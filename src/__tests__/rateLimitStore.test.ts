import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRateLimitStoreForTesting,
  incrementRateLimitBucket,
  setRateLimitStoreForTesting,
} from "../lib/security/rateLimitStore";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

describe("rate limit store", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    lookupMock.mockReset();
    clearRateLimitStoreForTesting();
  });

  it("keeps the memory fallback available in local mode", async () => {
    await expect(
      incrementRateLimitBucket("local:key", 1_000, 1_000),
    ).resolves.toMatchObject({
      count: 1,
      resetAt: 2_000,
    });
  });

  it("removes expired unique proof-nonce buckets during later requests", async () => {
    await incrementRateLimitBucket("nonce:expired", 1_000, 1_000);
    await incrementRateLimitBucket("nonce:next", 1_000, 62_000);
    expect(globalThis.__neoChatRateLimitBuckets?.has("nonce:expired")).toBe(
      false,
    );
    expect(globalThis.__neoChatRateLimitBuckets?.has("nonce:next")).toBe(true);
  });

  it("uses memory when hosted shared storage is absent", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");

    await expect(
      incrementRateLimitBucket("hosted:key", 1_000, 1_000),
    ).resolves.toEqual({ count: 1, resetAt: 2_000 });
  });

  it("falls back to memory when the hosted rate limit store fails", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    setRateLimitStoreForTesting({
      increment: async () => {
        throw new Error("shared store unavailable");
      },
    });

    await expect(
      incrementRateLimitBucket("hosted:key", 1_000, 1_000),
    ).resolves.toEqual({ count: 1, resetAt: 2_000 });
  });

  it("allows hosted shared store requests to private HTTPS addresses", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("RATE_LIMIT_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://127.0.0.1:8787");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json([{ result: 1 }, { result: 1_000 }]));

    await expect(
      incrementRateLimitBucket("hosted:key", 1_000, 1_000),
    ).resolves.toEqual({ count: 1, resetAt: 2_000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps hosted shared store requests HTTPS-only", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("RATE_LIMIT_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "http://127.0.0.1:8787");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      incrementRateLimitBucket("hosted:key", 1_000, 1_000),
    ).resolves.toEqual({ count: 1, resetAt: 2_000 });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
