"use client";
import { v7 as uuidv7 } from "uuid";
import type { Message } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import {
  resolveRecordedSkillInvocations,
  resolveSkillsForMessage,
} from "@/services/api/skillService";
import { handleTokenUsageUpdate } from "@/lib/utils/message";
import { resolveEffectiveChatRequestConfig } from "@/lib/chat/effectiveChatConfig";
import { buildSearchUpdate } from "@/lib/chat/searchUpdate";
import { createCitationSources } from "@/lib/utils/citations";
import { getLongTextBlocks } from "@/lib/chat/longText";
import {
  createStreamCheckpointController,
  hasUnsafeContinuationToolState,
  runWithPreOutputRetry,
  trimContinuationOverlap,
} from "@/lib/chat/streamResilience";
import type { StreamRenderScheduler } from "@/lib/chat/streamRenderScheduler";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import { logDevError } from "@/lib/utils/devLogger";
import { isForcedPluginInvocationError } from "@/lib/chat/forcedInvocation";
import type { ChatFlowDeps, StreamRenderSnapshot } from "./chatFlowTypes";

const logChatAppError = logDevError;
const loadChatService = () => import("@/services/api/chatService");

/**
 * Everything that produces an alternative answer for an existing message:
 * regenerate, continue an interrupted stream, and version navigation.
 */
export function useResponseBranchFlow(deps: ChatFlowDeps) {
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
    addMessageVersion,
    switchMessageVersion,
    selectMessageVersion,
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
    getEffectiveContextForSession,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
    skillParameterValuesRef,
    skillBundleParameterValuesRef,
  } = deps;

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
        researchLaunchText,
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
      if (effectiveContext.agentModeEnabled) {
        const current = useChatStore
          .getState()
          .activeMessages.find((message) => message.id === branchMessageId);
        if (current?.generation) {
          updateMessage(currentSessionId, branchMessageId, {
            generation: { ...current.generation, agentRunId: requestId },
          });
        }
      }
      commitInjectedMemoryContext(
        currentSessionId,
        sessionMeta,
        injectedMemoryIds,
      );
      const skillResolution =
        (!effectiveContext.researchModeEnabled && recordedSkillResolution) ||
        (await resolveSkillsForMessage({
          message: promptText,
          selectedModel: generationModel,
          locale,
          installedSkills,
          activeSkillIds: effectiveContext.orchestratedModeEnabled
            ? []
            : effectiveContext.activeSkillIds,
          skillBundles,
          activeSkillBundleIds: effectiveContext.researchModeEnabled
            ? []
            : activeSkillBundleIds,
          skillParameterValues: skillParameterValuesRef.current,
          skillBundleParameterValues: skillBundleParameterValuesRef.current,
          autoSelect:
            skillAutoSelect && !effectiveContext.orchestratedModeEnabled,
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
            {
              userInputController: agentUserInputController,
              ...createAgentToolStreamOptions({
                sessionId: currentSessionId,
                modelMessageId: branchMessageId,
                knowledgeScope,
                isActive: () => isGenerationRunActive(generation),
                allowedSkillIds: effectiveContext.agentSkillIds,
                allowedToolIds: effectiveContext.agentToolIds,
                approvalMode: effectiveContext.approvalMode,
                agentBudget: effectiveContext.agentBudget,
                memoryScopes: effectiveContext.memoryScopes,
                memoryScopeIds: effectiveContext.memoryScopeIds,
                agentRun: {
                  id: requestId,
                  userMessageId: lastUserMsg.id,
                  modelMessageId: branchMessageId,
                },
              }),
              researchLaunchMessage: researchLaunchText,
              forcedPluginIds: lastUserMsg.forcedPluginIds,
            },
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
        const forcedPluginFailure = isForcedPluginInvocationError(error);
        const errorCode =
          typeof error?.code === "string" ? error.code : undefined;
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
        ...(interruptedMessage.generation.agentRunId
          ? { agentRunId: interruptedMessage.generation.agentRunId }
          : {}),
      },
    });

    try {
      const sessionMeta = getCurrentSession();
      const effectiveContext = getEffectiveContextForSession(
        sessionMeta,
        generationModel,
      );
      const resumableAgentRunId =
        effectiveContext.agentModeEnabled &&
        interruptedMessage.generation.agentRunId
          ? interruptedMessage.generation.agentRunId
          : undefined;
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
              useSearch: resumableAgentRunId ? chatConfig.useSearch : false,
              useAgentMode: Boolean(resumableAgentRunId),
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
            resumableAgentRunId ? effectiveContext.activePluginIds : [],
            undefined,
            undefined,
            toolConfirmationController,
            resumableAgentRunId
              ? {
                  userInputController: agentUserInputController,
                  ...createAgentToolStreamOptions({
                    sessionId,
                    modelMessageId: messageId,
                    knowledgeScope: [],
                    isActive: () => isGenerationRunActive(generation),
                    allowedSkillIds: effectiveContext.agentSkillIds,
                    allowedToolIds: effectiveContext.agentToolIds,
                    approvalMode: effectiveContext.approvalMode,
                    agentBudget: effectiveContext.agentBudget,
                    memoryScopes: effectiveContext.memoryScopes,
                    memoryScopeIds: effectiveContext.memoryScopeIds,
                    agentRun: {
                      id: resumableAgentRunId,
                      modelMessageId: messageId,
                    },
                  }),
                  resumeAgentRun: true,
                  initialOutputBlocks: continuationOutputBlocks,
                  resumeLongTextBlockId: resumableLongTextBlock?.id,
                }
              : {
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

  return {
    handleRegenerate,
    handleContinueGeneration,
    handleVersionChange,
    handleVersionSelect,
  };
}
