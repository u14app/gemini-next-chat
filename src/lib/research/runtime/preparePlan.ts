import { v7 as uuidv7 } from "uuid";

import type { ToolCall, ToolConfirmationController } from "@/types";
import {
  buildResearchPlanPrompt,
  buildResearchPlanRepairPrompt,
  buildResearchReconSnapshot,
  getActivePlan,
  getResearchSourceSnapshotTypes,
  normalizeResearchPlanDraft,
  parseResearchPlan,
  resolveResearchStrategy,
  transitionResearchTask,
  validateResearchPlanHostContract,
  type ResearchPlanVersion,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import { streamChatResponse } from "@/services/api/chatService";
import type { BuiltinResearchQueryBudget } from "@/services/api/chat/builtinTools";
import { getResearchTaskRepository } from "@/services/research";
import { AgentRunLeaseConflictError } from "@/services/agent/runLease";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "./executionContext";
import { isAbortError } from "./operations";
import { createSourceSnapshot } from "./sourceSnapshot";
import { resolveTaskContext } from "./taskContext";

/**
 * Extra closed-book model rounds spent repairing a plan the host could not fix
 * deterministically, before the task is reported as failed.
 */
const PLAN_REPAIR_ATTEMPTS = 2;

/**
 * Runs bounded reconnaissance, drafts a plan, and repairs it until it satisfies
 * the host contract or the repair budget runs out.
 */
export async function prepareResearchPlan({
  taskId,
  adjustment,
  requestModel,
  controller,
  toolConfirmationController,
  t,
  localizedRuntimeError,
  onError,
  onNotice,
}: {
  taskId: string;
  adjustment?: string;
  requestModel?: string;
  controller: AbortController;
  toolConfirmationController?: ToolConfirmationController;
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  const store = useResearchStore.getState();
  const initial = store.tasksById[taskId];
  if (!initial) throw new Error("Research task was not found.");
  try {
    const { model, chatConfig, effective, settings } = resolveTaskContext(
      initial,
      requestModel,
    );
    const provisionalSnapshot = await createSourceSnapshot(
      initial,
      requestModel,
    );
    const allowedSourceTypes =
      getResearchSourceSnapshotTypes(provisionalSnapshot);
    const strategy = resolveResearchStrategy(
      initial.budgetPreset,
      initial.requestedStrategy || getActivePlan(initial)?.strategy,
    );
    const reconRunId = uuidv7();
    const criticRunId = uuidv7();
    await store.updateTask(taskId, (current) => {
      const nextStatus =
        current.status === "clarifying"
          ? current
          : transitionResearchTask(current, "clarifying");
      return {
        ...nextStatus,
        sourceSnapshot: provisionalSnapshot,
        agentRunIds: [...nextStatus.agentRunIds, reconRunId, criticRunId],
        error: undefined,
      };
    });
    if (!getResearchTaskRepository().getStatus().durable) {
      throw new Error(t("runtime.error.persistence"));
    }

    const reconEnabled =
      provisionalSnapshot.searchEnabled &&
      effective.searchCompatibility.enabled &&
      effective.searchCompatibility.mode === "external";
    const reconStartedAt = Date.now();
    const executedQueries: string[] = [];
    let planningToolCalls: ToolCall[] = [];
    const reconQueryBudget: BuiltinResearchQueryBudget = {
      remainingQueries: 2,
      maxResultsPerQuery: 5,
      seenQueries: new Set<string>(),
      deadlineAt: reconStartedAt + 30_000,
      onQueriesExecuted: (queries) => executedQueries.push(...queries),
    };
    const reconAdjustment = adjustment?.trim() || undefined;
    let candidateContent = "";
    candidateContent = await streamChatResponse(
      initial.sessionId,
      model,
      [],
      buildResearchPlanPrompt({
        task: initial,
        adjustment: reconAdjustment,
        reconnaissanceAllowed: reconEnabled,
        allowedSourceTypes,
        strategy,
      }),
      [],
      {
        ...chatConfig,
        chatMode: "research",
        useAgentMode: false,
        useDeepResearch: true,
        useSearch: reconEnabled,
        useReasoning: false,
      },
      (text) => {
        candidateContent = text;
      },
      [
        effective.systemInstruction,
        reconEnabled
          ? "This is bounded pre-approval reconnaissance. Only public web search summaries are allowed: at most two queries, five results per query, and thirty seconds total. Do not fetch source bodies. Reconnaissance is audit metadata, not report evidence."
          : "Public reconnaissance is unavailable. Generate the plan with source feasibility explicitly treated as unverified.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      undefined,
      (toolCalls) => {
        planningToolCalls = toolCalls;
      },
      undefined,
      undefined,
      controller.signal,
      [],
      undefined,
      undefined,
      toolConfirmationController,
      {
        executionWorkflow: { kind: "research", phase: "plan" },
        allowedToolIds: reconEnabled ? ["web_search"] : [],
        enforceAllowedToolIds: true,
        allowedToolEffects: reconEnabled ? ["network_read"] : ["local_read"],
        approvalMode: effective.approvalMode,
        researchQueryBudget: reconQueryBudget,
        agentBudget: {
          maxToolRounds: Math.min(3, initial.budget.maxToolRounds),
          maxToolCalls: Math.min(2, initial.budget.maxToolCalls),
          maxDurationMs: Math.min(
            10 * 60 * 1_000,
            initial.budget.maxDurationMs,
          ),
          ...(initial.budget.maxTotalTokens
            ? { maxTotalTokens: initial.budget.maxTotalTokens }
            : {}),
        },
        agentRun: {
          id: reconRunId,
          userMessageId: initial.userMessageId,
          modelMessageId: initial.cardMessageId,
        },
        abortAgentRunAsInterrupted: true,
      },
    );
    controller.signal.throwIfAborted();
    const reconCompletedAt = Date.now();

    // The host repairs what it owns (strategy, source permissions,
    // duplicate query topics) before judging the draft, then spends at
    // most PLAN_REPAIR_ATTEMPTS extra model rounds on what is left.
    const evaluatePlanDraft = (content: string) => {
      const result = parseResearchPlan(content, initial.goal);
      if (!result.valid) {
        return { plan: undefined, issues: result.error.issues };
      }
      const plan = normalizeResearchPlanDraft({
        plan: result.data,
        strategy,
        allowedSourceTypes,
      });
      const issues = validateResearchPlanHostContract({
        plan,
        strategy,
        allowedSourceTypes,
      });
      return issues.length > 0 ? { plan: undefined, issues } : { plan, issues };
    };

    let attemptContent = candidateContent;
    let evaluated = evaluatePlanDraft(attemptContent);
    for (
      let attempt = 0;
      !evaluated.plan && attempt < PLAN_REPAIR_ATTEMPTS;
      attempt += 1
    ) {
      let repairedContent = "";
      repairedContent = await streamChatResponse(
        initial.sessionId,
        model,
        [],
        buildResearchPlanRepairPrompt({
          task: initial,
          invalidOutput: attemptContent,
          issues: evaluated.issues,
          allowedSourceTypes,
          strategy,
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
          repairedContent = text;
        },
        `${effective.systemInstruction}\n\nThis is a closed-book plan repair. All tools and source access are disabled.`,
        undefined,
        undefined,
        undefined,
        undefined,
        controller.signal,
        [],
        undefined,
        undefined,
        undefined,
        {
          disableTools: true,
          agentRun: {
            id: attempt === 0 ? criticRunId : uuidv7(),
            userMessageId: initial.userMessageId,
            modelMessageId: initial.cardMessageId,
          },
        },
      );
      controller.signal.throwIfAborted();
      attemptContent = repairedContent;
      evaluated = evaluatePlanDraft(repairedContent);
    }
    if (!evaluated.plan) {
      await store.updateTask(taskId, (current) =>
        current.status === "cancelled"
          ? current
          : {
              ...transitionResearchTask(current, "failed"),
              error: {
                code: "RESEARCH_PLAN_INVALID",
                message: [
                  `The research plan remained invalid after ${PLAN_REPAIR_ATTEMPTS} repairs.`,
                  ...evaluated.issues.slice(0, 8),
                ].join(" "),
                recoverable: true,
              },
            },
      );
      onError?.(t("runtime.error.plan"));
      return;
    }
    const planDraft = evaluated.plan;

    const recon = buildResearchReconSnapshot({
      enabled: reconEnabled,
      providerId: settings.search.provider,
      startedAt: reconStartedAt,
      completedAt: reconCompletedAt,
      executedQueries,
      toolCalls: planningToolCalls,
    });
    const sourceSnapshot = await createSourceSnapshot(
      store.tasksById[taskId] || initial,
    );
    await store.updateTask(taskId, (current) => {
      if (current.status === "cancelled") return current;
      const version = current.planVersions.length + 1;
      const plan: ResearchPlanVersion = {
        id: uuidv7(),
        version,
        ...planDraft,
        strategy,
        recon,
        createdAt: Date.now(),
        ...(adjustment?.trim()
          ? { adjustment: adjustment.trim().slice(0, 8_000) }
          : {}),
      };
      const planningTask =
        current.status === "clarifying"
          ? current
          : transitionResearchTask(current, "clarifying");
      return {
        ...transitionResearchTask(planningTask, "plan_ready"),
        planVersions: [...current.planVersions, plan],
        activePlanVersion: version,
        sourceSnapshot,
        checkpoint: undefined,
        error: undefined,
      };
    });
    if (!getResearchTaskRepository().getStatus().durable) {
      throw new Error(t("runtime.error.persistence"));
    }
    onNotice?.(t("runtime.notice.planReady"));
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      await store.updateTask(taskId, (current) =>
        current.status === "cancelled" || current.status === "paused"
          ? current
          : transitionResearchTask(current, "paused"),
      );
      return;
    }
    if (error instanceof AgentRunLeaseConflictError) {
      const message = t("runtime.dependency.leaseConflict");
      await store.updateTask(taskId, (current) =>
        current.status === "cancelled"
          ? current
          : {
              ...current,
              error: {
                code: "AGENT_RUN_LEASE_CONFLICT",
                message,
                recoverable: true,
              },
            },
      );
      onError?.(message);
      return;
    }
    await store.updateTask(taskId, (current) =>
      current.status === "cancelled"
        ? current
        : {
            ...transitionResearchTask(current, "failed"),
            error: {
              code: "RESEARCH_PLAN_FAILED",
              message: localizedRuntimeError(error, "planFallback"),
              recoverable: true,
            },
          },
    );
    onError?.(t("runtime.error.plan"));
  }
}
