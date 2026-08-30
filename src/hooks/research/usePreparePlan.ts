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
  onError,
  onNotice,
}: {
  runOperation: RunResearchOperation;
  toolConfirmationController?: ToolConfirmationController;
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  return useCallback(
    async (taskId: string, adjustment?: string, requestModel?: string) =>
      runOperation(taskId, "planning", (controller) =>
        prepareResearchPlan({
          taskId,
          adjustment,
          requestModel,
          controller,
          toolConfirmationController,
          t,
          localizedRuntimeError,
          onError,
          onNotice,
        }),
      ),
    [
      onError,
      onNotice,
      localizedRuntimeError,
      runOperation,
      t,
      toolConfirmationController,
    ],
  );
}
