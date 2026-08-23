import {
  Message,
  Attachment,
  ChatConfig,
  MessageOutputBlock,
  ToolCall,
  ToolConfirmationController,
  ToolConfirmationDecision,
  Source,
  AppliedSkillInvocation,
} from "@/types";
import { useSettingsStore, getTaskModel } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { v7 as uuidv7 } from "uuid";
import { executePluginFunction } from "@/utils/pluginUtils";
import {
  getEnabledPluginFunctions,
  resolveEnabledPluginFunction,
} from "@/lib/plugin/resolve";
import { getPluginFunctionRisk } from "@/lib/plugin/risk";
import type { PluginFunction } from "@/lib/plugin/types";
import {
  buildForcedToolDirective,
  ForcedPluginInvocationError,
  mergeForcedPluginIds,
} from "@/lib/chat/forcedInvocation";
import {
  createPluginFunctionFingerprint,
  normalizeToolConfirmationDecision,
  redactSensitiveToolArgs,
  requiresToolConfirmation,
} from "@/lib/plugin/confirmation";
import {
  parseModelString,
  supportsImageGeneration,
  supportsTextOutput,
  supportsToolCalls,
} from "@/lib/utils/model";
import {
  isGoogleProviderType,
  isOpenAIProviderType,
} from "@/lib/providers/providerTypes";
import { appendContextToChatInput } from "@/lib/utils/chatInput";
import {
  compressImageAttachments,
  getImageCompressionConfig,
  prepareGeneratedImageAttachments,
} from "@/lib/utils/imageCompression";
import {
  stripAttachmentsDisplayCacheForModel,
  stripMessagesDisplayCacheForModel,
} from "@/lib/utils/imageDisplayCache";
import { appendDiagramRequestInstructions } from "@/lib/chat/diagramPrompt";
import { appendHtmlVisualRequestInstructions } from "@/lib/chat/htmlVisualPrompt";
import {
  getSearchCompatibilityErrorMessage,
  resolveEffectiveSearchCapability,
} from "@/lib/settings/searchRag";
import { createMessageOutputBlockBuilder } from "@/lib/chat/messageOutputBlocks";
import { LONG_TEXT_TOOL_NAME } from "@/lib/chat/longText";
import { resolveImageGenerationOptions } from "@/lib/chat/imageGenerationOptions";
import { getResponseErrorMessage, signedApiFetch } from "@/lib/api/client";
import { createChatRequestBody } from "@/lib/api/chatImageRequestBody";
import {
  buildProviderRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import {
  buildDirectProviderConfig,
  describeDirectCallError,
  getBrowserProviderRuntime,
  hydrateDirectProviderImageFiles,
  shouldUseDirectCall,
} from "./chat/transport";
import { ATTACHMENT_LIMITS, PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import {
  collectBuiltinTools,
  type BuiltinKnowledgeScope,
} from "./chat/builtinTools";
import {
  runExternalSearchPreflight,
  type SearchStatusResults,
} from "./chat/externalSearchPreflight";
import { resolveModelMetadata } from "./chat/modelSelection";
import {
  compactPluginImageResultForHistory,
  extractPluginImageAttachments,
} from "./chat/pluginImageResults";
import type { ChatToolDefinition } from "./chat/types";
import {
  createBuiltinKnowledgeAggregator,
  createBuiltinSearchAggregator,
} from "./chat/builtinResultAggregators";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { boundHistoryForRequest } from "@/lib/chat/requestContextBudget";
import {
  appendAgentSystemInstruction,
  buildAgentSystemInstruction,
} from "@/lib/agent/systemPrompt";
import type { RagQueryError } from "@/lib/knowledge/retrieveKnowledgeSources";
import { buildSkillMetadataContext } from "@/lib/skills";
import {
  ChatStreamEventError,
  ChatStreamSizeLimitError,
  ChatStreamTimeoutError,
  IncompleteChatStreamError,
  createAbortError,
  createChatStreamEventError,
  isAbortError,
} from "./chat/streamErrors";
import {
  createConfirmationFailureToolCall,
  createRejectedToolCall,
  waitForToolConfirmation,
} from "./chat/toolConfirmation";
import {
  streamGenerateContent,
  streamGenerateToolCall,
} from "./chat/simpleGeneration";
import {
  performBackgroundMemoryExtraction,
  performMemoryDream,
} from "./chat/memoryProcessing";
import {
  performBackgroundCompression,
  prepareHistoryForLLM,
} from "./chat/compression";
import {
  executeCode,
  generateChatTitle,
  generateImage,
  generateRAGSearchQueries,
  generateRelatedQuestions,
} from "./chat/auxiliaryRequests";

type ChatUsagePayload = { usage?: unknown; usageMetadata?: unknown };
const MAX_CHAT_TOOLS_PER_REQUEST = 64;

export {
  ChatStreamEventError,
  ChatStreamSizeLimitError,
  ChatStreamTimeoutError,
  IncompleteChatStreamError,
  streamGenerateContent,
  streamGenerateToolCall,
  performBackgroundMemoryExtraction,
  performMemoryDream,
  performBackgroundCompression,
  prepareHistoryForLLM,
  executeCode,
  generateChatTitle,
  generateImage,
  generateRAGSearchQueries,
  generateRelatedQuestions,
};

type ChatStreamRoundPayload = {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
};

type ChatStreamRoundResult =
  | (ChatStreamRoundPayload & { status: "done" })
  | (ChatStreamRoundPayload & { status: "aborted"; error: Error })
  | (ChatStreamRoundPayload & { status: "error"; error: Error })
  | (ChatStreamRoundPayload & {
      status: "incomplete";
      error: IncompleteChatStreamError;
    });

// Export types
export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  providerName?: string;
}

export interface StreamChatResponseOptions {
  disableTools?: boolean;
  initialOutputBlocks?: MessageOutputBlock[];
  resumeLongTextBlockId?: string;
  knowledgeScope?: BuiltinKnowledgeScope;
  onKnowledgeSources?: (sources: Source[], ragError?: RagQueryError) => void;
  onSkillInvocation?: (invocation: AppliedSkillInvocation) => void;
  /** Plugins referenced with `@`; their tools are registered and required. */
  forcedPluginIds?: string[];
}

// Stream chat response from backend API
export const streamChatResponse = async (
  sessionId: string,
  model: string,
  history: Message[],
  newMessage: string,
  attachments: Attachment[],
  config: Partial<ChatConfig>,
  onChunk: (
    text: string,
    reasoning?: string,
    outputBlocks?: MessageOutputBlock[],
  ) => void,
  userSystemInstruction?: string,
  onSearchStatus?: (
    isSearching: boolean,
    results?: SearchStatusResults,
  ) => void,
  onToolUpdate?: (toolCalls: ToolCall[]) => void,
  onImage?: (images: Attachment[]) => void,
  onUsage?: (usage: ChatUsagePayload) => void,
  signal?: AbortSignal,
  activePlugins?: string[], // Add activePlugins parameter
  skillsContext?: string,
  onOutputBlocks?: (outputBlocks: MessageOutputBlock[]) => void,
  toolConfirmationController?: ToolConfirmationController,
  options?: StreamChatResponseOptions,
): Promise<string> => {
  const imageCompressionConfig = getImageCompressionConfig(
    useSettingsStore.getState().system,
  );
  const enableDestructiveToolConfirmation =
    useSettingsStore.getState().system?.enableDestructiveToolConfirmation ===
    true;
  const { providerId, modelName } = parseModelString(model);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider available");
  const selectedModelMetadata = resolveModelMetadata(modelName, providerId);
  const toolCallsSupported = supportsToolCalls(selectedModelMetadata);
  const agentModeEnabled = config?.useAgentMode === true && toolCallsSupported;
  const requestedForcedPluginIds = mergeForcedPluginIds(
    [],
    options?.forcedPluginIds,
  );
  if (
    requestedForcedPluginIds.length > 0 &&
    (options?.disableTools || !toolCallsSupported)
  ) {
    throw new ForcedPluginInvocationError(
      "Forced plugins require an enabled model with tool-call support.",
    );
  }

  let effectiveNewMessage = newMessage;
  const { search } = useSettingsStore.getState();
  const searchConfig =
    search.provider === "google" ? undefined : search.configs[search.provider];
  const searchCompatibility = resolveEffectiveSearchCapability({
    searchProvider: search.provider,
    searchConfig,
    modelProviderType: provider.type,
    selectedModel: model,
  });
  const outputBlockBuilder = createMessageOutputBlockBuilder({
    initialBlocks: options?.initialOutputBlocks,
  });
  if (options?.resumeLongTextBlockId) {
    outputBlockBuilder.resumeLongTextCapture(options.resumeLongTextBlockId);
  }
  const emitOutputBlocks = () => {
    onOutputBlocks?.(outputBlockBuilder.getBlocks());
  };
  const emitBuiltinSearch = createBuiltinSearchAggregator({
    upsertSearch: outputBlockBuilder.upsertSearch,
    emitOutputBlocks,
    onSearchStatus,
  });
  const emitBuiltinKnowledgeSources = createBuiltinKnowledgeAggregator({
    onKnowledgeSources: options?.onKnowledgeSources,
  });

  if (config?.useSearch && !searchCompatibility.enabled) {
    onSearchStatus?.(false, { sources: [], images: [] });
    throw new Error(getSearchCompatibilityErrorMessage(searchCompatibility));
  }

  if (
    config?.useSearch &&
    !agentModeEnabled &&
    onSearchStatus &&
    searchCompatibility.mode === "external"
  ) {
    effectiveNewMessage = await runExternalSearchPreflight({
      model,
      modelName,
      selectedModelMetadata,
      providers,
      history,
      newMessage,
      attachments,
      signal,
      generate: streamGenerateContent,
      onSearchStatus,
      upsertSearchBlock: outputBlockBuilder.upsertSearch,
      emitOutputBlocks,
    });
  }

  // Get plugin tools if activePlugins is provided
  const { installedPlugins, pluginConfigs, installedSkills } =
    useSettingsStore.getState();
  // Plugins referenced with `@` are registered and executable for this request
  // even when they are toggled off for the session. Explicit refs go first so
  // session plugins cannot consume the request tool budget ahead of them.
  const effectiveActivePlugins = mergeForcedPluginIds(
    requestedForcedPluginIds,
    activePlugins,
  );
  const tools: ChatToolDefinition[] = [];
  const toolNames = new Set<string>();
  const registeredPluginFunctions = new Map<string, PluginFunction[]>();
  const collectedBuiltinTools = collectBuiltinTools({
    message: newMessage,
    disabled: options?.disableTools || !toolCallsSupported,
    agentModeEnabled,
    useSearch: config?.useSearch === true,
    searchMode: searchCompatibility.mode,
    knowledgeScope: options?.knowledgeScope,
    installedSkills,
  });
  tools.push(...collectedBuiltinTools.definitions);
  for (const name of collectedBuiltinTools.bindingsByName.keys()) {
    toolNames.add(name);
  }

  if (
    !options?.disableTools &&
    toolCallsSupported &&
    effectiveActivePlugins.length > 0
  ) {
    effectiveActivePlugins.forEach((pluginId) => {
      const plugin = installedPlugins.find((p) => p.id === pluginId);
      const pluginConfig = pluginConfigs[pluginId];
      const registeredFunctions: PluginFunction[] = [];

      if (plugin) {
        const functionsToAdd = getEnabledPluginFunctions(plugin, pluginConfig);

        // Convert to OpenAI tool format
        functionsToAdd.forEach((func) => {
          if (tools.length >= MAX_CHAT_TOOLS_PER_REQUEST) return;
          if (toolNames.has(func.name)) return;
          toolNames.add(func.name);
          registeredFunctions.push(func);

          tools.push({
            type: "function",
            function: {
              name: func.name,
              description: func.description,
              parameters: func.parameters,
            },
          });
        });
      }
      registeredPluginFunctions.set(pluginId, registeredFunctions);
    });
  }

  const forcedPluginRequirements = requestedForcedPluginIds.map((pluginId) => {
    const plugin = installedPlugins.find((item) => item.id === pluginId);
    if (!plugin) {
      throw new ForcedPluginInvocationError(
        `Forced plugin "${pluginId}" is not installed.`,
      );
    }
    const functions = registeredPluginFunctions.get(pluginId) || [];
    if (functions.length === 0) {
      throw new ForcedPluginInvocationError(
        `Forced plugin "${plugin.title}" has no enabled tools available for this request.`,
      );
    }
    return {
      title: plugin.title,
      functions,
      toolNames: new Set(functions.map((fn) => fn.name)),
    };
  });

  const hasAgentBuiltin = [
    ...collectedBuiltinTools.bindingsByName.values(),
  ].some((binding) => binding.agentOnly);
  const agentSystemInstruction =
    agentModeEnabled && hasAgentBuiltin
      ? appendAgentSystemInstruction(
          userSystemInstruction,
          buildAgentSystemInstruction({
            toolNames: tools.map((tool) => tool.function.name),
            skillCatalogContext: collectedBuiltinTools.bindingsByName.has(
              "load_skill",
            )
              ? buildSkillMetadataContext({
                  skills: installedSkills,
                  includeParameters: true,
                })
              : undefined,
          }),
        )
      : userSystemInstruction;

  // Providers receive the directive as guidance; the terminal checks below
  // provide the fail-closed guarantee when a model ignores it.
  const forcedToolDirective = buildForcedToolDirective(
    forcedPluginRequirements.map((requirement) => ({
      title: requirement.title,
      functions: requirement.functions,
    })),
  );
  const effectiveSystemInstruction = forcedToolDirective
    ? appendAgentSystemInstruction(agentSystemInstruction, forcedToolDirective)
    : agentSystemInstruction;

  try {
    const allToolCalls: ToolCall[] = [];
    const assertForcedPluginsCalled = () => {
      const missing = forcedPluginRequirements.filter(
        (requirement) =>
          !allToolCalls.some(
            (toolCall) =>
              requirement.toolNames.has(toolCall.name) &&
              toolCall.status !== "skipped",
          ),
      );
      if (missing.length === 0) return;

      const titles = missing
        .map((requirement) => `"${requirement.title}"`)
        .join(", ");
      throw new ForcedPluginInvocationError(
        `Forced plugin${missing.length === 1 ? "" : "s"} ${titles} ${
          missing.length === 1 ? "was" : "were"
        } not called.`,
      );
    };
    let committedContent = "";
    let committedReasoning = "";
    let requestHistory = await stripMessagesDisplayCacheForModel(
      history as Message[],
    );
    const messageWithSkills = skillsContext?.trim()
      ? appendContextToChatInput(effectiveNewMessage, skillsContext, {
          separator: "\n\n",
        })
      : effectiveNewMessage;
    let requestMessage = appendDiagramRequestInstructions(
      appendHtmlVisualRequestInstructions(
        messageWithSkills,
        effectiveSystemInstruction,
      ),
      effectiveSystemInstruction,
    );
    const compressedRequestAttachments = await compressImageAttachments(
      attachments,
      imageCompressionConfig,
      { signal },
    );
    let requestAttachments = await stripAttachmentsDisplayCacheForModel(
      compressedRequestAttachments,
    );
    let requestConfig: Partial<ChatConfig> = {
      ...config,
      useAgentMode: agentModeEnabled,
    };
    let requestTools = tools;
    const maxToolRounds = PLUGIN_EXECUTION_LIMITS.maxToolRounds;
    let executedToolCallCount = 0;
    const functionFingerprintCache = new Map<string, Promise<string>>();
    const pendingSkillInvocations = new Map<string, AppliedSkillInvocation>();
    const emittedSkillIds = new Set<string>();

    if (
      requestConfig.imageCount === undefined &&
      supportsImageGeneration(selectedModelMetadata)
    ) {
      const availableModels = providers
        .filter((item) => item.enabled)
        .flatMap((item) =>
          item.models.map((availableModelName) => ({
            id: `${item.id}:${availableModelName}`,
            metadata: resolveModelMetadata(availableModelName, item.id),
          })),
        );
      const imageOptions = await resolveImageGenerationOptions({
        userMessage: newMessage,
        selectedModel: model,
        selectedModelMetadata,
        defaultPromptOptimizationModel: getTaskModel("promptOptimization"),
        availableModels,
        generate: (planningModel, prompt) =>
          streamGenerateContent(planningModel, prompt, () => {}, signal),
      });
      requestConfig = { ...requestConfig, ...imageOptions };
    }

    if (
      isOpenAIProviderType(provider.type) &&
      supportsImageGeneration(selectedModelMetadata) &&
      (!supportsTextOutput(selectedModelMetadata) ||
        modelName.toLowerCase().startsWith("gpt-image-"))
    ) {
      assertForcedPluginsCalled();
      boundHistoryForRequest([], {
        newMessage: requestMessage,
        attachments: requestAttachments,
        systemInstruction: effectiveSystemInstruction,
        tools,
        modelInputTokenLimit: selectedModelMetadata?.limit?.context,
        reservedOutputTokens: selectedModelMetadata?.limit?.output,
      });
      const loadingBlockId = outputBlockBuilder.appendImageGenerationStatus();
      emitOutputBlocks();

      let images: Attachment[];
      let message: string;
      try {
        const result = await generateImage(
          model,
          requestMessage,
          {
            imageCount: requestConfig.imageCount,
            attachments: requestAttachments,
          },
          signal,
        );
        images = result.images;
        message = result.message;
      } catch (error) {
        if (outputBlockBuilder.clearImageGenerationStatus(loadingBlockId)) {
          emitOutputBlocks();
        }
        throw error;
      }

      outputBlockBuilder.clearImageGenerationStatus(loadingBlockId);

      if (images.length > 0) {
        for (const image of images) {
          outputBlockBuilder.appendImage(image);
        }
        onChunk(
          committedContent,
          committedReasoning,
          outputBlockBuilder.getBlocks(),
        );
        return committedContent;
      }

      outputBlockBuilder.appendText(message);
      onChunk(
        committedContent + message,
        committedReasoning,
        outputBlockBuilder.getBlocks(),
      );
      return committedContent + message;
    }

    const emitToolCalls = () => {
      onToolUpdate?.([...allToolCalls]);
    };

    const upsertToolCall = (toolCall: ToolCall) => {
      const index = allToolCalls.findIndex((tc) => tc.id === toolCall.id);
      if (index === -1) {
        allToolCalls.push(toolCall);
      } else {
        allToolCalls[index] = { ...allToolCalls[index], ...toolCall };
      }
      emitToolCalls();
    };

    let longTextCaptureToolCallId: string | undefined;
    const failLongTextCapture = (code: string, message: string) => {
      const captureState = outputBlockBuilder.getLongTextCaptureState();
      if (!captureState.pending && !captureState.activeBlockId) return;

      outputBlockBuilder.cancelPendingLongTextCapture();
      outputBlockBuilder.finalizeLongTextCapture();
      const current = longTextCaptureToolCallId
        ? allToolCalls.find(
            (toolCall) => toolCall.id === longTextCaptureToolCallId,
          )
        : undefined;
      if (current) {
        const failed: ToolCall = {
          ...current,
          status: "error",
          isError: true,
          errorInfo: { code, message, recoverable: true },
          result: { error: { code, message, recoverable: true } },
        };
        outputBlockBuilder.updateToolCall(failed);
        upsertToolCall(failed);
      }
      emitOutputBlocks();
    };

    const runRound = async (): Promise<ChatStreamRoundResult> => {
      const boundedRequestHistory = boundHistoryForRequest(requestHistory, {
        newMessage: requestMessage,
        attachments: requestAttachments,
        modelInputTokenLimit: selectedModelMetadata?.limit?.context,
        reservedOutputTokens: selectedModelMetadata?.limit?.output,
        systemInstruction: effectiveSystemInstruction,
        tools: requestTools,
      });
      const requestPayload = {
        modelName,
        history: boundedRequestHistory,
        newMessage: requestMessage,
        attachments: requestAttachments,
        config: requestConfig,
        systemInstruction: effectiveSystemInstruction,
        tools: requestTools,
        enableImageGeneration:
          supportsImageGeneration(selectedModelMetadata) &&
          (provider.type === "OpenAI" || isGoogleProviderType(provider.type)),
        enableGoogleSearch:
          requestConfig?.useSearch &&
          !agentModeEnabled &&
          searchCompatibility.mode === "gemini-google",
        enableOpenAIWebSearch:
          requestConfig?.useSearch &&
          !agentModeEnabled &&
          searchCompatibility.mode === "openai-web",
      };

      let fullContent = "";
      let fullReasoning = "";
      const roundToolCalls: ToolCall[] = [];

      const getRoundPayload = (): ChatStreamRoundPayload => ({
        content: fullContent,
        reasoning: fullReasoning,
        toolCalls: roundToolCalls,
      });

      const handleMessage = async (parsed: any) => {
        switch (parsed.type) {
          case "content":
            fullContent += parsed.content;
            outputBlockBuilder.appendText(parsed.content);
            onChunk(
              committedContent + fullContent,
              committedReasoning + fullReasoning,
              outputBlockBuilder.getBlocks(),
            );
            return false;

          case "reasoning":
            fullReasoning += parsed.content;
            outputBlockBuilder.appendReasoning(parsed.content);
            onChunk(
              committedContent + fullContent,
              committedReasoning + fullReasoning,
              outputBlockBuilder.getBlocks(),
            );
            return false;

          case "tool_call": {
            const captureState = outputBlockBuilder.getLongTextCaptureState();
            if (captureState.pending || captureState.activeBlockId) {
              failLongTextCapture(
                "LONG_TEXT_OUTPUT_NESTED_TOOL_CALL",
                "The document body attempted another tool call instead of returning only text.",
              );
              throw new ChatStreamEventError(
                "The long text document body attempted an unexpected tool call.",
                "LONG_TEXT_OUTPUT_NESTED_TOOL_CALL",
              );
            }
            const toolCall: ToolCall = {
              id: parsed.toolCall?.id || uuidv7(),
              name: parsed.toolCall?.name,
              args: parsed.toolCall?.args ?? {},
              status: parsed.toolCall?.status || "pending",
            };
            roundToolCalls.push(toolCall);
            outputBlockBuilder.appendToolCall(toolCall);
            emitOutputBlocks();
            upsertToolCall(toolCall);
            return false;
          }

          case "tool_result":
            if (parsed.toolCall) {
              outputBlockBuilder.updateToolCall(parsed.toolCall);
              emitOutputBlocks();
              upsertToolCall(parsed.toolCall);
            }
            return false;

          case "search":
            outputBlockBuilder.upsertSearch({
              isSearching: parsed.isSearching,
              results: parsed.results,
            });
            onSearchStatus?.(parsed.isSearching, parsed.results);
            emitOutputBlocks();
            return false;

          case "image":
            if (parsed.image) {
              const [image] = await prepareGeneratedImageAttachments(
                [parsed.image],
                imageCompressionConfig,
                { signal },
              );
              outputBlockBuilder.appendImage(image);
              onChunk(
                committedContent + fullContent,
                committedReasoning + fullReasoning,
                outputBlockBuilder.getBlocks(),
              );
            }
            return false;

          case "usage": {
            const usageData = parsed.usage || parsed.usageMetadata;
            if (usageData && onUsage) {
              if (parsed.usage) {
                onUsage({ usage: usageData });
              } else if (parsed.usageMetadata) {
                onUsage({ usageMetadata: usageData });
              }
            }
            return false;
          }

          case "error":
            throw createChatStreamEventError(parsed);

          case "done":
            if (outputBlockBuilder.finalizeActiveReasoning()) {
              emitOutputBlocks();
            }
            return true;

          default:
            return false;
        }
      };

      // 直连：由浏览器直接请求 provider，逐条消费 runChatStream 产生的消息
      if (shouldUseDirectCall(provider)) {
        // send 是同步的，而 handleMessage 可能异步（图片附件），串行排队保证顺序
        let pump: Promise<boolean> = Promise.resolve(false);
        let pumpError: unknown = null;

        const send = (message: any) => {
          pump = pump.then(async (done) => {
            if (done || pumpError) return true;
            try {
              return await handleMessage(message);
            } catch (error) {
              pumpError = error;
              return true;
            }
          });
        };

        try {
          const [{ runChatStream }, runtime, directProvider] =
            await Promise.all([
              import("@/lib/chat/runChatStream"),
              getBrowserProviderRuntime(),
              buildDirectProviderConfig(provider),
            ]);
          const directImages = await hydrateDirectProviderImageFiles(
            requestPayload.history,
            requestPayload.attachments,
            { signal },
          );

          await runChatStream({
            ...requestPayload,
            history: directImages.history,
            attachments: directImages.attachments,
            provider: directProvider,
            signal,
            runtime,
            send,
          });
          await pump;
          if (pumpError) throw pumpError;

          if (signal?.aborted) {
            return {
              status: "aborted",
              error: createAbortError(signal),
              ...getRoundPayload(),
            };
          }

          if (outputBlockBuilder.finalizeActiveReasoning()) {
            emitOutputBlocks();
          }
          return { status: "done", ...getRoundPayload() };
        } catch (error) {
          await pump.catch(() => undefined);
          const normalizedError = describeDirectCallError(error, provider);
          if (isAbortError(normalizedError, signal)) {
            return {
              status: "aborted",
              error: createAbortError(signal),
              ...getRoundPayload(),
            };
          }
          return {
            status: "error",
            error: normalizedError,
            ...getRoundPayload(),
          };
        }
      }

      const response = await fetchWithByokRetry(async () => {
        const request = await createChatRequestBody(
          {
            ...requestPayload,
            provider: await buildProviderRuntimeConfig(provider, signal),
          },
          { signal },
        );
        return signedApiFetch("/api/chat", {
          method: "POST",
          headers: request.headers,
          body: request.body,
          signal,
        });
      });

      const contentType = response.headers.get("content-type");
      const isSSE = contentType?.includes("text/event-stream");

      if (!response.ok && !isSSE) {
        throw new Error(
          await getResponseErrorMessage(response, "Stream request failed"),
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      const handleEventData = async (data: string) => {
        if (!data) return false;
        if (data === "[DONE]") return true;
        return handleMessage(JSON.parse(data));
      };

      const processSSEEvent = async (event: string) => {
        const dataLines = event
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));

        if (dataLines.length === 0) return false;

        try {
          return await handleEventData(dataLines.join("\n"));
        } catch (eventError) {
          if (eventError instanceof SyntaxError) {
            throw new ChatStreamEventError(
              "The response stream contained malformed data.",
              "MALFORMED_CHAT_STREAM",
            );
          }
          throw eventError;
        }
      };

      const cancelReader = () => {
        void reader.cancel(signal?.reason).catch(() => undefined);
      };
      signal?.addEventListener("abort", cancelReader, { once: true });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            const isDone = await processSSEEvent(event);
            if (isDone) {
              await reader.cancel().catch(() => undefined);
              return { status: "done", ...getRoundPayload() };
            }
          }
        }

        if (buffer.trim()) {
          const isDone = await processSSEEvent(buffer);
          if (isDone) {
            await reader.cancel().catch(() => undefined);
            return { status: "done", ...getRoundPayload() };
          }
        }

        if (signal?.aborted) {
          return {
            status: "aborted",
            error: createAbortError(signal),
            ...getRoundPayload(),
          };
        }

        if (outputBlockBuilder.finalizeActiveReasoning()) {
          emitOutputBlocks();
        }
        return {
          status: "incomplete",
          error: new IncompleteChatStreamError(),
          ...getRoundPayload(),
        };
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));
        if (isAbortError(normalizedError, signal)) {
          return {
            status: "aborted",
            error: createAbortError(signal),
            ...getRoundPayload(),
          };
        }
        return {
          status: "error",
          error: normalizedError,
          ...getRoundPayload(),
        };
      } finally {
        signal?.removeEventListener("abort", cancelReader);
      }
    };

    for (let round = 0; round <= maxToolRounds; round++) {
      const result = await runRound();
      if (result.status !== "done") {
        const captureState = outputBlockBuilder.getLongTextCaptureState();
        if (captureState.pending) {
          failLongTextCapture(
            "LONG_TEXT_OUTPUT_MISSING_BODY",
            "The model did not return a document body after starting long text output.",
          );
        } else if (captureState.activeBlockId) {
          outputBlockBuilder.finalizeLongTextCapture();
          emitOutputBlocks();
        }
        throw result.error;
      }
      const pendingToolCalls = result.toolCalls.filter(
        (toolCall) =>
          toolCall.name &&
          (toolCall.status === "pending" ||
            toolCall.status === "running" ||
            toolCall.result === undefined),
      );

      if (pendingToolCalls.length === 0) {
        const captureState = outputBlockBuilder.getLongTextCaptureState();
        if (captureState.pending) {
          failLongTextCapture(
            "LONG_TEXT_OUTPUT_EMPTY_BODY",
            "The model completed without returning the requested document body.",
          );
        } else if (captureState.activeBlockId) {
          outputBlockBuilder.finalizeLongTextCapture();
          emitOutputBlocks();
        }
        assertForcedPluginsCalled();
        return committedContent + result.content;
      }

      if (round === maxToolRounds) {
        pendingToolCalls.forEach((toolCall) => {
          const skippedToolCall: ToolCall = {
            ...toolCall,
            status: "skipped",
            isError: true,
            result:
              "Tool execution skipped because the maximum tool-call rounds were reached.",
          };
          outputBlockBuilder.updateToolCall(skippedToolCall);
          emitOutputBlocks();
          upsertToolCall(skippedToolCall);
        });
        assertForcedPluginsCalled();
        return (
          committedContent +
          result.content +
          `\n\n[Tool Error] Tool execution stopped after reaching the ${maxToolRounds} tool-call rounds limit.`
        );
      }

      const remainingToolBudget = Math.max(
        0,
        PLUGIN_EXECUTION_LIMITS.maxTotalToolCalls - executedToolCallCount,
      );
      const toolCallsToExecute = pendingToolCalls.slice(0, remainingToolBudget);
      const budgetSkippedToolCalls = pendingToolCalls
        .slice(remainingToolBudget)
        .map((toolCall): ToolCall => ({
          ...toolCall,
          status: "skipped",
          isError: true,
          result:
            "Tool execution skipped because the per-generation total tool-call budget was reached.",
        }));
      budgetSkippedToolCalls.forEach((toolCall) => {
        outputBlockBuilder.updateToolCall(toolCall);
        emitOutputBlocks();
        upsertToolCall(toolCall);
      });
      executedToolCallCount += toolCallsToExecute.length;

      const approvedToolCalls: ToolCall[] = [];
      const nonExecutedToolCalls: ToolCall[] = [];

      for (const toolCall of toolCallsToExecute) {
        if (!toolNames.has(toolCall.name)) {
          const failed: ToolCall = {
            ...toolCall,
            status: "error",
            isError: true,
            errorInfo: {
              code: "TOOL_FUNCTION_NOT_FOUND",
              message: `Function ${toolCall.name} was not offered for this request.`,
              recoverable: true,
            },
            result: {
              error: {
                code: "TOOL_FUNCTION_NOT_FOUND",
                message: `Function ${toolCall.name} was not offered for this request.`,
              },
            },
          };
          outputBlockBuilder.updateToolCall(failed);
          emitOutputBlocks();
          upsertToolCall(failed);
          nonExecutedToolCalls.push(failed);
          continue;
        }

        const builtinBinding = collectedBuiltinTools.bindingsByName.get(
          toolCall.name,
        );
        if (builtinBinding?.risk === "read") {
          const approvedToolCall: ToolCall = {
            ...toolCall,
            risk: builtinBinding.risk,
            confirmation: {
              required: false,
              state: "approved",
              decision: "automatic",
              decidedAt: Date.now(),
            },
          };
          approvedToolCalls.push(approvedToolCall);
          continue;
        }

        const resolved = resolveEnabledPluginFunction(
          installedPlugins,
          toolCall.name,
          effectiveActivePlugins,
          pluginConfigs,
        );
        if (!resolved) {
          const failed: ToolCall = {
            ...toolCall,
            status: "error",
            isError: true,
            errorInfo: {
              code: "TOOL_FUNCTION_NOT_FOUND",
              message: `Function ${toolCall.name} is no longer available.`,
              recoverable: true,
            },
            result: {
              error: {
                code: "TOOL_FUNCTION_NOT_FOUND",
                message: `Function ${toolCall.name} is no longer available.`,
              },
            },
          };
          outputBlockBuilder.updateToolCall(failed);
          emitOutputBlocks();
          upsertToolCall(failed);
          nonExecutedToolCalls.push(failed);
          continue;
        }

        const { plugin, functionDef } = resolved;
        const risk = getPluginFunctionRisk(functionDef);
        const fingerprintCacheKey = `${plugin.id}\u0000${functionDef.name}`;
        let fingerprintPromise =
          functionFingerprintCache.get(fingerprintCacheKey);
        if (!fingerprintPromise) {
          fingerprintPromise = createPluginFunctionFingerprint(
            plugin,
            functionDef,
          );
          functionFingerprintCache.set(fingerprintCacheKey, fingerprintPromise);
        }
        const functionFingerprint = await fingerprintPromise;
        const identifiedToolCall: ToolCall = {
          ...toolCall,
          pluginId: plugin.id,
          pluginTitle: plugin.title,
          functionFingerprint,
          risk,
        };

        if (
          !requiresToolConfirmation(risk, enableDestructiveToolConfirmation)
        ) {
          const approvedToolCall: ToolCall = {
            ...identifiedToolCall,
            confirmation: {
              required: false,
              state: "approved",
              decision: "automatic",
              decidedAt: Date.now(),
            },
          };
          approvedToolCalls.push(approvedToolCall);
          continue;
        }

        const approvalCandidate = {
          pluginId: plugin.id,
          functionName: functionDef.name,
          risk,
          functionFingerprint,
          sessionId,
        };
        let decision: ToolConfirmationDecision | undefined;

        if (toolConfirmationController) {
          const awaitingToolCall: ToolCall = {
            ...identifiedToolCall,
            status: "awaiting_confirmation",
            confirmation: { required: true, state: "pending" },
          };
          outputBlockBuilder.updateToolCall(awaitingToolCall);
          emitOutputBlocks();
          upsertToolCall(awaitingToolCall);

          try {
            decision = normalizeToolConfirmationDecision(
              await waitForToolConfirmation(
                toolConfirmationController,
                {
                  ...approvalCandidate,
                  approvedAt: Date.now(),
                  toolCallId: toolCall.id,
                  pluginTitle: plugin.title,
                  args: redactSensitiveToolArgs(toolCall.args),
                },
                signal,
              ),
              risk,
            );
          } catch (confirmationError) {
            const aborted = isAbortError(confirmationError, signal);
            const rejected = createConfirmationFailureToolCall(
              awaitingToolCall,
              aborted ? "CONFIRMATION_INTERRUPTED" : "TOOL_CONFIRMATION_FAILED",
              aborted
                ? "Tool confirmation was interrupted before a decision."
                : "Tool confirmation failed before a decision.",
              aborted ? "interrupted" : "error",
            );
            outputBlockBuilder.updateToolCall(rejected);
            emitOutputBlocks();
            upsertToolCall(rejected);
            if (aborted) throw createAbortError(signal);
            nonExecutedToolCalls.push(rejected);
            continue;
          }
        }

        if (!decision) {
          const failed = createConfirmationFailureToolCall(
            identifiedToolCall,
            "TOOL_CONFIRMATION_UNAVAILABLE",
            "This tool call requires confirmation, but no confirmation controller is available.",
            "error",
          );
          outputBlockBuilder.updateToolCall(failed);
          emitOutputBlocks();
          upsertToolCall(failed);
          nonExecutedToolCalls.push(failed);
          continue;
        }

        if (decision === "deny") {
          const rejected = createRejectedToolCall(
            identifiedToolCall,
            "TOOL_CALL_DENIED",
            "The user denied this tool call.",
            false,
          );
          outputBlockBuilder.updateToolCall(rejected);
          emitOutputBlocks();
          upsertToolCall(rejected);
          nonExecutedToolCalls.push(rejected);
          continue;
        }

        const approvedAt = Date.now();
        const approvedToolCall: ToolCall = {
          ...identifiedToolCall,
          confirmation: {
            required: true,
            state: "approved",
            decision,
            decidedAt: approvedAt,
          },
        };
        approvedToolCalls.push(approvedToolCall);
      }

      approvedToolCalls.forEach((toolCall) => {
        const runningToolCall: ToolCall = { ...toolCall, status: "running" };
        outputBlockBuilder.updateToolCall(runningToolCall);
        emitOutputBlocks();
        upsertToolCall(runningToolCall);
      });

      const pluginImagesByToolCallId = new Map<string, Attachment[]>();
      const completedToolCalls = await mapWithConcurrency(
        approvedToolCalls,
        PLUGIN_EXECUTION_LIMITS.maxToolConcurrency,
        async (toolCall) => {
          try {
            const builtinBinding = collectedBuiltinTools.bindingsByName.get(
              toolCall.name,
            );
            const resultData = builtinBinding
              ? await builtinBinding.execute(toolCall.args, {
                  signal,
                  sessionId,
                  knowledgeScope: options?.knowledgeScope,
                  emit: {
                    search: (event) =>
                      emitBuiltinSearch(
                        toolCall.id,
                        allToolCalls.findIndex(
                          (candidate) => candidate.id === toolCall.id,
                        ),
                        event,
                      ),
                    knowledgeSources: (sources, ragError) =>
                      emitBuiltinKnowledgeSources(
                        toolCall.id,
                        allToolCalls.findIndex(
                          (candidate) => candidate.id === toolCall.id,
                        ),
                        sources,
                        ragError,
                      ),
                    skillInvocation: (invocation) => {
                      pendingSkillInvocations.set(toolCall.id, invocation);
                    },
                    taskPlan: (plan) => {
                      outputBlockBuilder.upsertTaskPlan(plan);
                      emitOutputBlocks();
                    },
                    longText: (request) => {
                      const capture =
                        outputBlockBuilder.startLongTextCapture(request);
                      if (capture.ok) {
                        longTextCaptureToolCallId = toolCall.id;
                      }
                      return capture;
                    },
                  },
                })
              : await executePluginFunction(
                  toolCall.name,
                  toolCall.args,
                  toolCall.auth,
                  toolCall.pluginId
                    ? [toolCall.pluginId]
                    : effectiveActivePlugins,
                  signal,
                  toolCall.pluginId &&
                    toolCall.functionFingerprint &&
                    toolCall.risk
                    ? {
                        pluginId: toolCall.pluginId,
                        functionFingerprint: toolCall.functionFingerprint,
                        risk: toolCall.risk,
                      }
                    : undefined,
                );
            const isError =
              !!resultData &&
              typeof resultData === "object" &&
              "error" in resultData;
            if (!builtinBinding && !isError) {
              const pluginImages = extractPluginImageAttachments(resultData);
              if (pluginImages.length > 0) {
                pluginImagesByToolCallId.set(toolCall.id, pluginImages);
              }
            }
            const storedResultData = isError
              ? resultData
              : compactPluginImageResultForHistory(resultData);
            const completed: ToolCall = {
              ...toolCall,
              status: isError ? "error" : "success",
              isError,
              result: storedResultData,
            };
            outputBlockBuilder.updateToolCall(completed);
            emitOutputBlocks();
            upsertToolCall(completed);
            return completed;
          } catch (toolError) {
            if (isAbortError(toolError, signal)) throw toolError;
            const failed: ToolCall = {
              ...toolCall,
              status: "error",
              isError: true,
              result:
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError),
            };
            outputBlockBuilder.updateToolCall(failed);
            emitOutputBlocks();
            upsertToolCall(failed);
            return failed;
          }
        },
      );
      const roundPluginImages = approvedToolCalls
        .flatMap((toolCall) => pluginImagesByToolCallId.get(toolCall.id) || [])
        .slice(0, ATTACHMENT_LIMITS.maxCount);
      const completedById = new Map(
        [...completedToolCalls, ...nonExecutedToolCalls].map((toolCall) => [
          toolCall.id,
          toolCall,
        ]),
      );
      if (roundPluginImages.length > 0) {
        const displayImages = await prepareGeneratedImageAttachments(
          roundPluginImages,
          imageCompressionConfig,
          { signal },
        );
        let displayImageIndex = 0;
        for (const toolCall of approvedToolCalls) {
          const resultImageCount = Math.min(
            pluginImagesByToolCallId.get(toolCall.id)?.length || 0,
            displayImages.length - displayImageIndex,
          );
          if (resultImageCount === 0) continue;

          const completed = completedById.get(toolCall.id);
          if (!completed) continue;
          const resultImages = displayImages.slice(
            displayImageIndex,
            displayImageIndex + resultImageCount,
          );
          displayImageIndex += resultImageCount;
          outputBlockBuilder.updateToolCall({
            ...completed,
            resultImages,
          });
        }
        onChunk(
          committedContent + result.content,
          committedReasoning + result.reasoning,
          outputBlockBuilder.getBlocks(),
        );
      }
      for (const toolCall of approvedToolCalls) {
        const invocation = pendingSkillInvocations.get(toolCall.id);
        pendingSkillInvocations.delete(toolCall.id);
        if (!invocation || emittedSkillIds.has(invocation.id)) continue;
        emittedSkillIds.add(invocation.id);
        options?.onSkillInvocation?.({
          ...invocation,
          order: emittedSkillIds.size - 1,
        });
      }
      const executedToolCalls = [
        ...toolCallsToExecute.flatMap((toolCall) => {
          const completed = completedById.get(toolCall.id);
          return completed ? [completed] : [];
        }),
        ...budgetSkippedToolCalls,
      ];

      committedContent = result.content
        ? `${committedContent}${result.content}\n\n`
        : committedContent;
      committedReasoning = result.reasoning
        ? `${committedReasoning}${result.reasoning}\n\n`
        : committedReasoning;

      requestHistory = [
        ...requestHistory,
        {
          id: uuidv7(),
          role: "user",
          content: requestMessage,
          attachments: requestAttachments,
          timestamp: Date.now(),
        },
        {
          id: uuidv7(),
          role: "model",
          content: result.content,
          reasoning: result.reasoning,
          toolCalls: executedToolCalls,
          timestamp: Date.now(),
        },
      ];
      const successfulLongTextCall = completedToolCalls.find(
        (toolCall) =>
          toolCall.name === LONG_TEXT_TOOL_NAME &&
          toolCall.status === "success" &&
          !toolCall.isError,
      );
      if (successfulLongTextCall) {
        const args = successfulLongTextCall.args as {
          title?: unknown;
          format?: unknown;
        };
        const title =
          typeof args.title === "string" ? args.title : "Untitled document";
        const format = args.format === "plain_text" ? "plain text" : "Markdown";
        requestMessage = `Write the complete ${format} body for the document titled ${JSON.stringify(title)}. Output only the document body as ordinary text. Do not add a preamble, do not call another tool, and do not repeat the title unless it belongs in the document itself.`;
        requestTools = [];
      } else {
        requestMessage =
          roundPluginImages.length > 0
            ? "Use the tool results above and the attached image outputs to answer the user's original request. Only call another tool if more external data is required."
            : "Use the tool results above to answer the user's original request. Only call another tool if more external data is required.";
        requestTools = tools;
      }
      requestAttachments = roundPluginImages;
    }

    assertForcedPluginsCalled();
    return committedContent;
  } catch (error) {
    throw error;
  }
};
