import {
  Message,
  Attachment,
  ChatConfig,
  Session,
  MessageOutputBlock,
  ToolCall,
  ToolConfirmationController,
  ToolConfirmationDecision,
  ToolConfirmationRequest,
  Source,
  ImageSource,
  AppliedSkillInvocation,
} from "@/types";
import { useSettingsStore, getTaskModel } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useMemoryStore } from "@/store/core/memoryStore";
import { v7 as uuidv7 } from "uuid";
import { executePluginFunction } from "@/utils/pluginUtils";
import {
  getEnabledPluginFunctions,
  resolveEnabledPluginFunction,
} from "@/lib/plugin/resolve";
import { getPluginFunctionRisk } from "@/lib/plugin/risk";
import {
  createPluginFunctionFingerprint,
  normalizeToolConfirmationDecision,
  redactSensitiveToolArgs,
  requiresToolConfirmation,
} from "@/lib/plugin/confirmation";
import {
  parseModelString,
  resolveProviderModelMetadata,
  supportsImageGeneration,
  supportsTextOutput,
  supportsToolCalls,
} from "@/lib/utils/model";
import {
  isGoogleProviderType,
  isOpenAIProviderType,
} from "@/lib/providers/providerTypes";
import { normalizeSessionTitle } from "@/lib/chat/entities";
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
import { resolveImageGenerationOptions } from "@/lib/chat/imageGenerationOptions";
import {
  buildCompressionSource,
  createContextCompressionSummaryPrompt,
  mergeCompressedContentWithMemoryIds,
  normalizeCompressedContent,
  normalizeCompressedContentWithMemoryIds,
  textToBase64,
} from "@/lib/utils/contextCompression";
import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import { createChatRequestBody } from "@/lib/api/chatImageRequestBody";
import {
  buildProviderRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import {
  buildDirectProviderConfig,
  getBrowserImageRuntime,
  describeDirectCallError,
  directSimpleGenerator,
  getBrowserProviderRuntime,
  hydrateDirectProviderImageFiles,
  shouldUseDirectCall,
} from "./chat/transport";
import {
  parseMemoryDreamToolCall,
  parseMemoryRecordToolCall,
} from "@/lib/memory/entities";
import {
  createMemoryDreamPrompt,
  createMemoryExtractionPrompt,
  MEMORY_DREAM_TOOL,
  MEMORY_DREAM_TOOL_NAME,
  MEMORY_RECORD_TOOL,
  MEMORY_RECORD_TOOL_NAME,
} from "@/lib/memory/tools";
import { logDevError, logDevWarn } from "@/lib/utils/devLogger";
import {
  ATTACHMENT_LIMITS,
  MEMORY_LIMITS,
  PLUGIN_EXECUTION_LIMITS,
  RAG_LIMITS,
  SEARCH_RESULT_LIMITS,
} from "@/config/limits";
import {
  collectBuiltinTools,
  type BuiltinKnowledgeScope,
  type BuiltinSearchEvent,
} from "./chat/builtinTools";
import { isBrowserMemoryStorePendingHydration } from "./chat/builtinTools/memorySearch";
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
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { boundHistoryForRequest } from "@/lib/chat/requestContextBudget";
import { mergeImages, mergeSources } from "@/lib/chat/searchUpdate";
import {
  appendAgentSystemInstruction,
  buildAgentSystemInstruction,
} from "@/lib/agent/systemPrompt";
import type { RagQueryError } from "@/lib/knowledge/retrieveKnowledgeSources";
import { buildSkillMetadataContext } from "@/lib/skills";

type ChatUsagePayload = { usage?: unknown; usageMetadata?: unknown };
const MAX_CHAT_TOOLS_PER_REQUEST = 64;

export class IncompleteChatStreamError extends Error {
  readonly code = "INCOMPLETE_CHAT_STREAM";
  readonly recoverable = true;

  constructor() {
    super("The response stream ended before completion. Please retry.");
    this.name = "IncompleteChatStreamError";
  }
}

export class ChatStreamEventError extends Error {
  constructor(
    message: string,
    readonly code = "CHAT_STREAM_ERROR",
  ) {
    super(message);
    this.name = "ChatStreamEventError";
  }
}

export class ChatStreamTimeoutError extends ChatStreamEventError {
  constructor(message: string) {
    super(message, "RESPONSE_TIMEOUT");
    this.name = "ChatStreamTimeoutError";
  }
}

export class ChatStreamSizeLimitError extends ChatStreamEventError {
  constructor(message: string) {
    super(message, "RESPONSE_SIZE_LIMIT");
    this.name = "ChatStreamSizeLimitError";
  }
}

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

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function waitForToolConfirmation(
  controller: ToolConfirmationController,
  request: ToolConfirmationRequest,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return Promise.reject(createAbortError(signal));

  return new Promise<
    Awaited<ReturnType<ToolConfirmationController["requestConfirmation"]>>
  >((resolve, reject) => {
    const onAbort = () => reject(createAbortError(signal));
    signal?.addEventListener("abort", onAbort, { once: true });

    Promise.resolve()
      .then(() => controller.requestConfirmation(request, signal))
      .then(
        (decision) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(decision);
        },
        (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
  });
}

function createRejectedToolCall(
  toolCall: ToolCall,
  code: string,
  message: string,
  recoverable: boolean,
): ToolCall {
  return {
    ...toolCall,
    status: "denied",
    isError: true,
    confirmation: {
      required: true,
      state: "denied",
      decision: "deny",
      decidedAt: Date.now(),
    },
    errorInfo: { code, message, recoverable },
    result: { error: { code, message } },
  };
}

function createConfirmationFailureToolCall(
  toolCall: ToolCall,
  code: string,
  message: string,
  state: "interrupted" | "error",
): ToolCall {
  return {
    ...toolCall,
    status: "error",
    isError: true,
    confirmation: {
      required: true,
      state,
      decidedAt: Date.now(),
    },
    errorInfo: { code, message, recoverable: true },
    result: { error: { code, message } },
  };
}

function createChatStreamEventError(event: {
  error?: string;
  code?: string;
}): ChatStreamEventError {
  const message = event.error || "The response stream failed.";
  if (event.code === "INCOMPLETE_PROVIDER_STREAM") {
    return new IncompleteChatStreamError();
  }
  if (event.code === "RESPONSE_TIMEOUT") {
    return new ChatStreamTimeoutError(message);
  }
  if (event.code === "RESPONSE_SIZE_LIMIT") {
    return new ChatStreamSizeLimitError(message);
  }
  return new ChatStreamEventError(message, event.code);
}

function coerceToolDefinition(tool: unknown): ChatToolDefinition {
  return tool as ChatToolDefinition;
}

export const executeCode = async (
  modelString: string,
  code: string,
): Promise<string> => {
  const { providerId, modelName } = parseModelString(modelString);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider found");

  if (shouldUseDirectCall(provider)) {
    try {
      const [{ simulateCode }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/simulateCode"),
        getBrowserProviderRuntime(),
        buildDirectProviderConfig(provider),
      ]);
      const result = await simulateCode(
        directProvider,
        modelName,
        code,
        runtime,
      );
      if (!result.ok) throw new Error(result.error);
      return result.output;
    } catch (error) {
      throw describeDirectCallError(error, provider);
    }
  }

  try {
    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/execute-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(provider),
          modelName,
          code,
        }),
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Code execution failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{
      output?: string;
      error?: string;
    }>(response, "Code execution failed");
    return data.output || data.error || "No output.";
  } catch (error) {
    logDevError("Code execution error:", error);
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

export const generateChatTitle = async (
  history: Message[],
  signal?: AbortSignal,
): Promise<string> => {
  const fallbackTitle = () =>
    normalizeSessionTitle(history.find((m) => m.role === "user")?.content);
  const { providers } = useCoreSettingsStore.getState();
  const provider = providers.find((p) => p.enabled);

  if (!provider) return fallbackTitle();

  // Get task model from settings using helper function
  const modelString = getTaskModel("titleGeneration");

  const { providerId, modelName } = parseModelString(modelString);

  const targetProvider = providerId
    ? providers.find((p) => p.id === providerId)
    : provider;

  if (!targetProvider) return fallbackTitle();

  try {
    if (shouldUseDirectCall(targetProvider)) {
      const [{ generateTitleWith }, generate, directProvider] =
        await Promise.all([
          import("@/lib/chat/auxiliaryGeneration"),
          directSimpleGenerator(),
          buildDirectProviderConfig(targetProvider),
        ]);
      return await generateTitleWith(
        generate,
        directProvider,
        modelName,
        history,
        signal,
      );
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/generate-title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(targetProvider, signal),
          modelName,
          history,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Title generation failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{ title?: string }>(
      response,
      "Title generation failed",
    );
    return normalizeSessionTitle(data.title);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevError("Title generation error:", error);
    return fallbackTitle();
  }
};

export const generateRelatedQuestions = async (
  history: Message[],
  signal?: AbortSignal,
): Promise<string[]> => {
  const { providers } = useCoreSettingsStore.getState();
  const provider = providers.find((p) => p.enabled);

  if (!provider) return [];

  // Get task model from settings using helper function
  const modelString = getTaskModel("relatedQuestions");

  const { providerId, modelName } = parseModelString(modelString);

  const targetProvider = providerId
    ? providers.find((p) => p.id === providerId)
    : provider;

  if (!targetProvider) return [];

  try {
    if (shouldUseDirectCall(targetProvider)) {
      const [{ generateRelatedQuestionsWith }, generate, directProvider] =
        await Promise.all([
          import("@/lib/chat/auxiliaryGeneration"),
          directSimpleGenerator(),
          buildDirectProviderConfig(targetProvider),
        ]);
      return await generateRelatedQuestionsWith(
        generate,
        directProvider,
        modelName,
        history,
        signal,
      );
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/related-questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(targetProvider, signal),
          modelName,
          history,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(
          response,
          "Related questions generation failed",
        ),
      );
    }

    const data = await readJsonResponseOrThrow<{ questions?: string[] }>(
      response,
      "Related questions generation failed",
    );
    return data.questions || [];
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevError("Related questions error:", error);
    return [];
  }
};

export const generateRAGSearchQueries = async (
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const { providers } = useCoreSettingsStore.getState();
  const provider = providers.find((p) => p.enabled);

  if (!provider) return [userPrompt];

  // Get task model from settings using helper function
  const modelString = getTaskModel("ragQuery");

  const { providerId, modelName } = parseModelString(modelString);

  const targetProvider = providerId
    ? providers.find((p) => p.id === providerId)
    : provider;

  if (!targetProvider) return [userPrompt];

  try {
    if (shouldUseDirectCall(targetProvider)) {
      const [{ generateRAGQueriesWith }, generate, directProvider] =
        await Promise.all([
          import("@/lib/chat/auxiliaryGeneration"),
          directSimpleGenerator(),
          buildDirectProviderConfig(targetProvider),
        ]);
      return await generateRAGQueriesWith(
        generate,
        directProvider,
        modelName,
        userPrompt,
        signal,
      );
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/rag-queries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(targetProvider, signal),
          modelName,
          userMessage: userPrompt,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(
          response,
          "RAG queries generation failed",
        ),
      );
    }

    const data = await readJsonResponseOrThrow<{ queries?: string[] }>(
      response,
      "RAG queries generation failed",
    );
    return data.queries || [userPrompt];
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevError("RAG queries error:", error);
    return [userPrompt];
  }
};

