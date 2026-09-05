"use client";
import {
  getTemporarySessionSignal,
  isTemporarySession,
  isTemporarySessionId,
  TEMPORARY_CHAT_CONFIG,
} from "@/lib/chat/sessionRetention";
import type React from "react";
import { useTranslations } from "next-intl";
import type {
  ComposerSkillParameterValues,
  SkillParameterRequest,
  SkillParameterSubmission,
} from "@/components/skill/SkillParameterDialog";
import type { StreamChatResponseOptions } from "@/services/api/chatService";
import type {
  AppliedSkillInvocation,
  Attachment,
  ChatConfig,
  Message,
  MessageReplyReference,
  ModelMetadata,
  ModelProvider,
  Plugin,
  PluginConfig,
  RAGConfig,
  SearchProviderID,
  SearchServiceConfig,
  Session,
  SystemSettings,
  TextSkill,
  Workspace,
} from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { useMemoryStore } from "@/store/core/memoryStore";
import {
  resolveEffectiveChatContext,
  type EffectiveChatContext,
} from "@/lib/chat/effectiveChatContext";
import { processMessageForSending } from "@/lib/chat/messageProcessor";
import {
  buildDirectMemoryPromptContext,
  isMemoryVisibleInScopes,
} from "@/lib/memory/entities";
import { getSuppressedMemoryIds } from "@/lib/memory/compression";
import { appendContextToChatInput } from "@/lib/utils/chatInput";
import { getPendingResearchPlanTaskId } from "@/lib/research/pendingTask";
import { buildReplyPromptContext } from "@/lib/chat/streamResilience";
import { mergeSources } from "@/lib/chat/searchUpdate";
import { createCitationSources } from "@/lib/utils/citations";
import { parseModelString } from "@/lib/utils/model";
import {
  getImageCompressionConfig,
  prepareConversationImageAttachments,
} from "@/lib/utils/imageCompression";
import {
  getMissingSkillParameters,
  resolveSkillBundle,
  resolveSkillParameterValues,
} from "@/lib/skills";
import { MARKET_LIMITS, RAG_LIMITS } from "@/config/limits";
import { logDevError } from "@/lib/utils/devLogger";
import type { useChatShellState } from "./useChatShellState";

const logChatAppError = logDevError;

type ShellState = ReturnType<typeof useChatShellState>;

interface UseChatRequestPreparationOptions {
  t: ReturnType<typeof useTranslations<"ChatApp">>;
  selectedModel: string;
  providers: ModelProvider[];
  workspaces: Workspace[];
  system: SystemSettings;
  rag: RAGConfig;
  search: {
    provider: SearchProviderID;
    configs: Record<string, SearchServiceConfig>;
  };
  chatConfig: ChatConfig;
  modelMetadata: Record<string, ModelMetadata>;
  customModelMetadata: Record<string, ModelMetadata>;
  installedPlugins: Plugin[];
  installedSkills: TextSkill[];
  pluginConfigs: Record<string, PluginConfig>;
  activePlugins: string[];
  skillBundles: ShellState["settings"]["skillBundles"];
  activeSkillBundleIds: string[];
  skillAutoSelect: boolean;
  knowledgeCollections: ShellState["knowledgeCollections"];
  updateMessage: ShellState["chat"]["updateMessage"];
  updateSessionMemoryContext: ShellState["chat"]["updateSessionMemoryContext"];
  /**
   * Owned by ChatApp: the collected values outlive a single request and are
   * also read by the regenerate/continue flows.
   */
  skillParameterValuesRef: React.RefObject<
    ComposerSkillParameterValues["skillParameterValues"]
  >;
  skillBundleParameterValuesRef: React.RefObject<
    ComposerSkillParameterValues["skillBundleParameterValues"]
  >;
  /** Opens the parameter dialog; resolves to null when the user cancels. */
  requestSkillParameterValues: (
    requests: SkillParameterRequest[],
    initialValues: SkillParameterSubmission,
  ) => Promise<SkillParameterSubmission | null>;
  showActionError: (message: string) => void;
}

/**
 * The request-preparation stage shared by every generation path: resolve the
 * effective context, collect skill parameters, build the model prompt, and
 * record injected memories.
 */
