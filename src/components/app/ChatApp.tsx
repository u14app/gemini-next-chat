"use client";
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useLocale, useTranslations } from "next-intl";

import ChatAppShell from "@/components/app/ChatAppShell";
import type { MessageInputRef } from "@/components/chat/MessageInput";
import SkillParameterDialog, {
  type ComposerSkillParameterValues,
  type SkillParameterRequest,
  type SkillParameterSubmission,
} from "@/components/skill/SkillParameterDialog";
import AgentUserInputDialog from "@/components/agent/AgentUserInputDialog";
import type { ModelInfo } from "@/services/api/chatService";
import { getAgentDetail } from "@/services/api/agentService";
import type { AgentProfileV2, SessionConfig } from "@/types";
import { Message, LobeAgent, SessionMessageTree, ToolCall } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { appDb } from "@/store/storage/storageConfig";
import { formatModelName } from "@/store/core/settingsStore";
import { buildAvailableModels } from "@/lib/utils/models";
import {
  createSessionPostGenerationSnapshot,
  shouldAbortActiveGenerationForSessionDelete,
  shouldApplyRequestedTitle,
} from "@/lib/chat/postGenerationGuards";
import {
  useChatBootstrap,
  useChatGenerationController,
  useChatPanelNavigation,
  useChatRequestPreparation,
  useChatShellState,
  useChatThemeEffects,
  useMessageEditFlow,
  useResponseBranchFlow,
  useSendMessageFlow,
  useToolConfirmationController,
  useAgentUserInputController,
  useWelcomeChatState,
  useWorkspaceAttachmentHydration,
} from "@/features/chat";
import {
  getActiveMessagePath,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
import { normalizeActivePluginIds } from "@/lib/plugin/config";
import { parseModelString } from "@/lib/utils/model";
import { logDevError } from "@/lib/utils/devLogger";
import {
  getSessionPluginPresetSyncKey,
  shouldApplySessionPluginPreset,
} from "@/lib/app/startupEffects";
import { getSessionDisplayTitle } from "@/lib/chat/sessionTitle";
import { resolveEffectiveSearchCapability } from "@/lib/settings/searchRag";
import { recoverPersistedGeneration } from "@/lib/chat/streamResilience";
import {
  createStreamRenderScheduler,
  type StreamRenderScheduler,
} from "@/lib/chat/streamRenderScheduler";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import {
  cleanupCreatedLongTextFiles,
  persistLongTextOutputBlocks,
} from "@/lib/chat/longTextFiles";
import { getLongTextBlocks } from "@/lib/chat/longText";
import type {
  ChatFlowDeps,
  StreamRenderSnapshot,
} from "@/features/chat/hooks/chatFlowTypes";
import {
  ResearchRuntimeProvider,
  cancelResearchTasksForSession,
} from "@/features/research";

const logChatAppError = logDevError;
const EMPTY_MESSAGES: Message[] = [];
const loadChatService = () => import("@/services/api/chatService");
const getCompressionInputSignature = (messages: Message[]) =>
  JSON.stringify(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      memoryContext: message.memoryContext,
    })),
  );

function createProfileSessionConfig(
  identifier: string,
  profile: AgentProfileV2 | undefined,
): SessionConfig | undefined {
  if (!profile) return undefined;
  const reasoningMode = profile.runtime.reasoningMode;
  const skillPolicies = profile.capabilities.skillPolicies || [];

  return {
    agentProfileId: identifier,
    agentProfile: profile,
    chatMode: profile.runtime.agentEnabled ? "agent" : "chat",
    useAgentMode: profile.runtime.agentEnabled,
    approvalMode: profile.runtime.approvalMode,
    ...(profile.runtime.budget ? { agentBudget: profile.runtime.budget } : {}),
    ...(typeof profile.runtime.searchEnabled === "boolean"
      ? { useSearch: profile.runtime.searchEnabled }
      : {}),
    ...(reasoningMode
      ? {
          reasoningMode,
          useReasoning: reasoningMode !== "off",
        }
      : {}),
    activePlugins: profile.capabilities.pluginIds || [],
    skillPolicies,
    activeSkills: skillPolicies
      .filter((policy) => policy.mode !== "disabled")
      .map((policy) => policy.skillId),
  };
}