export const generateImage = async (
  modelString: string,
  prompt: string,
  options: { imageCount?: number; attachments?: Attachment[] } = {},
  signal?: AbortSignal,
): Promise<{ images: Attachment[]; message: string }> => {
  const { providerId, modelName } = parseModelString(modelString);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider found");

  try {
    const imageCompressionConfig = getImageCompressionConfig(
      useSettingsStore.getState().system,
    );
    const preparedAttachments = options.attachments
      ? await compressImageAttachments(
          options.attachments,
          imageCompressionConfig,
          { signal },
        )
      : undefined;
    const requestAttachments = preparedAttachments
      ? await stripAttachmentsDisplayCacheForModel(preparedAttachments)
      : undefined;
    if (shouldUseDirectCall(provider)) {
      const [{ generateImage }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/generateImage"),
        getBrowserImageRuntime(),
        buildDirectProviderConfig(provider),
      ]);
      const directImages = await hydrateDirectProviderImageFiles(
        [],
        requestAttachments || [],
        { signal },
      );

      let result;
      try {
        result = await generateImage(
          {
            provider: directProvider,
            modelName,
            prompt,
            imageCount: options.imageCount,
            attachments: directImages.attachments,
            signal,
          },
          runtime,
        );
      } catch (error) {
        throw describeDirectCallError(error, provider);
      }

      if (!result.ok) throw new Error(result.error);

      return {
        images: await prepareGeneratedImageAttachments(
          result.images,
          imageCompressionConfig,
          { signal },
        ),
        message: result.message,
      };
    }

    const response = await fetchWithByokRetry(async () => {
      const request = await createChatRequestBody(
        {
          provider: await buildProviderRuntimeConfig(provider, signal),
          modelName,
          prompt,
          imageCount: options.imageCount,
          attachments: requestAttachments,
        },
        { signal },
      );
      return signedApiFetch("/api/chat/generate-image", {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal,
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Image generation failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{
      images?: Attachment[];
      message?: string;
    }>(response, "Image generation failed");
    const images = await prepareGeneratedImageAttachments(
      data.images || [],
      imageCompressionConfig,
      { signal },
    );
    return {
      images,
      message: data.message || "No images generated.",
    };
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError(signal);
    logDevError("Image generation error:", error);
    throw error;
  }
};

// Export types
export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  providerName?: string;
}

export interface StreamChatResponseOptions {
  disableTools?: boolean;
  knowledgeScope?: BuiltinKnowledgeScope;
  onKnowledgeSources?: (sources: Source[], ragError?: RagQueryError) => void;
  onSkillInvocation?: (invocation: AppliedSkillInvocation) => void;
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
  const outputBlockBuilder = createMessageOutputBlockBuilder();
  const emitOutputBlocks = () => {
    onOutputBlocks?.(outputBlockBuilder.getBlocks());
  };
  const builtinSearchStates = new Map<
    string,
    {
      order: number;
      phase: BuiltinSearchEvent["phase"];
      sources: Source[];
      images: ImageSource[];
      error?: string;
    }
  >();
  const emitBuiltinSearch = (
    toolCallId: string,
    order: number,
    event: BuiltinSearchEvent,
  ) => {
    const previous = builtinSearchStates.get(toolCallId);
    builtinSearchStates.set(toolCallId, {
      order,
      phase: event.phase,
      sources:
        event.phase === "complete" ? event.sources : previous?.sources || [],
      images:
        event.phase === "complete" ? event.images : previous?.images || [],
      ...(event.phase === "error" ? { error: event.message } : {}),
    });

    const orderedStates = [...builtinSearchStates.values()].sort(
      (left, right) => left.order - right.order,
    );
    const activeBuiltinSearches = orderedStates.filter(
      (state) => state.phase === "start",
    ).length;
    let builtinSearchSources: Source[] = [];
    let builtinSearchImages: ImageSource[] = [];
    for (const state of orderedStates) {
      if (state.phase !== "complete") continue;
      builtinSearchSources = mergeSources(
        builtinSearchSources,
        state.sources,
      ).slice(0, SEARCH_RESULT_LIMITS.maxSources);
      builtinSearchImages = mergeImages(
        builtinSearchImages,
        state.images,
      ).slice(0, SEARCH_RESULT_LIMITS.maxImages);
    }
    const latestSuccessOrder = orderedStates.reduce(
      (latest, state) =>
        state.phase === "complete" ? Math.max(latest, state.order) : latest,
      -1,
    );
    const latestError = orderedStates
      .filter(
        (state) => state.phase === "error" && state.order > latestSuccessOrder,
      )
      .at(-1)?.error;
    const results = {
      sources: builtinSearchSources,
      images: builtinSearchImages,
    };
    outputBlockBuilder.upsertSearch({
      isSearching: activeBuiltinSearches > 0,
      ...(latestError ? { error: latestError } : {}),
      results,
    });
    emitOutputBlocks();
    onSearchStatus?.(activeBuiltinSearches > 0, results);
  };
  const builtinKnowledgeStates = new Map<
    string,
    {
      order: number;
      sources: Source[];
      ragError?: RagQueryError;
    }
  >();
  const emitBuiltinKnowledgeSources = (
    toolCallId: string,
    order: number,
    sources: Source[],
    ragError?: RagQueryError,
  ) => {
    builtinKnowledgeStates.set(toolCallId, {
      order,
      sources,
      ragError,
    });
    const orderedStates = [...builtinKnowledgeStates.values()].sort(
      (left, right) => left.order - right.order,
    );
    let aggregatedSources: Source[] = [];
    for (const state of orderedStates) {
      aggregatedSources = mergeSources(aggregatedSources, state.sources).slice(
        0,
        RAG_LIMITS.maxTopK,
      );
    }
    const latestRagError = orderedStates
      .filter((state) => state.ragError)
      .at(-1)?.ragError;
    options?.onKnowledgeSources?.(aggregatedSources, latestRagError);
  };

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
  const tools: ChatToolDefinition[] = [];
  const toolNames = new Set<string>();
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
    activePlugins &&
    activePlugins.length > 0
  ) {
    activePlugins.forEach((pluginId) => {
      const plugin = installedPlugins.find((p) => p.id === pluginId);
      const pluginConfig = pluginConfigs[pluginId];

      if (plugin) {
        const functionsToAdd = getEnabledPluginFunctions(plugin, pluginConfig);

        // Convert to OpenAI tool format
        functionsToAdd.forEach((func) => {
          if (tools.length >= MAX_CHAT_TOOLS_PER_REQUEST) return;
          if (toolNames.has(func.name)) return;
          toolNames.add(func.name);

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
    });
  }

  const hasAgentBuiltin = [
    ...collectedBuiltinTools.bindingsByName.values(),
  ].some((binding) => binding.agentOnly);
  const effectiveSystemInstruction =
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

  try {
    const allToolCalls: ToolCall[] = [];
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

    const runRound = async (): Promise<ChatStreamRoundResult> => {
      const boundedRequestHistory = boundHistoryForRequest(requestHistory, {
        newMessage: requestMessage,
        attachments: requestAttachments,
        modelInputTokenLimit: selectedModelMetadata?.limit?.context,
        reservedOutputTokens: selectedModelMetadata?.limit?.output,
        systemInstruction: effectiveSystemInstruction,
        tools,
      });
      const requestPayload = {
        modelName,
        history: boundedRequestHistory,
        newMessage: requestMessage,
        attachments: requestAttachments,
        config: requestConfig,
        systemInstruction: effectiveSystemInstruction,
        tools,
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
          activePlugins,
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
                  },
                })
              : await executePluginFunction(
                  toolCall.name,
                  toolCall.args,
                  toolCall.auth,
                  toolCall.pluginId ? [toolCall.pluginId] : activePlugins,
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
      requestMessage =
        roundPluginImages.length > 0
          ? "Use the tool results above and the attached image outputs to answer the user's original request. Only call another tool if more external data is required."
          : "Use the tool results above to answer the user's original request. Only call another tool if more external data is required.";
      requestAttachments = roundPluginImages;
    }

    return committedContent;
  } catch (error) {
    throw error;
  }
};

// Helper functions for history preparation and compression
// These remain client-side as they need access to local state

// Helper to get compression config from store
const getCompressionConfig = () => {
  const { system } = useSettingsStore.getState();
  // Use stored values or defaults if something is wrong (though state should be init)
  // Turns to Messages: 1 Turn = 2 Messages
  return {
    thresholdMessages: (system.compressionThreshold || 12) * 2,
    keepMessages: (system.historyKeepCount || 4) * 2,
  };
};

// Generate summary using backend API
const generateSummary = async (
  text: string,
  signal?: AbortSignal,
): Promise<string> => {
  try {
    // Use configured task model
    const summaryModel = getTaskModel("contextCompression");

    const prompt = createContextCompressionSummaryPrompt(text);

    const response = await streamGenerateContent(
      summaryModel,
      prompt,
      () => {},
      signal,
    );
    return response;
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
    logDevWarn("Summary generation failed, returning raw truncation", e);
    return normalizeCompressedContent(
      `${text.slice(0, 1000)}... [Summary Failed]`,
    );
  }
};

// Reconstruct history for the LLM based on stored compression state + uncompressed tail
export const prepareHistoryForLLM = async (
  allMessages: Message[],
  compression: Session["compression"],
  model: string,
): Promise<Message[]> => {
  // Filter out empty model messages (can happen after retract/delete operations)
  const validMessages = allMessages.filter(
    (m) =>
      m.role === "user" ||
      (m.role === "model" &&
        (m.content.trim() !== "" ||
          m.attachments?.length ||
          m.reasoning ||
          m.searchSources?.length ||
          m.toolCalls?.length ||
          m.outputBlocks?.length)),
  );

  // If no compression state exists, return filtered history
  if (!compression) return validMessages;

  // 1. Identify uncompressed tail
  const lastCompressedIndex = validMessages.findIndex(
    (m) => m.id === compression.lastCompressedMessageId,
  );
  let uncompressedTail: Message[] = [];

  if (lastCompressedIndex !== -1) {
    uncompressedTail = validMessages.slice(lastCompressedIndex + 1);
  } else {
    // If ID not found (maybe message deleted?), fallback to full history or handle error.
    // Safer to return full history if state is invalid.
    return validMessages;
  }

  // 2. Identify First User Message (Requirement: Preserve user's first question)
  const firstUserMsg = validMessages.find((m) => m.role === "user");

  // 3. Construct Compressed Message Placeholder
  // Check model capability for attachment
  const { modelMetadata, customModelMetadata } = useSettingsStore.getState();
  const { providerId, modelName } = parseModelString(model);
  const meta = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const supportAttachment = meta ? (meta.attachment ?? false) : true;

  let compressedMsg: Message;
  const placeholderId = uuidv7();
  const compressedContent = normalizeCompressedContent(
    compression.compressedContent,
  );

  if (supportAttachment) {
    compressedMsg = {
      id: placeholderId,
      role: "model",
      timestamp: Date.now(),
      content:
        "The context has been compressed. If you need to view the previous conversation, please read the attached content.",
      attachments: [
        {
          id: uuidv7(),
          mimeType: "text/plain",
          fileName: "conversation_history.txt",
          data: textToBase64(compressedContent),
        },
      ],
    };
  } else {
    compressedMsg = {
      id: placeholderId,
      role: "model",
      timestamp: Date.now(),
      content: `The context has been compressed. To retrieve previous conversation content, please read the following conversation summary:\n\n${compressedContent}`,
    };
  }

  // 4. Assemble Final Array
  // [First User] -> [Compressed Placeholder] -> [Uncompressed Tail]
  // Note: If firstUserMsg is actually part of the tail (unlikely if compression exists), we shouldn't duplicate it.
  // Since compression usually happens after 12 turns, firstUserMsg is definitely compressed.

  const result: Message[] = [];
  if (firstUserMsg) {
    result.push(firstUserMsg);
  }
  result.push(compressedMsg);
  result.push(...uncompressedTail);

  return result;
};

// Background task to calculate new compression if needed
export const performBackgroundCompression = async (
  allMessages: Message[],
  currentCompression: Session["compression"],
  model: string,
  signal?: AbortSignal,
): Promise<Session["compression"] | null> => {
  const { thresholdMessages, keepMessages } = getCompressionConfig();

  // 1. Identify Uncompressed Segment
  let startIndex = 0;
  let oldContent = "";
  let oldIncludedMemoryIds: string[] = [];

  if (currentCompression) {
    const lastIdx = allMessages.findIndex(
      (m) => m.id === currentCompression.lastCompressedMessageId,
    );
    if (lastIdx !== -1) {
      startIndex = lastIdx + 1;
      const normalizedPrevious = normalizeCompressedContentWithMemoryIds({
        content: currentCompression.compressedContent,
        memoryIds: currentCompression.includedMemoryIds || [],
      });
      oldContent = normalizedPrevious.content;
      oldIncludedMemoryIds = normalizedPrevious.representedMemoryIds;
    }
  } else {
    // If no previous compression, start from index 1 (keeping index 0 User safe)
    startIndex = 1;
  }

  const uncompressedMessages = allMessages.slice(startIndex);

  // 2. Check Threshold
  if (uncompressedMessages.length < thresholdMessages + keepMessages) {
    return null; // No new compression needed
  }

  // 3. Define chunk to compress
  // We keep the last 'keepMessages' raw. Compress everything else in the uncompressed segment.
  const splitIndex = uncompressedMessages.length - keepMessages;
  const messagesToCompress = uncompressedMessages.slice(0, splitIndex);
  if (messagesToCompress.length === 0) return null;

  // 4. Generate Content
  const compressionSource = buildCompressionSource(messagesToCompress);
  if (!compressionSource.lastIncludedMessageId) return null;
  const textToCompress = compressionSource.text;

  const { modelMetadata, customModelMetadata } = useSettingsStore.getState();
  const { providerId, modelName } = parseModelString(model);
  const meta = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const supportAttachment = meta ? (meta.attachment ?? false) : true;

  let nextCompressedContent = textToCompress;

  if (!supportAttachment) {
    // Generate Summary
    const summary = await generateSummary(textToCompress, signal);
    nextCompressedContent = oldContent
      ? `[New Summary Segment]:\n${summary}`
      : summary;
  }

  const mergedCompression = mergeCompressedContentWithMemoryIds({
    previousContent: oldContent,
    previousMemoryIds: oldIncludedMemoryIds,
    nextContent: nextCompressedContent,
    nextMemoryIds: compressionSource.includedMemoryIds,
  });

  return {
    compressedContent: mergedCompression.content,
    lastCompressedMessageId: compressionSource.lastIncludedMessageId,
    includedMemoryIds: mergedCompression.representedMemoryIds,
  };
};

// Simple streaming text generation (for prompts without complex history)
export const streamGenerateContent = async (
  model: string,
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const { providerId, modelName } = parseModelString(model);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider found");

  if (shouldUseDirectCall(provider)) {
    let fullText = "";
    try {
      const [{ runChatStream }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/runChatStream"),
        getBrowserProviderRuntime(),
        buildDirectProviderConfig(provider),
      ]);

      await runChatStream({
        provider: directProvider,
        modelName,
        history: [],
        newMessage: prompt,
        attachments: [],
        config: { temperature: 0.7 },
        signal,
        runtime,
        send: (message) => {
          if (message.type === "content") {
            fullText += message.content;
            onChunk(fullText);
          }
        },
      });

      if (signal?.aborted) throw createAbortError(signal);
      return fullText;
    } catch (error) {
      if (isAbortError(error, signal)) throw createAbortError(signal);
      const normalizedError = describeDirectCallError(error, provider);
      logDevError("Stream generate error:", normalizedError);
      throw normalizedError;
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(provider, signal),
          modelName,
          prompt,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Generate request failed"),
      );
    }

    reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    const processEvent = (event: string): boolean => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");

      if (!data) return false;
      if (data === "[DONE]") return true;

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new ChatStreamEventError(
          "The response stream contained malformed data.",
          "MALFORMED_CHAT_STREAM",
        );
      }

      switch (parsed.type) {
        case "content":
          fullText += parsed.content;
          onChunk(fullText);
          return false;
        case "error":
          throw createChatStreamEventError(parsed);
        case "done":
          return true;
        default:
          return false;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (processEvent(event)) {
          await reader.cancel().catch(() => undefined);
          return fullText;
        }
      }
    }

    if (buffer.trim() && processEvent(buffer)) return fullText;
    if (signal?.aborted) throw createAbortError(signal);
    throw new IncompleteChatStreamError();
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    if (isAbortError(error, signal)) throw createAbortError(signal);
    logDevError("Stream generate error:", error);
    throw error;
  }
};

