import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const repository = vi.hoisted(() => ({
  publish: vi.fn(),
  get: vi.fn(),
  revoke: vi.fn(),
  getAsset: vi.fn(),
}));
vi.mock("@/lib/sharing/server", () => ({ shareRepository: repository }));
vi.mock("@/lib/security/requestGuards", () => ({
  applyRequestGuards: vi.fn(async () => null),
}));
vi.mock("@/lib/security/accessControl", () => ({
  ACCESS_ATTEMPTS_COOKIE: "attempts",
  ACCESS_SESSION_COOKIE: "session",
  ACCESS_ERROR_CODES: {
    required: "ACCESS_PASSWORD_REQUIRED",
    locked: "LOCKED",
  },
  isAccessPasswordEnabled: () => true,
  isValidAccessSessionCookie: async () => false,
  getAccessAttemptState: async () => ({ attempts: 0 }),
  isAccessLocked: () => false,
}));
import { POST } from "@/app/api/shares/route";
import { GET, PUT, DELETE } from "@/app/api/shares/[id]/route";
import { GET as GET_ASSET } from "@/app/api/shares/[id]/assets/[assetId]/route";
import { getPublicServerConfig } from "@/lib/defaultConfig/server";
import { middleware } from "@/middleware";
import { isSharingAvailable } from "@/lib/sharing/config";
import { SHARE_LIMITS, SHARE_OWNER_HEADER } from "@/lib/sharing/types";

const id = "s".repeat(43);
const owner = "o".repeat(43);
const context = { params: Promise.resolve({ id }) };
const payload = {
  id,
  operationId: "p".repeat(43),
  expectedRevision: 0,
  snapshot: { schemaVersion: 1, title: "Example", createdAt: 1, messages: [] },
  assets: [],
};
const request = (method: string, body?: unknown, token?: string) =>
  new Request(`https://neo.test/api/shares/${id}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { [SHARE_OWNER_HEADER]: token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHARING_ENABLED", "true");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-only-token");
});
afterEach(() => vi.unstubAllEnvs());

describe("share handlers", () => {
  it("advertises enabled sharing only when both Redis credentials are configured", () => {
    expect(isSharingAvailable()).toBe(true);
    expect(getPublicServerConfig().sharing).toEqual({ available: true });
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", " ");
    expect(isSharingAvailable()).toBe(false);
    expect(getPublicServerConfig().sharing).toEqual({ available: false });
  });

  it.each([undefined, "", "false", "1", "invalid"])(
    "disables publication and public reads when SHARING_ENABLED is %s",
    async (value) => {
      vi.stubEnv("SHARING_ENABLED", value);
      expect(isSharingAvailable()).toBe(false);
      expect(getPublicServerConfig().sharing).toEqual({ available: false });
      const responses = await Promise.all([
        POST(request("POST", payload, owner)),
        PUT(request("PUT", payload, owner), context),
        GET(request("GET"), context),
        GET_ASSET(request("GET"), {
          params: Promise.resolve({ id, assetId: "a".repeat(64) }),
        }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
          code: "SHARING_UNAVAILABLE",
        });
      }
      expect(repository.publish).not.toHaveBeenCalled();
      expect(repository.get).not.toHaveBeenCalled();
      expect(repository.getAsset).not.toHaveBeenCalled();
    },
  );

  it("recognizes an explicit true value regardless of whitespace and casing", () => {
    vi.stubEnv("SHARING_ENABLED", " TRUE ");
    expect(isSharingAvailable()).toBe(true);
  });

  it("keeps authenticated revocation available while sharing is disabled", async () => {
    vi.stubEnv("SHARING_ENABLED", "false");
    expect((await DELETE(request("DELETE"), context)).status).toBe(403);
    expect(repository.revoke).not.toHaveBeenCalled();
    expect(
      (await DELETE(request("DELETE", undefined, owner), context)).status,
    ).toBe(200);
    expect(repository.revoke).toHaveBeenCalledWith(id, owner);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(
      (await DELETE(request("DELETE", undefined, owner), context)).status,
    ).toBe(503);
    expect(repository.revoke).toHaveBeenCalledTimes(1);
  });

  it("does not create memory-backed shares when Redis is unconfigured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect((await POST(request("POST", payload, owner))).status).toBe(503);
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("requires owner credentials for every mutation", async () => {
    expect((await POST(request("POST", payload))).status).toBe(403);
    expect((await PUT(request("PUT", payload), context)).status).toBe(403);
    expect((await DELETE(request("DELETE"), context)).status).toBe(403);
    expect(repository.publish).not.toHaveBeenCalled();
    expect(repository.revoke).not.toHaveBeenCalled();
  });

  it("returns only public content with cache and indexing disabled", async () => {
    repository.get.mockResolvedValue({ id, snapshot: payload.snapshot });
    const response = await GET(request("GET"), context);
    expect(await response.json()).toEqual({ id, snapshot: payload.snapshot });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects an oversized body before publication", async () => {
    const oversized = new Request("https://neo.test/api/shares", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SHARE_OWNER_HEADER]: owner,
        "Content-Length": String(SHARE_LIMITS.requestBytes + 1),
      },
      body: JSON.stringify(payload),
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("rejects a mismatched update target", async () => {
    expect(
      (
        await PUT(
          request("PUT", { ...payload, id: "x".repeat(43) }, owner),
          context,
        )
      ).status,
    ).toBe(400);
    expect(repository.publish).not.toHaveBeenCalled();
  });
});

describe("site password sharing exception", () => {
  it("adds a per-request hosted CSP nonce to application HTML", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    const response = await middleware(new NextRequest("https://neo.test/"));
    const csp = response.headers.get("content-security-policy") || "";
    const nextResponse = await middleware(new NextRequest("https://neo.test/"));
    const nextCsp = nextResponse.headers.get("content-security-policy") || "";
    const scriptSrc = csp.match(/script-src[^;]+/)?.[0] || "";

    expect(csp).toMatch(/'nonce-[a-f0-9]{32}'/);
    expect(nextCsp).toMatch(/'nonce-[a-f0-9]{32}'/);
    expect(nextCsp).not.toBe(csp);
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("marks the public HTML page no-store and no-referrer without requiring the site password", async () => {
    const response = await middleware(
      new NextRequest(`https://neo.test/share/${id}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("allows only exact public share GETs without the site password", async () => {
    expect(
      (await middleware(new NextRequest(`https://neo.test/api/shares/${id}`)))
        .status,
    ).toBe(200);
    expect(
      (
        await middleware(
          new NextRequest(
            `https://neo.test/api/shares/${id}/assets/${"a".repeat(64)}`,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await middleware(
          new NextRequest(`https://neo.test/api/shares/${id}`, {
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await middleware(
          new NextRequest(`https://neo.test/api/shares/${id}/private`),
        )
      ).status,
    ).toBe(401);
    expect(
      (await middleware(new NextRequest("https://neo.test/api/config"))).status,
    ).toBe(401);
  });
});
