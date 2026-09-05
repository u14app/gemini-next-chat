import {
  runResearchTaskAction,
  type LaunchResearch,
  type PrepareResearchPlanAction,
} from "@/lib/research/runtime/taskLifecycle";
import { useCallback } from "react";

import { DEEP_RESEARCH_INSTRUCTION_MAX_CHARS } from "@/lib/research/toolArguments";
import { markMutableResearchEvidenceStale } from "@/lib/research/evidence";
import { transitionResearchTask } from "@/lib/research/task";
import { useResearchStore } from "@/store/core/researchStore";

/**
 * The task-lifecycle actions that are not plan-stage specific: retrying a
 * recoverable failure, resuming a pause, and the three post-report follow-ups.
 */
export function useResearchTaskActions({
  claimActiveSlot,
  checkpointUnavailableText,
  launchResearch,
  preparePlan,
  onNotice,
}: {
  claimActiveSlot: (sessionId: string, nextTaskId?: string) => Promise<boolean>;
  checkpointUnavailableText: string;
  launchResearch: LaunchResearch;
  preparePlan: PrepareResearchPlanAction;
  onNotice?: (message: string) => void;
}) {
  const retryTask = useCallback(
    async (taskId: string) =>
      runResearchTaskAction(taskId, async (task) => {
        const store = useResearchStore.getState();
        if (
          !task?.error?.recoverable ||
          (task.status !== "failed" && task.status !== "clarifying")
        ) {
          return;
        }
        await store.updateTask(taskId, (current) => ({
          ...(current.status === "failed"
            ? transitionResearchTask(current, "clarifying")
            : current),
          error: undefined,
        }));
        return {
          run: (lease) => preparePlan(taskId, undefined, undefined, lease),
        };
      }),
    [preparePlan],
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      const displayed = useResearchStore.getState().tasksById[taskId];
      return runResearchTaskAction(taskId, async (task, lease) => {
        const store = useResearchStore.getState();
        if (
          task.status !== "paused" ||
          !displayed ||
          task.activePlanVersion !== displayed.activePlanVersion ||
          task.activeReportRunId !== displayed.activeReportRunId ||
          task.reportVersions.at(-1)?.id !== displayed.reportVersions.at(-1)?.id
        )
          return;
        if (task.error?.code === "RESEARCH_SCOPE_APPROVAL_REQUIRED") {
          const { resumeLegacyScopeApproval } =
            await import("@/lib/research/runtime/resumeLegacyScope");
          const resumed = await resumeLegacyScopeApproval({
            task,
            lease,
            checkpointUnavailableText,
            claimActiveSlot,
            onNotice,
          });
          if (resumed)
            return {
              run: (lease) => launchResearch(taskId, lease),
              background: true,
            };
          return;
        }
        const resumeStatus = task.checkpoint?.resumeStatus || "plan_ready";
        if (resumeStatus === "draft" || resumeStatus === "clarifying") {
          return {
            run: (lease) => preparePlan(taskId, undefined, undefined, lease),
          };
        }
        if (resumeStatus === "plan_ready" || !task.sourceSnapshot) {
          await store.updateTask(taskId, (current) =>
            transitionResearchTask(current, "plan_ready"),
          );
          return;
        }
        if (!(await claimActiveSlot(task.sessionId, taskId))) return;
        const activeResumeStatus =
          resumeStatus === "verifying" || resumeStatus === "synthesizing"
            ? resumeStatus
            : "researching";
        await store.updateTask(taskId, (current) =>
          transitionResearchTask(current, activeResumeStatus),
        );
        store.setActiveTask(taskId);
        return {
          run: (lease) => launchResearch(taskId, lease),
          background: true,
        };
      });
    },
    [
      claimActiveSlot,
      checkpointUnavailableText,
      launchResearch,
      onNotice,
      preparePlan,
    ],
  );

  const continueResearch = useCallback(
    async (taskId: string, instruction: string) => {
      const value = instruction
        .trim()
        .slice(0, DEEP_RESEARCH_INSTRUCTION_MAX_CHARS);
      if (!value) return;
      return runResearchTaskAction(taskId, async (task) => {
        const store = useResearchStore.getState();
        if (task.status !== "completed" && task.status !== "partial_completed")
          return;
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "clarifying"),
          pendingReportKind: "continue",
          error: undefined,
        }));
        return { run: (lease) => preparePlan(taskId, value, undefined, lease) };
      });
    },
    [preparePlan],
  );

  const updateLatest = useCallback(
    async (taskId: string) =>
      runResearchTaskAction(taskId, async (task) => {
        const store = useResearchStore.getState();
        if (task.status !== "completed" && task.status !== "partial_completed")
          return;
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "clarifying"),
          pendingReportKind: "update",
          evidence: markMutableResearchEvidenceStale(current.evidence),
          error: undefined,
        }));
        return {
          run: (lease) =>
            preparePlan(
              taskId,
              "Update the report to the latest available state. Re-fetch every mutable web, plugin, and MCP source; reuse local evidence only when its content hash is unchanged. Preserve prior conclusions when the evidence has not changed and call out any changes explicitly.",
              undefined,
              lease,
            ),
        };
      }),
    [preparePlan],
  );

  return {
    retryTask,
    resumeTask,
    continueResearch,
    updateLatest,
  };
}