export const streamGenerateToolCall = async (
  model: string,
  prompt: string,
  tools: ChatToolDefinition[],
  signal?: AbortSignal,
): Promise<ToolCall | null> => {
  if (tools.length === 0) return null;

  const { providerId, modelName } = parseModelString(model);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) {
    logDevWarn("Skill tool selection skipped: no provider found.");
    return null;
  }

  if (shouldUseDirectCall(provider)) {
    let pendingToolCall: ToolCall | null = null;
    try {
      const [{ runChatStream }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/runChatStream"),
        getBrowserProviderRuntime(),
        buildDirectProviderConfig(provider),
      ]);

      await runChatStream({
        provider: directProvider,
        modelName,
        history: [],
        newMessage: prompt,
        attachments: [],
        config: { temperature: 0 },
        tools,
        signal,
        runtime,
        send: (message) => {
          if (message.type === "tool_call") {
            pendingToolCall = message.toolCall || null;
          }
        },
      });

      if (signal?.aborted) throw createAbortError(signal);
      return pendingToolCall;
    } catch (error) {
      if (isAbortError(error, signal)) throw createAbortError(signal);
      logDevWarn(
        "Skill tool selection failed:",
        describeDirectCallError(error, provider),
      );
      return null;
    }
  }

  try {
    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(provider, signal),
          modelName,
          history: [],
          newMessage: prompt,
          attachments: [],
          config: { temperature: 0 },
          tools,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Tool selection failed"),
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let pendingToolCall: ToolCall | null = null;

    const readEvent = (event: string): "done" | "continue" => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");

      if (!data) return "continue";
      if (data === "[DONE]") return "done";

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new ChatStreamEventError(
          "The response stream contained malformed data.",
          "MALFORMED_CHAT_STREAM",
        );
      }
      switch (parsed.type) {
        case "tool_call":
          pendingToolCall = parsed.toolCall || null;
          return "continue";
        case "error":
          throw createChatStreamEventError(parsed);
        case "done":
          return "done";
        default:
          return "continue";
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (readEvent(event) === "done") {
          await reader.cancel().catch(() => undefined);
          return pendingToolCall;
        }
      }
    }

    if (buffer.trim()) {
      if (readEvent(buffer) === "done") return pendingToolCall;
    }

    if (signal?.aborted) throw createAbortError(signal);
    throw new IncompleteChatStreamError();
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError(signal);
    if (
      error instanceof IncompleteChatStreamError ||
      error instanceof ChatStreamEventError
    ) {
      throw error;
    }
    logDevWarn("Skill tool selection failed:", error);
    return null;
  }
};

