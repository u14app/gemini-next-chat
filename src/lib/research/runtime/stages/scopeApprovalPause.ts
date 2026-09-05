import {
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchCheckpoint,
} from "@/lib/research";

import type { ResearchExecutionContext } from "../executionContext";

/**
 * Pauses the run when a wave asked for sources outside the approved snapshot.
 * Returns `true` when the task was paused and execution must stop.
 */
export async function pauseForScopeApproval(
  ctx: ResearchExecutionContext,
): Promise<boolean> {
  if (ctx.run.phase !== "awaiting_scope_approval") return false;
  const checkpoint: ResearchCheckpoint = {
    createdAt: Date.now(),
    resumeStatus: "clarifying",
    committedEvidenceIds: ctx.evidence.map((item) => item.id),
    committedToolExecutionIds:
      ctx.run.checkpoint?.committedToolExecutionIds || [],
    ...(ctx.imageSources?.length
      ? { committedImageSourceIds: ctx.imageSources.map((image) => image.id) }
      : {}),
    researchRunId: ctx.run.id,
  };
  await ctx.store.updateTask(ctx.taskId, (current) => {
    const withRun = upsertResearchReportRun(current, ctx.run);
    return {
      ...transitionResearchTask(withRun, "paused", { checkpoint }),
      checkpoint,
      error: {
        code: "RESEARCH_SCOPE_APPROVAL_REQUIRED",
        message: ctx.t("run.scopeApproval"),
        recoverable: true,
      },
    };
  });
  ctx.store.setActiveTask(null);
  ctx.onNotice?.(ctx.t("run.scopeApproval"));
  return true;
}
