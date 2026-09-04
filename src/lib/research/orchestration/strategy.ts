import type {
  ResearchBudgetPreset,
  ResearchCoverage,
  ResearchStrategy,
  ResolvedResearchBudget,
} from "../types";

export const RESEARCH_STRATEGY_LIMITS = {
  initialBreadth: { min: 1, max: 8 },
  maxDepth: { min: 1, max: 4 },
  maxQueries: { min: 2, max: 48 },
  resultsPerQuery: { min: 3, max: 10 },
} as const;

export const RESEARCH_RECON_LIMITS = {
  maxQueries: 2,
  resultsPerQuery: 5,
  timeoutMs: 90_000,
  knowledgeTimeoutMs: 30_000,
} as const;

export const RESEARCH_EXPLORATION_TOOL_CALL_RATIO = 0.8;
export const RESEARCH_SYNTHESIS_MODEL_ROUND_RESERVE = 2;

export const RESEARCH_STRATEGY_PRESETS: Readonly<
  Record<ResearchBudgetPreset, ResearchStrategy>
> = {
  quick: {
    initialBreadth: 2,
    maxDepth: 1,
    maxQueries: 6,
    resultsPerQuery: 5,
  },
  standard: {
    initialBreadth: 4,
    maxDepth: 2,
    maxQueries: 16,
    resultsPerQuery: 5,
  },
  deep: {
    initialBreadth: 6,
    maxDepth: 3,
    maxQueries: 32,
    resultsPerQuery: 5,
  },
};

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value!)));
}

export function resolveResearchStrategy(
  preset: ResearchBudgetPreset,
  overrides: Partial<ResearchStrategy> = {},
): ResearchStrategy {
  const defaults = RESEARCH_STRATEGY_PRESETS[preset];
  return {
    initialBreadth: clampInteger(
      overrides.initialBreadth,
      defaults.initialBreadth,
      RESEARCH_STRATEGY_LIMITS.initialBreadth.min,
      RESEARCH_STRATEGY_LIMITS.initialBreadth.max,
    ),
    maxDepth: clampInteger(
      overrides.maxDepth,
      defaults.maxDepth,
      RESEARCH_STRATEGY_LIMITS.maxDepth.min,
      RESEARCH_STRATEGY_LIMITS.maxDepth.max,
    ),
    maxQueries: clampInteger(
      overrides.maxQueries,
      defaults.maxQueries,
      RESEARCH_STRATEGY_LIMITS.maxQueries.min,
      RESEARCH_STRATEGY_LIMITS.maxQueries.max,
    ),
    resultsPerQuery: clampInteger(
      overrides.resultsPerQuery,
      defaults.resultsPerQuery,
      RESEARCH_STRATEGY_LIMITS.resultsPerQuery.min,
      RESEARCH_STRATEGY_LIMITS.resultsPerQuery.max,
    ),
  };
}

export function getResearchVerificationQueryReserve(
  strategy: Pick<ResearchStrategy, "maxQueries">,
): number {
  return Math.min(
    strategy.maxQueries,
    Math.max(2, Math.ceil(strategy.maxQueries * 0.15)),
  );
}

export function getResearchExplorationQueryLimit(
  strategy: Pick<ResearchStrategy, "maxQueries">,
): number {
  return Math.max(
    0,
    strategy.maxQueries - getResearchVerificationQueryReserve(strategy),
  );
}

export function getResearchVerificationQueryAllowance(
  strategy: Pick<ResearchStrategy, "maxQueries">,
  usedQueries: number,
): number {
  return Math.max(
    0,
    strategy.maxQueries - Math.max(0, Math.trunc(usedQueries)),
  );
}

export function getResearchSourceBodyLimit(
  strategy: Pick<ResearchStrategy, "maxQueries">,
  remainingExplorationToolCalls: number,
): number {
  return Math.max(
    0,
    Math.min(
      strategy.maxQueries * 2,
      64,
      Math.trunc(Math.max(0, remainingExplorationToolCalls)),
    ),
  );
}

