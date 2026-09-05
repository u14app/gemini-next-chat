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
import { recordResearchModuleLoadFailure } from "@/lib/research/runtime/moduleLoadFailure";

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
        async (planningLease) => {
          const task = await useResearchStore.getState().refreshTask(taskId);
          if (
            !task ||
            !["draft", "clarifying", "plan_ready", "paused", "failed"].includes(
              task.status,
            )
          )
            return;
          await runOperation(taskId, "planning", async (controller) => {
            const runtime =
              await import("@/lib/research/runtime/preparePlan").catch(
                async (error) => {
                  const failed = await recordResearchModuleLoadFailure({
                    taskId,
                    phase: "planning",
                    lease: planningLease,
                    signal: controller.signal,
                    message: localizedRuntimeError(error, "planFallback"),
                  });
                  if (failed) onError?.(t("runtime.error.plan"));
                  return null;
                },
              );
            if (!runtime) return;
            if (controller.signal.aborted) return;
            await runtime.prepareResearchPlan({
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
            });
          });
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
