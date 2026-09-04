/** Host-selected profiles; clients cannot choose an arbitrary server timeout. */
export type SearchRequestProfile = "research_summary";

export const RESEARCH_SEARCH_LIMITS = {
  requestTimeoutMs: 90_000,
  minStartIntervalMs: 2_000,
  rateLimitCooldownMs: 60_000,
} as const;
