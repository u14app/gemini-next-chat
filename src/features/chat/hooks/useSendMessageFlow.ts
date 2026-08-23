"use client";
import { v7 as uuidv7 } from "uuid";
import type { ComposerForcedInvocations } from "@/components/chat/MessageInput";
import type { ComposerSkillParameterValues } from "@/components/skill/SkillParameterDialog";
import type { Attachment, Message, MessageReplyReference } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { resolveSkillsForMessage } from "@/services/api/skillService";
import { handleTokenUsageUpdate } from "@/lib/utils/message";
import {
  createBotMessagePlaceholder,
  getModelDisplayName,
} from "@/lib/chat/messageProcessor";
import {
  createSessionPostGenerationSnapshot,
  shouldApplyCompressionUpdate,
  shouldApplyGeneratedTitle,
  shouldApplySuggestedQuestions,
} from "@/lib/chat/postGenerationGuards";
import { resolveEffectiveChatRequestConfig } from "@/lib/chat/effectiveChatConfig";
import { buildSearchUpdate } from "@/lib/chat/searchUpdate";
import {
  createStreamCheckpointController,
  runWithPreOutputRetry,
} from "@/lib/chat/streamResilience";
import type { StreamRenderScheduler } from "@/lib/chat/streamRenderScheduler";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import {
  isForcedPluginInvocationError,
  mergeForcedPluginIds,
} from "@/lib/chat/forcedInvocation";
import { logDevError } from "@/lib/utils/devLogger";
import type { ChatFlowDeps, StreamRenderSnapshot } from "./chatFlowTypes";

const logChatAppError = logDevError;
const loadChatService = () => import("@/services/api/chatService");

/** Composer send: user message -> placeholder -> stream -> post-generation. */
export function useSendMessageFlow(deps: ChatFlowDeps) {
  const {
    t,
    locale,
    showActionError,
    sessions,
    system,
    selectedModel,
    chatConfig,
    modelMetadata,
    customModelMetadata,
    availableModels,
    installedSkills,
    skillBundles,
    activeSkillBundleIds,
    skillAutoSelect,
    isGenerating,
    createSession,
    addMessage,
    updateMessage,
    updateMessageContent,
    setSuggestedQuestions,
    updateSessionTitle,
    updateSessionCompression,
    syncActiveSession,
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
    prepareComposerSkillParameters,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
  } = deps;

  const handleSendMessage = async (
    text: string,
    attachments: Attachment[],
    replyTo?: MessageReplyReference,
    skillParameters?: ComposerSkillParameterValues,
    forced?: ComposerForcedInvocations,
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
    const requestedPluginIds = mergeForcedPluginIds([], forced?.pluginIds);

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

      if (requestedPluginIds.length > 0) {
        userMessage.forcedPluginIds = requestedPluginIds;
      }

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
        forcedSkillIds: forced?.skillIds,
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
            {
              ...createAgentToolStreamOptions({
                sessionId: targetSessionId!,
                modelMessageId: currentBotMsgId,
                knowledgeScope: processedData.knowledgeScope,
                isActive: () => isGenerationRunActive(generation),
              }),
              forcedPluginIds: requestedPluginIds,
            },
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
        const forcedPluginFailure = isForcedPluginInvocationError(error);
        const errorCode =
          typeof error?.code === "string" ? error.code : undefined;

        if (!userMessageAdded) {
          const fallbackUserMessage: Message = {
            id: uuidv7(),
            role: "user",
            content: text,
            timestamp: Date.now(),
            attachments,
            replyTo,
            ...(requestedPluginIds.length > 0
              ? { forcedPluginIds: requestedPluginIds }
              : {}),
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
            generationError:
              hasPartialOutput && !forcedPluginFailure
                ? undefined
                : {
                    message: errorMessage,
                    recoverable: true,
                    ...(errorCode ? { code: errorCode } : {}),
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
            ...(errorCode ? { code: errorCode } : {}),
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

  return { handleSendMessage };
}
