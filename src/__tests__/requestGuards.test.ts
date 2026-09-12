import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  clearRequestRateLimitBuckets,
  enforceRateLimit,
  REQUEST_GUARD_ERROR_CODES,
} from "../lib/security/requestGuards";
import {
  API_PROOF_SESSION_COOKIE,
  clearRequestProofSigningKeyForTesting,
  createRequestProofSession,
} from "../lib/security/requestProof";
import {
  MemoryRateLimitStore,
  setRateLimitStoreForTesting,
  incrementRateLimitBucket,
  getRateLimitBucket,
  resetRateLimitBucket,
} from "../lib/security/rateLimitStore";

describe("request guard rate limiting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRequestRateLimitBuckets();
    clearRequestProofSigningKeyForTesting();
    setRateLimitStoreForTesting(null);
  });

  it("shares one quota across dynamic paths in the same route family", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    for (let i = 0; i < 30; i += 1) {
      const response = await enforceRateLimit(
        new NextRequest("https://neo.test/api/agents/a", {
          method: "GET",
          headers: { "x-forwarded-for": "203.0.113.10" },
        }),
      );
      expect(response).toBeNull();
    }

    const response = await enforceRateLimit(
      new NextRequest("https://neo.test/api/agents/b", {
        method: "GET",
        headers: { "x-forwarded-for": "203.0.113.10" },
      }),
    );
    const data = await response?.json();

    expect(response?.status).toBe(429);
    expect(data).toMatchObject({
      code: REQUEST_GUARD_ERROR_CODES.rateLimited,
      statusCode: 429,
    });
  });

  it("does not create a shared limiter bucket for an unknown client", async () => {
    for (let i = 0; i < 60; i += 1) {
      await expect(
        enforceRateLimit(
          new NextRequest("https://neo.test/api/agents/a", { method: "GET" }),
        ),
      ).resolves.toBeNull();
    }
  });

  it("keeps the unknown access bucket high enough to avoid login lockout", async () => {
    for (let i = 0; i < 300; i += 1) {
      await expect(
        enforceRateLimit(
          new NextRequest("https://neo.test/api/access/verify", {
            method: "POST",
          }),
        ),
      ).resolves.toBeNull();
    }

    const response = await enforceRateLimit(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
      }),
    );

    expect(response?.status).toBe(429);
  });

  it("bounds proof-session creation when client identity is unavailable", async () => {
    for (let i = 0; i < 30; i += 1) {
      await expect(
        enforceRateLimit(
          new NextRequest("https://neo.test/api/request-proof/session"),
        ),
      ).resolves.toBeNull();
    }

    const response = await enforceRateLimit(
      new NextRequest("https://neo.test/api/request-proof/session"),
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBeTruthy();
  });

  it("isolates hosted proof-session quotas when trusted client IP headers are unavailable", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "stable-test-key");
    setRateLimitStoreForTesting(new MemoryRateLimitStore());
    const firstProofSession = await createRequestProofSession();
    const secondProofSession = await createRequestProofSession();
    const proofHeaders = [firstProofSession, secondProofSession].map(
      (session) => ({
        cookie: `${API_PROOF_SESSION_COOKIE}=${session.cookieValue}`,
      }),
    );

    for (let i = 0; i < 30; i += 1) {
      await expect(
        enforceRateLimit(
          new NextRequest("https://neo.test/api/media/image-proxy", {
            method: "POST",
            headers: proofHeaders[0],
          }),
        ),
      ).resolves.toBeNull();
    }

    const response = await enforceRateLimit(
      new NextRequest("https://neo.test/api/media/image-proxy", {
        method: "POST",
        headers: proofHeaders[0],
      }),
    );

    expect(response?.status).toBe(429);
    expect(
      await enforceRateLimit(
        new NextRequest("https://neo.test/api/media/image-proxy", {
          method: "POST",
          headers: proofHeaders[1],
        }),
      ),
    ).toBeNull();
  });

  it("keeps hosted quotas in memory during a shared-store failure", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    setRateLimitStoreForTesting({
      increment: async () => {
        throw new Error("Upstash unavailable");
      },
      get: async () => {
        throw new Error("Upstash unavailable");
      },
      reset: async () => {
        throw new Error("Upstash unavailable");
      },
    });
    expect(await incrementRateLimitBucket("outage", 60_000, 1_000)).toEqual({
      count: 1,
      resetAt: 61_000,
    });
    expect(await incrementRateLimitBucket("outage", 60_000, 2_000)).toEqual({
      count: 2,
      resetAt: 61_000,
    });
    expect(await getRateLimitBucket("outage", 3_000)).toEqual({
      count: 2,
      resetAt: 61_000,
    });
    await resetRateLimitBucket("outage");
    expect(await getRateLimitBucket("outage", 3_000)).toBeNull();
  });
});
