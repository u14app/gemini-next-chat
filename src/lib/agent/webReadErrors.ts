import "server-only";

import { ApiError } from "../errors";
import { safeServerLogWarn } from "../utils/safeServerLog";

const TRANSPORT_TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const TRANSPORT_FAILURE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function transportCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) break;
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (
      typeof value.code === "string" &&
      (TRANSPORT_TIMEOUT_CODES.has(value.code) ||
        TRANSPORT_FAILURE_CODES.has(value.code))
    ) {
      return value.code;
    }
    current = value.cause;
  }
  return undefined;
}

/** Only call at the outbound transport boundary, never around page parsing. */
export function normalizeWebReadTransportError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  const code = transportCode(error);
  if (code && TRANSPORT_TIMEOUT_CODES.has(code)) {
    return new ApiError(
      "The upstream connection timed out.",
      504,
      "RESPONSE_TIMEOUT",
    );
  }
  if (
    code ||
    (error instanceof TypeError &&
      /^(?:fetch failed|Failed to fetch|NetworkError when attempting to fetch resource\.)$/i.test(
        error.message,
      ))
  ) {
    return new ApiError(
      "The webpage connection failed. Check network connectivity and try another source.",
      502,
      "WEB_FETCH_NETWORK",
    );
  }
  return error;
}

export function logWebReadFailure(
  error: unknown,
  stage: "direct" | "jina" | "jina-fallback",
  startedAt: number,
): void {
  const normalized = normalizeWebReadTransportError(error);
  const code = normalized instanceof ApiError ? normalized.code : undefined;
  const upstreamStatus =
    normalized instanceof ApiError &&
    normalized.details &&
    typeof normalized.details.upstreamStatus === "number"
      ? normalized.details.upstreamStatus
      : undefined;
  // Do not log URLs, response bodies, arbitrary causes, headers, or credentials.
  safeServerLogWarn("Web reader request failed:", {
    stage,
    elapsedMs: Math.max(0, Math.round(Date.now() - startedAt)),
    code: code && /^[A-Z0-9_]{1,64}$/.test(code) ? code : "INTERNAL_ERROR",
    statusCode: normalized instanceof ApiError ? normalized.statusCode : 500,
    ...(upstreamStatus !== undefined &&
    Number.isInteger(upstreamStatus) &&
    upstreamStatus >= 100 &&
    upstreamStatus <= 599
      ? { upstreamStatus }
      : {}),
    transportCode: transportCode(error),
  });
}

/** Require challenge-page structure; ordinary articles mentioning CF are valid. */
export function isWebPageChallenge(text: string, title?: string): boolean {
  const head = text.slice(0, 16_384);
  const pageTitle =
    title ??
    /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ??
    /^Title:\s*(.+)$/im.exec(head)?.[1];
  const challengeTitle =
    /^(?:just a moment(?:\.{3}|…)?|attention required!?(?:\s*\|\s*cloudflare)?|verify (?:that )?you are human|access denied)$/i.test(
      pageTitle?.trim() || "",
    );
  return (
    (challengeTitle &&
      /verify (?:that )?you are human|captcha|cloudflare|enable javascript and cookies/i.test(
        head,
      )) ||
    (/<script\b[^>]*>[\s\S]*?window\._cf_chl_opt\s*=/i.test(head) &&
      /\/cdn-cgi\/challenge-platform\//i.test(head))
  );
}

export function webPageChallengeError(): ApiError {
  return new ApiError(
    "The webpage requires human verification. Use another source or provide the page content.",
    502,
    "WEB_PAGE_CHALLENGE",
  );
}