export function useChatRequestPreparation({
  t,
  selectedModel,
  providers,
  workspaces,
  system,
  rag,
  search,
  chatConfig,
  modelMetadata,
  customModelMetadata,
  installedPlugins,
  installedSkills,
  pluginConfigs,
  activePlugins,
  skillBundles,
  activeSkillBundleIds,
  skillAutoSelect,
  knowledgeCollections,
  updateMessage,
  updateSessionMemoryContext,
  skillParameterValuesRef,
  skillBundleParameterValuesRef,
  requestSkillParameterValues,
  showActionError,
}: UseChatRequestPreparationOptions) {
  const getEffectiveContextForSession = (
    session?: Session | null,
    requestModel = selectedModel,
  ) => {
    const { providerId } = parseModelString(requestModel);
    const provider = providerId
      ? providers.find((item) => item.id === providerId)
      : providers.find((item) => item.enabled);
    const workspace = session?.workspaceId
      ? workspaces.find((item) => item.id === session.workspaceId)
      : null;

    const temporary = isTemporarySession(session);
    const context = resolveEffectiveChatContext({
      session,
      workspace,
      systemPrompt: system.systemPrompt,
      personality: system.personality,
      enableHtmlVisualPrompt: system.enableHtmlVisualPrompt,
      selectedModel: requestModel,
      provider,
      modelMetadata,
      customModelMetadata,
      chatConfig: temporary
        ? { ...chatConfig, ...TEMPORARY_CHAT_CONFIG }
        : chatConfig,
      search: {
        provider: search.provider,
        configs: search.configs,
      },
      rag,
      installedPlugins,
      installedSkills,
      pluginConfigs,
      activePlugins,
    });
    return temporary
      ? {
          ...context,
          workspaceFiles: [],
          workspaceKnowledgeCollectionIds: [],
          activePluginIds: [],
          activeSkillIds: [],
          agentSkillIds: [],
          agentToolIds: [],
          memoryScopes: [],
          memoryScopeIds: {},
          agentModeEnabled: false,
          researchModeEnabled: false,
          orchestratedModeEnabled: false,
        }
      : context;
  };

  const prepareComposerSkillParameters = async (
    session?: Session | null,
    requestModel = selectedModel,
    forcedSkillIds: readonly string[] = [],
  ): Promise<ComposerSkillParameterValues | null> => {
    if (isTemporarySession(session))
      return { skillParameterValues: {}, skillBundleParameterValues: {} };
    const effectiveContext = getEffectiveContextForSession(
      session,
      requestModel,
    );
    const skillsById = new Map(
      installedSkills.map((skill) => [skill.id, skill]),
    );
    const activeManualSkills =
      skillAutoSelect || effectiveContext.orchestratedModeEnabled
        ? []
        : effectiveContext.activeSkillIds
            .map((id) => skillsById.get(id))
            .filter((skill): skill is (typeof installedSkills)[number] =>
              Boolean(skill),
            );
    // `/skill` references bypass auto-select, so they still need their
    // parameters collected before the message is sent.
    const seenSkillIds = new Set(activeManualSkills.map((skill) => skill.id));
    for (const id of effectiveContext.researchModeEnabled
      ? []
      : forcedSkillIds) {
      const skill = skillsById.get(id);
      if (!skill || seenSkillIds.has(skill.id)) continue;
      seenSkillIds.add(skill.id);
      activeManualSkills.push(skill);
    }
    const bundlesById = new Map(
      skillBundles.map((bundle) => [bundle.id, bundle]),
    );
    const activeBundles = (
      effectiveContext.researchModeEnabled ? [] : activeSkillBundleIds
    )
      .map((id) => bundlesById.get(id))
      .filter((bundle): bundle is (typeof skillBundles)[number] =>
        Boolean(bundle),
      );
    const requests: SkillParameterRequest[] = [];

    for (const skill of activeManualSkills) {
      if (
        getMissingSkillParameters(
          skill,
          skillParameterValuesRef.current[skill.id],
        ).length > 0
      ) {
        requests.push({
          key: `skill:${skill.id}`,
          title: skill.title,
          description: skill.description,
          parameters: skill.parameters || [],
        });
      }
    }
    for (const bundle of activeBundles) {
      if (
        getMissingSkillParameters(
          { id: bundle.id, parameters: bundle.parameters },
          skillBundleParameterValuesRef.current[bundle.id],
        ).length > 0
      ) {
        requests.push({
          key: `bundle:${bundle.id}`,
          title: bundle.title,
          description: bundle.description,
          parameters: bundle.parameters,
        });
      }
    }

    if (requests.length > 0) {
      const initialValues = Object.fromEntries(
        requests.map((request) => {
          const [kind, id] = request.key.split(":", 2);
          return [
            request.key,
            kind === "bundle"
              ? skillBundleParameterValuesRef.current[id] || {}
              : skillParameterValuesRef.current[id] || {},
          ];
        }),
      );
      const submission = await requestSkillParameterValues(
        requests,
        initialValues,
      );
      if (!submission) return null;
      for (const [key, values] of Object.entries(submission)) {
        const [kind, id] = key.split(":", 2);
        if (!id) continue;
        if (kind === "bundle") {
          skillBundleParameterValuesRef.current[id] = values;
        } else if (kind === "skill") {
          skillParameterValuesRef.current[id] = values;
        }
      }
    }

    try {
      activeManualSkills.forEach((skill) =>
        resolveSkillParameterValues(
          skill,
          skillParameterValuesRef.current[skill.id],
        ),
      );
      activeBundles.forEach((bundle) =>
        resolveSkillBundle({
          bundle,
          skills: installedSkills,
          values: skillBundleParameterValuesRef.current[bundle.id],
        }),
      );
    } catch (error) {
      logChatAppError("Skill parameter validation failed:", error);
      showActionError(t("errSkillParameters"));
      return null;
    }

    return {
      skillParameterValues: { ...skillParameterValuesRef.current },
      skillBundleParameterValues: {
        ...skillBundleParameterValuesRef.current,
      },
    };
  };

  const processPromptForModel = async (
    session: Session | null | undefined,
    text: string,
    attachments: Attachment[],
    signal: AbortSignal,
    existingMemoryContext?: Message["memoryContext"],
    replyTo?: MessageReplyReference,
    requestModel = selectedModel,
  ) => {
    const effectiveContext = getEffectiveContextForSession(
      session,
      requestModel,
    );
    const temporary = isTemporarySession(session);
    getTemporarySessionSignal(session?.id)?.throwIfAborted();
    if (temporary) attachments = [];
    const preparedAttachments = effectiveContext.researchModeEnabled
      ? attachments
      : await prepareConversationImageAttachments(
          attachments,
          getImageCompressionConfig(system),
          { signal },
        );
    const processedData = await processMessageForSending({
      text,
      attachments: preparedAttachments,
      selectedModel: requestModel,
      modelMetadata,
      customModelMetadata,
      ragConfig: rag,
      ragEnabled: !temporary && chatConfig.useRAG !== false,
      deferKnowledgeRetrieval: effectiveContext.orchestratedModeEnabled,
      deferAttachmentReading: effectiveContext.researchModeEnabled,
      knowledgeCollections,
      workspaceKnowledgeCollectionIds:
        effectiveContext.workspaceKnowledgeCollectionIds,
      signal,
    });

    const memoryState = useMemoryStore.getState();
    const directMemoryContext =
      temporary || effectiveContext.researchModeEnabled
        ? { text: "", injectedMemoryIds: [] }
        : existingMemoryContext?.promptContext
          ? {
              text: existingMemoryContext.promptContext,
              injectedMemoryIds: existingMemoryContext.injectedMemoryIds,
            }
          : memoryState._hasHydrated &&
              memoryState.settings.enabled &&
              memoryState.settings.searchEnabled
            ? buildDirectMemoryPromptContext({
                memories: memoryState.memories.filter((memory) =>
                  isMemoryVisibleInScopes(
                    memory,
                    effectiveContext.memoryScopes,
                    effectiveContext.memoryScopeIds,
                  ),
                ),
                query: text,
                alreadyInjectedMemoryIds: getSuppressedMemoryIds(
                  session,
                  useChatStore.getState().activeMessages,
                ),
              })
            : { text: "", injectedMemoryIds: [] };
    const memoryContext =
      directMemoryContext.text &&
      directMemoryContext.injectedMemoryIds.length > 0
        ? {
            injectedMemoryIds: directMemoryContext.injectedMemoryIds,
            promptContext: directMemoryContext.text,
            createdAt: existingMemoryContext?.createdAt || Date.now(),
          }
        : undefined;

    const replyContext = buildReplyPromptContext(replyTo);
    const promptWithReply = replyContext
      ? appendContextToChatInput(replyContext, processedData.finalText, {
          separator: "\n\n",
        })
      : processedData.finalText;

    return {
      ...processedData,
      userMessage: {
        ...processedData.userMessage,
        ...(memoryContext ? { memoryContext } : {}),
        ...(replyTo ? { replyTo } : {}),
      },
      finalText: directMemoryContext.text
        ? appendContextToChatInput(promptWithReply, directMemoryContext.text, {
            separator: "\n\n",
          })
        : promptWithReply,
      researchLaunchText: promptWithReply,
      // A reply sent while a plan is awaiting approval refines that plan
      // instead of launching a second research task.
      researchPendingPlanTaskId: effectiveContext.researchModeEnabled
        ? (getPendingResearchPlanTaskId(session?.id) ?? undefined)
        : undefined,
      effectiveContext,
      injectedMemoryIds: directMemoryContext.injectedMemoryIds,
    };
  };

  const createAgentToolStreamOptions = ({
    sessionId,
    modelMessageId,
    knowledgeScope,
    isActive,
    allowedSkillIds,
    allowedToolIds,
    approvalMode,
    agentBudget,
    agentRun,
    memoryScopes,
    memoryScopeIds,
  }: {
    sessionId: string;
    modelMessageId: string;
    knowledgeScope: Attachment[];
    isActive: () => boolean;
    allowedSkillIds?: string[];
    allowedToolIds?: string[];
    approvalMode?: EffectiveChatContext["approvalMode"];
    agentBudget?: EffectiveChatContext["agentBudget"];
    agentRun?: StreamChatResponseOptions["agentRun"];
    memoryScopes?: StreamChatResponseOptions["memoryScopes"];
    memoryScopeIds?: StreamChatResponseOptions["memoryScopeIds"];
  }): StreamChatResponseOptions => ({
    allowedSkillIds,
    allowedToolIds,
    approvalMode,
    agentBudget,
    agentRun,
    memoryScopes,
    memoryScopeIds,
    researchBudgetPreset:
      useChatStore
        .getState()
        .sessions.find((session) => session.id === sessionId)?.config
        ?.researchBudgetPreset || "standard",
    onChatModeChange: (config, agentRunId) => {
      if (!isActive()) return;
      const modeConfig = {
        chatMode: config.chatMode,
        useAgentMode: config.useAgentMode === true,
        useDeepResearch: config.useDeepResearch === true,
        useSearch: config.useSearch === true,
      };
      const chatState = useChatStore.getState();
      chatState.setChatConfig(modeConfig);
      chatState.updateSessionConfig(sessionId, modeConfig);
      const current = chatState.activeMessages.find(
        (message) => message.id === modelMessageId,
      );
      if (current?.generation) {
        const generation = { ...current.generation };
        delete generation.agentRunId;
        updateMessage(sessionId, modelMessageId, {
          generation: agentRunId ? { ...generation, agentRunId } : generation,
        });
      }
    },
    knowledgeScope: {
      attachments: knowledgeScope.map((attachment) => ({ ...attachment })),
      collections: knowledgeCollections,
      ragConfig: { ...rag },
    },
    onKnowledgeSources: (sources, ragError) => {
      if (!isActive()) return;
      const current = useChatStore
        .getState()
        .activeMessages.find((message) => message.id === modelMessageId);
      const ragSources = mergeSources([], sources).slice(0, RAG_LIMITS.maxTopK);
      updateMessage(sessionId, modelMessageId, {
        ragSources,
        ragError,
        citations: createCitationSources({
          web: current?.searchSources,
          knowledge: ragSources,
        }),
      });
    },
    onSkillInvocation: (invocation: AppliedSkillInvocation) => {
      if (!isActive()) return;
      const current = useChatStore
        .getState()
        .activeMessages.find((message) => message.id === modelMessageId);
      const existing = current?.skillInvocations || [];
      if (existing.some((item) => item.id === invocation.id)) return;
      if (existing.length >= MARKET_LIMITS.maxActiveSkills) return;
      const nextOrder =
        existing.reduce(
          (maximum, item, index) => Math.max(maximum, item.order ?? index),
          -1,
        ) + 1;
      updateMessage(sessionId, modelMessageId, {
        skillInvocations: [
          ...existing,
          {
            ...invocation,
            order: nextOrder,
          },
        ],
      });
    },
  });

  const commitInjectedMemoryContext = (
    sessionId: string,
    session: Session | null | undefined,
    injectedMemoryIds: string[],
  ) => {
    if (isTemporarySessionId(sessionId) || injectedMemoryIds.length === 0)
      return;
    const merged = Array.from(
      new Set([
        ...(session?.memoryContext?.injectedMemoryIds || []),
        ...injectedMemoryIds,
      ]),
    );
    updateSessionMemoryContext(sessionId, {
      injectedMemoryIds: merged,
      updatedAt: Date.now(),
    });
  };

  return {
    getEffectiveContextForSession,
    prepareComposerSkillParameters,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
  };
}
