import { useCallback } from "react";
import { v7 as uuidv7 } from "uuid";

import type { Message } from "@/types";
import {
  DEEP_RESEARCH_INSTRUCTION_MAX_CHARS,
  buildEvidenceQuestionPrompt,
  markMutableResearchEvidenceStale,
  transitionResearchTask,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import { useChatStore } from "@/store/core/chatStore";
import { streamChatResponse } from "@/services/api/chatService";

import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import type { RunResearchOperation } from "@/lib/research/runtime/operations";
import { readReportMarkdown } from "@/lib/research/runtime/reportPublication";
import { resumeLegacyScopeApproval } from "@/lib/research/runtime/resumeLegacyScope";
import { resolveTaskContext } from "@/lib/research/runtime/taskContext";

/**
 * The task-lifecycle actions that are not plan-stage specific: retrying a
 * recoverable failure, resuming a pause, and the three post-report follow-ups.
 */
export function useResearchTaskActions({
  claimActiveSlot,
  checkpointUnavailableText,
  launchResearch,
  preparePlan,
  runOperation,
  t,
  onNotice,
}: {
  claimActiveSlot: (sessionId: string, nextTaskId?: string) => Promise<boolean>;
  checkpointUnavailableText: string;
  launchResearch: (taskId: string) => void;
  preparePlan: (
    taskId: string,
    adjustment?: string,
    requestModel?: string,
  ) => Promise<void>;
  runOperation: RunResearchOperation;
  t: ResearchTranslate;
  onNotice?: (message: string) => void;
}) {
  const retryTask = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
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
      await preparePlan(taskId);
    },
    [preparePlan],
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (!task || task.status !== "paused") return;
      if (task.error?.code === "RESEARCH_SCOPE_APPROVAL_REQUIRED") {
        await resumeLegacyScopeApproval({
          task,
          checkpointUnavailableText,
          claimActiveSlot,
          launchResearch,
          onNotice,
        });
        return;
      }
      const resumeStatus = task.checkpoint?.resumeStatus || "plan_ready";
      if (resumeStatus === "draft" || resumeStatus === "clarifying") {
        await preparePlan(taskId);
        return;
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
      launchResearch(taskId);
    },
    [
      claimActiveSlot,
      checkpointUnavailableText,
      launchResearch,
      onNotice,
      preparePlan,
    ],
  );

  const askExistingEvidence = useCallback(
    async (taskId: string, question: string) =>
      runOperation(taskId, "evidence_answer", async (controller) => {
        const task = useResearchStore.getState().tasksById[taskId];
        if (!task || !question.trim()) return;
        const report = await readReportMarkdown(task);
        if (!report)
          throw new Error("The stored research report is unavailable.");
        const { model, chatConfig, effective } = resolveTaskContext(task);
        const userMessage: Message = {
          id: uuidv7(),
          role: "user",
          content: question.trim(),
          timestamp: Date.now(),
          model,
        };
        await useChatStore.getState().addMessage(task.sessionId, userMessage);
        let answer = "";
        answer = await streamChatResponse(
          task.sessionId,
          model,
          [],
          buildEvidenceQuestionPrompt({
            question: question.trim(),
            report,
            evidence: task.evidence,
          }),
          [],
          {
            ...chatConfig,
            chatMode: "chat",
            useAgentMode: false,
            useDeepResearch: false,
            useSearch: false,
            useReasoning: false,
          },
          (text) => {
            answer = text;
          },
          `${effective.systemInstruction}\n\nThis turn is closed-book: only the supplied stored report and evidence index may be used.`,
          undefined,
          undefined,
          undefined,
          undefined,
          controller.signal,
          [],
          undefined,
          undefined,
          undefined,
          { disableTools: true },
        );
        controller.signal.throwIfAborted();
        await useChatStore.getState().addMessage(task.sessionId, {
          id: uuidv7(),
          role: "model",
          content: answer,
          timestamp: Date.now(),
          model,
        });
        onNotice?.(t("runtime.notice.evidenceAnswer"));
      }),
    [onNotice, runOperation, t],
  );

  const continueResearch = useCallback(
    async (taskId: string, instruction: string) => {
      const value = instruction
        .trim()
        .slice(0, DEEP_RESEARCH_INSTRUCTION_MAX_CHARS);
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (
        !task ||
        (task.status !== "completed" && task.status !== "partial_completed") ||
        !value
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...transitionResearchTask(current, "clarifying"),
        pendingReportKind: "continue",
        error: undefined,
      }));
      await preparePlan(taskId, value);
    },
    [preparePlan],
  );

  const updateLatest = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (
        !task ||
        (task.status !== "completed" && task.status !== "partial_completed")
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...transitionResearchTask(current, "clarifying"),
        pendingReportKind: "update",
        evidence: markMutableResearchEvidenceStale(current.evidence),
        error: undefined,
      }));
      await preparePlan(
        taskId,
        "Update the report to the latest available state. Re-fetch every mutable web, plugin, and MCP source; reuse local evidence only when its content hash is unchanged. Preserve prior conclusions when the evidence has not changed and call out any changes explicitly.",
      );
    },
    [preparePlan],
  );

  return {
    retryTask,
    resumeTask,
    askExistingEvidence,
    continueResearch,
    updateLatest,
  };
}
