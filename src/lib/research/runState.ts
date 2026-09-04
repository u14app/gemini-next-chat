import type { parseResearchPlan } from "./prompts";
import type {
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchSourceType,
  ResearchStrategy,
  ResearchTask,
} from "./types";

export function getActivePlan(
  task: ResearchTask,
): ResearchPlanVersion | undefined {
  return task.planVersions.find(
    (plan) => plan.version === task.activePlanVersion,
  );
}

export function validateResearchPlanHostContract({
  plan,
  strategy,
  allowedSourceTypes,
}: {
  plan: Extract<ReturnType<typeof parseResearchPlan>, { valid: true }>["data"];
  strategy: ResearchStrategy;
  allowedSourceTypes: readonly ResearchSourceType[];
}): string[] {
  const issues: string[] = [];
  for (const key of [
    "initialBreadth",
    "maxDepth",
    "maxQueries",
    "resultsPerQuery",
  ] as const) {
    if (plan.strategy[key] !== strategy[key]) {
      issues.push(
        `strategy.${key}: Expected approved value ${strategy[key]}, received ${plan.strategy[key]}.`,
      );
    }
  }
  const allowed = new Set(allowedSourceTypes);
  for (const sourceType of plan.scope.allowedSourceTypes) {
    if (!allowed.has(sourceType)) {
      issues.push(
        `scope.allowedSourceTypes: ${sourceType} is not available to this task.`,
      );
    }
  }
  return issues;
}

export function upsertResearchReportRun(
  task: ResearchTask,
  run: ResearchReportRun,
): ResearchTask {
  const index = task.reportRuns.findIndex(
    (candidate) => candidate.id === run.id,
  );
  const reportRuns = [...task.reportRuns];
  if (index >= 0) reportRuns[index] = run;
  else reportRuns.push(run);
  return { ...task, reportRuns, activeReportRunId: run.id };
}

export function getActiveResearchReportRun(
  task: ResearchTask,
): ResearchReportRun | undefined {
  return task.reportRuns.find((run) => run.id === task.activeReportRunId);
}

export function countTrailingWaves(
  run: ResearchReportRun,
  field: "newEvidenceCount" | "newVerifiedClaimCount",
): number {
  let count = 0;
  for (const wave of [...run.waves].reverse()) {
    if (wave.status !== "completed" || wave[field] > 0) break;
    count += 1;
  }
  return count;
}

export function countTrailingDegradedWaves(run: ResearchReportRun): number {
  let count = 0;
  for (const wave of [...run.waves].reverse()) {
    if (wave.status !== "completed" || wave.packetStatus !== "degraded") break;
    count += 1;
  }
  return count;
}
