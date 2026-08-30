import type { RefObject } from "react";

import type {
  AgentUserInputController,
  ToolConfirmationController,
} from "@/types";

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
import type { ResearchDependencyText } from "./taskContext";

/**
 * Runs an approved plan end to end: explore, verify, synthesize. Each stage
 * reads and advances the shared execution context, and a scope-approval pause
 * can end the run cleanly after either search stage.
 */
export async function executeResearchRun({
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
}: {
  taskId: string;
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
  const ctx = await prepareResearchExecution({
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

  try {
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
    await handleExecutionFailure(ctx, error, onError);
  }
}