export function getResearchExplorationToolCallLimit(
  budget: Pick<ResolvedResearchBudget, "maxToolCalls">,
): number {
  return Math.max(
    0,
    Math.floor(budget.maxToolCalls * RESEARCH_EXPLORATION_TOOL_CALL_RATIO),
  );
}

export function getResearchReservedModelRounds(
  budget: Pick<ResolvedResearchBudget, "maxToolRounds">,
): number {
  return Math.min(
    Math.max(0, Math.trunc(budget.maxToolRounds)),
    RESEARCH_SYNTHESIS_MODEL_ROUND_RESERVE,
  );
}

export function normalizeResearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function queryTerms(query: string): Set<string> {
  return new Set(normalizeResearchQuery(query).match(/[\p{L}\p{N}]+/gu) ?? []);
}

function queryTrigrams(query: string): Set<string> {
  const compact = normalizeResearchQuery(query).replace(/\s+/g, "");
  if (compact.length < 3) return new Set(compact ? [compact] : []);
  return new Set(
    Array.from({ length: compact.length - 2 }, (_, index) =>
      compact.slice(index, index + 3),
    ),
  );
}

function jaccard(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

export function areResearchQueriesSimilar(
  left: string,
  right: string,
  threshold: number = 0.8,
): boolean {
  const normalizedLeft = normalizeResearchQuery(left);
  const normalizedRight = normalizeResearchQuery(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const leftTerms = queryTerms(normalizedLeft);
  const rightTerms = queryTerms(normalizedRight);
  if (
    leftTerms.size >= 2 &&
    rightTerms.size >= 2 &&
    jaccard(leftTerms, rightTerms) >= threshold
  ) {
    return true;
  }
  const leftTrigrams = queryTrigrams(normalizedLeft);
  const rightTrigrams = queryTrigrams(normalizedRight);
  return (
    leftTrigrams.size >= 3 &&
    rightTrigrams.size >= 3 &&
    jaccard(leftTrigrams, rightTrigrams) >= Math.max(threshold, 0.86)
  );
}

export function isResearchQueryDuplicate(
  query: string,
  existingQueries: Iterable<string>,
): boolean {
  for (const existing of existingQueries) {
    if (areResearchQueriesSimilar(query, existing)) return true;
  }
  return false;
}

export function dedupeResearchQueries(
  queries: readonly string[],
  existingQueries: readonly string[] = [],
): string[] {
  const seen = new Set(
    existingQueries.map(normalizeResearchQuery).filter(Boolean),
  );
  const unique: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    const normalized = normalizeResearchQuery(trimmed);
    if (!normalized || isResearchQueryDuplicate(normalized, seen)) continue;
    seen.add(normalized);
    unique.push(trimmed);
  }
  return unique;
}

export function getNextResearchBreadth(currentBreadth: number): number {
  const safeBreadth = Number.isFinite(currentBreadth)
    ? Math.max(1, currentBreadth)
    : 1;
  return Math.max(1, Math.ceil(safeBreadth / 2));
}

export function getResearchBreadthAtDepth(
  initialBreadth: number,
  depth: number,
): number {
  let breadth = Number.isFinite(initialBreadth)
    ? Math.max(1, Math.trunc(initialBreadth))
    : 1;
  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    breadth = getNextResearchBreadth(breadth);
  }
  return breadth;
}

export function getAdaptiveResearchBreadth(
  strategy: Pick<ResearchStrategy, "initialBreadth">,
  coverage: Pick<
    ResearchCoverage,
    "requiredStepCount" | "coveredStepCount" | "unresolvedMajorClaimCount"
  >,
  depth: number,
): number {
  const baseline = getResearchBreadthAtDepth(strategy.initialBreadth, depth);
  if (depth <= 1) return baseline;
  const residualUncertainty =
    Math.max(0, coverage.requiredStepCount - coverage.coveredStepCount) +
    Math.max(0, coverage.unresolvedMajorClaimCount);
  return Math.min(
    RESEARCH_STRATEGY_LIMITS.initialBreadth.max,
    Math.max(1, baseline, residualUncertainty),
  );
}
