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
import { type ResearchTemplate } from "@/lib/research/templates";
import { useResearchStore } from "@/store/core/researchStore";
import { streamChatResponse } from "@/services/api/chatService";
import type { BuiltinResearchQueryBudget } from "@/services/api/chat/builtinTools";
import { getResearchTaskRepository } from "@/services/research";
import { freezeResearchTaskTemplate } from "@/services/research/templates";
import { AgentRunLeaseConflictError } from "@/services/agent/runLease";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "./executionContext";
import { isAbortError } from "./operations";
import {
  buildResearchExecutionSourceContext,
  createSourceSnapshot,
  loadSessionMessages,
} from "./sourceSnapshot";
import {
  RESEARCH_PLANNING_SYSTEM_INSTRUCTION,
  type ResearchPlanningStage,
} from "../prompts/planPrompts";
import {
  parseResearchPlanningResponse,
  type ResearchPlanningContextRequest,
} from "../prompts/planningResponse";
import {
  getToolResultData,
  getToolResultError,
  isRecord,
} from "../toolCallInsights";
import type { BuiltinKnowledgeScope } from "@/services/api/chat/builtinTools";
import { resolveTaskContext } from "./taskContext";
import { RESEARCH_RECON_LIMITS } from "../orchestration/strategy";
import { createQuerySignal } from "@/services/api/chat/builtinTools/researchQueryBudget";
import { ResearchModelUnavailableError } from "./dependencyErrors";

/**
 * Extra closed-book model rounds spent repairing a plan the host could not fix
 * deterministically, before the task is reported as failed.
 */
const PLAN_REPAIR_ATTEMPTS = 2;

