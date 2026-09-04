import "server-only";
import { safeFetchText } from "@/lib/security/safeFetch";
import { safeFetchSharedStoreJson } from "@/lib/security/sharedStoreFetch";
import { getDeploymentMode } from "@/lib/security/deployment";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import type { ResearchSourceProvider } from "./catalog";
import { ResearchSourceError } from "./types";

export type ResearchSourceFetch = (
  url: string,
  init?: RequestInit,
  options?: { cache?: boolean; allowMissing?: boolean },
) => Promise<string>;
const GAP_MS: Record<ResearchSourceProvider, number> = {
  arxiv: 3_000,
  pubmed: 400,
  "epo-ops": 1_000,
  "sec-edgar": 200,
};
const HOSTS: Record<ResearchSourceProvider, string[]> = {
  arxiv: ["export.arxiv.org"],
  pubmed: ["eutils.ncbi.nlm.nih.gov"],
  "epo-ops": ["ops.epo.org"],
  "sec-edgar": ["www.sec.gov", "data.sec.gov"],
};
const cache = new Map<string, { expires: number; text: string }>();
const localLeases = new Map<string, { owner: string; until: number }>();

export async function hashSourceKey(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function waitForSource(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function redisCommand(args: unknown[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token)
    throw new ResearchSourceError(
      "Shared source coordination requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in hosted deployments.",
      "SOURCE_COORDINATION_UNAVAILABLE",
      503,
    );
  try {
    const { response, data } = await safeFetchSharedStoreJson<{
      result?: unknown;
      error?: unknown;
    }>(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!response.ok || data.error)
      throw new Error("Shared coordination failed");
    return data.result;
  } catch {
    throw new ResearchSourceError(
      "Shared source coordination is unavailable. Retry when the shared store is reachable.",
      "SOURCE_COORDINATION_UNAVAILABLE",
      503,
    );
  }
}
/** Lease covers the entire bounded request, then enforces a gap after completion. */
async function acquire(
  provider: ResearchSourceProvider,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  const key = `neo:research-source:lease:${provider}`;
  const owner = crypto.randomUUID();
  const shared =
    getDeploymentMode() === "hosted" ||
    Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim());
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    let acquired: boolean;
    if (shared)
      acquired =
        (await redisCommand(["SET", key, owner, "NX", "PX", 35_000])) === "OK";
    else {
      acquired = (localLeases.get(key)?.until ?? 0) <= Date.now();
      if (acquired) localLeases.set(key, { owner, until: Date.now() + 35_000 });
    }
    if (acquired)
      return async () => {
        if (shared) {
          await redisCommand([
            "EVAL",
            "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
            1,
            key,
            owner,
            GAP_MS[provider],
          ]);
        } else if (localLeases.get(key)?.owner === owner)
          localLeases.set(key, { owner, until: Date.now() + GAP_MS[provider] });
      };
    await waitForSource(150, signal);
  }
  throw new ResearchSourceError(
    "Source request queue is busy. Retry shortly.",
    "SOURCE_RATE_LIMITED",
    429,
  );
}
export function createResearchSourceFetch(
  provider: ResearchSourceProvider,
  signal?: AbortSignal,
  fetchText = safeFetchText,
): ResearchSourceFetch {
  return async (url, init = {}, options = {}) => {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !HOSTS[provider].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    )
      throw new ResearchSourceError(
        "Source endpoint is not allowed.",
        "SOURCE_ENDPOINT_INVALID",
      );
    const key = await hashSourceKey(
      JSON.stringify([
        provider,
        url,
        init.method ?? "GET",
        Array.from(new Headers(init.headers).entries()),
        init.body ?? "",
      ]),
    );
    signal?.throwIfAborted();
    const cached = options.cache !== false ? cache.get(key) : undefined;
    if (cached && cached.expires > Date.now()) return cached.text;
    for (let attempt = 0; attempt < 2; attempt++) {
      const release = await acquire(provider, signal);
      let result: Awaited<ReturnType<typeof safeFetchText>>;
      try {
        signal?.throwIfAborted();
        result = await fetchText(
          url,
          { ...init, cache: "no-store", redirect: "manual" },
          {
            signal,
            timeoutMs: 15_000,
            maxResponseBytes: 8 * 1024 * 1024,
            enforceResponseLimits: true,
            policy: {
              ...getSafeUrlPolicy("plugin"),
              allowedProtocols: ["https:"],
              allowedHosts: HOSTS[provider],
              maxRedirects: 0,
            },
          },
        );
      } finally {
        await release();
      }
      if (options.allowMissing && result.response.status === 404) return "";
      if (result.response.status === 429 || result.response.status >= 500) {
        const retryHeader = result.response.headers.get("retry-after");
        const retryMs = retryHeader
          ? /^\d+$/.test(retryHeader)
            ? Number(retryHeader) * 1000
            : Math.max(0, Date.parse(retryHeader) - Date.now())
          : GAP_MS[provider];
        if (attempt === 0 && Number.isFinite(retryMs) && retryMs <= 5_000) {
          await waitForSource(Math.max(retryMs, GAP_MS[provider]), signal);
          continue;
        }
        throw new ResearchSourceError(
          "Source rate limit or temporary outage. Retry later.",
          "SOURCE_RATE_LIMITED",
          429,
        );
      }
      if (result.response.status === 401 || result.response.status === 403)
        throw new ResearchSourceError(
          "Source rejected authentication or access. Check its configuration and quota.",
          "SOURCE_AUTH_FAILED",
          403,
        );
      if (!result.response.ok)
        throw new ResearchSourceError(
          `Source request failed (HTTP ${result.response.status}).`,
          "SOURCE_REQUEST_FAILED",
          502,
        );
      if (options.cache !== false) {
        // Bound both entry count and total retained body size.
        if (result.text.length <= 500_000) {
          if (cache.size >= 32) cache.delete(cache.keys().next().value!);
          cache.set(key, {
            text: result.text,
            expires: Date.now() + 5 * 60_000,
          });
        }
      }
      return result.text;
    }
    throw new ResearchSourceError(
      "Source is unavailable.",
      "SOURCE_REQUEST_FAILED",
      502,
    );
  };
}
export function clearResearchSourceTransportForTests() {
  cache.clear();
  localLeases.clear();
}
