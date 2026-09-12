import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  clearRateLimitStoreForTesting,
  incrementRateLimitBucket,
} from "./rateLimitStore";
import {
  getApiRateLimitPolicy,
  isMutatingApiRouteMethod,
} from "./apiRoutePolicy";
import { getDeploymentMode } from "./deployment";
import {
  enforceApiRequestProof,
  getRequestProofRateLimitIdentity,
  isApiProofProtectedPath,
} from "./requestProof";
import { isAccessPasswordEnabled } from "./accessControl";

export const REQUEST_GUARD_ERROR_CODES = {
  csrf: "CSRF_ORIGIN_BLOCKED",
  rateLimited: "RATE_LIMITED",
  productionLocalOpen: "PRODUCTION_LOCAL_OPEN_API_BLOCKED",
  sharedStoreRequired: "SHARED_STORE_REQUIRED",
} as const;

function jsonError(
  status: number,
  payload: Record<string, unknown>,
): NextResponse {
  const response = NextResponse.json(
    { ...payload, statusCode: status },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function envBool(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function shouldTrustProxyHeaders(): boolean {
  return envBool("TRUST_PROXY_HEADERS");
}

function isProductionLocalOpenApiBlocked(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    getDeploymentMode() === "local" &&
    !isAccessPasswordEnabled() &&
    !envBool("ALLOW_INSECURE_LOCAL_PRODUCTION")
  );
}

function isSharedStoreConfigurationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /required|RATE_LIMIT_STORE|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN/i.test(
      error.message,
    )
  );
}

export function getRateLimitClientIp(request: NextRequest): string {
  if (!shouldTrustProxyHeaders()) return "unknown";

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (shouldTrustProxyHeaders() && forwardedHost) {
    return `${forwardedProto || request.nextUrl.protocol.replace(":", "")}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

export function isMutatingRequest(request: NextRequest): boolean {
  return isMutatingApiRouteMethod(request.method);
}

export function validateSameOriginRequest(
  request: NextRequest,
): NextResponse | null {
  if (!isMutatingRequest(request)) return null;

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin") {
    return jsonError(403, {
      error: "Cross-site API requests are blocked",
      code: REQUEST_GUARD_ERROR_CODES.csrf,
    });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  let parsedOrigin: URL;
  let expectedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
    expectedOrigin = new URL(getRequestOrigin(request));
  } catch {
    return jsonError(403, {
      error: "Invalid request origin",
      code: REQUEST_GUARD_ERROR_CODES.csrf,
    });
  }

  if (parsedOrigin.origin !== expectedOrigin.origin) {
    return jsonError(403, {
      error: "Cross-origin API requests are blocked",
      code: REQUEST_GUARD_ERROR_CODES.csrf,
    });
  }

  return null;
}

export async function enforceRateLimit(
  request: NextRequest,
  now = Date.now(),
): Promise<NextResponse | null> {
  const rule = getApiRateLimitPolicy(request.nextUrl.pathname, request.method);
  if (!rule) return null;

  const clientIp = getRateLimitClientIp(request);
  const useDeploymentBucket =
    clientIp === "unknown" &&
    ((getDeploymentMode() === "hosted" &&
      !isApiProofProtectedPath(request.nextUrl.pathname, request.method)) ||
      rule.routeFamily.startsWith("/api/shares/") ||
      rule.routeFamily === "/api/access/verify" ||
      rule.routeFamily === "/api/request-proof/session");
  const proofIdentity =
    clientIp === "unknown" && !useDeploymentBucket
      ? await getRequestProofRateLimitIdentity(request, now)
      : null;
  if (clientIp === "unknown" && !useDeploymentBucket && !proofIdentity) {
    if (getDeploymentMode() !== "hosted") return null;
  }

  const identity = useDeploymentBucket
    ? "deployment"
    : proofIdentity || (clientIp === "unknown" ? "deployment" : clientIp);
  const key = `${identity}:${request.method}:${rule.routeFamily}`;
  const current = await incrementRateLimitBucket(key, rule.windowMs, now);
  if (current.count <= rule.maxRequests) return null;

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((current.resetAt - now) / 1000),
  );
  const response = jsonError(429, {
    error: "Too many requests. Please try again later.",
    code: REQUEST_GUARD_ERROR_CODES.rateLimited,
    retryAfter: retryAfterSeconds,
  });
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export async function applyRequestGuards(
  request: NextRequest,
): Promise<NextResponse | null> {
  const originResponse = validateSameOriginRequest(request);
  if (originResponse) return originResponse;

  if (isProductionLocalOpenApiBlocked()) {
    return jsonError(503, {
      error:
        "Production local API access requires ACCESS_PASSWORD or ALLOW_INSECURE_LOCAL_PRODUCTION=true.",
      code: REQUEST_GUARD_ERROR_CODES.productionLocalOpen,
    });
  }

  try {
    const proofResponse = await enforceApiRequestProof(request);
    if (proofResponse) return proofResponse;

    return await enforceRateLimit(request);
  } catch (error) {
    if (isSharedStoreConfigurationError(error)) {
      return jsonError(503, {
        error: "A shared request guard store is required in hosted mode.",
        code: REQUEST_GUARD_ERROR_CODES.sharedStoreRequired,
      });
    }
    throw error;
  }
}

export function clearRequestRateLimitBuckets(): void {
  clearRateLimitStoreForTesting();
}
