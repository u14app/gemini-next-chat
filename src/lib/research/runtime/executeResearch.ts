import type { ResearchTaskExecutionLease } from "@/services/research/taskExecutionLock";
import { useResearchStore } from "@/store/core/researchStore";
import {
  finalizeResearchReportRun,
  getActiveResearchReportRun,
  isTerminalResearchStatus,
  transitionResearchTask,
  upsertResearchReportRun,
} from "@/lib/research";
import type { ResearchExecutionContext } from "./executionContext";
import { aggregateTaskUsage } from "./usage";
import type { RefObject } from "react";

import type {
  AgentUserInputController,
  ToolConfirmationController,
} from "@/types";
import { logDevError } from "@/lib/utils/devLogger";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "./executionContext";
import type { RunningOperation } from "./operations";
import { prepareResearchExecution } from "./prepareExecution";
import { runExplorationStage } from "./stages/exploration";
import { handleExecutionFailure } from "./stages/failure";
import { pauseForScopeApproval } from "./stages/scopeApprovalPause";
import { runSynthesisStage } from "./stages/synthesis";
import { runVerificationStage } from "./stages/verification";
import {
  initializeResearchSteering,
  rejectPendingResearchSteering,
  withResearchExecutionLock,
} from "./steering";
import type { ResearchDependencyText } from "./taskContext";

/**
 * Runs an approved plan end to end: explore, verify, synthesize. Each stage
 * reads and advances the shared execution context, and a scope-approval pause
 * can end the run cleanly after either search stage.
 */
export async function executeResearchRun({
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
}: {
  taskId: string;
  lease?: ResearchTaskExecutionLease;
  controller: AbortController;
  operationsRef: RefObject<Map<string, RunningOperation>>;
  userInputController: AgentUserInputController;
  toolConfirmationController?: ToolConfirmationController;
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  dependencyText: ResearchDependencyText;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  return withResearchExecutionLock(
    taskId,
    async (steeringLockHeld) => {
      let ctx: ResearchExecutionContext | null = null;
      try {
        ctx = await prepareResearchExecution({
          taskId,
          controller,
          operationsRef,
          userInputController,
          toolConfirmationController,
          t,
          localizedRuntimeError,
          dependencyText,
          onNotice,
        });
        if (!ctx) return;
        ctx.steeringLockHeld = steeringLockHeld;

        await initializeResearchSteering(ctx);
        if (!ctx.resumeAtVerification && !ctx.resumeAtSynthesis) {
          await runExplorationStage(ctx);
        }
        if (await pauseForScopeApproval(ctx)) return;
        if (!ctx.resumeAtSynthesis) {
          await runVerificationStage(ctx);
        }
        if (await pauseForScopeApproval(ctx)) return;
        await runSynthesisStage(ctx);
      } catch (error) {
        if (ctx) await handleExecutionFailure(ctx, error, onError);
        else {
          const store = useResearchStore.getState();
          const task = store.tasksById[taskId];
          if (
            task &&
            task.status !== "paused" &&
            !isTerminalResearchStatus(task.status)
          ) {
            const failedAt = Date.now();
            await store.updateTask(taskId, (current) => {
              const active = getActiveResearchReportRun(current);
              const withRun = active
                ? upsertResearchReportRun(
                    current,
                    finalizeResearchReportRun(active, "failed", failedAt),
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
          }
        }
      } finally {
        const task = ctx?.store.tasksById[taskId];
        if (
          ctx &&
          task &&
          ["completed", "partial_completed", "failed", "cancelled"].includes(
            task.status,
          )
        ) {
          await rejectPendingResearchSteering(ctx).catch((error) => {
            // Terminal core status still rejects submissions if extension cleanup fails.
            logDevError("Failed to close research adjustments", error);
          });
        }
      }
    },
    () => onNotice?.(t("runtime.dependency.leaseConflict")),
    lease,
  );
}
