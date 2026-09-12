import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  API_PROOF_ERROR_CODES,
  API_PROOF_SESSION_COOKIE,
  createRequestProofHeaders,
  createRequestProofSession,
  clearRequestProofSigningKeyForTesting,
  getApiProofPublicStatus,
} from "../lib/security/requestProof";
import {
  MemoryRateLimitStore,
  setRateLimitStoreForTesting,
} from "../lib/security/rateLimitStore";
import { middleware as proxy } from "../middleware";

function hostedEnv(privateKey = "stable-proof-private-key") {
  vi.stubEnv("DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("ACCESS_PASSWORD", "");
  vi.stubEnv("BYOK_PRIVATE_KEY_PEM", privateKey);
  setRateLimitStoreForTesting(new MemoryRateLimitStore());
}

function protectedRequest(
  headers: Record<string, string> = {},
  path = "/api/chat",
) {
  return new NextRequest(`https://neo.test${path}`, {
    method: "POST",
    headers: {
      origin: "https://neo.test",
      ...headers,
    },
  });
}

describe("API request proof middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setRateLimitStoreForTesting(null);
    clearRequestProofSigningKeyForTesting();
  });

  it("rejects hosted protected API requests without request proof", async () => {
    hostedEnv();

    const response = await proxy(protectedRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({
      code: API_PROOF_ERROR_CODES.required,
      statusCode: 401,
    });
  });

  it("requires a session instead of blocking configuration when hosted BYOK is missing", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "");

    const response = await proxy(protectedRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({
      code: API_PROOF_ERROR_CODES.required,
      statusCode: 401,
    });
    expect(getApiProofPublicStatus()).toMatchObject({
      enabled: true,
      configured: true,
      ephemeral: true,
    });
  });

  it("accepts ephemeral proof without shared stores and renews it after a process restart", async () => {
    hostedEnv("");
    vi.stubEnv("BYOK_ALLOW_EPHEMERAL_KEY", "false");
    vi.stubEnv("RATE_LIMIT_STORE", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    setRateLimitStoreForTesting(null);
    const session = await createRequestProofSession();
    const request = async (current: typeof session, nonce: string) =>
      protectedRequest({
        cookie: `${API_PROOF_SESSION_COOKIE}=${current.cookieValue}`,
        ...(await createRequestProofHeaders({
          clientKey: current.clientKey,
          method: "POST",
          target: "/api/chat",
          timestamp: Date.now(),
          nonce,
        })),
      });
    expect(
      (await proxy(await request(session, "nonce-before-restart"))).status,
    ).toBe(200);
    clearRequestProofSigningKeyForTesting();
    expect(
      (await proxy(await request(session, "nonce-after-restart"))).status,
    ).toBe(401);
    const renewed = await createRequestProofSession();
    expect(
      (await proxy(await request(renewed, "nonce-renewed-session"))).status,
    ).toBe(200);
  });

  it("issues bootstrap cookies in middleware that validate on subsequent requests", async () => {
    hostedEnv("");
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    setRateLimitStoreForTesting(null);
    const response = await proxy(
      new NextRequest("https://neo.test/api/request-proof/session"),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.cookies.get(API_PROOF_SESSION_COOKIE)?.httpOnly).toBe(true);
    const session = await response.json();
    const headers = await createRequestProofHeaders({
      clientKey: session.clientKey,
      method: "POST",
      target: "/api/chat",
      timestamp: session.serverTime,
      nonce: "bootstrap-cookie-proof",
    });
    const result = await proxy(
      protectedRequest({
        cookie: `${API_PROOF_SESSION_COOKIE}=${response.cookies.get(API_PROOF_SESSION_COOKIE)!.value}`,
        ...headers,
      }),
    );
    expect(result.status).toBe(200);
  });

  it("allows hosted protected API requests with valid request proof", async () => {
    hostedEnv();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const session = await createRequestProofSession(now);
    const proofHeaders = await createRequestProofHeaders({
      clientKey: session.clientKey,
      method: "POST",
      target: "/api/chat",
      timestamp: now,
      nonce: "nonce-valid",
    });

    const response = await proxy(
      protectedRequest({
        cookie: `${API_PROOF_SESSION_COOKIE}=${session.cookieValue}`,
        ...proofHeaders,
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects replayed request proof nonces within the proof window", async () => {
    hostedEnv();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const session = await createRequestProofSession(now);
    const proofHeaders = await createRequestProofHeaders({
      clientKey: session.clientKey,
      method: "POST",
      target: "/api/chat",
      timestamp: now,
      nonce: "nonce-replayed",
    });

    const firstResponse = await proxy(
      protectedRequest({
        cookie: `${API_PROOF_SESSION_COOKIE}=${session.cookieValue}`,
        ...proofHeaders,
      }),
    );
    const replayResponse = await proxy(
      protectedRequest({
        cookie: `${API_PROOF_SESSION_COOKIE}=${session.cookieValue}`,
        ...proofHeaders,
      }),
    );
    const data = await replayResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(401);
    expect(data).toMatchObject({
      code: API_PROOF_ERROR_CODES.invalid,
      statusCode: 401,
    });
  });

  it("rejects hosted protected API requests with expired request proof", async () => {
    hostedEnv();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const session = await createRequestProofSession(now);
    const proofHeaders = await createRequestProofHeaders({
      clientKey: session.clientKey,
      method: "POST",
      target: "/api/chat",
      timestamp: now - 61_000,
      nonce: "nonce-expired",
    });

    const response = await proxy(
      protectedRequest({
        cookie: `${API_PROOF_SESSION_COOKIE}=${session.cookieValue}`,
        ...proofHeaders,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({
      code: API_PROOF_ERROR_CODES.expired,
      statusCode: 401,
    });
  });

  it("does not require request proof for local mode or public bootstrap APIs", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.stubEnv("ACCESS_PASSWORD", "");

    await expect(proxy(protectedRequest())).resolves.toMatchObject({
      status: 200,
    });

    hostedEnv();
    await expect(
      proxy(new NextRequest("https://neo.test/api/config")),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      proxy(new NextRequest("https://neo.test/api/request-proof/session")),
    ).resolves.toMatchObject({ status: 200 });
  });
});