export const performBackgroundMemoryExtraction = async ({
  sessionId,
  userMessage,
  assistantMessage,
  signal,
}: {
  sessionId: string;
  userMessage: Pick<Message, "id" | "content">;
  assistantMessage: Pick<Message, "id" | "content">;
  signal?: AbortSignal;
}) => {
  if (signal?.aborted) throw createAbortError(signal);
  const state = useMemoryStore.getState();
  const { _hasHydrated, settings } = state;
  if (
    isBrowserMemoryStorePendingHydration(_hasHydrated) ||
    !settings.enabled ||
    !settings.autoRecordEnabled
  ) {
    return [];
  }
  if (!userMessage.content.trim() || !assistantMessage.content.trim()) {
    return [];
  }

  const toolCall = await streamGenerateToolCall(
    getTaskModel("memory"),
    createMemoryExtractionPrompt({
      userMessage: userMessage.content,
      assistantMessage: assistantMessage.content,
    }),
    [coerceToolDefinition(MEMORY_RECORD_TOOL)],
    signal,
  );
  if (signal?.aborted) throw createAbortError(signal);

  if (!toolCall || toolCall.name !== MEMORY_RECORD_TOOL_NAME) return [];

  const memories = parseMemoryRecordToolCall(toolCall.args, {
    source: "ai",
    sourceSessionId: sessionId,
    sourceMessageIds: [userMessage.id, assistantMessage.id],
  });
  if (memories.length === 0) return [];
  if (signal?.aborted) throw createAbortError(signal);

  const saved = useMemoryStore.getState().upsertMemories(memories);
  const nextState = useMemoryStore.getState();
  if (
    nextState.settings.enabled &&
    nextState.settings.dreamEnabled &&
    nextState.memories.length > nextState.settings.triggerCount
  ) {
    void performMemoryDream({ force: false, signal }).catch((error) => {
      if (!isAbortError(error, signal)) {
        logDevWarn("Memory dream failed:", error);
      }
    });
  }

  return saved;
};

