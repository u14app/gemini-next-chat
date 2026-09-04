export type SearchErrorLocation =
  "provider" | "search_transport" | "search_api" | "client";

export class SearchRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly location: SearchErrorLocation,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SearchRequestError";
  }
}

/** Retry-After supports both delta seconds and an HTTP date. */
export function parseSearchRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    const milliseconds = seconds * 1_000;
    return seconds >= 0 && Number.isFinite(milliseconds)
      ? milliseconds
      : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function describeSearchFailure(error: unknown) {
  if (error instanceof SearchRequestError) {
    return {
      code: error.code,
      // The generic tool ledger preserves code/message, so keep the HTTP layer
      // visible there as well as in the per-query structured result.
      message: `${error.message} (HTTP ${error.status}; ${error.location})`,
      recoverable: true,
      status: error.status,
      location: error.location,
      ...(error.retryAfterMs !== undefined
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    };
  }
  return {
    code:
      error instanceof Error && error.name === "TimeoutError"
        ? "RESEARCH_RECON_TIMEOUT"
        : "WEB_SEARCH_FAILED",
    message: error instanceof Error ? error.message : "Web search failed.",
    recoverable: true,
  };
}
