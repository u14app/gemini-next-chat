import {
  applyResearchRunUserStop,
  finalizeResearchReportRun,
  getActiveResearchReportRun,
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchCheckpoint,
} from "@/lib/research";
import { logDevError } from "@/lib/utils/devLogger";

import type { ResearchExecutionContext } from "../executionContext";
import { ResearchWorkspaceUnavailableError } from "../dependencyErrors";
import { isAbortError } from "../operations";
import {
  deliverResearchReport,
  ResearchReportDeliveryError,
} from "../reportDelivery";
import { aggregateTaskUsage } from "../usage";

/**
 * Terminal handling for a run that threw: a user abort pauses resumably, and
 * anything else still tries to publish a deterministic salvage report before
 * the task is reported as failed.
 */
export async function handleExecutionFailure(
  ctx: ResearchExecutionContext,
  error: unknown,
  onError?: (message: string) => void,
): Promise<void> {
  const current = ctx.store.tasksById[ctx.taskId];
  if (!current || current.status === "cancelled") return;
  if (error instanceof ResearchWorkspaceUnavailableError) {
    const pausedAt = Date.now();
    const pausedRun = {
      ...applyResearchRunUserStop(ctx.run, "pause", pausedAt),
      stopReason: {
        code: "dependency_unavailable" as const,
        at: pausedAt,
        detail: error.message,
      },
    };
    const checkpoint: ResearchCheckpoint = current.checkpoint || {
      createdAt: pausedAt,
      resumeStatus: "researching",
      committedEvidenceIds: ctx.evidence.map((item) => item.id),
      committedToolExecutionIds:
        pausedRun.checkpoint?.committedToolExecutionIds || [],
      ...(ctx.imageSources?.length
        ? {
            committedImageSourceIds: ctx.imageSources.map((image) => image.id),
          }
        : {}),
      researchRunId: pausedRun.id,
    };
    const message = ctx.dependencyText.sourceUnavailable("workspace");
    await ctx.store.updateTask(ctx.taskId, (latest) => ({
      ...transitionResearchTask(
        upsertResearchReportRun(latest, pausedRun),
        "paused",
        { checkpoint },
      ),
      checkpoint,
      error: {
        code: "RESEARCH_WORKSPACE_UNAVAILABLE",
        message,
        recoverable: true,
      },
    }));
    ctx.store.setActiveTask(null);
    ctx.onNotice?.(message);
    return;
  }
  if (isAbortError(error) || ctx.controller.signal.aborted) {
    if (
      current.status === "completed" ||
      current.status === "partial_completed"
    ) {
      ctx.store.setActiveTask(null);
      return;
    }
    const pausedRun = applyResearchRunUserStop(ctx.run, "pause");
    const checkpoint: ResearchCheckpoint = current.checkpoint || {
      createdAt: Date.now(),
      resumeStatus:
        current.status === "synthesizing"
          ? "synthesizing"
          : current.status === "verifying"
            ? "verifying"
            : "researching",
      committedEvidenceIds: ctx.evidence.map((item) => item.id),
      committedToolExecutionIds:
        pausedRun.checkpoint?.committedToolExecutionIds || [],
      ...(ctx.imageSources?.length
        ? {
            committedImageSourceIds: (ctx.imageSources ?? []).map(
              (image) => image.id,
            ),
          }
        : {}),
      researchRunId: pausedRun.id,
    };
    await ctx.store.updateTask(ctx.taskId, (latest) => {
      if (latest.status === "cancelled") return latest;
      const withRun = upsertResearchReportRun(latest, pausedRun);
      return latest.status === "paused"
        ? { ...withRun, checkpoint }
        : transitionResearchTask(withRun, "paused", { checkpoint });
    });
    ctx.store.setActiveTask(null);
    return;
  }
  if (!(error instanceof ResearchReportDeliveryError)) {
    try {
      await deliverResearchReport(ctx, { interruption: error });
      return;
    } catch (salvageError) {
      if (isAbortError(salvageError) || ctx.controller.signal.aborted) {
        return handleExecutionFailure(ctx, salvageError, onError);
      }
      logDevError("Failed to salvage Deep Research report", salvageError);
    }
  }
  const failedAt = Date.now();
  await ctx.store.updateTask(ctx.taskId, (latest) => {
    const activeRun = getActiveResearchReportRun(latest) ?? ctx.run;
    const withRun = upsertResearchReportRun(
      latest,
      finalizeResearchReportRun(activeRun, "failed", failedAt),
    );
    return {
      ...transitionResearchTask(withRun, "failed", { now: failedAt }),
      usage: aggregateTaskUsage(withRun),
      error: {
        code: "RESEARCH_EXECUTION_FAILED",
        message: ctx.localizedRuntimeError(error, "executionFallback"),
        recoverable: true,
      },
    };
  });
  ctx.store.setActiveTask(null);
  onError?.(ctx.t("runtime.error.report"));
}