export const performMemoryDream = async ({
  force = false,
  signal,
}: {
  force?: boolean;
  signal?: AbortSignal;
} = {}) => {
  if (signal?.aborted) throw createAbortError(signal);
  const state = useMemoryStore.getState();
  const { _hasHydrated, settings, memories, dreamStatus } = state;
  if (
    isBrowserMemoryStorePendingHydration(_hasHydrated) ||
    !settings.enabled ||
    !settings.dreamEnabled ||
    dreamStatus.isRunning
  ) {
    return null;
  }
  if (memories.length <= settings.targetCount) return null;
  if (!force && memories.length <= settings.triggerCount) return null;

  state.startDream();
  try {
    const targetCount = Math.min(
      settings.targetCount,
      MEMORY_LIMITS.targetCount,
    );
    const toolCall = await streamGenerateToolCall(
      getTaskModel("memory"),
      createMemoryDreamPrompt({ memories, targetCount }),
      [coerceToolDefinition(MEMORY_DREAM_TOOL)],
      signal,
    );

    if (!toolCall || toolCall.name !== MEMORY_DREAM_TOOL_NAME) {
      throw new Error("Memory dream did not return a valid tool call.");
    }

    const dreamed = parseMemoryDreamToolCall(toolCall.args, {
      targetCount,
    });

    if (dreamed.length === 0 || dreamed.length > targetCount) {
      throw new Error("Memory dream returned an invalid memory set.");
    }

    if (signal?.aborted) throw createAbortError(signal);
    useMemoryStore.getState().replaceMemories(dreamed);
    useMemoryStore.getState().finishDream();
    return dreamed;
  } catch (error) {
    if (isAbortError(error, signal)) {
      useMemoryStore.getState().finishDream();
      throw createAbortError(signal);
    }
    const message = error instanceof Error ? error.message : String(error);
    useMemoryStore.getState().finishDream(message);
    logDevWarn("Memory dream failed:", error);
    return null;
  }
};
