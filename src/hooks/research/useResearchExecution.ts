import { useCallback, type RefObject } from "react";

import type {
  AgentUserInputController,
  ToolConfirmationController,
} from "@/types";
import type { ResearchTaskExecutionLease } from "@/services/research/taskExecutionLock";
import { logDevError } from "@/lib/utils/devLogger";

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

/**
 * Execution keeps the caller's explicit lease through the full run. Lifecycle
 * actions decide whether their UI caller waits for completion or only startup.
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
    async (taskId: string, lease?: ResearchTaskExecutionLease) => {
      await runOperation(taskId, "research", (controller) =>
        executeResearchRun({
          taskId,
          lease,
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
    async (taskId: string, lease?: ResearchTaskExecutionLease) => {
      try {
        await executeResearch(taskId, lease);
      } catch (error) {
        // Failures inside execution are persisted while its lease is held.
        // A lock failure must never write a stale local task after release.
        logDevError("Research execution could not start", error);
        onError?.(t("runtime.error.report"));
      }
    },
    [executeResearch, onError, t],
  );

  return { executeResearch, launchResearch };
}
