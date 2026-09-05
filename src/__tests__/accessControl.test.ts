import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { API_INPUT_LIMITS } from "../config/limits";
import {
  ACCESS_ATTEMPTS_COOKIE,
  ACCESS_ERROR_CODES,
  ACCESS_LOCKOUT_MS,
  ACCESS_MAX_ATTEMPTS,
  ACCESS_SESSION_COOKIE,
  createAccessAttemptCookieValue,
  createAccessSessionCookieValue,
  getAccessAttemptState,
  isAccessLocked,
  isAccessPasswordEnabled,
  isValidAccessPassword,
  isValidAccessSessionCookie,
  recordAccessPasswordFailure,
} from "../lib/security/accessControl";
import {
  applyRequestGuards,
  clearRequestRateLimitBuckets,
  getRateLimitClientIp,
  REQUEST_GUARD_ERROR_CODES,
} from "../lib/security/requestGuards";
import { config as proxyConfig, middleware as proxy } from "../middleware";

vi.mock("@/lib/security/accessControl", async () =>
  vi.importActual("../lib/security/accessControl"),
);

function extractCookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] || "";
}

function makeVerifyRequest(
  password: string,
  cookieHeader?: string,
): NextRequest {
  return new NextRequest("https://neo.test/api/access/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ password }),
  });
}

describe("access control helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRequestRateLimitBuckets();
  });

  it("is disabled when ACCESS_PASSWORD has no non-empty values", () => {
    for (const value of ["", " , , "]) {
      vi.stubEnv("ACCESS_PASSWORD", value);
      expect(isAccessPasswordEnabled()).toBe(false);
    }
  });

  it("validates signed session cookies and rejects tampering or env changes", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");

    const cookieValue = await createAccessSessionCookieValue();
    expect(await isValidAccessSessionCookie(cookieValue)).toBe(true);
    expect(await isValidAccessSessionCookie(`${cookieValue}x`)).toBe(false);

    vi.stubEnv("ACCESS_PASSWORD", "changed");
    expect(await isValidAccessSessionCookie(cookieValue)).toBe(false);
  });

  it("tracks failures and locks after the configured attempt limit", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const now = 1_700_000_000_000;

    const first = await recordAccessPasswordFailure(undefined, now);
    expect(first.attempts).toBe(1);
    expect(first.remainingAttempts).toBe(ACCESS_MAX_ATTEMPTS - 1);
    expect(first.lockedUntil).toBeUndefined();

    const second = await recordAccessPasswordFailure(
      first.cookieValue,
      now + 1,
    );
    expect(second.attempts).toBe(2);
    expect(second.remainingAttempts).toBe(ACCESS_MAX_ATTEMPTS - 2);
    expect(second.lockedUntil).toBeUndefined();

    const third = await recordAccessPasswordFailure(
      second.cookieValue,
      now + 2,
    );
    expect(third.attempts).toBe(ACCESS_MAX_ATTEMPTS);
    expect(third.remainingAttempts).toBe(0);
    expect(third.lockedUntil).toBe(now + 2 + ACCESS_LOCKOUT_MS);

    const locked = await getAccessAttemptState(third.cookieValue, now + 3);
    expect(isAccessLocked(locked, now + 3)).toBe(true);

    const expired = await getAccessAttemptState(
      third.cookieValue,
      third.lockedUntil! + 1,
    );
    expect(expired).toEqual({ attempts: 0 });
  });

  it("validates access passwords with a timing-safe helper", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");

    await expect(isValidAccessPassword("secret")).resolves.toBe(true);
    await expect(isValidAccessPassword("wrong")).resolves.toBe(false);
    await expect(isValidAccessPassword("")).resolves.toBe(false);
  });

  it("validates every non-empty comma-separated access password", async () => {
    vi.stubEnv("ACCESS_PASSWORD", " primary, secondary ,, tertiary ");

    await expect(isValidAccessPassword("primary")).resolves.toBe(true);
    await expect(isValidAccessPassword("secondary")).resolves.toBe(true);
    await expect(isValidAccessPassword("tertiary")).resolves.toBe(true);
    await expect(isValidAccessPassword("wrong")).resolves.toBe(false);
    await expect(isValidAccessPassword("primary,secondary")).resolves.toBe(
      false,
    );
  });
});

