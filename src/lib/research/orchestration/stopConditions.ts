import type {
  ResearchCoverage,
  ResearchNode,
  ResearchReportRun,
  ResearchStopReason,
  ResearchStrategy,
} from "../types";
import { isResearchCoverageSufficient } from "./coverage";

export interface ResearchStopEvaluation {
  now?: number;
  coverage: ResearchCoverage;
  frontierCount: number;
  currentDepth: number;
  queryCount: number;
  sourceBodyCount: number;
  sourceBodyLimit: number;
  remainingToolCalls: number;
  wavesWithoutNewSources: number;
  wavesWithoutNewVerifiedClaims: number;
  consecutiveDegradedWaves?: number;
  sufficientClaimRatio?: number;
  pendingScopeApproval?: boolean;
  dependencyAvailable?: boolean;
  userAction?: "pause" | "cancel";
}

export function getResearchStopReason(
  strategy: ResearchStrategy,
  evaluation: ResearchStopEvaluation,
): ResearchStopReason | undefined {
  const at = evaluation.now ?? Date.now();
  const reason = (code: ResearchStopReason["code"]): ResearchStopReason => ({
    code,
    at,
  });
  if (evaluation.userAction === "cancel") return reason("user_cancelled");
  if (evaluation.userAction === "pause") return reason("user_paused");
  if (evaluation.pendingScopeApproval) {
    return reason("scope_approval_required");
  }
  if (evaluation.dependencyAvailable === false) {
    return reason("dependency_unavailable");
  }
  if (evaluation.coverage.complete) return reason("coverage_satisfied");
  if (
    isResearchCoverageSufficient(
      evaluation.coverage,
      evaluation.sufficientClaimRatio,
    )
  ) {
    return reason("coverage_sufficient");
  }
  if ((evaluation.consecutiveDegradedWaves ?? 0) >= 2) {
    return reason("invalid_model_output");
  }
  if (evaluation.remainingToolCalls <= 0) return reason("budget_exhausted");
  if (evaluation.queryCount >= strategy.maxQueries) {
    return reason("max_queries");
  }
  if (
    evaluation.sourceBodyLimit >= 0 &&
    evaluation.sourceBodyCount >= evaluation.sourceBodyLimit
  ) {
    return reason("max_sources");
  }
  if (evaluation.wavesWithoutNewSources >= 2) {
    return reason("no_new_sources");
  }
  if (evaluation.wavesWithoutNewVerifiedClaims >= 2) {
    return reason("no_new_verified_claims");
  }
  if (
    evaluation.frontierCount === 0 &&
    evaluation.currentDepth >= strategy.maxDepth
  ) {
    return reason("max_depth");
  }
  if (evaluation.frontierCount === 0) return reason("frontier_exhausted");
  return undefined;
}

export function applyResearchRunUserStop(
  run: ResearchReportRun,
  action: "pause" | "cancel",
  now: number = Date.now(),
): ResearchReportRun {
  const cancelled = action === "cancel";
  const stopReason: ResearchStopReason = {
    code: cancelled ? "user_cancelled" : "user_paused",
    at: now,
  };
  const activeNodeStatuses = new Set<ResearchNode["status"]>([
    "queued",
    "searching",
    "reading",
    "learning",
  ]);
  return {
    ...run,
    phase: cancelled ? "cancelled" : "paused",
    waves: run.waves.map((wave) =>
      ["queued", "running", "paused"].includes(wave.status)
        ? { ...wave, status: cancelled ? "failed" : "paused" }
        : wave,
    ),
    nodes: run.nodes.map((node) =>
      activeNodeStatuses.has(node.status) ||
      (cancelled && node.status === "pending")
        ? {
            ...node,
            status: cancelled ? "skipped" : node.status,
            stopReason,
            updatedAt: now,
          }
        : node,
    ),
    stopReason,
    updatedAt: now,
    ...(cancelled ? { endedAt: now, checkpoint: undefined } : {}),
  };
}

export function finalizeResearchReportRun(
  run: ResearchReportRun,
  phase: "completed" | "partial_completed" | "failed",
  now: number = Date.now(),
): ResearchReportRun {
  return {
    ...run,
    phase,
    updatedAt: now,
    endedAt: now,
    checkpoint: undefined,
  };
}

export function findInvalidResearchWorkspaceSource(
  frozenSources: readonly {
    path: string;
    contentHash: string;
    revision: string;
  }[],
  currentSources: readonly {
    path: string;
    contentHash: string;
    revision: string;
  }[],
): string | undefined {
  const currentByPath = new Map(
    currentSources.map((source) => [source.path, source] as const),
  );
  return frozenSources.find((source) => {
    const current = currentByPath.get(source.path);
    return (
      !current ||
      current.contentHash !== source.contentHash ||
      current.revision !== source.revision
    );
  })?.path;
}
