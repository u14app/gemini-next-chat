import {
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";
import { useResearchStore } from "@/store/core/researchStore";
import { useCallback } from "react";

import type { ToolConfirmationController } from "@/types";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "@/lib/research/runtime/executionContext";
import type { RunResearchOperation } from "@/lib/research/runtime/operations";
import { prepareResearchPlan } from "@/lib/research/runtime/preparePlan";

/**
 * Binds the planning stage to the operation registry so a task can only have
 * one planning round in flight at a time.
 */
export function usePreparePlan({
  runOperation,
  toolConfirmationController,
  t,
  localizedRuntimeError,
  locale,
  onError,
  onNotice,
}: {
  runOperation: RunResearchOperation;
  toolConfirmationController?: ToolConfirmationController;
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  locale?: string;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  return useCallback(
    async (
      taskId: string,
      adjustment?: string,
      requestModel?: string,
      lease?: ResearchTaskExecutionLease,
    ) => {
      const result = await withResearchTaskExecutionLock(
        taskId,
        async () => {
          const task = await useResearchStore.getState().refreshTask(taskId);
          if (
            !task ||
            !["draft", "clarifying", "plan_ready", "paused", "failed"].includes(
              task.status,
            )
          )
            return;
          await runOperation(taskId, "planning", (controller) =>
            prepareResearchPlan({
              taskId,
              adjustment,
              requestModel,
              controller,
              toolConfirmationController,
              t,
              localizedRuntimeError,
              locale,
              onError,
              onNotice,
            }),
          );
        },
        lease,
      );
      if (!result.acquired) onNotice?.(t("runtime.dependency.leaseConflict"));
    },
    [
      onError,
      onNotice,
      localizedRuntimeError,
      locale,
      runOperation,
      t,
      toolConfirmationController,
    ],
  );
}