describe("access password verification route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRequestRateLimitBuckets();
  });

  it("sets a valid session cookie for the correct password", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "primary, secondary");
    const { POST } = await import("../app/api/access/verify/route");

    const response = await POST(makeVerifyRequest("secondary"));
    const setCookie = response.headers.get("set-cookie") || "";
    const sessionValue = extractCookieValue(setCookie, ACCESS_SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sessionValue).toBeTruthy();
    expect(await isValidAccessSessionCookie(sessionValue)).toBe(true);
    expect(setCookie).toContain(`${ACCESS_ATTEMPTS_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("returns 401 for invalid passwords before the lock threshold", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const { POST } = await import("../app/api/access/verify/route");

    const response = await POST(makeVerifyRequest("wrong"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({
      code: ACCESS_ERROR_CODES.invalid,
      remainingAttempts: ACCESS_MAX_ATTEMPTS - 1,
    });
  });

  it("rejects oversized verification bodies before parsing unauthenticated JSON", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const { POST } = await import("../app/api/access/verify/route");

    const response = await POST(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(API_INPUT_LIMITS.maxJsonBodyBytes + 1),
        },
        body: JSON.stringify({ password: "secret" }),
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("locks on the third invalid password and keeps rejecting while locked", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const { POST } = await import("../app/api/access/verify/route");

    const first = await POST(makeVerifyRequest("wrong"));
    const firstAttempts = extractCookieValue(
      first.headers.get("set-cookie") || "",
      ACCESS_ATTEMPTS_COOKIE,
    );
    const second = await POST(
      makeVerifyRequest("wrong", `${ACCESS_ATTEMPTS_COOKIE}=${firstAttempts}`),
    );
    const secondAttempts = extractCookieValue(
      second.headers.get("set-cookie") || "",
      ACCESS_ATTEMPTS_COOKIE,
    );
    const third = await POST(
      makeVerifyRequest("wrong", `${ACCESS_ATTEMPTS_COOKIE}=${secondAttempts}`),
    );
    const thirdData = await third.json();

    expect(third.status).toBe(423);
    expect(thirdData.code).toBe(ACCESS_ERROR_CODES.locked);
    expect(thirdData.lockedUntil).toEqual(expect.any(Number));

    const thirdAttempts = extractCookieValue(
      third.headers.get("set-cookie") || "",
      ACCESS_ATTEMPTS_COOKIE,
    );
    const locked = await POST(
      makeVerifyRequest("secret", `${ACCESS_ATTEMPTS_COOKIE}=${thirdAttempts}`),
    );
    const lockedData = await locked.json();

    expect(locked.status).toBe(423);
    expect(lockedData.code).toBe(ACCESS_ERROR_CODES.locked);
  });

  it("keeps access failures server-side when the attempt cookie is cleared", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const { POST } = await import("../app/api/access/verify/route");

    const headers = { "x-forwarded-for": "203.0.113.44" };
    await POST(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    await POST(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    const third = await POST(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    expect(third.status).toBe(423);

    const locked = await POST(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "secret" }),
      }),
    );
    const data = await locked.json();

    expect(locked.status).toBe(423);
    expect(data.code).toBe(ACCESS_ERROR_CODES.locked);
  });

  it("does not globally lock unknown clients when proxy headers are untrusted", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    const { POST } = await import("../app/api/access/verify/route");

    for (const ip of ["203.0.113.44", "203.0.113.45", "203.0.113.46"]) {
      const response = await POST(
        new NextRequest("https://neo.test/api/access/verify", {
          method: "POST",
          headers: {
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ password: "wrong" }),
        }),
      );
      expect(response.status).toBe(401);
    }

    const response = await POST(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.47",
        },
        body: JSON.stringify({ password: "secret" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("access proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRequestRateLimitBuckets();
  });

  it("matches API and public reading routes", () => {
    expect(proxyConfig.matcher).toEqual(["/api/:path*", "/share/:path*"]);
  });

  it("keeps public reading pages uncached and unindexed behind a site password", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const response = await proxy(
      new NextRequest(`https://neo.test/share/${"A".repeat(43)}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("allows API requests when access password is disabled", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");

    const response = await proxy(
      new NextRequest("https://neo.test/api/config"),
    );
    expect(response.status).toBe(200);
  });

  it("allows the verification route without a session", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");

    const response = await proxy(
      new NextRequest("https://neo.test/api/access/verify"),
    );
    expect(response.status).toBe(200);
  });

  it("rejects cross-origin mutating API requests before route handling", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");

    const response = await proxy(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
        },
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe(REQUEST_GUARD_ERROR_CODES.csrf);
    expect(data.statusCode).toBe(403);
  });

  it("rejects browser same-site mutating API requests without an Origin header", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");

    const response = await proxy(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-site",
        },
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe(REQUEST_GUARD_ERROR_CODES.csrf);
    expect(data.statusCode).toBe(403);
  });

  it("allows controlled server-side mutating API requests without browser fetch metadata", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");

    const response = await proxy(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("fails closed for production local API deployments without access control", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.stubEnv("ACCESS_PASSWORD", " , , ");
    vi.stubEnv("ALLOW_INSECURE_LOCAL_PRODUCTION", "");

    const response = await applyRequestGuards(
      new NextRequest("https://neo.test/api/search", {
        method: "POST",
        headers: {
          origin: "https://neo.test",
        },
      }),
    );
    const data = await response?.json();

    expect(response?.status).toBe(503);
    expect(data).toMatchObject({
      code: REQUEST_GUARD_ERROR_CODES.productionLocalOpen,
      statusCode: 503,
    });
  });

  it("allows explicit insecure local production opt-in for private deployments", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("ALLOW_INSECURE_LOCAL_PRODUCTION", "true");

    const response = await applyRequestGuards(
      new NextRequest("https://neo.test/api/search", {
        method: "POST",
        headers: {
          origin: "https://neo.test",
        },
      }),
    );

    expect(response).toBeNull();
  });

  it("rate limits repeated access verification attempts server-side", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");

    let response = await proxy(
      new NextRequest("https://neo.test/api/access/verify", {
        method: "POST",
        headers: {
          origin: "https://neo.test",
          "x-forwarded-for": "203.0.113.10",
        },
      }),
    );

    for (let i = 0; i < 300; i += 1) {
      response = await proxy(
        new NextRequest("https://neo.test/api/access/verify", {
          method: "POST",
          headers: {
            origin: "https://neo.test",
            "x-forwarded-for": "203.0.113.10",
          },
        }),
      );
    }

    const data = await response.json();
    expect(response.status).toBe(429);
    expect(data.code).toBe(REQUEST_GUARD_ERROR_CODES.rateLimited);
    expect(data.statusCode).toBe(429);
    expect(data.retryAfter).toEqual(expect.any(Number));
  });

  it("does not trust forwarded client IP headers unless proxy trust is enabled", () => {
    const request = new NextRequest("https://neo.test/api/chat", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.88, 198.51.100.2",
        "x-real-ip": "198.51.100.3",
      },
    });

    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    expect(getRateLimitClientIp(request)).toBe("unknown");

    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(getRateLimitClientIp(request)).toBe("203.0.113.88");
  });

  it("rate limits high-cost GET API routes before route handling", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");

    let response: Response | null = null;
    for (let i = 0; i < 16; i += 1) {
      response = await applyRequestGuards(
        new NextRequest("https://neo.test/api/plugins/list", {
          method: "GET",
          headers: {
            "x-forwarded-for": "203.0.113.55",
          },
        }),
      );
    }

    const data = await response?.json();
    expect(response?.status).toBe(429);
    expect(data).toMatchObject({
      code: REQUEST_GUARD_ERROR_CODES.rateLimited,
      statusCode: 429,
    });
  });

  it("rate limits provider model POST requests with the high-cost provider rule", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");

    let response: Response | null = null;
    for (let i = 0; i < 31; i += 1) {
      response = await applyRequestGuards(
        new NextRequest("https://neo.test/api/providers/models", {
          method: "POST",
          headers: {
            origin: "https://neo.test",
            "x-forwarded-for": "203.0.113.56",
          },
        }),
      );
    }

    const data = await response?.json();
    expect(response?.status).toBe(429);
    expect(data).toMatchObject({
      code: REQUEST_GUARD_ERROR_CODES.rateLimited,
      statusCode: 429,
    });
  });

  it("rate limits MCP server registry GET requests before route handling", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");

    let response: Response | null = null;
    for (let i = 0; i < 31; i += 1) {
      response = await applyRequestGuards(
        new NextRequest("https://neo.test/api/mcp/servers?limit=1", {
          method: "GET",
          headers: {
            "x-forwarded-for": "203.0.113.57",
          },
        }),
      );
    }

    const data = await response?.json();
    expect(response?.status).toBe(429);
    expect(data).toMatchObject({
      code: REQUEST_GUARD_ERROR_CODES.rateLimited,
      statusCode: 429,
    });
  });

  it("rejects API requests without a valid session", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");

    const response = await proxy(
      new NextRequest("https://neo.test/api/config"),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe(ACCESS_ERROR_CODES.required);
  });

  it("allows API requests with a valid session cookie", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const sessionValue = await createAccessSessionCookieValue();

    const response = await proxy(
      new NextRequest("https://neo.test/api/config", {
        headers: { cookie: `${ACCESS_SESSION_COOKIE}=${sessionValue}` },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects API requests while the browser is locked", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const attemptsValue = await createAccessAttemptCookieValue({
      attempts: ACCESS_MAX_ATTEMPTS,
      lockedUntil: Date.now() + ACCESS_LOCKOUT_MS,
    });

    const response = await proxy(
      new NextRequest("https://neo.test/api/config", {
        headers: { cookie: `${ACCESS_ATTEMPTS_COOKIE}=${attemptsValue}` },
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(423);
    expect(data.code).toBe(ACCESS_ERROR_CODES.locked);
  });
});
