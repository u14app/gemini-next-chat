import type { RefObject } from "react";

import type {
  AgentUserInputController,
  ToolConfirmationController,
} from "@/types";
import {
  createResearchReportRun,
  getActivePlan,
  getActiveResearchReportRun,
  isActiveResearchStatus,
  getResearchExplorationQueryLimit,
  getResearchExplorationToolCallLimit,
  getResearchSourceBodyLimit,
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchReportRun,
  type ResearchSourceSnapshot,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import { useAgentRunStore } from "@/store/core/agentRunStore";

import type {
  ResearchExecutionContext,
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "./executionContext";
import type { RunningOperation } from "./operations";
import { readReportMarkdown } from "./reportPublication";
import {
  buildResearchExecutionSourceContext,
  getInvalidFrozenWorkspaceSource,
  loadSessionMessages,
} from "./sourceSnapshot";
import {
  getResearchDependencyError,
  resolveTaskContext,
  type ResearchDependencyError,
  type ResearchDependencyText,
} from "./taskContext";

/**
 * Resolves everything `executeResearch` needs before its first wave. Returns
 * `null` when a missing dependency already paused the task, in which case the
 * caller must stop without running any stage.
 */
export async function prepareResearchExecution({
  taskId,
  controller,
  operationsRef,
  userInputController,
  toolConfirmationController,
  t,
  localizedRuntimeError,
  dependencyText,
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
  onNotice?: (message: string) => void;
}): Promise<ResearchExecutionContext | null> {
  const store = useResearchStore.getState();
  const refreshedTask = await store.refreshTask(taskId);
  if (!refreshedTask || !isActiveResearchStatus(refreshedTask.status))
    return null;
  let task = refreshedTask;
  const plan = getActivePlan(task);
  const approvedSnapshot = task.sourceSnapshot;
  if (!plan || !approvedSnapshot?.model) {
    throw new Error("The approved research plan is incomplete.");
  }
  const researchModel = approvedSnapshot.model;
  const snapshot: ResearchSourceSnapshot = approvedSnapshot;
  const dependencyError = getResearchDependencyError(task, dependencyText);
  if (dependencyError) {
    await store.updateTask(taskId, (current) => ({
      ...transitionResearchTask(current, "paused"),
      error: { ...dependencyError, recoverable: true },
    }));
    store.setActiveTask(null);
    onNotice?.(dependencyError.message);
    return null;
  }
  const invalidWorkspaceSource = await getInvalidFrozenWorkspaceSource(
    snapshot,
    task.sessionId,
  );
  if (invalidWorkspaceSource) {
    const workspaceError: ResearchDependencyError = {
      code: "RESEARCH_SOURCE_REVOKED",
      message: dependencyText.sourceUnavailable(invalidWorkspaceSource),
    };
    await store.updateTask(taskId, (current) => ({
      ...transitionResearchTask(current, "paused"),
      error: { ...workspaceError, recoverable: true },
    }));
    store.setActiveTask(null);
    onNotice?.(workspaceError.message);
    return null;
  }

  const { chatConfig, effective, settings } = resolveTaskContext(task);
  const messages = await loadSessionMessages(task.sessionId);
  const originMessage = messages.find(
    (message) => message.id === task.userMessageId,
  );
  const currentAttachments = originMessage?.attachments || [];
  const currentAttachmentIds = new Set(
    currentAttachments.map((attachment) => attachment.id),
  );
  const missingAttachment = snapshot.attachmentIds.find(
    (attachmentId) => !currentAttachmentIds.has(attachmentId),
  );
  if (missingAttachment) {
    const missingSourceError: ResearchDependencyError = {
      code: "RESEARCH_SOURCE_REVOKED",
      message: dependencyText.sourceUnavailable(missingAttachment),
    };
    await store.updateTask(taskId, (current) => ({
      ...transitionResearchTask(current, "paused"),
      error: { ...missingSourceError, recoverable: true },
    }));
    store.setActiveTask(null);
    onNotice?.(missingSourceError.message);
    return null;
  }
  const sourceContext = buildResearchExecutionSourceContext(
    snapshot,
    currentAttachments,
  );
  const priorReport =
    task.pendingReportKind === "initial" ? "" : await readReportMarkdown(task);
  await useAgentRunStore.getState().loadSessionRuns(task.sessionId);

  const resumeAtVerification = task.checkpoint?.resumeStatus === "verifying";
  const resumeAtSynthesis = task.checkpoint?.resumeStatus === "synthesizing";
  const existingRun = getActiveResearchReportRun(task);
  let researchRun: ResearchReportRun;
  if (
    !existingRun ||
    existingRun.planVersion !== plan.version ||
    ["completed", "partial_completed", "failed", "cancelled"].includes(
      existingRun.phase,
    )
  ) {
    researchRun = createResearchReportRun({
      taskId: task.id,
      plan,
      reportKind: task.pendingReportKind,
    });
  } else if (existingRun.phase === "paused") {
    researchRun = {
      ...existingRun,
      phase: resumeAtSynthesis
        ? "synthesizing"
        : resumeAtVerification
          ? "verifying"
          : "exploring",
      stopReason: undefined,
      updatedAt: Date.now(),
    };
  } else {
    researchRun = existingRun;
  }
  const updatedTask = await store.updateTask(taskId, (current) => ({
    ...upsertResearchReportRun(current, researchRun!),
    error: undefined,
  }));
  task = updatedTask ?? task;

  const explorationQueryLimit = getResearchExplorationQueryLimit(
    researchRun.strategy,
  );
  const explorationToolCallCap = getResearchExplorationToolCallLimit(
    task.budget,
  );
  const sourceBodyLimit = getResearchSourceBodyLimit(
    researchRun.strategy,
    explorationToolCallCap,
  );

  return {
    get store() {
      return useResearchStore.getState();
    },
    taskId,
    controller,
    plan,
    researchModel,
    chatConfig,
    effective,
    settings,
    operationsRef,
    userInputController,
    toolConfirmationController,
    t,
    localizedRuntimeError,
    dependencyText,
    onNotice,
    currentAttachments,
    priorReport,
    resumeAtVerification,
    resumeAtSynthesis,
    explorationQueryLimit,
    explorationToolCallCap,
    sourceBodyLimit,
    task,
    snapshot,
    sourceContext,
    run: researchRun,
    evidence: [...task.evidence],
  };
}