/**
 * Drafts closed-book first, looks up only unresolved concepts, and repairs until
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
  locale,
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
  locale?: string;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  const store = useResearchStore.getState();
  const initial = store.tasksById[taskId];
  if (!initial) throw new Error("Research task was not found.");
  try {
    const provisionalSnapshot = await createSourceSnapshot(
      initial,
      requestModel,
    );
    const { model, chatConfig, effective, settings } = resolveTaskContext({
      ...initial,
      sourceSnapshot: provisionalSnapshot,
    });
    const frozenTemplate = await freezeResearchTaskTemplate(
      taskId,
      effective.researchTemplate,
      Date.now(),
      locale,
    );
    const template: ResearchTemplate | null = frozenTemplate.template;
    const preserveInitialTemplateContract = Boolean(
      template && initial.planVersions.length === 0 && !adjustment?.trim(),
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
    const knowledgeQueries: string[] = [];
    let planningToolCalls: ToolCall[] = [];
    let planningContext = "";
    let lookupFailed = false;
    let contextRequest: ResearchPlanningContextRequest | undefined;
    let knowledgeScope: BuiltinKnowledgeScope | undefined;
    const reconAdjustment = adjustment?.trim() || undefined;

    const requestPlan = async (stage: ResearchPlanningStage) => {
      controller.signal.throwIfAborted();
      const lookup = stage === "knowledge" || stage === "web";
      const runId = stage === "initial" ? reconRunId : uuidv7();
      if (stage !== "initial") {
        await store.updateTask(taskId, (current) => ({
          ...current,
          agentRunIds: [...current.agentRunIds, runId],
        }));
      }
      controller.signal.throwIfAborted();
      const deadlineAt = lookup
        ? Date.now() +
          (stage === "web"
            ? RESEARCH_RECON_LIMITS.timeoutMs
            : RESEARCH_RECON_LIMITS.knowledgeTimeoutMs)
        : undefined;
      const lookupSignal = createQuerySignal(controller.signal, deadlineAt);
      const queryBudget: BuiltinResearchQueryBudget | undefined = lookup
        ? {
            remainingQueries: 2,
            maxResultsPerQuery: 5,
            seenQueries: new Set<string>(),
            deadlineAt,
            ...(stage === "web"
              ? { allowedQueries: new Set(contextRequest!.queries) }
              : {}),
            onQueriesExecuted: (queries) => {
              (stage === "knowledge" ? knowledgeQueries : executedQueries).push(
                ...queries,
              );
            },
          }
        : undefined;
      let content = "";
      let roundToolCalls: ToolCall[] = [];
      const priorToolCalls = planningToolCalls;
      try {
        content = await streamChatResponse(
          initial.sessionId,
          model,
          [],
          buildResearchPlanPrompt({
            task: initial,
            adjustment: reconAdjustment,
            stage,
            contextRequest,
            planningContext,
            allowedSourceTypes,
            strategy,
            template,
            preserveInitialContract: preserveInitialTemplateContract,
          }),
          [],
          {
            ...chatConfig,
            chatMode: "research",
            useAgentMode: false,
            useDeepResearch: true,
            useSearch: stage === "web",
            useReasoning: false,
          },
          (text) => {
            content = text;
          },
          [effective.systemInstruction, RESEARCH_PLANNING_SYSTEM_INSTRUCTION]
            .filter(Boolean)
            .join("\n\n"),
          undefined,
          (toolCalls) => {
            roundToolCalls = toolCalls;
            planningToolCalls = [...priorToolCalls, ...toolCalls];
          },
          undefined,
          undefined,
          lookupSignal.signal,
          [],
          undefined,
          undefined,
          toolConfirmationController,
          {
            executionWorkflow: { kind: "research", phase: "plan" },
            disableTools: !lookup,
            disableImageGeneration: true,
            allowedToolIds:
              stage === "knowledge"
                ? ["search_knowledge"]
                : stage === "web"
                  ? ["web_search"]
                  : [],
            enforceAllowedToolIds: true,
            allowedToolEffects:
              stage === "web" ? ["network_read"] : ["local_read"],
            approvalMode: effective.approvalMode,
            researchQueryBudget: queryBudget,
            ...(stage === "knowledge" ? { knowledgeScope } : {}),
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
              id: runId,
              userMessageId: initial.userMessageId,
              modelMessageId: initial.cardMessageId,
            },
            abortAgentRunAsInterrupted: true,
          },
        );
        controller.signal.throwIfAborted();
        lookupSignal.signal?.throwIfAborted();
        return content;
      } catch (error) {
        const lookupTimedOut =
          lookupSignal.signal?.aborted &&
          lookupSignal.signal.reason instanceof Error &&
          lookupSignal.signal.reason.name === "TimeoutError";
        if (
          !lookup ||
          (isAbortError(error) && !lookupTimedOut) ||
          controller.signal.aborted ||
          error instanceof AgentRunLeaseConflictError
        )
          throw error;
        // A failed optional lookup cannot turn a recoverable plan into a failed task.
        lookupFailed = true;
        planningContext += `\n${stage} lookup could not finish. Plan using explicit assumptions.`;
        return parseResearchPlanningResponse(content)?.kind === "plan"
          ? content
          : JSON.stringify(contextRequest);
      } finally {
        lookupSignal.cleanup();
        if (lookup) {
          lookupFailed ||= roundToolCalls.some(
            (call) =>
              call.status === "error" || getToolResultError(call) !== null,
          );
          const results = roundToolCalls.slice(0, 2).map((call) => {
            const result = getToolResultData(call);
            const sources = Array.isArray(result?.sources)
              ? result.sources
              : [];
            return {
              tool: call.name,
              error: getToolResultError(call)?.message,
              sources: sources
                .filter(isRecord)
                .slice(0, 5)
                .map((source) => ({
                  title:
                    typeof source.title === "string"
                      ? source.title.slice(0, 500)
                      : "",
                  content:
                    typeof source.content === "string"
                      ? source.content.slice(0, 2_000)
                      : "",
                })),
            };
          });
          planningContext =
            `${planningContext}\n${JSON.stringify({ stage, results })}`.slice(
              0,
              24_000,
            );
        }
      }
    };

    let candidateContent = await requestPlan("initial");
    let response = parseResearchPlanningResponse(candidateContent);
    const contextRequested = response?.kind === "needs_context";
    if (response?.kind === "needs_context") {
      // This immutable request predates all private knowledge. Later model text
      // cannot supply new public queries through a needs_context response.
      contextRequest = { ...response, queries: [...response.queries] };
      if (
        provisionalSnapshot.knowledgeCollectionIds.length > 0 &&
        provisionalSnapshot.toolIds.includes("search_knowledge")
      ) {
        try {
          const messages = await loadSessionMessages(initial.sessionId);
          const sourceContext = buildResearchExecutionSourceContext(
            provisionalSnapshot,
            messages.find((message) => message.id === initial.userMessageId)
              ?.attachments || [],
          );
          knowledgeScope = {
            attachments: sourceContext.approvedKnowledgeAttachments,
            collections: sourceContext.collections,
            ragConfig: { ...settings.rag },
          };
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) throw error;
          lookupFailed = true;
          planningContext +=
            "\nSelected knowledge is unavailable. State the limitation in the plan assumptions.";
        }
        if (knowledgeScope) {
          candidateContent = await requestPlan("knowledge");
          response = parseResearchPlanningResponse(candidateContent);
        }
      }
      if (response?.kind === "needs_context" && reconEnabled) {
        candidateContent = await requestPlan("web");
        response = parseResearchPlanningResponse(candidateContent);
      }
      if (response?.kind === "needs_context") {
        candidateContent = await requestPlan("final");
        response = parseResearchPlanningResponse(candidateContent);
      }
    }
    if (response?.kind === "plan")
      candidateContent = JSON.stringify(response.plan);
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
        template,
        preserveInitialContract: preserveInitialTemplateContract,
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
          planningContext,
          issues: evaluated.issues,
          allowedSourceTypes,
          strategy,
          template,
          preserveInitialContract: preserveInitialTemplateContract,
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
          disableImageGeneration: true,
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
      requested: contextRequested,
      failed: lookupFailed,
      knowledgeQueries,
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
    if (error instanceof ResearchModelUnavailableError) {
      const message = t("runtime.dependency.modelUnavailable");
      await store.updateTask(taskId, (current) =>
        current.status === "cancelled"
          ? current
          : {
              ...transitionResearchTask(current, "paused"),
              error: {
                code: error.code,
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
