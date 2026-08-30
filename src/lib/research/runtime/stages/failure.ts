import {
  applyResearchRunUserStop,
  buildDeterministicSalvageReport,
  finalizeResearchReportRun,
  getActiveResearchReportRun,
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchCheckpoint,
} from "@/lib/research";
import { logDevError } from "@/lib/utils/devLogger";

import type { ResearchExecutionContext } from "../executionContext";
import { isAbortError } from "../operations";
import { publishResearchReportVersion } from "../reportPublication";
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
) {
  const current = ctx.store.tasksById[ctx.taskId];
  if (!current || current.status === "cancelled") return;
  if (isAbortError(error) || ctx.controller.signal.aborted) {
    const pausedRun = applyResearchRunUserStop(ctx.run, "pause");
    const checkpoint: ResearchCheckpoint = current.checkpoint || {
      createdAt: Date.now(),
      resumeStatus:
        current.status === "verifying" ? "verifying" : "researching",
      committedEvidenceIds: ctx.evidence.map((item) => item.id),
      committedToolExecutionIds:
        pausedRun.checkpoint?.committedToolExecutionIds || [],
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
  try {
    const salvage = buildDeterministicSalvageReport({
      task: current,
      plan: ctx.plan,
      run: ctx.run,
      evidence: ctx.evidence,
      reason: ctx.t("runtime.gaps.executionInterrupted"),
    });
    const uniqueGaps = await publishResearchReportVersion({
      taskId: ctx.taskId,
      plan: ctx.plan,
      run: {
        ...ctx.run,
        phase: "synthesizing",
        stopReason: ctx.run.stopReason || {
          code: "dependency_unavailable",
          at: Date.now(),
        },
      },
      markdown: salvage,
      evidence: ctx.evidence,
      extraGaps: [
        ctx.t("runtime.gaps.executionInterrupted"),
        ctx.localizedRuntimeError(error, "executionFallback"),
      ],
      agentRunId: ctx.lastAgentRunId,
      noEvidenceGap: ctx.t("runtime.gaps.noEvidence"),
      noKeyFindingsGap: ctx.t("runtime.gaps.noKeyFindings"),
      incompleteQuestionsGap: (count) =>
        ctx.t("runtime.gaps.incompleteQuestions", { count }),
      singleSourceNote: (count, total) =>
        ctx.t("report.singleSourceNote", { count, total }),
      persistenceError: ctx.t("runtime.error.persistence"),
    });
    ctx.store.setActiveTask(null);
    ctx.onNotice?.(
      uniqueGaps.length > 0
        ? ctx.t("runtime.notice.reportPartial")
        : ctx.t("runtime.notice.reportReady"),
    );
    return;
  } catch (salvageError) {
    logDevError("Failed to salvage Deep Research report", salvageError);
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
