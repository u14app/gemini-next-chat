import { safeFetchSharedStoreJson } from "./sharedStoreFetch";

export interface RateLimitResult {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  get?(key: string, now?: number): Promise<RateLimitResult | null>;
  increment(
    key: string,
    windowMs: number,
    now?: number,
  ): Promise<RateLimitResult>;
  reset?(key: string): Promise<void>;
  clear?(): void;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

declare global {
  var __neoChatRateLimitBuckets: Map<string, RateLimitBucket> | undefined;
  var __neoChatRateLimitNextSweepAt: number | undefined;
}

function getMemoryBuckets(): Map<string, RateLimitBucket> {
  if (!globalThis.__neoChatRateLimitBuckets) {
    globalThis.__neoChatRateLimitBuckets = new Map();
  }
  return globalThis.__neoChatRateLimitBuckets;
}

export class MemoryRateLimitStore implements RateLimitStore {
  async get(key: string, now = Date.now()): Promise<RateLimitResult | null> {
    const current = getMemoryBuckets().get(key);
    if (!current) return null;
    if (current.resetAt <= now) {
      getMemoryBuckets().delete(key);
      return null;
    }
    return { count: current.count, resetAt: current.resetAt };
  }

  async increment(
    key: string,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const buckets = getMemoryBuckets();
    // Proof nonces create unique keys, so expiration cannot rely only on reads
    // of the same bucket when hosted requests use the memory fallback.
    if (now >= (globalThis.__neoChatRateLimitNextSweepAt ?? 0)) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      globalThis.__neoChatRateLimitNextSweepAt = now + 60_000;
    }
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      buckets.set(key, next);
      return next;
    }

    current.count += 1;
    return { count: current.count, resetAt: current.resetAt };
  }

  async reset(key: string): Promise<void> {
    getMemoryBuckets().delete(key);
  }

  clear(): void {
    getMemoryBuckets().clear();
    globalThis.__neoChatRateLimitNextSweepAt = undefined;
  }
}

class UpstashRateLimitStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private get endpoint(): string {
    return `${this.url.replace(/\/+$/, "")}/pipeline`;
  }

  async get(key: string, now = Date.now()): Promise<RateLimitResult | null> {
    const { response, data } = await safeFetchSharedStoreJson<
      Array<{ result?: unknown }>
    >(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["GET", key],
        ["PTTL", key],
      ]),
    });

    if (!response.ok) {
      throw new Error(`Rate limit store failed with status ${response.status}`);
    }

    const count = Number(data[0]?.result);
    const ttlMs = Number(data[1]?.result);
    if (
      !Number.isFinite(count) ||
      count < 1 ||
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0
    ) {
      return null;
    }

    return { count, resetAt: now + ttlMs };
  }

  async increment(
    key: string,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const { response, data } = await safeFetchSharedStoreJson<
      Array<{ result?: unknown }>
    >(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
    });

    if (!response.ok) {
      throw new Error(`Rate limit store failed with status ${response.status}`);
    }

    const count = Number(data[0]?.result);
    const ttlMs = Number(data[2]?.result);

    if (!Number.isFinite(count) || count < 1) {
      throw new Error("Rate limit store returned an invalid count");
    }

    const resetAt =
      now + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : windowMs);
    return { count, resetAt };
  }

  async reset(key: string): Promise<void> {
    await safeFetchSharedStoreJson(
      `${this.url.replace(/\/+$/, "")}/del/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );
  }
}

let cachedRateLimitStore: RateLimitStore | null = null;
const fallbackMemoryStore = new MemoryRateLimitStore();

function env(name: string): string {
  if (typeof process === "undefined") return "";
  return process.env[name]?.trim() || "";
}

function isSharedStoreName(store: string): boolean {
  return store === "upstash" || store === "redis" || store === "kv";
}

export function createRateLimitStore(): RateLimitStore {
  const store = env("RATE_LIMIT_STORE").toLowerCase();
  const upstashUrl = env("UPSTASH_REDIS_REST_URL");
  const upstashToken = env("UPSTASH_REDIS_REST_TOKEN");

  if (isSharedStoreName(store) && upstashUrl && upstashToken) {
    return new UpstashRateLimitStore(upstashUrl, upstashToken);
  }

  return fallbackMemoryStore;
}

export function getRateLimitStore(): RateLimitStore {
  if (!cachedRateLimitStore) cachedRateLimitStore = createRateLimitStore();
  return cachedRateLimitStore;
}

export function setRateLimitStoreForTesting(
  store: RateLimitStore | null,
): void {
  cachedRateLimitStore = store;
}

export async function incrementRateLimitBucket(
  key: string,
  windowMs: number,
  now?: number,
): Promise<RateLimitResult> {
  try {
    return await getRateLimitStore().increment(key, windowMs, now);
  } catch {
    return fallbackMemoryStore.increment(key, windowMs, now);
  }
}

export async function getRateLimitBucket(
  key: string,
  now?: number,
): Promise<RateLimitResult | null> {
  try {
    const current = await getRateLimitStore().get?.(key, now);
    if (current) return current;
  } catch {
    // Fall back to memory state below.
  }
  return fallbackMemoryStore.get(key, now);
}

export async function resetRateLimitBucket(key: string): Promise<void> {
  try {
    await getRateLimitStore().reset?.(key);
  } catch {
    // Keep request handling available even if the external store is unavailable.
  }
  await fallbackMemoryStore.reset(key);
}

export function clearRateLimitStoreForTesting(): void {
  fallbackMemoryStore.clear();
  cachedRateLimitStore?.clear?.();
  cachedRateLimitStore = null;
}
