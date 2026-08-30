import { useCallback, type RefObject } from "react";

import type {
  AgentUserInputController,
  ToolConfirmationController,
} from "@/types";
import {
  finalizeResearchReportRun,
  getActiveResearchReportRun,
  isTerminalResearchStatus,
  transitionResearchTask,
  upsertResearchReportRun,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";

import { executeResearchRun } from "@/lib/research/runtime/executeResearch";
import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "@/lib/research/runtime/executionContext";
import type {
  RunResearchOperation,
  RunningOperation,
} from "@/lib/research/runtime/operations";
import type { ResearchDependencyText } from "@/lib/research/runtime/taskContext";
import { aggregateTaskUsage } from "@/lib/research/runtime/usage";

/**
 * `executeResearch` awaits the run; `launchResearch` fires it off and owns the
 * only place an unhandled execution failure is turned into a failed task.
 */
export function useResearchExecution({
  runOperation,
  operationsRef,
  userInputController,
  toolConfirmationController,
  t,
  localizedRuntimeError,
  dependencyText,
  onError,
  onNotice,
}: {
  runOperation: RunResearchOperation;
  operationsRef: RefObject<Map<string, RunningOperation>>;
  userInputController: AgentUserInputController;
  toolConfirmationController?: ToolConfirmationController;
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  dependencyText: ResearchDependencyText;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  const executeResearch = useCallback(
    async (taskId: string) => {
      await runOperation(taskId, "research", (controller) =>
        executeResearchRun({
          taskId,
          controller,
          operationsRef,
          userInputController,
          toolConfirmationController,
          t,
          localizedRuntimeError,
          dependencyText,
          onError,
          onNotice,
        }),
      );
    },
    [
      dependencyText,
      localizedRuntimeError,
      onError,
      onNotice,
      operationsRef,
      runOperation,
      t,
      toolConfirmationController,
      userInputController,
    ],
  );

  const launchResearch = useCallback(
    (taskId: string) => {
      void executeResearch(taskId).catch(async (error) => {
        const store = useResearchStore.getState();
        const task = store.tasksById[taskId];
        if (
          !task ||
          task.status === "paused" ||
          isTerminalResearchStatus(task.status)
        ) {
          return;
        }
        const failedAt = Date.now();
        await store.updateTask(taskId, (current) => {
          const activeRun = getActiveResearchReportRun(current);
          const withRun = activeRun
            ? upsertResearchReportRun(
                current,
                finalizeResearchReportRun(activeRun, "failed", failedAt),
              )
            : current;
          return {
            ...transitionResearchTask(withRun, "failed", { now: failedAt }),
            usage: aggregateTaskUsage(withRun),
            error: {
              code: "RESEARCH_EXECUTION_FAILED",
              message: localizedRuntimeError(error, "executionFallback"),
              recoverable: true,
            },
          };
        });
        store.setActiveTask(null);
        onError?.(t("runtime.error.report"));
      });
    },
    [executeResearch, localizedRuntimeError, onError, t],
  );

  return { executeResearch, launchResearch };
}
