"use client";
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { v7 as uuidv7 } from "uuid";

import ChatAppShell from "@/components/app/ChatAppShell";
import type { MessageInputRef } from "@/components/chat/MessageInput";
import SkillParameterDialog, {
  type ComposerSkillParameterValues,
  type SkillParameterRequest,
  type SkillParameterSubmission,
} from "@/components/skill/SkillParameterDialog";
import type {
  ModelInfo,
  StreamChatResponseOptions,
} from "@/services/api/chatService";
import {
  resolveRecordedSkillInvocations,
  resolveSkillsForMessage,
} from "@/services/api/skillService";
import {
  buildProviderRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import { getAgentDetail } from "@/services/api/agentService";
import {
  Message,
  MessageReplyReference,
  Attachment,
  LobeAgent,
  SessionMessageTree,
  ToolCall,
  AppliedSkillInvocation,
} from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { useMemoryStore } from "@/store/core/memoryStore";
import { appDb } from "@/store/storage/storageConfig";
import { formatModelName } from "@/store/core/settingsStore";
import { handleTokenUsageUpdate } from "@/lib/utils/message";
import { buildAvailableModels, resolveSelectedModel } from "@/lib/utils/models";
import {
  processMessageForSending,
  createBotMessagePlaceholder,
  getModelDisplayName,
} from "@/lib/chat/messageProcessor";
import {
  createSessionPostGenerationSnapshot,
  shouldAbortActiveGenerationForSessionDelete,
  shouldApplyCompressionUpdate,
  shouldApplyGeneratedTitle,
  shouldApplyRequestedTitle,
  shouldApplySuggestedQuestions,
} from "@/lib/chat/postGenerationGuards";
import {
  useChatGenerationController,
  useChatPanelNavigation,
  useChatShellState,
  useChatThemeEffects,
  useToolConfirmationController,
  useWelcomeChatState,
  useWorkspaceAttachmentHydration,
} from "@/features/chat";
import { resolveEffectiveChatContext } from "@/lib/chat/effectiveChatContext";
import { resolveEffectiveChatRequestConfig } from "@/lib/chat/effectiveChatConfig";
import { buildDirectMemoryPromptContext } from "@/lib/memory/entities";
import { getSuppressedMemoryIds } from "@/lib/memory/compression";
import { appendContextToChatInput } from "@/lib/utils/chatInput";
import {
  getActiveMessagePath,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
import { normalizeActivePluginIds } from "@/lib/plugin/config";
import { parseModelString } from "@/lib/utils/model";
import { logDevError } from "@/lib/utils/devLogger";
import {
  PublicServerConfig,
  SERVER_DEFAULT_PROVIDER_ID,
} from "@/lib/defaultConfig/shared";
import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import {
  getSessionPluginPresetSyncKey,
  shouldDisableSearchToggle,
  shouldApplySessionPluginPreset,
  shouldResolveSelectedModelAfterBootstrap,
  shouldRunSettingsStartupEffects,
} from "@/lib/app/startupEffects";
import { buildSearchUpdate, mergeSources } from "@/lib/chat/searchUpdate";
import { getSessionDisplayTitle } from "@/lib/chat/sessionTitle";
import { createCitationSources } from "@/lib/utils/citations";
import { resolveEffectiveSearchCapability } from "@/lib/settings/searchRag";
import {
  getImageCompressionConfig,
  prepareConversationImageAttachments,
} from "@/lib/utils/imageCompression";
import {
  buildReplyPromptContext,
  createStreamCheckpointController,
  hasUnsafeContinuationToolState,
  recoverPersistedGeneration,
  runWithPreOutputRetry,
  trimContinuationOverlap,
} from "@/lib/chat/streamResilience";
import {
  createStreamRenderScheduler,
  type StreamRenderScheduler,
} from "@/lib/chat/streamRenderScheduler";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import {
  getMissingSkillParameters,
  resolveSkillBundle,
  resolveSkillParameterValues,
} from "@/lib/skills";
import { MARKET_LIMITS, RAG_LIMITS } from "@/config/limits";
import {
  cleanupCreatedLongTextFiles,
  persistLongTextOutputBlocks,
} from "@/lib/chat/longTextFiles";
import { getLongTextBlocks } from "@/lib/chat/longText";

const logChatAppError = logDevError;
const EMPTY_MESSAGES: Message[] = [];
const loadChatService = () => import("@/services/api/chatService");

interface StreamRenderSnapshot {
  content: string;
  reasoning?: string;
  outputBlocks?: Message["outputBlocks"];
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
  const locale = useLocale();

  // --- Local UI State ---
  const [actionError, setActionError] = useState<string | null>(null);
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

  const [serverConfigResolved, setServerConfigResolved] = useState(false);
  const [serverModelBootstrapReady, setServerModelBootstrapReady] =
    useState(false);

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
  const assistantSelectRequestRef = useRef(0);
  const defaultProviderFetchRef = useRef(false);
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

  // Fetch Metadata & Ensure Plugins on mount
  useEffect(() => {
    if (
      !shouldDisableSearchToggle({
        chatHydrated: chatHasHydrated,
        settingsHydrated: _hasHydrated,
        coreHydrated: coreHasHydrated,
        serverModelBootstrapReady,
        useSearch: chatConfig.useSearch,
        searchCompatibility: currentSearchCompatibility,
      })
    ) {
      return;
    }

    if (!currentSearchCompatibility.enabled) {
      setChatConfig({ useSearch: false });
    }
  }, [
    chatConfig.useSearch,
    chatHasHydrated,
    _hasHydrated,
    coreHasHydrated,
    currentSearchCompatibility,
    serverModelBootstrapReady,
    setChatConfig,
  ]);

  useEffect(() => {
    if (!shouldRunSettingsStartupEffects(_hasHydrated)) return;
    fetchModelMetadata();
    ensureBuiltInPlugins();
  }, [_hasHydrated, fetchModelMetadata, ensureBuiltInPlugins]);

  useEffect(() => {
    if (!coreHasHydrated || !_hasHydrated) return;

    let active = true;
    defaultProviderFetchRef.current = false;
    setServerConfigResolved(false);
    setServerModelBootstrapReady(false);

    const loadServerConfig = async () => {
      try {
        const response = await fetch("/api/config", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            await getResponseErrorMessage(response, "Failed to load config"),
          );
        }

        const config = await readJsonResponseOrThrow<PublicServerConfig>(
          response,
          "Failed to load config",
        );
        if (!active) return;

        applyCoreServerConfig(config);
        applySettingsServerConfig(config);
        setServerConfigResolved(true);
        if (
          !config.modelProvider.available ||
          config.modelProvider.models.length > 0
        ) {
          setServerModelBootstrapReady(true);
        }
      } catch (error) {
        logChatAppError("Failed to load server config", error);
        if (!active) return;
        setServerConfigResolved(true);
        setServerModelBootstrapReady(true);
      }
    };

    loadServerConfig();

    return () => {
      active = false;
    };
  }, [
    _hasHydrated,
    applyCoreServerConfig,
    applySettingsServerConfig,
    coreHasHydrated,
  ]);

  useEffect(() => {
    if (
      !coreHasHydrated ||
      !serverConfigResolved ||
      serverModelBootstrapReady
    ) {
      return;
    }

    const defaultProvider = providers.find(
      (provider) =>
        provider.id === SERVER_DEFAULT_PROVIDER_ID && provider.isServerDefault,
    );
    if (!defaultProvider) {
      setServerModelBootstrapReady(true);
      return;
    }
    if (
      defaultProvider.modelsList?.length ||
      defaultProvider.models.length > 0
    ) {
      setServerModelBootstrapReady(true);
      return;
    }
    if (defaultProviderFetchRef.current) return;

    let active = true;
    defaultProviderFetchRef.current = true;
    const providerSnapshot = defaultProvider;

    fetchWithByokRetry(async () =>
      signedApiFetch("/api/providers/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(providerSnapshot),
        }),
      }),
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await getResponseErrorMessage(response, "Failed to fetch models"),
          );
        }
        return readJsonResponseOrThrow<{ models?: string[] }>(
          response,
          "Failed to fetch models",
        );
      })
      .then((data) => {
        const models = data.models || [];
        updateProvider(providerSnapshot.id, {
          models,
          modelsList: models,
        });
        if (active) {
          setServerModelBootstrapReady(true);
        }
      })
      .catch((error) => {
        logChatAppError("Failed to fetch default provider models", error);
        if (active) {
          setServerModelBootstrapReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [
    coreHasHydrated,
    providers,
    serverConfigResolved,
    serverModelBootstrapReady,
    updateProvider,
  ]);

  useEffect(() => {
    if (
      !shouldResolveSelectedModelAfterBootstrap({
        chatHydrated: chatHasHydrated,
        settingsHydrated: _hasHydrated,
        coreHydrated: coreHasHydrated,
        serverModelBootstrapReady,
      })
    ) {
      return;
    }

    const nextModel = resolveSelectedModel(
      availableModels,
      selectedModel,
      SERVER_DEFAULT_PROVIDER_ID,
    );

    if (selectedModel === nextModel) {
      return;
    }

    setModel(nextModel);
  }, [
    chatHasHydrated,
    _hasHydrated,
    coreHasHydrated,
    serverModelBootstrapReady,
    availableModels,
    selectedModel,
    setModel,
  ]);

  useEffect(() => {
    return () => {
      abortBackgroundPostProcessing();
      assistantSelectRequestRef.current += 1;
      if (actionErrorTimerRef.current) {
        clearTimeout(actionErrorTimerRef.current);
        actionErrorTimerRef.current = null;
      }
    };
  }, [abortBackgroundPostProcessing]);

  useEffect(
    () => () => abortBackgroundPostProcessing(),
    [abortBackgroundPostProcessing, currentSessionId],
  );

  // Ensure a session exists on mount
  useEffect(() => {
    // Wait for chat store to hydrate before creating/selecting sessions
    if (!chatHasHydrated) return;

    const timer = setTimeout(() => {
      if (sessions.length === 0) {
        createSession();
      } else if (!currentSessionId) {
        selectSession(sessions[0].id);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [
    chatHasHydrated,
    sessions,
    currentSessionId,
    createSession,
    selectSession,
  ]);

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

  const getEffectiveContextForSession = (
    session?: typeof currentSession | null,
    requestModel = selectedModel,
  ) => {
    const { providerId } = parseModelString(requestModel);
    const provider = providerId
      ? providers.find((item) => item.id === providerId)
      : providers.find((item) => item.enabled);
    const workspace = session?.workspaceId
      ? workspaces.find((item) => item.id === session.workspaceId)
      : null;

    return resolveEffectiveChatContext({
      session,
      workspace,
      systemPrompt: system.systemPrompt,
      personality: system.personality,
      enableHtmlVisualPrompt: system.enableHtmlVisualPrompt,
      selectedModel: requestModel,
      provider,
      modelMetadata,
      customModelMetadata,
      chatConfig,
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

  const prepareComposerSkillParameters = async (
    session?: typeof currentSession | null,
    requestModel = selectedModel,
  ): Promise<ComposerSkillParameterValues | null> => {
    const effectiveContext = getEffectiveContextForSession(
      session,
      requestModel,
    );
    const skillsById = new Map(
      installedSkills.map((skill) => [skill.id, skill]),
    );
    const activeManualSkills =
      skillAutoSelect && !effectiveContext.agentModeEnabled
        ? []
        : effectiveContext.activeSkillIds
            .map((id) => skillsById.get(id))
            .filter((skill): skill is (typeof installedSkills)[number] =>
              Boolean(skill),
            );
    const bundlesById = new Map(
      skillBundles.map((bundle) => [bundle.id, bundle]),
    );
    const activeBundles = activeSkillBundleIds
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
    session: typeof currentSession | null | undefined,
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
    const preparedAttachments = await prepareConversationImageAttachments(
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
      ragEnabled: chatConfig.useRAG !== false,
      deferKnowledgeRetrieval: effectiveContext.agentModeEnabled,
      knowledgeCollections,
      workspaceKnowledgeCollectionIds:
        effectiveContext.workspaceKnowledgeCollectionIds,
      signal,
    });

    const memoryState = useMemoryStore.getState();
    const directMemoryContext = existingMemoryContext?.promptContext
      ? {
          text: existingMemoryContext.promptContext,
          injectedMemoryIds: existingMemoryContext.injectedMemoryIds,
        }
      : memoryState._hasHydrated &&
          memoryState.settings.enabled &&
          memoryState.settings.searchEnabled
        ? buildDirectMemoryPromptContext({
            memories: memoryState.memories,
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
      effectiveContext,
      injectedMemoryIds: directMemoryContext.injectedMemoryIds,
    };
  };

  const createAgentToolStreamOptions = ({
    sessionId,
    modelMessageId,
    knowledgeScope,
    isActive,
  }: {
    sessionId: string;
    modelMessageId: string;
    knowledgeScope: Attachment[];
    isActive: () => boolean;
  }): StreamChatResponseOptions => ({
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
    session: typeof currentSession | null | undefined,
    injectedMemoryIds: string[],
  ) => {
    if (injectedMemoryIds.length === 0) return;
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

  const handleSendMessage = async (
    text: string,
    attachments: Attachment[],
    replyTo?: MessageReplyReference,
    skillParameters?: ComposerSkillParameterValues,
  ) => {
    const chatState = useChatStore.getState();
    if (!navigator.onLine) {
      showActionError(t("offlineReadOnly"));
      return;
    }
    if (
      (!text.trim() && attachments.length === 0) ||
      isGenerating ||
      chatState.isActiveSessionLoading
    ) {
      return;
    }

    let targetSessionId = chatState.currentSessionId;

    if (!targetSessionId) {
      targetSessionId = createSession();
    }

    if (!targetSessionId) return;

    // Auto-rename check
    let shouldAutoRename = false;
    let sessionForCheck = sessions.find((s) => s.id === targetSessionId);

    if (!sessionForCheck) {
      sessionForCheck = useChatStore
        .getState()
        .sessions.find((s) => s.id === targetSessionId);
    }

    if (
      system.enableAutoTitle &&
      sessionForCheck &&
      sessionForCheck.messageCount === 0 &&
      sessionForCheck.title === "New Chat"
    ) {
      shouldAutoRename = true;
    }

    const resolvedSkillParameters =
      skillParameters ||
      (await prepareComposerSkillParameters(sessionForCheck, selectedModel));
    if (!resolvedSkillParameters) return;

    abortBackgroundPostProcessing();
    const generation = beginActiveGeneration();

    const modelDisplayName = getModelDisplayName(
      selectedModel,
      availableModels,
    );

    let botMsgId: string | null = null;
    let userMessageAdded = false;
    let startTime = Date.now();
    let receivedVisibleOutput = false;
    let receivedToolActivity = false;
    let streamCheckpoint: ReturnType<
      typeof createStreamCheckpointController
    > | null = null;
    let streamRenderer: StreamRenderScheduler<StreamRenderSnapshot> | null =
      null;

    try {
      // Process message and attachments
      const sessionForProcessing =
        useChatStore
          .getState()
          .sessions.find((s) => s.id === targetSessionId) || sessionForCheck;
      const processedData = await processPromptForModel(
        sessionForProcessing,
        text,
        attachments,
        generation.controller.signal,
        undefined,
        replyTo,
        selectedModel,
      );

      const {
        finalText,
        finalAttachments,
        ragSources,
        ragError,
        userMessage,
        injectedMemoryIds,
      } = processedData;

      if (!isGenerationRunActive(generation)) return;
      commitInjectedMemoryContext(
        targetSessionId,
        sessionForProcessing,
        injectedMemoryIds,
      );

      // Add User Message
      await addMessage(targetSessionId, userMessage);
      userMessageAdded = true;
      if (!isGenerationRunActive(generation)) return;

      // Add Placeholder Bot Message
      const botMsg = createBotMessagePlaceholder(
        modelDisplayName,
        ragSources,
        ragError,
      );
      const currentBotMsgId = botMsg.id;
      botMsgId = currentBotMsgId;
      startTime = botMsg.timestamp;
      botMsg.generation = {
        status: "streaming",
        requestId: uuidv7(),
        ownerDeviceId: getSyncDeviceId(),
        model: selectedModel,
        attempt: 0,
        checkpointAt: startTime,
      };

      await addMessage(targetSessionId, botMsg);
      if (!isGenerationRunActive(generation)) return;

      // Get fresh session data
      const historyMessages = useChatStore.getState().activeMessages;
      const freshSession = useChatStore
        .getState()
        .sessions.find((s) => s.id === targetSessionId);

      if (!freshSession) throw new Error("Session not found");
      const effectiveContext = processedData.effectiveContext;

      // Prepare History for LLM (excluding the just-added user message)
      // Filter out the user message we just added since it will be sent separately
      const historyWithoutCurrentUser = historyMessages.filter(
        (m) => m.id !== userMessage.id,
      );

      const { prepareHistoryForLLM, streamChatResponse } =
        await loadChatService();
      const historyForLLM = await prepareHistoryForLLM(
        historyWithoutCurrentUser,
        freshSession.compression,
        selectedModel,
      );
      if (!isGenerationRunActive(generation)) return;

      const effectiveConfig = resolveEffectiveChatRequestConfig({
        chatConfig,
        selectedModel,
        modelMetadata,
        customModelMetadata,
        searchCompatibility: effectiveContext.searchCompatibility,
      });
      const skillResolution = await resolveSkillsForMessage({
        message: text,
        selectedModel,
        locale,
        installedSkills,
        activeSkillIds: effectiveContext.activeSkillIds,
        skillBundles,
        activeSkillBundleIds,
        skillParameterValues: resolvedSkillParameters.skillParameterValues,
        skillBundleParameterValues:
          resolvedSkillParameters.skillBundleParameterValues,
        autoSelect: skillAutoSelect && !effectiveContext.agentModeEnabled,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation)) return;
      if (skillResolution.skippedSkillIds.length > 0) {
        showActionError(
          t("skillsSkipped", {
            count: skillResolution.skippedSkillIds.length,
          }),
        );
      }

      if (skillResolution.invocations.length > 0) {
        updateMessage(targetSessionId, currentBotMsgId, {
          skillInvocations: skillResolution.invocations,
        });
      }

      let latestStreamText = "";
      let latestStreamReasoning: string | undefined;
      let latestStreamOutputBlocks: Message["outputBlocks"];

      streamRenderer = createMessageStreamRenderer(
        targetSessionId,
        currentBotMsgId,
      );
      activeStreamRenderRef.current = streamRenderer;

      streamCheckpoint = createStreamCheckpointController({
        persist: async () => {
          streamRenderer?.flush();
          const message = useChatStore
            .getState()
            .activeMessages.find((item) => item.id === currentBotMsgId);
          if (message?.generation) {
            updateMessage(targetSessionId!, currentBotMsgId, {
              generation: {
                ...message.generation,
                checkpointAt: Date.now(),
              },
            });
          }
          await useChatStore.getState().syncActiveSession(targetSessionId!);
        },
      });
      activeStreamCheckpointRef.current = streamCheckpoint;

      await runWithPreOutputRetry({
        signal: generation.controller.signal,
        hasVisibleOutput: () => receivedVisibleOutput,
        hasToolActivity: () => receivedToolActivity,
        onAttempt: (attempt) => {
          const message = useChatStore
            .getState()
            .activeMessages.find((item) => item.id === currentBotMsgId);
          if (message?.generation) {
            updateMessage(targetSessionId!, currentBotMsgId, {
              generation: { ...message.generation, attempt },
            });
          }
        },
        run: () =>
          streamChatResponse(
            targetSessionId!,
            selectedModel,
            historyForLLM,
            finalText,
            finalAttachments,
            effectiveConfig,
            (streamText, streamReasoning, outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              latestStreamText = streamText;
              if (streamReasoning !== undefined) {
                latestStreamReasoning = streamReasoning;
              }
              if (outputBlocks !== undefined) {
                latestStreamOutputBlocks = outputBlocks;
              }
              receivedVisibleOutput =
                receivedVisibleOutput ||
                Boolean(streamText || streamReasoning || outputBlocks?.length);
              streamRenderer?.schedule({
                content: latestStreamText,
                reasoning: latestStreamReasoning,
                outputBlocks: latestStreamOutputBlocks,
              });
              streamCheckpoint?.record(
                latestStreamText.length + (latestStreamReasoning?.length || 0),
              );
            },
            effectiveContext.systemInstruction,
            (isSearching, results) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedVisibleOutput = receivedVisibleOutput || isSearching;
              const currentMessage = useChatStore
                .getState()
                .activeMessages.find(
                  (message) => message.id === currentBotMsgId,
                );
              const updates = buildSearchUpdate(
                currentMessage,
                isSearching,
                results,
                {
                  replaceResults: effectiveContext.agentModeEnabled,
                },
              );
              updateMessage(targetSessionId!, currentBotMsgId, updates);
            },
            (toolCalls) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedToolActivity =
                receivedToolActivity || toolCalls.length > 0;
              updateMessage(targetSessionId!, currentBotMsgId, { toolCalls });
            },
            (images) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedVisibleOutput =
                receivedVisibleOutput || images.length > 0;
              const currentActiveMsgs = useChatStore.getState().activeMessages;
              const msg = currentActiveMsgs.find(
                (m) => m.id === currentBotMsgId,
              );
              const currentAttachments = msg?.attachments || [];

              updateMessage(targetSessionId!, currentBotMsgId, {
                attachments: [...currentAttachments, ...images],
              });
            },
            (usage) => {
              if (!isGenerationRunActive(generation)) return;
              const currentMessages = useChatStore.getState().activeMessages;
              handleTokenUsageUpdate(
                usage,
                currentMessages,
                userMessage.id,
                currentBotMsgId,
                targetSessionId!,
                updateMessage,
              );
            },
            generation.controller.signal,
            effectiveContext.activePluginIds,
            skillResolution.context,
            (outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              latestStreamOutputBlocks = outputBlocks;
              receivedVisibleOutput =
                receivedVisibleOutput || outputBlocks.length > 0;
              updateMessageContent(
                targetSessionId!,
                currentBotMsgId,
                latestStreamText,
                latestStreamReasoning,
                outputBlocks,
              );
            },
            toolConfirmationController,
            createAgentToolStreamOptions({
              sessionId: targetSessionId!,
              modelMessageId: currentBotMsgId,
              knowledgeScope: processedData.knowledgeScope,
              isActive: () => isGenerationRunActive(generation),
            }),
          ),
      });

      streamRenderer.flush();
      if (!isGenerationRunActive(generation)) return;
      await persistLongTextFilesForMessage(targetSessionId, currentBotMsgId, {
        expectedRequestId: botMsg.generation.requestId,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation)) return;
      const endTime = Date.now();
      const completedGeneration = useChatStore
        .getState()
        .activeMessages.find(
          (message) => message.id === currentBotMsgId,
        )?.generation;
      updateMessage(targetSessionId, currentBotMsgId, {
        generation: {
          ...(completedGeneration || botMsg.generation!),
          status: "completed",
          checkpointAt: endTime,
        },
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      });
      await streamCheckpoint.flush();

      // --- Post-Generation ---
      // Force sync active messages to storage at end of generation
      await syncActiveSession(targetSessionId);
      if (!isGenerationRunActive(generation)) return;

      const postGenerationState = useChatStore.getState();
      const postGenerationSession = postGenerationState.sessions.find(
        (session) => session.id === targetSessionId,
      );
      const postGenerationSnapshot = createSessionPostGenerationSnapshot(
        postGenerationSession,
      );
      const isTargetSessionActive =
        postGenerationState.currentSessionId === targetSessionId;
      const updatedHistory = isTargetSessionActive
        ? postGenerationState.activeMessages
        : [];
      const completedBotMessage = isTargetSessionActive
        ? updatedHistory.find((message) => message.id === currentBotMsgId)
        : undefined;
      const suggestedQuestionSnapshot = completedBotMessage
        ? {
            id: completedBotMessage.id,
            content: completedBotMessage.content,
          }
        : null;
      const postProcessSignal = beginBackgroundPostProcessing();

      if (completedBotMessage) {
        queueMemoryExtraction(
          targetSessionId,
          userMessage,
          {
            id: completedBotMessage.id,
            content: completedBotMessage.content,
          },
          postProcessSignal,
        );
      }

      // 1. Follow-up Questions
      if (system.enableRelatedQuestions && updatedHistory.length > 0) {
        loadChatService()
          .then(({ generateRelatedQuestions }) =>
            generateRelatedQuestions(updatedHistory, postProcessSignal),
          )
          .then((questions) => {
            if (postProcessSignal.aborted) return;
            const state = useChatStore.getState();
            const currentMessage =
              state.currentSessionId === targetSessionId
                ? state.activeMessages.find(
                    (message) => message.id === currentBotMsgId,
                  )
                : undefined;
            if (
              questions &&
              questions.length > 0 &&
              shouldApplySuggestedQuestions(
                currentMessage,
                suggestedQuestionSnapshot,
              )
            ) {
              setSuggestedQuestions(
                targetSessionId!,
                currentBotMsgId,
                questions,
              );
            }
          })
          .catch((err) => {
            if (postProcessSignal.aborted) return;
            logChatAppError("Related question generation failed:", err);
          });
      }

      // 2. Auto-Rename
      if (shouldAutoRename && updatedHistory.length > 0) {
        loadChatService()
          .then(({ generateChatTitle }) =>
            generateChatTitle(updatedHistory, postProcessSignal),
          )
          .then((newTitle) => {
            if (postProcessSignal.aborted) return;
            const currentSession = useChatStore
              .getState()
              .sessions.find((session) => session.id === targetSessionId);
            if (
              newTitle &&
              shouldApplyGeneratedTitle(currentSession, postGenerationSnapshot)
            ) {
              updateSessionTitle(targetSessionId!, newTitle);
            }
          })
          .catch((err) => {
            if (postProcessSignal.aborted) return;
            logChatAppError("Chat title generation failed:", err);
          });
      }

      // 3. Auto-Compress
      if (
        system.enableAutoCompression &&
        postGenerationSession &&
        updatedHistory.length > 0
      ) {
        loadChatService()
          .then(({ performBackgroundCompression }) =>
            performBackgroundCompression(
              updatedHistory,
              postGenerationSession.compression,
              selectedModel,
              postProcessSignal,
            ),
          )
          .then((newCompression) => {
            if (postProcessSignal.aborted) return;
            const currentSession = useChatStore
              .getState()
              .sessions.find((session) => session.id === targetSessionId);
            if (
              newCompression &&
              shouldApplyCompressionUpdate(
                currentSession,
                postGenerationSnapshot,
              )
            ) {
              updateSessionCompression(targetSessionId!, newCompression);
            }
          })
          .catch((err) => {
            if (postProcessSignal.aborted) return;
            logChatAppError("Context compression failed:", err);
          });
      }
    } catch (error: any) {
      streamRenderer?.flush();
      if (error.name === "AbortError" || generation.controller.signal.aborted) {
        return;
      } else {
        logChatAppError("Generating content failed:", error);
        let errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred.";
        if (typeof error === "object" && error !== null && "message" in error) {
          errorMessage = error.message;
        } else if (typeof error === "string") {
          errorMessage = error;
        }

        if (!userMessageAdded) {
          const fallbackUserMessage: Message = {
            id: uuidv7(),
            role: "user",
            content: text,
            timestamp: Date.now(),
            attachments,
            replyTo,
          };
          await addMessage(targetSessionId, fallbackUserMessage);
          userMessageAdded = true;
        }

        if (botMsgId) {
          const partialMessage = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === botMsgId);
          const hasPartialOutput = Boolean(
            partialMessage?.content ||
            partialMessage?.reasoning ||
            partialMessage?.outputBlocks?.length,
          );
          updateMessage(targetSessionId, botMsgId, {
            generation: partialMessage?.generation
              ? {
                  ...partialMessage.generation,
                  status: "interrupted",
                  checkpointAt: Date.now(),
                }
              : undefined,
            generationError: hasPartialOutput
              ? undefined
              : {
                  message: errorMessage,
                  recoverable: true,
                },
            timing: {
              startTime,
              endTime: Date.now(),
              duration: Date.now() - startTime,
            },
          });
        } else {
          const errorBotMsg = createBotMessagePlaceholder(modelDisplayName, []);
          errorBotMsg.content = "";
          errorBotMsg.generationError = {
            message: errorMessage,
            recoverable: true,
          };
          errorBotMsg.timing = {
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
          };
          await addMessage(targetSessionId, errorBotMsg);
        }

        await streamCheckpoint?.flush();
        await syncActiveSession(targetSessionId); // Sync error message too
      }
    } finally {
      streamRenderer?.cancel();
      if (activeStreamRenderRef.current === streamRenderer) {
        activeStreamRenderRef.current = null;
      }
      if (activeStreamCheckpointRef.current === streamCheckpoint) {
        activeStreamCheckpointRef.current = null;
      }
      finishActiveGeneration(generation);
    }
  };

  const generateModelResponseBranch = async (
    messageId: string,
    {
      errorMessage,
      logPrefix,
      model,
    }: {
      errorMessage: string;
      logPrefix: string;
      model?: string;
    },
  ) => {
    if (!navigator.onLine) {
      showActionError(t("offlineReadOnly"));
      return;
    }
    if (
      isGenerating ||
      !currentSessionId ||
      useChatStore.getState().isActiveSessionLoading
    ) {
      return;
    }

    const sessionMessages = activeMessages;
    if (!sessionMessages) return;

    const msgIndex = sessionMessages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const historyContext = sessionMessages.slice(0, msgIndex);

    const lastUserMsg = historyContext[historyContext.length - 1];
    if (!lastUserMsg || lastUserMsg.role !== "user") {
      logChatAppError(`${logPrefix}: preceding message is not a user message.`);
      showActionError(errorMessage);
      return;
    }

    const promptText = lastUserMsg.content;
    const promptAttachments = lastUserMsg.attachments || [];
    const generationModel = model || selectedModel;

    const currentModelInfo = availableModels.find(
      (m) => m.name === generationModel,
    );
    if (!currentModelInfo) {
      showActionError(t("errModelUnavailable"));
      return;
    }
    const modelDisplayName = currentModelInfo.displayName;

    let recordedSkillResolution: ReturnType<
      typeof resolveRecordedSkillInvocations
    > | null = null;
    const recordedInvocations = sessionMessages[msgIndex].skillInvocations;
    if (recordedInvocations?.length) {
      try {
        recordedSkillResolution = resolveRecordedSkillInvocations({
          invocations: recordedInvocations,
          installedSkills,
        });
      } catch (error) {
        logChatAppError(`${logPrefix}: recorded skill unavailable.`, error);
        showActionError(t("errRecordedSkillChanged"));
        return;
      }
    }

    const branchMessageId = addMessageVersion(
      currentSessionId,
      messageId,
      modelDisplayName,
    );
    if (!branchMessageId) {
      showActionError(errorMessage);
      return;
    }
    abortBackgroundPostProcessing();
    const generation = beginActiveGeneration();
    const startTime = Date.now();
    const requestId = uuidv7();
    let receivedVisibleOutput = false;
    let receivedToolActivity = false;
    let streamCheckpoint: ReturnType<
      typeof createStreamCheckpointController
    > | null = null;
    let streamRenderer: StreamRenderScheduler<StreamRenderSnapshot> | null =
      null;
    updateMessage(currentSessionId, branchMessageId, {
      generation: {
        status: "streaming",
        requestId,
        ownerDeviceId: getSyncDeviceId(),
        model: generationModel,
        attempt: 0,
        checkpointAt: startTime,
      },
    });

    try {
      const sessionMeta = getCurrentSession();
      const {
        finalText,
        finalAttachments,
        ragSources,
        ragError,
        effectiveContext,
        knowledgeScope,
        injectedMemoryIds,
      } = await processPromptForModel(
        sessionMeta,
        promptText,
        promptAttachments,
        generation.controller.signal,
        lastUserMsg.memoryContext,
        lastUserMsg.replyTo,
        generationModel,
      );
      if (!isGenerationRunActive(generation)) return;
      commitInjectedMemoryContext(
        currentSessionId,
        sessionMeta,
        injectedMemoryIds,
      );
      const skillResolution =
        recordedSkillResolution ||
        (await resolveSkillsForMessage({
          message: promptText,
          selectedModel: generationModel,
          locale,
          installedSkills,
          activeSkillIds: effectiveContext.activeSkillIds,
          skillBundles,
          activeSkillBundleIds,
          skillParameterValues: skillParameterValuesRef.current,
          skillBundleParameterValues: skillBundleParameterValuesRef.current,
          autoSelect: skillAutoSelect && !effectiveContext.agentModeEnabled,
          signal: generation.controller.signal,
        }));
      if (!isGenerationRunActive(generation)) return;
      if (skillResolution.skippedSkillIds.length > 0) {
        showActionError(
          t("skillsSkipped", {
            count: skillResolution.skippedSkillIds.length,
          }),
        );
      }
      if (ragSources.length > 0 || ragError) {
        updateMessage(currentSessionId, branchMessageId, {
          ragSources,
          ragError,
          citations: createCitationSources({ knowledge: ragSources }),
        });
      }
      if (skillResolution.invocations.length > 0) {
        updateMessage(currentSessionId, branchMessageId, {
          skillInvocations: skillResolution.invocations,
        });
      }
      const historyBeforeUser = historyContext.slice(0, -1);
      const { prepareHistoryForLLM, streamChatResponse } =
        await loadChatService();
      const historyForApi = await prepareHistoryForLLM(
        historyBeforeUser,
        sessionMeta?.compression,
        generationModel,
      );
      if (!isGenerationRunActive(generation)) return;

      let latestStreamText = "";
      let latestStreamReasoning: string | undefined;
      let latestStreamOutputBlocks: Message["outputBlocks"];

      streamRenderer = createMessageStreamRenderer(
        currentSessionId,
        branchMessageId,
      );
      activeStreamRenderRef.current = streamRenderer;

      streamCheckpoint = createStreamCheckpointController({
        persist: async () => {
          streamRenderer?.flush();
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === branchMessageId);
          if (current?.generation) {
            updateMessage(currentSessionId, branchMessageId, {
              generation: {
                ...current.generation,
                checkpointAt: Date.now(),
              },
            });
          }
          await useChatStore.getState().syncActiveSession(currentSessionId);
        },
      });
      activeStreamCheckpointRef.current = streamCheckpoint;

      await runWithPreOutputRetry({
        signal: generation.controller.signal,
        hasVisibleOutput: () => receivedVisibleOutput,
        hasToolActivity: () => receivedToolActivity,
        onAttempt: (attempt) => {
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === branchMessageId);
          if (current?.generation) {
            updateMessage(currentSessionId, branchMessageId, {
              generation: { ...current.generation, attempt },
            });
          }
        },
        run: () =>
          streamChatResponse(
            currentSessionId,
            generationModel,
            historyForApi, // Don't include lastUserMsg here, it's sent as newMessage
            finalText,
            finalAttachments,
            resolveEffectiveChatRequestConfig({
              chatConfig,
              selectedModel: generationModel,
              modelMetadata,
              customModelMetadata,
              searchCompatibility: effectiveContext.searchCompatibility,
            }),
            (streamText, streamReasoning, outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              latestStreamText = streamText;
              if (streamReasoning !== undefined) {
                latestStreamReasoning = streamReasoning;
              }
              if (outputBlocks !== undefined) {
                latestStreamOutputBlocks = outputBlocks;
              }
              receivedVisibleOutput =
                receivedVisibleOutput ||
                Boolean(streamText || streamReasoning || outputBlocks?.length);
              streamRenderer?.schedule({
                content: latestStreamText,
                reasoning: latestStreamReasoning,
                outputBlocks: latestStreamOutputBlocks,
              });
              streamCheckpoint?.record(
                latestStreamText.length + (latestStreamReasoning?.length || 0),
              );
            },
            effectiveContext.systemInstruction,
            (isSearching, results) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedVisibleOutput = receivedVisibleOutput || isSearching;
              const currentMessage = useChatStore
                .getState()
                .activeMessages.find(
                  (message) => message.id === branchMessageId,
                );
              const updates = buildSearchUpdate(
                currentMessage,
                isSearching,
                results,
                {
                  replaceResults: effectiveContext.agentModeEnabled,
                },
              );
              updateMessage(currentSessionId, branchMessageId, updates);
            },
            (toolCalls) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedToolActivity =
                receivedToolActivity || toolCalls.length > 0;
              updateMessage(currentSessionId, branchMessageId, { toolCalls });
            },
            (images) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedVisibleOutput =
                receivedVisibleOutput || images.length > 0;
              const currentActiveMsgs = useChatStore.getState().activeMessages;
              const msg = currentActiveMsgs.find(
                (m) => m.id === branchMessageId,
              );
              const currentAttachments = msg?.attachments || [];
              updateMessage(currentSessionId, branchMessageId, {
                attachments: [...currentAttachments, ...images],
              });
            },
            (usage) => {
              if (!isGenerationRunActive(generation)) return;
              const currentMessages = useChatStore.getState().activeMessages;
              handleTokenUsageUpdate(
                usage,
                currentMessages,
                lastUserMsg.id,
                branchMessageId,
                currentSessionId,
                updateMessage,
              );
            },
            generation.controller.signal,
            effectiveContext.activePluginIds,
            skillResolution.context,
            (outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              latestStreamOutputBlocks = outputBlocks;
              receivedVisibleOutput =
                receivedVisibleOutput || outputBlocks.length > 0;
              updateMessageContent(
                currentSessionId,
                branchMessageId,
                latestStreamText,
                latestStreamReasoning,
                outputBlocks,
              );
            },
            toolConfirmationController,
            createAgentToolStreamOptions({
              sessionId: currentSessionId,
              modelMessageId: branchMessageId,
              knowledgeScope,
              isActive: () => isGenerationRunActive(generation),
            }),
          ),
      });

      streamRenderer.flush();
      if (!isGenerationRunActive(generation)) return;
      await persistLongTextFilesForMessage(currentSessionId, branchMessageId, {
        expectedRequestId: requestId,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation)) return;
      const endTime = Date.now();
      updateMessage(currentSessionId, branchMessageId, {
        generation: {
          ...(useChatStore
            .getState()
            .activeMessages.find((message) => message.id === branchMessageId)
            ?.generation || {
            status: "streaming",
            requestId,
            ownerDeviceId: getSyncDeviceId(),
            model: generationModel,
            attempt: 0,
            checkpointAt: startTime,
          }),
          status: "completed",
          checkpointAt: endTime,
        },
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      });
      await streamCheckpoint.flush();

      await syncActiveSession(currentSessionId);
      if (!isGenerationRunActive(generation)) return;
      const postProcessSignal = beginBackgroundPostProcessing();
      const completedBranchMessage = useChatStore
        .getState()
        .activeMessages.find((message) => message.id === branchMessageId);
      if (completedBranchMessage) {
        queueMemoryExtraction(
          currentSessionId,
          lastUserMsg,
          {
            id: completedBranchMessage.id,
            content: completedBranchMessage.content,
          },
          postProcessSignal,
        );
      }
    } catch (error: any) {
      streamRenderer?.flush();
      if (error.name === "AbortError" || generation.controller.signal.aborted) {
        return;
      } else {
        logChatAppError(`${logPrefix} generation failed:`, error);
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred.";
        const partialMessage = useChatStore
          .getState()
          .activeMessages.find((message) => message.id === branchMessageId);
        const hasPartialOutput = Boolean(
          partialMessage?.content ||
          partialMessage?.reasoning ||
          partialMessage?.outputBlocks?.length,
        );
        updateMessage(currentSessionId, branchMessageId, {
          generation: partialMessage?.generation
            ? {
                ...partialMessage.generation,
                status: "interrupted",
                checkpointAt: Date.now(),
              }
            : undefined,
          generationError: hasPartialOutput
            ? undefined
            : {
                message: errorMessage,
                recoverable: true,
              },
          timing: {
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
          },
        });
        await streamCheckpoint?.flush();
        await syncActiveSessionWithNotice(
          currentSessionId,
          `Failed to persist ${logPrefix.toLowerCase()} error message`,
        );
      }
    } finally {
      streamRenderer?.cancel();
      if (activeStreamRenderRef.current === streamRenderer) {
        activeStreamRenderRef.current = null;
      }
      if (activeStreamCheckpointRef.current === streamCheckpoint) {
        activeStreamCheckpointRef.current = null;
      }
      finishActiveGeneration(generation);
    }
  };

  const handleRegenerate = async (messageId: string, model?: string) => {
    await generateModelResponseBranch(messageId, {
      errorMessage: t("errRegenerate"),
      logPrefix: "Regeneration",
      model,
    });
  };

  const handleContinueGeneration = async (messageId: string) => {
    if (!navigator.onLine) {
      showActionError(t("offlineReadOnly"));
      return;
    }
    const sessionId = currentSessionId;
    if (
      !sessionId ||
      isGenerating ||
      useChatStore.getState().isActiveSessionLoading
    ) {
      return;
    }

    const sessionMessages = useChatStore.getState().activeMessages;
    const messageIndex = sessionMessages.findIndex(
      (message) => message.id === messageId,
    );
    const interruptedMessage = sessionMessages[messageIndex];
    if (
      !interruptedMessage ||
      interruptedMessage.role !== "model" ||
      interruptedMessage.generation?.status !== "interrupted"
    ) {
      return;
    }
    if (hasUnsafeContinuationToolState(interruptedMessage.toolCalls)) {
      showActionError(t("errUnsafeContinue"));
      return;
    }

    const generationModel = interruptedMessage.generation.model;
    if (!availableModels.some((model) => model.name === generationModel)) {
      showActionError(t("errModelUnavailable"));
      return;
    }

    let continuationSkillContext = "";
    if (interruptedMessage.skillInvocations?.length) {
      try {
        continuationSkillContext = resolveRecordedSkillInvocations({
          invocations: interruptedMessage.skillInvocations,
          installedSkills,
        }).context;
      } catch (error) {
        logChatAppError("Continuation recorded skill unavailable.", error);
        showActionError(t("errRecordedSkillChanged"));
        return;
      }
    }

    const existingContent = interruptedMessage.content;
    const existingReasoning = interruptedMessage.reasoning || "";
    const interruptedLongTextBlocks = getLongTextBlocks(
      interruptedMessage.outputBlocks,
    );
    const resumableLongTextBlock =
      interruptedLongTextBlocks[interruptedLongTextBlocks.length - 1];
    const continuationOutputBlocks = resumableLongTextBlock
      ? interruptedMessage.outputBlocks
      : undefined;
    const previousRequestId = interruptedMessage.generation.requestId;
    const requestId = uuidv7();
    const startedAt = Date.now();
    const generation = beginActiveGeneration();
    let receivedVisibleOutput = false;
    let streamCheckpoint: ReturnType<
      typeof createStreamCheckpointController
    > | null = null;
    let streamRenderer: StreamRenderScheduler<StreamRenderSnapshot> | null =
      null;

    updateMessage(sessionId, messageId, {
      generationError: undefined,
      outputBlocks: continuationOutputBlocks,
      generation: {
        status: "streaming",
        requestId,
        ownerDeviceId: getSyncDeviceId(),
        model: generationModel,
        attempt: 0,
        checkpointAt: startedAt,
        continuedFrom: previousRequestId,
      },
    });

    try {
      const sessionMeta = getCurrentSession();
      const effectiveContext = getEffectiveContextForSession(
        sessionMeta,
        generationModel,
      );
      const { prepareHistoryForLLM, streamChatResponse } =
        await loadChatService();
      const history = await prepareHistoryForLLM(
        sessionMessages.slice(0, messageIndex + 1),
        sessionMeta?.compression,
        generationModel,
      );
      if (!isGenerationRunActive(generation)) return;

      streamRenderer = createMessageStreamRenderer(sessionId, messageId);
      activeStreamRenderRef.current = streamRenderer;
      streamCheckpoint = createStreamCheckpointController({
        persist: async () => {
          streamRenderer?.flush();
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === messageId);
          if (current?.generation) {
            updateMessage(sessionId, messageId, {
              generation: {
                ...current.generation,
                checkpointAt: Date.now(),
              },
            });
          }
          await useChatStore.getState().syncActiveSession(sessionId);
        },
      });
      activeStreamCheckpointRef.current = streamCheckpoint;

      await runWithPreOutputRetry({
        signal: generation.controller.signal,
        hasVisibleOutput: () => receivedVisibleOutput,
        hasToolActivity: () => false,
        onAttempt: (attempt) => {
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === messageId);
          if (current?.generation) {
            updateMessage(sessionId, messageId, {
              generation: { ...current.generation, attempt },
            });
          }
        },
        run: () =>
          streamChatResponse(
            sessionId,
            generationModel,
            history,
            "Continue the interrupted answer from exactly where it stopped. Do not repeat text that is already present.",
            [],
            {
              ...resolveEffectiveChatRequestConfig({
                chatConfig,
                selectedModel: generationModel,
                modelMetadata,
                customModelMetadata,
                searchCompatibility: effectiveContext.searchCompatibility,
              }),
              useSearch: false,
            },
            (streamText, streamReasoning, outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              const continuationContent = trimContinuationOverlap(
                existingContent,
                streamText,
              );
              receivedVisibleOutput =
                receivedVisibleOutput ||
                Boolean(streamText || streamReasoning || outputBlocks?.length);
              const content = existingContent + continuationContent;
              const reasoning = streamReasoning
                ? existingReasoning +
                  trimContinuationOverlap(existingReasoning, streamReasoning)
                : existingReasoning;
              const normalizedOutputBlocks = resumableLongTextBlock
                ? outputBlocks?.map((block) =>
                    block.type === "text" &&
                    block.id === resumableLongTextBlock.id
                      ? {
                          ...block,
                          content:
                            resumableLongTextBlock.content +
                            continuationContent,
                        }
                      : block,
                  )
                : undefined;
              streamRenderer?.schedule({
                content,
                reasoning: reasoning || undefined,
                outputBlocks: normalizedOutputBlocks,
              });
              streamCheckpoint?.record(content.length + reasoning.length);
            },
            [effectiveContext.systemInstruction, continuationSkillContext]
              .filter(Boolean)
              .join("\n\n"),
            undefined,
            undefined,
            undefined,
            undefined,
            generation.controller.signal,
            [],
            undefined,
            undefined,
            toolConfirmationController,
            {
              disableTools: true,
              initialOutputBlocks: continuationOutputBlocks,
              resumeLongTextBlockId: resumableLongTextBlock?.id,
            },
          ),
      });

      streamRenderer.flush();
      if (!isGenerationRunActive(generation)) return;
      await persistLongTextFilesForMessage(sessionId, messageId, {
        expectedRequestId: requestId,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation)) return;
      const endedAt = Date.now();
      const current = useChatStore
        .getState()
        .activeMessages.find((message) => message.id === messageId);
      if (current?.generation) {
        updateMessage(sessionId, messageId, {
          generation: {
            ...current.generation,
            status: "completed",
            checkpointAt: endedAt,
          },
          timing: {
            startTime: interruptedMessage.timing?.startTime || startedAt,
            endTime: endedAt,
            duration:
              endedAt - (interruptedMessage.timing?.startTime || startedAt),
          },
        });
      }
      await streamCheckpoint.flush();
    } catch (error) {
      streamRenderer?.flush();
      if (
        !(error instanceof Error && error.name === "AbortError") &&
        !generation.controller.signal.aborted
      ) {
        const current = useChatStore
          .getState()
          .activeMessages.find((message) => message.id === messageId);
        if (current?.generation) {
          updateMessage(sessionId, messageId, {
            generation: {
              ...current.generation,
              status: "interrupted",
              checkpointAt: Date.now(),
            },
          });
        }
        await streamCheckpoint?.flush();
      }
    } finally {
      streamRenderer?.cancel();
      if (activeStreamRenderRef.current === streamRenderer) {
        activeStreamRenderRef.current = null;
      }
      if (activeStreamCheckpointRef.current === streamCheckpoint) {
        activeStreamCheckpointRef.current = null;
      }
      finishActiveGeneration(generation);
    }
  };

  const handleVersionChange = (msgId: string, direction: "prev" | "next") => {
    if (
      currentSessionId &&
      !isGenerating &&
      !useChatStore.getState().isActiveSessionLoading
    ) {
      switchMessageVersion(currentSessionId, msgId, direction);
    }
  };

  const handleVersionSelect = (msgId: string, targetId: string) => {
    if (
      currentSessionId &&
      !isGenerating &&
      !useChatStore.getState().isActiveSessionLoading
    ) {
      selectMessageVersion(currentSessionId, msgId, targetId);
    }
  };

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

    if (!instruction && !agent.isCustom) {
      try {
        const detail = await getAgentDetail(agent.identifier, locale);
        if (requestId !== assistantSelectRequestRef.current) return;
        instruction = detail.config?.systemRole;
      } catch (e) {
        if (requestId !== assistantSelectRequestRef.current) return;
        logChatAppError("Failed to fetch agent details for instruction", e);
      }
    }

    if (requestId !== assistantSelectRequestRef.current) return;

    if (!instruction) {
      instruction = `You are ${agent.meta.title}. ${agent.meta.description}`;
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
        return;
      }
    }

    abortBackgroundPostProcessing();
    createSession(instruction, agent.meta.title);
  };

  const handleEditMessage = (msgId: string, newContent: string) => {
    if (
      currentSessionId &&
      !isGenerating &&
      !useChatStore.getState().isActiveSessionLoading
    ) {
      updateMessageContent(currentSessionId, msgId, newContent);
      const sessionId = currentSessionId;
      void (async () => {
        try {
          await persistLongTextFilesForMessage(sessionId, msgId);
        } catch (error) {
          logChatAppError("Failed to update long text document file", error);
        }
        await syncActiveSessionWithNotice(
          sessionId,
          "Failed to persist edited message",
        );
      })();
    }
  };

  const handleSubmitUserMessageEdit = async (
    msgId: string,
    newContent: string,
  ) => {
    if (!navigator.onLine) {
      showActionError(t("offlineReadOnly"));
      return;
    }
    const sessionId = currentSessionId;
    if (
      !sessionId ||
      isGenerating ||
      useChatStore.getState().isActiveSessionLoading ||
      !newContent.trim()
    ) {
      return;
    }

    const sessionMessages = activeMessages;
    const msgIndex = sessionMessages.findIndex(
      (message) => message.id === msgId,
    );
    const sourceMessage = sessionMessages[msgIndex];
    if (!sourceMessage || sourceMessage.role !== "user") {
      showActionError(t("errEditUserMessage"));
      return;
    }
    if (newContent === sourceMessage.content) return;

    const sessionMeta = getCurrentSession();
    const editSkillParameters = await prepareComposerSkillParameters(
      sessionMeta,
      selectedModel,
    );
    if (!editSkillParameters) return;

    abortBackgroundPostProcessing();
    const generation = beginActiveGeneration();
    let modelMessageId: string | null = null;
    let editedUserMessageId: string | null = null;
    let startTime = Date.now();
    let receivedVisibleOutput = false;
    let receivedToolActivity = false;
    let streamCheckpoint: ReturnType<
      typeof createStreamCheckpointController
    > | null = null;
    let streamRenderer: StreamRenderScheduler<StreamRenderSnapshot> | null =
      null;

    try {
      const {
        finalText,
        finalAttachments,
        ragSources,
        ragError,
        userMessage,
        effectiveContext,
        knowledgeScope,
        injectedMemoryIds,
      } = await processPromptForModel(
        sessionMeta,
        newContent,
        sourceMessage.attachments || [],
        generation.controller.signal,
        undefined,
        sourceMessage.replyTo,
        selectedModel,
      );
      if (!isGenerationRunActive(generation)) return;
      commitInjectedMemoryContext(sessionId, sessionMeta, injectedMemoryIds);

      const skillResolution = await resolveSkillsForMessage({
        message: newContent,
        selectedModel,
        locale,
        installedSkills,
        activeSkillIds: effectiveContext.activeSkillIds,
        skillBundles,
        activeSkillBundleIds,
        skillParameterValues: editSkillParameters.skillParameterValues,
        skillBundleParameterValues:
          editSkillParameters.skillBundleParameterValues,
        autoSelect: skillAutoSelect && !effectiveContext.agentModeEnabled,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation)) return;
      if (skillResolution.skippedSkillIds.length > 0) {
        showActionError(
          t("skillsSkipped", {
            count: skillResolution.skippedSkillIds.length,
          }),
        );
      }

      const modelDisplayName = getModelDisplayName(
        selectedModel,
        availableModels,
      );
      const modelPlaceholder = createBotMessagePlaceholder(
        modelDisplayName,
        ragSources,
        ragError,
      );
      modelPlaceholder.generation = {
        status: "streaming",
        requestId: uuidv7(),
        ownerDeviceId: getSyncDeviceId(),
        model: selectedModel,
        attempt: 0,
        checkpointAt: modelPlaceholder.timestamp,
      };
      startTime = modelPlaceholder.timestamp;

      const branchIds = createEditedUserMessageBranch(
        sessionId,
        msgId,
        userMessage,
        modelPlaceholder,
      );
      if (!branchIds) {
        showActionError(t("errEditUserMessage"));
        return;
      }

      editedUserMessageId = branchIds.userMessageId;
      modelMessageId = branchIds.modelMessageId;
      if (skillResolution.invocations.length > 0) {
        updateMessage(sessionId, modelMessageId, {
          skillInvocations: skillResolution.invocations,
        });
      }

      const historyBeforeUser = sessionMessages.slice(0, msgIndex);
      const { prepareHistoryForLLM, streamChatResponse } =
        await loadChatService();
      const historyForApi = await prepareHistoryForLLM(
        historyBeforeUser,
        sessionMeta?.compression,
        selectedModel,
      );
      if (!isGenerationRunActive(generation)) return;

      let latestStreamText = "";
      let latestStreamReasoning: string | undefined;
      let latestStreamOutputBlocks: Message["outputBlocks"];

      streamRenderer = createMessageStreamRenderer(sessionId, modelMessageId);
      activeStreamRenderRef.current = streamRenderer;

      streamCheckpoint = createStreamCheckpointController({
        persist: async () => {
          streamRenderer?.flush();
          if (!modelMessageId) return;
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === modelMessageId);
          if (current?.generation) {
            updateMessage(sessionId, modelMessageId, {
              generation: {
                ...current.generation,
                checkpointAt: Date.now(),
              },
            });
          }
          await useChatStore.getState().syncActiveSession(sessionId);
        },
      });
      activeStreamCheckpointRef.current = streamCheckpoint;

      await runWithPreOutputRetry({
        signal: generation.controller.signal,
        hasVisibleOutput: () => receivedVisibleOutput,
        hasToolActivity: () => receivedToolActivity,
        onAttempt: (attempt) => {
          if (!modelMessageId) return;
          const current = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === modelMessageId);
          if (current?.generation) {
            updateMessage(sessionId, modelMessageId, {
              generation: { ...current.generation, attempt },
            });
          }
        },
        run: () =>
          streamChatResponse(
            sessionId,
            selectedModel,
            historyForApi,
            finalText,
            finalAttachments,
            resolveEffectiveChatRequestConfig({
              chatConfig,
              selectedModel,
              modelMetadata,
              customModelMetadata,
              searchCompatibility: effectiveContext.searchCompatibility,
            }),
            (streamText, streamReasoning, outputBlocks) => {
              if (!isGenerationRunActive(generation) || !modelMessageId) return;
              latestStreamText = streamText;
              if (streamReasoning !== undefined) {
                latestStreamReasoning = streamReasoning;
              }
              if (outputBlocks !== undefined) {
                latestStreamOutputBlocks = outputBlocks;
              }
              receivedVisibleOutput =
                receivedVisibleOutput ||
                Boolean(streamText || streamReasoning || outputBlocks?.length);
              streamRenderer?.schedule({
                content: latestStreamText,
                reasoning: latestStreamReasoning,
                outputBlocks: latestStreamOutputBlocks,
              });
              streamCheckpoint?.record(
                latestStreamText.length + (latestStreamReasoning?.length || 0),
              );
            },
            effectiveContext.systemInstruction,
            (isSearching, results) => {
              if (!isGenerationRunActive(generation) || !modelMessageId) return;
              streamRenderer?.flush();
              receivedVisibleOutput = receivedVisibleOutput || isSearching;
              const currentMessage = useChatStore
                .getState()
                .activeMessages.find(
                  (message) => message.id === modelMessageId,
                );
              const updates = buildSearchUpdate(
                currentMessage,
                isSearching,
                results,
                {
                  replaceResults: effectiveContext.agentModeEnabled,
                },
              );
              updateMessage(sessionId, modelMessageId, updates);
            },
            (toolCalls) => {
              if (!isGenerationRunActive(generation) || !modelMessageId) return;
              streamRenderer?.flush();
              receivedToolActivity =
                receivedToolActivity || toolCalls.length > 0;
              updateMessage(sessionId, modelMessageId, { toolCalls });
            },
            (images) => {
              if (!isGenerationRunActive(generation) || !modelMessageId) return;
              streamRenderer?.flush();
              receivedVisibleOutput =
                receivedVisibleOutput || images.length > 0;
              const currentActiveMsgs = useChatStore.getState().activeMessages;
              const msg = currentActiveMsgs.find(
                (message) => message.id === modelMessageId,
              );
              const currentAttachments = msg?.attachments || [];

              updateMessage(sessionId, modelMessageId, {
                attachments: [...currentAttachments, ...images],
              });
            },
            (usage) => {
              if (
                !isGenerationRunActive(generation) ||
                !modelMessageId ||
                !editedUserMessageId
              ) {
                return;
              }
              const currentMessages = useChatStore.getState().activeMessages;
              handleTokenUsageUpdate(
                usage,
                currentMessages,
                editedUserMessageId,
                modelMessageId,
                sessionId,
                updateMessage,
              );
            },
            generation.controller.signal,
            effectiveContext.activePluginIds,
            skillResolution.context,
            (outputBlocks) => {
              if (!isGenerationRunActive(generation) || !modelMessageId) return;
              streamRenderer?.flush();
              latestStreamOutputBlocks = outputBlocks;
              receivedVisibleOutput =
                receivedVisibleOutput || outputBlocks.length > 0;
              updateMessageContent(
                sessionId,
                modelMessageId,
                latestStreamText,
                latestStreamReasoning,
                outputBlocks,
              );
            },
            toolConfirmationController,
            createAgentToolStreamOptions({
              sessionId,
              modelMessageId: modelMessageId!,
              knowledgeScope,
              isActive: () =>
                isGenerationRunActive(generation) && Boolean(modelMessageId),
            }),
          ),
      });

      streamRenderer.flush();
      if (!isGenerationRunActive(generation) || !modelMessageId) return;
      await persistLongTextFilesForMessage(sessionId, modelMessageId, {
        expectedRequestId: modelPlaceholder.generation.requestId,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation) || !modelMessageId) return;
      const endTime = Date.now();
      updateMessage(sessionId, modelMessageId, {
        generation: {
          ...(useChatStore
            .getState()
            .activeMessages.find((message) => message.id === modelMessageId)
            ?.generation || modelPlaceholder.generation),
          status: "completed",
          checkpointAt: endTime,
        },
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      });
      await streamCheckpoint.flush();

      await syncActiveSession(sessionId);
      if (!isGenerationRunActive(generation)) return;
      const postProcessSignal = beginBackgroundPostProcessing();
      const completedModelMessage = useChatStore
        .getState()
        .activeMessages.find((message) => message.id === modelMessageId);
      if (completedModelMessage && editedUserMessageId) {
        queueMemoryExtraction(
          sessionId,
          { id: editedUserMessageId, content: newContent },
          {
            id: completedModelMessage.id,
            content: completedModelMessage.content,
          },
          postProcessSignal,
        );
      }
    } catch (error: any) {
      streamRenderer?.flush();
      if (error.name === "AbortError" || generation.controller.signal.aborted) {
        return;
      }

      logChatAppError("User message edit branch generation failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred.";
      if (modelMessageId) {
        const partialMessage = useChatStore
          .getState()
          .activeMessages.find((message) => message.id === modelMessageId);
        const hasPartialOutput = Boolean(
          partialMessage?.content ||
          partialMessage?.reasoning ||
          partialMessage?.outputBlocks?.length,
        );
        updateMessage(sessionId, modelMessageId, {
          generation: partialMessage?.generation
            ? {
                ...partialMessage.generation,
                status: "interrupted",
                checkpointAt: Date.now(),
              }
            : undefined,
          generationError: hasPartialOutput
            ? undefined
            : {
                message: errorMessage,
                recoverable: true,
              },
          timing: {
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
          },
        });
        await streamCheckpoint?.flush();
        await syncActiveSessionWithNotice(
          sessionId,
          "Failed to persist edited user message branch error",
        );
      } else {
        showActionError(t("errEditUserMessage"));
      }
    } finally {
      streamRenderer?.cancel();
      if (activeStreamRenderRef.current === streamRenderer) {
        activeStreamRenderRef.current = null;
      }
      if (activeStreamCheckpointRef.current === streamCheckpoint) {
        activeStreamCheckpointRef.current = null;
      }
      finishActiveGeneration(generation);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    const sessionId = currentSessionId;
    if (
      !sessionId ||
      isGenerating ||
      useChatStore.getState().isActiveSessionLoading
    ) {
      return;
    }

    try {
      await deleteMessage(sessionId, msgId);
    } catch (error) {
      logChatAppError("Failed to delete message", error);
      showActionError(t("errDeleteMessage"));
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
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

  const handleRetractMessage = async (msg: Message) => {
    const sessionId = currentSessionId;
    if (
      !sessionId ||
      isGenerating ||
      useChatStore.getState().isActiveSessionLoading
    ) {
      return;
    }

    try {
      await deleteMessageAndSubsequent(sessionId, msg.id);

      if (messageInputRef.current) {
        messageInputRef.current.setValue(msg.content);
        messageInputRef.current.focus();
      }
    } catch (error) {
      logChatAppError("Failed to retract message", error);
      showActionError(t("errRetractMessage"));
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

  const handleSuggestionClick = (question: string) => {
    void handleSendMessage(question, []);
  };

  // --- Render ---

  return (
    <>
      <ChatAppShell
        actionError={actionError}
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
        prepareComposerSkillParameters={() =>
          prepareComposerSkillParameters(currentSession, selectedModel)
        }
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
    </>
  );
};

export default ChatApp;
