"use client";
import { isTemporarySessionId } from "@/lib/chat/sessionRetention";
import { v7 as uuidv7 } from "uuid";
import type { Message } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { resolveSkillsForMessage } from "@/services/api/skillService";
import { handleTokenUsageUpdate } from "@/lib/utils/message";
import {
  createBotMessagePlaceholder,
  getModelDisplayName,
} from "@/lib/chat/messageProcessor";
import { resolveEffectiveChatRequestConfig } from "@/lib/chat/effectiveChatConfig";
import { buildSearchUpdate } from "@/lib/chat/searchUpdate";
import {
  createStreamCheckpointController,
  runWithPreOutputRetry,
} from "@/lib/chat/streamResilience";
import type { StreamRenderScheduler } from "@/lib/chat/streamRenderScheduler";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import { logDevError } from "@/lib/utils/devLogger";
import { hasMixedLongTextOutput } from "@/lib/chat/longText";
import { isForcedPluginInvocationError } from "@/lib/chat/forcedInvocation";
import type { ChatFlowDeps, StreamRenderSnapshot } from "./chatFlowTypes";

const logChatAppError = logDevError;
const loadChatService = () => import("@/services/api/chatService");

/** Mutating an existing message: inline edit, edit-and-rebranch, delete, retract. */
export function useMessageEditFlow(deps: ChatFlowDeps) {
  const {
    t,
    locale,
    showActionError,
    syncActiveSessionWithNotice,
    currentSessionId,
    activeMessages,
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
    getCurrentSession,
    updateMessage,
    updateMessageContent,
    createEditedUserMessageBranch,
    deleteMessage,
    deleteMessageAndSubsequent,
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
    agentUserInputController,
    messageInputRef,
    prepareComposerSkillParameters,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
  } = deps;

  const handleEditMessage = (msgId: string, newContent: string) => {
    const currentMessage = useChatStore
      .getState()
      .activeMessages.find((message) => message.id === msgId);
    if (hasMixedLongTextOutput(currentMessage?.outputBlocks)) return;

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
        researchLaunchText,
        researchPendingPlanTaskId,
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
      if (sourceMessage.forcedPluginIds?.length) {
        userMessage.forcedPluginIds = [...sourceMessage.forcedPluginIds];
      }
      if (!isGenerationRunActive(generation)) return;
      commitInjectedMemoryContext(sessionId, sessionMeta, injectedMemoryIds);

      const skillResolution = isTemporarySessionId(sessionId)
        ? {
            context: "",
            appliedSkills: [],
            invocations: [],
            skippedSkillIds: [],
          }
        : await resolveSkillsForMessage({
            message: newContent,
            selectedModel,
            locale,
            installedSkills,
            activeSkillIds: effectiveContext.orchestratedModeEnabled
              ? []
              : effectiveContext.activeSkillIds,
            skillBundles,
            activeSkillBundleIds: effectiveContext.researchModeEnabled
              ? []
              : activeSkillBundleIds,
            skillParameterValues: editSkillParameters.skillParameterValues,
            skillBundleParameterValues:
              editSkillParameters.skillBundleParameterValues,
            autoSelect:
              skillAutoSelect && !effectiveContext.orchestratedModeEnabled,
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
      if (effectiveContext.agentModeEnabled) {
        modelPlaceholder.generation.agentRunId =
          modelPlaceholder.generation.requestId;
      }
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
            {
              userInputController: agentUserInputController,
              ...createAgentToolStreamOptions({
                sessionId,
                modelMessageId: modelMessageId!,
                knowledgeScope,
                isActive: () =>
                  isGenerationRunActive(generation) && Boolean(modelMessageId),
                allowedSkillIds: effectiveContext.agentSkillIds,
                allowedToolIds: effectiveContext.agentToolIds,
                approvalMode: effectiveContext.approvalMode,
                agentBudget: effectiveContext.agentBudget,
                memoryScopes: effectiveContext.memoryScopes,
                memoryScopeIds: effectiveContext.memoryScopeIds,
                agentRun: {
                  id: modelPlaceholder.generation!.requestId,
                  userMessageId: editedUserMessageId || undefined,
                  modelMessageId: modelMessageId!,
                },
              }),
              researchLaunchMessage: researchLaunchText,
              ...(researchPendingPlanTaskId
                ? {
                    executionWorkflow: {
                      kind: "research" as const,
                      phase: "clarify" as const,
                    },
                    researchPendingTaskId: researchPendingPlanTaskId,
                  }
                : {}),
              forcedPluginIds: sourceMessage.forcedPluginIds,
            },
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
      const forcedPluginFailure = isForcedPluginInvocationError(error);
      const errorCode =
        typeof error?.code === "string" ? error.code : undefined;
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

  return {
    handleEditMessage,
    handleSubmitUserMessageEdit,
    handleDeleteMessage,
    handleRetractMessage,
  };
}