const ChatApp = () => {
  // --- Global Store ---
  const {
    chat: {
      _hasHydrated: chatHasHydrated,
      sessions,
      workspaces,
      currentSessionId,
      activeMessages,
      activeMessageTree,
      isActiveSessionLoading,
      activeSessionLoadError,
      selectedModel,
      chatConfig,
      createSession,
      selectSession,
      deleteSession,
      updateSessionTitle,
      updateSessionInstruction,
      updateSessionCompression,
      updateSessionMemoryContext,
      updateSessionConfig,
      toggleSessionPin,
      duplicateSession,
      addMessage,
      updateMessageContent,
      updateMessage,
      addMessageVersion,
      createEditedUserMessageBranch,
      switchMessageVersion,
      selectMessageVersion,
      deleteMessage,
      deleteMessageAndSubsequent,
      setSuggestedQuestions,
      setModel,
      setChatConfig,
      getCurrentSession,
      syncActiveSession,
    },
    settings: {
      _hasHydrated,
      modelMetadata,
      customModelMetadata,
      fetchModelMetadata,
      ensureBuiltInPlugins,
      system,
      rag,
      search,
      activePlugins,
      installedPlugins,
      pluginConfigs,
      installedSkills,
      skillBundles,
      activeSkillBundleIds,
      skillAutoSelect,
      setActivePlugins,
      applyServerConfig: applySettingsServerConfig,
    },
    core: {
      _hasHydrated: coreHasHydrated,
      theme,
      providers,
      updateProvider,
      applyServerConfig: applyCoreServerConfig,
    },
    knowledgeCollections,
  } = useChatShellState();

  const t = useTranslations("ChatApp");
  const tInput = useTranslations("MessageInput");
  const locale = useLocale();
  const loadSessionRuns = useAgentRunStore((state) => state.loadSessionRuns);

  // --- Local UI State ---
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    if (currentSessionId) void loadSessionRuns(currentSessionId);
  }, [currentSessionId, loadSessionRuns]);
  const [generationRecoveryTick, setGenerationRecoveryTick] = useState(0);
  const [skillParameterDialog, setSkillParameterDialog] = useState<{
    requests: SkillParameterRequest[];
    initialValues: SkillParameterSubmission;
  } | null>(null);
  const skillParameterDialogResolverRef = useRef<
    ((values: SkillParameterSubmission | null) => void) | null
  >(null);
  const skillParameterValuesRef = useRef<
    ComposerSkillParameterValues["skillParameterValues"]
  >({});
  const skillBundleParameterValuesRef = useRef<
    ComposerSkillParameterValues["skillBundleParameterValues"]
  >({});
  const {
    isGenerating,
    beginActiveGeneration,
    isGenerationRunActive,
    finishActiveGeneration,
    stopActiveGeneration,
  } = useChatGenerationController();
  const {
    viewMode,
    settingsTab,
    researchTaskId,
    isSidebarOpen,
    isNonDesktopViewport,
    isSidebarDrawerOpen,
    mainInertProps,
    setIsSidebarOpen,
    navigateToPanel,
    handleSettingsTabChange,
  } = useChatPanelNavigation();

  const backgroundPostProcessControllerRef = useRef<AbortController | null>(
    null,
  );
  const manualCompressionControllerRef = useRef<AbortController | null>(null);
  const abortBackgroundPostProcessing = useCallback(() => {
    backgroundPostProcessControllerRef.current?.abort();
    backgroundPostProcessControllerRef.current = null;
  }, []);
  const beginBackgroundPostProcessing = useCallback(() => {
    abortBackgroundPostProcessing();
    const controller = new AbortController();
    backgroundPostProcessControllerRef.current = controller;
    return controller.signal;
  }, [abortBackgroundPostProcessing]);
  const abortManualCompression = useCallback(() => {
    manualCompressionControllerRef.current?.abort();
    manualCompressionControllerRef.current = null;
  }, []);

  const queueMemoryExtraction = useCallback(
    (
      sessionId: string,
      userMessage: Pick<Message, "id" | "content">,
      assistantMessage: Pick<Message, "id" | "content">,
      signal?: AbortSignal,
    ) => {
      loadChatService()
        .then(({ performBackgroundMemoryExtraction }) =>
          performBackgroundMemoryExtraction({
            sessionId,
            userMessage,
            assistantMessage,
            signal,
          }),
        )
        .catch((err) => {
          if (
            signal?.aborted ||
            (err instanceof Error && err.name === "AbortError")
          ) {
            return;
          }
          logChatAppError("Memory extraction failed:", err);
        });
    },
    [],
  );

  const availableModels = useMemo<ModelInfo[]>(() => {
    if (!_hasHydrated || !coreHasHydrated) return [];

    return buildAvailableModels(
      providers,
      modelMetadata,
      customModelMetadata,
      formatModelName,
    );
  }, [
    _hasHydrated,
    coreHasHydrated,
    providers,
    modelMetadata,
    customModelMetadata,
  ]);

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<MessageInputRef>(null);
  const activeStreamCheckpointRef = useRef<{
    flush: () => Promise<void>;
  } | null>(null);
  const activeStreamRenderRef =
    useRef<StreamRenderScheduler<StreamRenderSnapshot> | null>(null);
  const actionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const actionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const assistantSelectRequestRef = useRef(0);
  const createMessageStreamRenderer = useCallback(
    (sessionId: string, messageId: string) =>
      createStreamRenderScheduler<StreamRenderSnapshot>((snapshot) => {
        updateMessageContent(
          sessionId,
          messageId,
          snapshot.content,
          snapshot.reasoning,
          snapshot.outputBlocks,
        );
      }),
    [updateMessageContent],
  );
  const longTextPersistenceQueueRef = useRef(new Map<string, Promise<void>>());
  const persistLongTextFilesForMessage = useCallback(
    (
      sessionId: string,
      messageId: string,
      options: { expectedRequestId?: string; signal?: AbortSignal } = {},
    ) => {
      const queueKey = `${sessionId}:${messageId}`;
      const previous =
        longTextPersistenceQueueRef.current.get(queueKey) || Promise.resolve();
      const queued = previous
        .catch(() => undefined)
        .then(async () => {
          const before = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === messageId);
          if (
            !before?.outputBlocks?.length ||
            (options.expectedRequestId &&
              before.generation?.requestId !== options.expectedRequestId)
          ) {
            return;
          }
          const beforeLongTextBlocks = getLongTextBlocks(before.outputBlocks);
          if (beforeLongTextBlocks.length === 0) return;

          const signature = beforeLongTextBlocks.map((block) => ({
            id: block.id,
            content: block.content,
            url: block.presentation?.document.url,
          }));
          const result = await persistLongTextOutputBlocks(
            before.outputBlocks,
            { signal: options.signal },
          );
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === messageId);
          const currentSignature = getLongTextBlocks(current?.outputBlocks).map(
            (block) => ({
              id: block.id,
              content: block.content,
              url: block.presentation?.document.url,
            }),
          );
          const isCurrent =
            current &&
            (!options.expectedRequestId ||
              current.generation?.requestId === options.expectedRequestId) &&
            JSON.stringify(currentSignature) === JSON.stringify(signature);

          if (!isCurrent) {
            await cleanupCreatedLongTextFiles(result.createdUrls);
            return;
          }
          updateMessage(sessionId, messageId, {
            outputBlocks: result.outputBlocks,
          });
        });

      longTextPersistenceQueueRef.current.set(queueKey, queued);
      const clearQueue = () => {
        if (longTextPersistenceQueueRef.current.get(queueKey) === queued) {
          longTextPersistenceQueueRef.current.delete(queueKey);
        }
      };
      void queued.then(clearQueue, clearQueue);
      return queued;
    },
    [updateMessage],
  );

  const currentSession = getCurrentSession(); // This is just metadata now
  const messages = activeMessages ?? EMPTY_MESSAGES; // Use activeMessages from store
  const currentSessionConfig = currentSession?.config;
  const currentSessionWorkspaceId = currentSession?.workspaceId;
  const handleToolApprovalsChange = useCallback(
    (
      toolApprovals: NonNullable<typeof currentSessionConfig>["toolApprovals"],
    ) => {
      if (!currentSessionId) return;
      updateSessionConfig(currentSessionId, { toolApprovals });
    },
    [currentSessionId, updateSessionConfig],
  );
  const {
    controller: toolConfirmationController,
    pendingRequests: pendingToolConfirmations,
    decide: decideToolConfirmation,
  } = useToolConfirmationController({
    sessionId: currentSessionId,
    approvals: currentSessionConfig?.toolApprovals ?? [],
    onApprovalsChange: handleToolApprovalsChange,
  });
  const {
    controller: agentUserInputController,
    pendingRequests: pendingAgentUserInputRequests,
    respond: respondToAgentUserInput,
  } = useAgentUserInputController();
  const revokeToolSessionApproval = useCallback(
    (toolCall: ToolCall) => {
      if (!currentSessionId || !toolCall.pluginId) return;
      const toolApprovals = (currentSessionConfig?.toolApprovals ?? []).filter(
        (approval) =>
          approval.pluginId !== toolCall.pluginId ||
          approval.functionFingerprint !== toolCall.functionFingerprint ||
          approval.risk !== toolCall.risk,
      );
      updateSessionConfig(currentSessionId, { toolApprovals });
    },
    [
      currentSessionConfig?.toolApprovals,
      currentSessionId,
      updateSessionConfig,
    ],
  );
  const selectedProvider = useMemo(() => {
    const { providerId } = parseModelString(selectedModel);
    return providerId
      ? providers.find((provider) => provider.id === providerId)
      : providers.find((provider) => provider.enabled);
  }, [providers, selectedModel]);
  const currentSearchCompatibility = useMemo(() => {
    const searchConfig =
      search.provider === "google"
        ? undefined
        : search.configs[search.provider];
    return resolveEffectiveSearchCapability({
      searchProvider: search.provider,
      searchConfig,
      modelProviderType: selectedProvider?.type,
      selectedModel,
    });
  }, [search.configs, search.provider, selectedModel, selectedProvider?.type]);
  useChatThemeEffects(theme, system.fontSize);

  // Logic for Assistant List Animation
  const isChatEmpty =
    messages.length === 0 && !currentSession?.systemInstruction;
  const { welcomeState, messageInputVariant, shouldShowChatTitleBar } =
    useWelcomeChatState({
      currentSessionId,
      isChatEmpty,
    });
  const syncedSessionPluginPresetRef = useRef<string | null>(null);

  // --- Effects ---

  // Sync Global Plugins from Session Config
  useEffect(() => {
    const sessionPluginPreset = currentSessionConfig?.activePlugins;
    const sessionPlugins = normalizeActivePluginIds(
      sessionPluginPreset,
      installedPlugins,
      pluginConfigs,
      { unauthenticatedAllowedPluginIds: ["unsplash"] },
    );
    const presetSyncKey = getSessionPluginPresetSyncKey(
      currentSessionId,
      sessionPlugins,
    );

    if (
      !shouldApplySessionPluginPreset(
        _hasHydrated,
        chatHasHydrated,
        sessionPluginPreset,
        syncedSessionPluginPresetRef.current,
        presetSyncKey,
      )
    ) {
      return;
    }

    const sortedSession = [...sessionPlugins].sort();
    const sortedActive = [...activePlugins].sort();

    if (JSON.stringify(sortedSession) !== JSON.stringify(sortedActive)) {
      setActivePlugins(sessionPlugins);
    }
    syncedSessionPluginPresetRef.current = presetSyncKey;
  }, [
    activePlugins,
    chatHasHydrated,
    currentSessionId,
    currentSessionConfig,
    _hasHydrated,
    installedPlugins,
    pluginConfigs,
    setActivePlugins,
  ]);

  useWorkspaceAttachmentHydration({
    activeMessagesLength: activeMessages.length,
    currentSessionId,
    currentSessionWorkspaceId,
    inputRef: messageInputRef,
    workspaces,
  });

  const { serverModelBootstrapReady } = useChatBootstrap({
    chatHasHydrated,
    settingsHasHydrated: _hasHydrated,
    coreHasHydrated,
    useSearch: chatConfig.useSearch,
    useDeepResearch: chatConfig.useDeepResearch === true,
    currentSearchCompatibility,
    setChatConfig,
    updateSessionConfig,
    fetchModelMetadata,
    ensureBuiltInPlugins,
    applyCoreServerConfig,
    applySettingsServerConfig,
    providers,
    updateProvider,
    availableModels,
    selectedModel,
    setModel,
    sessions,
    currentSessionId,
    createSession,
    selectSession,
  });

  useEffect(() => {
    return () => {
      abortBackgroundPostProcessing();
      abortManualCompression();
      assistantSelectRequestRef.current += 1;
      if (actionErrorTimerRef.current) {
        clearTimeout(actionErrorTimerRef.current);
        actionErrorTimerRef.current = null;
      }
      if (actionNoticeTimerRef.current) {
        clearTimeout(actionNoticeTimerRef.current);
        actionNoticeTimerRef.current = null;
      }
    };
  }, [abortBackgroundPostProcessing, abortManualCompression]);

  useEffect(
    () => () => abortBackgroundPostProcessing(),
    [abortBackgroundPostProcessing, currentSessionId],
  );
  useEffect(
    () => () => abortManualCompression(),
    [abortManualCompression, currentSessionId],
  );

  useEffect(() => {
    const flushCheckpoint = () => {
      activeStreamRenderRef.current?.flush();
      void activeStreamCheckpointRef.current?.flush();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushCheckpoint();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushCheckpoint);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushCheckpoint);
    };
  }, []);

  useEffect(() => {
    if (!currentSessionId) return;
    const ownerDeviceId = getSyncDeviceId();
    const now = Date.now();
    let nextForeignStaleDelay: number | null = null;
    activeMessages.forEach((message) => {
      const normalized = recoverPersistedGeneration(
        message,
        ownerDeviceId,
        isGenerating,
        now,
      );
      if (normalized !== message) {
        updateMessage(currentSessionId, message.id, {
          generation: normalized.generation,
        });
      } else if (
        message.generation?.status === "streaming" &&
        message.generation.ownerDeviceId !== ownerDeviceId
      ) {
        const delay =
          message.generation.checkpointAt + 2 * 60 * 1000 - now + 25;
        if (delay > 0) {
          nextForeignStaleDelay =
            nextForeignStaleDelay === null
              ? delay
              : Math.min(nextForeignStaleDelay, delay);
        }
      }
    });
    if (nextForeignStaleDelay === null) return;
    const timer = window.setTimeout(
      () => setGenerationRecoveryTick((value) => value + 1),
      nextForeignStaleDelay,
    );
    return () => window.clearTimeout(timer);
  }, [
    activeMessages,
    currentSessionId,
    generationRecoveryTick,
    isGenerating,
    updateMessage,
  ]);

  // --- Handlers ---

  const showActionError = (message: string) => {
    if (actionErrorTimerRef.current) {
      clearTimeout(actionErrorTimerRef.current);
    }
    setActionError(message);
    actionErrorTimerRef.current = setTimeout(() => {
      actionErrorTimerRef.current = null;
      setActionError(null);
    }, 5000);
  };

  /** Neutral counterpart to `showActionError`, for succeeded actions. */
  const showActionNotice = (message: string) => {
    if (actionNoticeTimerRef.current) {
      clearTimeout(actionNoticeTimerRef.current);
    }
    setActionNotice(message);
    actionNoticeTimerRef.current = setTimeout(() => {
      actionNoticeTimerRef.current = null;
      setActionNotice(null);
    }, 5000);
  };

  useEffect(() => {
    if (activeSessionLoadError === "session_load_failed") {
      showActionError(t("errLoadChat"));
    }
  }, [activeSessionLoadError, t]);

  const syncActiveSessionWithNotice = async (
    sessionId: string,
    logMessage: string,
  ) => {
    try {
      await syncActiveSession(sessionId);
    } catch (error) {
      logChatAppError(logMessage, error);
      showActionError(t("errSaveChanges"));
    }
  };

  const stopActiveGenerationWithFeedback = async () => {
    abortBackgroundPostProcessing();
    try {
      const renderer = activeStreamRenderRef.current;
      const checkpoint = activeStreamCheckpointRef.current;
      renderer?.flush();
      await stopActiveGeneration();
      await checkpoint?.flush();
    } catch (error) {
      logChatAppError("Failed to persist stopped generation", error);
      showActionError(t("errSaveStopped"));
    }
  };

  const handleStopGeneration = () => {
    void stopActiveGenerationWithFeedback();
  };

  const requestSkillParameterValues = useCallback(
    (
      requests: SkillParameterRequest[],
      initialValues: SkillParameterSubmission,
    ) =>
      new Promise<SkillParameterSubmission | null>((resolve) => {
        skillParameterDialogResolverRef.current?.(null);
        skillParameterDialogResolverRef.current = resolve;
        setSkillParameterDialog({ requests, initialValues });
      }),
    [],
  );

  const closeSkillParameterDialog = useCallback(
    (values: SkillParameterSubmission | null) => {
      const resolve = skillParameterDialogResolverRef.current;
      skillParameterDialogResolverRef.current = null;
      setSkillParameterDialog(null);
      resolve?.(values);
    },
    [],
  );

  useEffect(
    () => () => {
      skillParameterDialogResolverRef.current?.(null);
      skillParameterDialogResolverRef.current = null;
    },
    [],
  );

  const {
    getEffectiveContextForSession,
    prepareComposerSkillParameters,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
  } = useChatRequestPreparation({
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
  });

  const chatFlowDeps: ChatFlowDeps = {
    t,
    locale,
    showActionError,
    syncActiveSessionWithNotice,
    sessions,
    currentSessionId,
    activeMessages,
    selectedModel,
    chatConfig,
    getCurrentSession,
    createSession,
    addMessage,
    updateMessage,
    updateMessageContent,
    addMessageVersion,
    createEditedUserMessageBranch,
    switchMessageVersion,
    selectMessageVersion,
    deleteMessage,
    deleteMessageAndSubsequent,
    setSuggestedQuestions,
    updateSessionTitle,
    updateSessionCompression,
    syncActiveSession,
    system,
    modelMetadata,
    customModelMetadata,
    installedSkills,
    skillBundles,
    activeSkillBundleIds,
    skillAutoSelect,
    availableModels,
    isGenerating,
    beginActiveGeneration,
    isGenerationRunActive,
    finishActiveGeneration,
    abortBackgroundPostProcessing,
    beginBackgroundPostProcessing,
    queueMemoryExtraction,
    createMessageStreamRenderer,
    activeStreamRenderRef,
    activeStreamCheckpointRef,
    persistLongTextFilesForMessage,
    toolConfirmationController,
    agentUserInputController,
    messageInputRef,
    getEffectiveContextForSession,
    prepareComposerSkillParameters,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
    skillParameterValuesRef,
    skillBundleParameterValuesRef,
  };

  const { handleSendMessage } = useSendMessageFlow(chatFlowDeps);

  const {
    handleRegenerate,
    handleContinueGeneration,
    handleVersionChange,
    handleVersionSelect,
  } = useResponseBranchFlow(chatFlowDeps);

  const handleAssistantSelect = async (agent: LobeAgent) => {
    const requestId = assistantSelectRequestRef.current + 1;
    assistantSelectRequestRef.current = requestId;

    if (isGenerating) {
      void stopActiveGenerationWithFeedback();
    }

    if (viewMode === "assistants") {
      navigateToPanel("chat");
    }

    let instruction = agent.meta.systemRole;
    let profile = agent.profile;

    if (!instruction && !agent.isCustom) {
      try {
        const detail = await getAgentDetail(agent.identifier, locale);
        if (requestId !== assistantSelectRequestRef.current) return;
        instruction = detail.config?.systemRole;
        profile = detail.profile || profile;
      } catch (e) {
        if (requestId !== assistantSelectRequestRef.current) return;
        logChatAppError("Failed to fetch agent details for instruction", e);
      }
    }

    if (requestId !== assistantSelectRequestRef.current) return;

    if (!instruction) {
      instruction = `You are ${agent.meta.title}. ${agent.meta.description}`;
    }

    const profileConfig = createProfileSessionConfig(agent.identifier, profile);
    if (
      profile?.runtime.preferredModel &&
      availableModels.some(
        (candidate) => candidate.name === profile.runtime.preferredModel,
      )
    ) {
      setModel(profile.runtime.preferredModel);
    }
    if (profileConfig) {
      setChatConfig({
        chatMode: profileConfig.chatMode,
        useAgentMode: profileConfig.useAgentMode,
        ...(profileConfig.useSearch !== undefined
          ? { useSearch: profileConfig.useSearch }
          : {}),
        ...(profileConfig.reasoningMode
          ? {
              reasoningMode: profileConfig.reasoningMode,
              useReasoning: profileConfig.useReasoning,
            }
          : {}),
      });
    }

    if (currentSessionId) {
      const session = getCurrentSession();
      if (
        session &&
        session.messageCount === 0 &&
        session.title === "New Chat"
      ) {
        updateSessionInstruction(currentSessionId, instruction);
        updateSessionTitle(currentSessionId, agent.meta.title);
        if (profileConfig) {
          updateSessionConfig(currentSessionId, profileConfig);
        }
        return;
      }
    }

    abortBackgroundPostProcessing();
    createSession(instruction, agent.meta.title, undefined, [], profileConfig);
  };

  const {
    handleEditMessage,
    handleSubmitUserMessageEdit,
    handleDeleteMessage,
    handleRetractMessage,
  } = useMessageEditFlow(chatFlowDeps);

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await cancelResearchTasksForSession(sessionId);
      if (sessionId === currentSessionId) {
        abortBackgroundPostProcessing();
      }
      if (
        shouldAbortActiveGenerationForSessionDelete({
          currentSessionId,
          deletingSessionId: sessionId,
          isGenerating,
        })
      ) {
        const renderer = activeStreamRenderRef.current;
        const checkpoint = activeStreamCheckpointRef.current;
        renderer?.flush();
        await stopActiveGeneration();
        await checkpoint?.flush();
      }

      await deleteSession(sessionId);
    } catch (error) {
      logChatAppError("Failed to delete session", error);
      showActionError(t("errDeleteChat"));
    }
  };

  const handleDuplicateSession = async (sessionId: string) => {
    if (isGenerating || useChatStore.getState().isActiveSessionLoading) return;

    try {
      abortBackgroundPostProcessing();
      const sourceSession = useChatStore
        .getState()
        .sessions.find((session) => session.id === sessionId);
      const duplicateTitle = sourceSession
        ? t("duplicateTitle", {
            title: getSessionDisplayTitle(sourceSession.title, t("newChat")),
          })
        : undefined;
      await duplicateSession(sessionId, duplicateTitle);
    } catch (error) {
      logChatAppError("Failed to duplicate session", error);
      showActionError(t("errDuplicateChat"));
    }
  };

  const handleSmartRename = async (sessionId: string) => {
    const snapshot = createSessionPostGenerationSnapshot(
      useChatStore
        .getState()
        .sessions.find((session) => session.id === sessionId),
    );
    if (!snapshot) return;

    // Need messages for rename, if active session, use state, else load
    let msgs: Message[];
    try {
      const state = useChatStore.getState();
      if (state.currentSessionId === sessionId) {
        msgs = state.activeMessages;
      } else {
        const storedMessages = await appDb.getItem<
          Message[] | SessionMessageTree
        >(`session_messages_${sessionId}`);
        msgs = getActiveMessagePath(
          normalizeSessionMessageTree(storedMessages),
        );
      }
    } catch (error) {
      logChatAppError("Failed to load messages for smart rename", error);
      showActionError(t("errRenameChat"));
      return;
    }

    if (msgs.length === 0) return;

    try {
      const { generateChatTitle } = await loadChatService();
      const newTitle = await generateChatTitle(msgs);
      const currentSession = useChatStore
        .getState()
        .sessions.find((session) => session.id === sessionId);
      if (shouldApplyRequestedTitle(currentSession, snapshot)) {
        updateSessionTitle(sessionId, newTitle);
      }
    } catch (error) {
      logChatAppError("Failed to generate a smart rename", error);
      showActionError(t("errRenameChat"));
    }
  };

  const handleNewChat = () => {
    abortBackgroundPostProcessing();
    if (isGenerating) {
      void stopActiveGenerationWithFeedback();
    }

    createSession();
    navigateToPanel("chat");
  };

  const handleSelectSession = async (sessionId: string) => {
    abortBackgroundPostProcessing();
    await selectSession(sessionId);
  };

  /**
   * `/compress` — the same summarizer auto-compression uses, run on demand and
   * without its message-count threshold.
   */
  const handleCompressContext = async () => {
    if (manualCompressionControllerRef.current) {
      showActionNotice(tInput("compressingContext"));
      return;
    }
    const state = useChatStore.getState();
    const sessionId = state.currentSessionId;
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!sessionId || !session || state.activeMessages.length === 0) {
      showActionNotice(tInput("compressContextNothingToDo"));
      return;
    }

    const sourceMessages = [...state.activeMessages];
    const sourceSignature = getCompressionInputSignature(sourceMessages);
    const compressionSignature = JSON.stringify(session.compression ?? null);
    const controller = new AbortController();
    manualCompressionControllerRef.current = controller;
    showActionNotice(tInput("compressingContext"));
    try {
      const { performBackgroundCompression } = await loadChatService();
      const nextCompression = await performBackgroundCompression(
        sourceMessages,
        session.compression,
        selectedModel,
        controller.signal,
        { ignoreThreshold: true },
      );
      controller.signal.throwIfAborted();
      const currentState = useChatStore.getState();
      const currentSession = currentState.sessions.find(
        (item) => item.id === sessionId,
      );
      const sourceIsCurrent =
        currentState.currentSessionId === sessionId &&
        getCompressionInputSignature(
          currentState.activeMessages.slice(0, sourceMessages.length),
        ) === sourceSignature &&
        JSON.stringify(currentSession?.compression ?? null) ===
          compressionSignature;
      if (!sourceIsCurrent) {
        showActionNotice(tInput("compressContextChanged"));
        return;
      }
      if (!nextCompression) {
        showActionNotice(tInput("compressContextNothingToDo"));
        return;
      }
      updateSessionCompression(sessionId, nextCompression);
      showActionNotice(tInput("compressContextDone"));
    } catch (error) {
      if (controller.signal.aborted) return;
      logChatAppError("Manual context compression failed:", error);
      showActionError(tInput("compressContextFailed"));
    } finally {
      if (manualCompressionControllerRef.current === controller) {
        manualCompressionControllerRef.current = null;
      }
    }
  };

  const handleSuggestionClick = (question: string) => {
    void handleSendMessage(question, []);
  };

  // --- Render ---

  return (
    <ResearchRuntimeProvider
      userInputController={agentUserInputController}
      toolConfirmationController={toolConfirmationController}
      onError={showActionError}
      onNotice={showActionNotice}
    >
      <ChatAppShell
        actionError={actionError}
        actionNotice={actionNotice}
        sessions={sessions}
        currentSessionId={currentSessionId}
        currentSession={currentSession}
        messages={messages}
        activeMessageTree={activeMessageTree}
        isGenerating={isGenerating}
        isActiveSessionLoading={isActiveSessionLoading}
        availableModels={availableModels}
        isModelBootstrapReady={serverModelBootstrapReady}
        selectedModel={selectedModel}
        isSearchEnabled={chatConfig.useSearch}
        viewMode={viewMode}
        settingsTab={settingsTab}
        researchTaskId={researchTaskId}
        isSidebarOpen={isSidebarOpen}
        isNonDesktopViewport={isNonDesktopViewport}
        isSidebarDrawerOpen={isSidebarDrawerOpen}
        mainInertProps={mainInertProps}
        shouldShowChatTitleBar={shouldShowChatTitleBar}
        welcomeState={welcomeState}
        messageInputVariant={messageInputVariant}
        messagesScrollRef={messagesScrollRef}
        messageInputRef={messageInputRef}
        setIsSidebarOpen={setIsSidebarOpen}
        navigateToPanel={navigateToPanel}
        handleSettingsTabChange={handleSettingsTabChange}
        stopActiveGenerationWithFeedback={stopActiveGenerationWithFeedback}
        selectSession={handleSelectSession}
        handleNewChat={handleNewChat}
        handleDeleteSession={handleDeleteSession}
        updateSessionTitle={updateSessionTitle}
        toggleSessionPin={toggleSessionPin}
        handleDuplicateSession={handleDuplicateSession}
        handleSmartRename={handleSmartRename}
        handleAssistantSelect={handleAssistantSelect}
        updateSessionInstruction={updateSessionInstruction}
        handleEditMessage={handleEditMessage}
        handleDeleteMessage={handleDeleteMessage}
        handleSubmitUserMessageEdit={handleSubmitUserMessageEdit}
        handleRetractMessage={handleRetractMessage}
        handleRegenerate={handleRegenerate}
        handleContinueGeneration={handleContinueGeneration}
        handleVersionChange={handleVersionChange}
        handleVersionSelect={handleVersionSelect}
        handleSendMessage={handleSendMessage}
        prepareComposerSkillParameters={(forced) =>
          prepareComposerSkillParameters(
            currentSession,
            selectedModel,
            forced?.skillIds,
          )
        }
        handleCompressContext={handleCompressContext}
        handleSuggestionClick={handleSuggestionClick}
        handleStopGeneration={handleStopGeneration}
        setModel={setModel}
        onToggleSearch={() =>
          setChatConfig({ useSearch: !chatConfig.useSearch })
        }
        pendingToolConfirmations={pendingToolConfirmations}
        onToolConfirmationDecision={decideToolConfirmation}
        onRevokeToolSessionApproval={revokeToolSessionApproval}
      />
      <SkillParameterDialog
        open={Boolean(skillParameterDialog)}
        requests={skillParameterDialog?.requests || []}
        initialValues={skillParameterDialog?.initialValues}
        onCancel={() => closeSkillParameterDialog(null)}
        onSubmit={closeSkillParameterDialog}
      />
      <AgentUserInputDialog
        request={pendingAgentUserInputRequests[0]}
        onRespond={respondToAgentUserInput}
      />
    </ResearchRuntimeProvider>
  );
};

export default ChatApp;
