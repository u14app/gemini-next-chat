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
  AgentUserInputController,
  Plugin,
  AgentMemoryScope,
} from "@/types";
import { useSettingsStore, getTaskModel } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { v7 as uuidv7 } from "uuid";
import { executePluginFunction } from "@/utils/pluginUtils";
import { getEnabledPluginFunctions } from "@/lib/plugin/resolve";
import { getPluginFunctionInvocationPolicy } from "@/lib/plugin/risk";
import type {
  PluginFunction,
  PluginFunctionRisk,
  ToolApprovalProfile,
  ToolInvocationPolicy,
} from "@/lib/plugin/types";
import {
  buildForcedToolDirective,
  ForcedPluginInvocationError,
  mergeForcedPluginIds,
} from "@/lib/chat/forcedInvocation";
import {
  createPluginFunctionFingerprint,
  createToolApprovalIdentity,
  evaluateToolInvocationApproval,
  normalizeToolConfirmationDecision,
  redactSensitiveToolArgs,
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
  resolveBuiltinToolInvocationPolicy,
} from "./chat/builtinTools";
import {
  createToolDiscoveryBindings,
  type DiscoverableToolEntry,
} from "./chat/builtinTools/toolDiscovery";
import { createMcpCapabilityBindings } from "./chat/builtinTools/mcpCapabilities";
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
import { mapWithConcurrencyGroups } from "@/lib/utils/concurrency";
import { boundHistoryForRequest } from "@/lib/chat/requestContextBudget";
import {
  appendAgentSystemInstruction,
  buildAgentSystemInstruction,
} from "@/lib/agent/systemPrompt";
import {
  validateToolArguments,
  validateToolOutput,
} from "@/lib/agent/toolSchema";
import {
  commitToolExecution,
  collectAgentEvidenceRecords,
  createAgentRun,
  failToolExecution,
  getExceededAgentRunBudget,
  getToolReplayDecision,
  hashToolArguments,
  isAgentWorkspaceAvailable,
  markToolExecutionEffectUnknown,
  markToolExecutionRunning,
  prepareToolExecution,
  recordAgentEvidence,
  recordAgentRoundCompleted,
  recoverInterruptedToolExecutions,
  transitionAgentRunStatus,
  type AgentRun,
  type ResolvedAgentRunBudget,
} from "@/lib/agent";
import {
  isToolResultFailure,
  normalizeToolResultEnvelope,
  type ToolResultTrust,
} from "@/lib/agent/toolResult";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import {
  acquireAgentRunLease,
  checkpointAgentRunLease,
  releaseAgentRunLease,
  AgentRunLeaseConflictError,
  type AgentRunLease,
} from "@/services/agent/runLease";
import type { RagQueryError } from "@/lib/knowledge/retrieveKnowledgeSources";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";
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

interface NormalizedRoundUsage {
  format: "openai" | "gemini";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function finiteTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function normalizeRoundUsage(
  payload: ChatUsagePayload,
): NormalizedRoundUsage | null {
  if (payload.usage && typeof payload.usage === "object") {
    const usage = payload.usage as Record<string, unknown>;
    const promptTokens = finiteTokenCount(usage.prompt_tokens);
    const completionTokens = finiteTokenCount(usage.completion_tokens);
    return {
      format: "openai",
      promptTokens,
      completionTokens,
      totalTokens: Math.max(
        promptTokens + completionTokens,
        finiteTokenCount(usage.total_tokens),
      ),
    };
  }
  if (payload.usageMetadata && typeof payload.usageMetadata === "object") {
    const usage = payload.usageMetadata as Record<string, unknown>;
    const promptTokens = finiteTokenCount(usage.promptTokenCount);
    const completionTokens = finiteTokenCount(usage.candidatesTokenCount);
    return {
      format: "gemini",
      promptTokens,
      completionTokens,
      totalTokens: Math.max(
        promptTokens + completionTokens,
        finiteTokenCount(usage.totalTokenCount),
      ),
    };
  }
  return null;
}

function toUsagePayload(usage: NormalizedRoundUsage): ChatUsagePayload {
  return usage.format === "openai"
    ? {
        usage: {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
        },
      }
    : {
        usageMetadata: {
          promptTokenCount: usage.promptTokens,
          candidatesTokenCount: usage.completionTokens,
          totalTokenCount: usage.totalTokens,
        },
      };
}

function toLegacyRisk(policy: ToolInvocationPolicy): PluginFunctionRisk {
  if (
    policy.effects.includes("local_destructive") ||
    policy.effects.includes("external_destructive")
  ) {
    return "destructive";
  }
  if (policy.effects.includes("external_write")) return "write";
  if (policy.origin === "mcp") return "external";
  if (policy.effects.includes("local_write")) return "write";
  return "read";
}

function getToolResultTrust(policy: ToolInvocationPolicy): ToolResultTrust {
  return policy.origin === "builtin" &&
    !policy.effects.some((effect) =>
      ["network_read", "external_write", "external_destructive"].includes(
        effect,
      ),
    )
    ? "internal"
    : "external_untrusted";
}

function createRuntimeToolFailure(
  toolName: string,
  error: { code: string; message: string; recoverable: boolean },
) {
  return normalizeToolResultEnvelope(
    { ok: false, error },
    {
      trust: "internal",
      provenance: {
        origin: "runtime",
        toolName,
        retrievedAt: Date.now(),
      },
    },
  );
}

function getToolTargetScope(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "*";
  const input = args as Record<string, unknown>;
  for (const key of ["url", "uri", "baseUrl"]) {
    const value = input[key];
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.hash = "";
        const redacted = redactSensitiveToolArgs(url.toString());
        return typeof redacted === "string" ? redacted : url.origin;
      }
    } catch {
      // Continue to path/resource scopes.
    }
  }
  for (const key of ["path", "from", "to"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return `workspace:${value.trim().slice(0, 512)}`;
    }
  }
  const resourceId = input.id;
  return typeof resourceId === "string" && resourceId.trim()
    ? `resource:${resourceId.trim().slice(0, 512)}`
    : "*";
}

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
  usage?: NormalizedRoundUsage;
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
  /** Skills the current session/Profile explicitly allows Agent mode to load. */
  allowedSkillIds?: string[];
  /** Optional Agent Profile allowlist. Empty means no additional restriction. */
  allowedToolIds?: string[];
  approvalMode?: ToolApprovalProfile;
  agentBudget?: Partial<ResolvedAgentRunBudget>;
  agentRun?: {
    id: string;
    userMessageId?: string;
    modelMessageId?: string;
  };
  resumeAgentRun?: boolean;
  userInputController?: AgentUserInputController;
  memoryScopes?: AgentMemoryScope[];
  memoryScopeIds?: {
    workspace?: string;
    agent?: string;
    session?: string;
  };
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
  const { providerId, modelName } = parseModelString(model);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider available");
  const selectedModelMetadata = resolveModelMetadata(modelName, providerId);
  const toolCallsSupported = supportsToolCalls(selectedModelMetadata);
  const agentModeEnabled = config?.useAgentMode === true && toolCallsSupported;
  let agentRun: AgentRun | null = null;
  if (agentModeEnabled) {
    if (options?.resumeAgentRun && options.agentRun?.id) {
      await useAgentRunStore.getState().loadSessionRuns(sessionId);
      const existing =
        useAgentRunStore.getState().runsById[options.agentRun.id];
      if (!existing || existing.sessionId !== sessionId) {
        throw new Error("The interrupted Agent run is no longer available.");
      }
      if (existing.status !== "interrupted") {
        throw new Error(
          existing.stop?.reason === "effect_unknown"
            ? "The Agent run has an unknown side effect and cannot be resumed automatically."
            : `Agent run ${existing.id} cannot resume from ${existing.status}.`,
        );
      }
      agentRun = {
        ...transitionAgentRunStatus(existing, "running"),
        model,
        ...(options.agentRun.userMessageId
          ? { userMessageId: options.agentRun.userMessageId }
          : {}),
        ...(options.agentRun.modelMessageId
          ? { modelMessageId: options.agentRun.modelMessageId }
          : {}),
      };
    } else {
      agentRun = createAgentRun({
        id: options?.agentRun?.id,
        sessionId,
        userMessageId: options?.agentRun?.userMessageId,
        modelMessageId: options?.agentRun?.modelMessageId,
        model,
        budget: options?.agentBudget,
      });
    }
  }
  let agentRunLease: AgentRunLease | undefined;
  let agentRunUpdateQueue: Promise<void> = Promise.resolve();
  const updateAgentRun = async (
    update: (current: AgentRun) => AgentRun,
  ): Promise<void> => {
    if (!agentRun) return;
    agentRunUpdateQueue = agentRunUpdateQueue
      .catch(() => undefined)
      .then(async () => {
        if (!agentRun) return;
        agentRun = update(agentRun);
        await useAgentRunStore.getState().upsertRun(agentRun);
        if (
          agentRunLease &&
          agentRun.status !== "completed" &&
          agentRun.status !== "failed" &&
          agentRun.status !== "cancelled"
        ) {
          try {
            agentRunLease = checkpointAgentRunLease(agentRunLease);
          } catch (error) {
            agentRunLease = undefined;
            throw error;
          }
        }
      });
    await agentRunUpdateQueue;
  };
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
  const {
    installedPlugins,
    pluginConfigs,
    installedSkills = [],
  } = useSettingsStore.getState();
  const allowedSkillIds = new Set(options?.allowedSkillIds || []);
  const agentSkills = installedSkills.filter((skill) =>
    allowedSkillIds.has(skill.id),
  );
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
    installedSkills: agentSkills,
    memoryScopes: options?.memoryScopes,
    memoryScopeIds: options?.memoryScopeIds,
    workspaceAvailable: isAgentWorkspaceAvailable(),
  });
  const allowedToolIds = new Set(options?.allowedToolIds || []);
  const restrictTools = allowedToolIds.size > 0;
  const allowedBuiltinDefinitions = restrictTools
    ? collectedBuiltinTools.definitions.filter((definition) =>
        allowedToolIds.has(definition.function.name),
      )
    : collectedBuiltinTools.definitions;
  const builtinBindingsByName = new Map(
    [...collectedBuiltinTools.bindingsByName].filter(
      ([name]) => !restrictTools || allowedToolIds.has(name),
    ),
  );
  tools.push(...allowedBuiltinDefinitions);
  for (const name of builtinBindingsByName.keys()) {
    toolNames.add(name);
  }

  const offeredPluginFunctionsByName = new Map<
    string,
    { plugin: Plugin; functionDef: PluginFunction }
  >();
  const discoverableToolEntries: DiscoverableToolEntry[] = [];

  if (
    !options?.disableTools &&
    toolCallsSupported &&
    effectiveActivePlugins.length > 0
  ) {
    if (agentModeEnabled) {
      const activeMcpServers = effectiveActivePlugins.flatMap((pluginId) => {
        const plugin = installedPlugins.find((item) => item.id === pluginId);
        return plugin?.source === "mcp" ? [plugin] : [];
      });
      for (const binding of createMcpCapabilityBindings(activeMcpServers)) {
        const name = binding.definition.function.name;
        if (
          tools.length >= MAX_CHAT_TOOLS_PER_REQUEST ||
          toolNames.has(name) ||
          (restrictTools && !allowedToolIds.has(name))
        ) {
          continue;
        }
        builtinBindingsByName.set(name, binding);
        tools.push(binding.definition);
        toolNames.add(name);
      }
    }
    const candidates = effectiveActivePlugins.flatMap((pluginId) => {
      const plugin = installedPlugins.find((item) => item.id === pluginId);
      if (!plugin) return [];
      return getEnabledPluginFunctions(plugin, pluginConfigs[pluginId]).map(
        (functionDef) => ({ plugin, functionDef }),
      );
    });
    const nameCounts = candidates.reduce((counts, candidate) => {
      counts.set(
        candidate.functionDef.name,
        (counts.get(candidate.functionDef.name) || 0) + 1,
      );
      return counts;
    }, new Map<string, number>());
    const claimedAliases = new Set(toolNames);
    const createAlias = (pluginId: string, functionName: string) => {
      const safeProvider =
        pluginId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24) || "provider";
      const safeFunction = functionName
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 36);
      const base = `${safeProvider}__${safeFunction}`.slice(0, 64);
      let alias = base;
      let suffix = 2;
      while (claimedAliases.has(alias)) {
        const marker = `_${suffix}`;
        alias = `${base.slice(0, 64 - marker.length)}${marker}`;
        suffix += 1;
      }
      return alias;
    };

    for (const { plugin, functionDef } of candidates) {
      const hasCollision =
        (nameCounts.get(functionDef.name) || 0) > 1 ||
        claimedAliases.has(functionDef.name);
      const offeredName = hasCollision
        ? createAlias(plugin.id, functionDef.name)
        : functionDef.name;
      claimedAliases.add(offeredName);
      const definition: ChatToolDefinition = {
        type: "function",
        function: {
          name: offeredName,
          description: functionDef.description,
          parameters: functionDef.parameters,
        },
      };
      offeredPluginFunctionsByName.set(offeredName, { plugin, functionDef });
      if (
        restrictTools &&
        !requestedForcedPluginIds.includes(plugin.id) &&
        !allowedToolIds.has(offeredName) &&
        !allowedToolIds.has(functionDef.name)
      ) {
        continue;
      }
      discoverableToolEntries.push({
        name: offeredName,
        originalName: functionDef.name,
        providerId: plugin.id,
        providerTitle: plugin.title,
        description: functionDef.description,
        definition,
      });
    }

    const loadEntries = (names: string[]) => {
      const loaded: string[] = [];
      const alreadyLoaded: string[] = [];
      const unavailable: string[] = [];
      for (const name of names) {
        if (toolNames.has(name)) {
          alreadyLoaded.push(name);
          continue;
        }
        const entry = discoverableToolEntries.find(
          (candidate) => candidate.name === name,
        );
        if (!entry || tools.length >= MAX_CHAT_TOOLS_PER_REQUEST) {
          unavailable.push(name);
          continue;
        }
        tools.push(entry.definition);
        toolNames.add(name);
        loaded.push(name);
      }
      return {
        loaded,
        alreadyLoaded,
        unavailable,
        capacityRemaining: Math.max(
          0,
          MAX_CHAT_TOOLS_PER_REQUEST - tools.length,
        ),
      };
    };

    if (agentModeEnabled && discoverableToolEntries.length > 0) {
      for (const binding of createToolDiscoveryBindings({
        entries: discoverableToolEntries,
        isLoaded: (name) => toolNames.has(name),
        load: loadEntries,
      })) {
        const name = binding.definition.function.name;
        if (
          tools.length >= MAX_CHAT_TOOLS_PER_REQUEST ||
          toolNames.has(name) ||
          (restrictTools && !allowedToolIds.has(name))
        ) {
          continue;
        }
        builtinBindingsByName.set(name, binding);
        tools.push(binding.definition);
        toolNames.add(name);
      }
    }

    for (const pluginId of effectiveActivePlugins) {
      const entries = discoverableToolEntries.filter(
        (entry) => entry.providerId === pluginId,
      );
      const mustLoad =
        !agentModeEnabled ||
        requestedForcedPluginIds.includes(pluginId) ||
        (restrictTools && entries.length > 0);
      const loadedNames = mustLoad
        ? [...loadEntries(entries.map((entry) => entry.name)).loaded]
        : [];
      registeredPluginFunctions.set(
        pluginId,
        entries
          .filter((entry) => loadedNames.includes(entry.name))
          .map((entry) => ({
            ...offeredPluginFunctionsByName.get(entry.name)!.functionDef,
            name: entry.name,
          })),
      );
    }
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

  const hasAgentBuiltin = [...builtinBindingsByName.values()].some(
    (binding) => binding.agentOnly,
  );
  const agentSystemInstruction =
    agentModeEnabled && hasAgentBuiltin
      ? appendAgentSystemInstruction(
          userSystemInstruction,
          buildAgentSystemInstruction({
            toolNames: tools.map((tool) => tool.function.name),
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

  if (agentRun) {
    const lease = acquireAgentRunLease({ sessionId, runId: agentRun.id });
    if (!lease.acquired) {
      agentRun = transitionAgentRunStatus(agentRun, "failed", {
        stop: {
          reason: "runtime_error",
          error: {
            code: "AGENT_RUN_LEASE_CONFLICT",
            message: "Another browser tab currently owns this Agent session.",
            recoverable: true,
          },
        },
      });
      await useAgentRunStore.getState().upsertRun(agentRun);
      throw new AgentRunLeaseConflictError(lease.holder);
    }
    agentRunLease = lease.lease;
    await useAgentRunStore.getState().upsertRun(agentRun);
  }

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
    const maxToolRounds =
      agentRun?.budget.maxToolRounds ?? PLUGIN_EXECUTION_LIMITS.maxToolRounds;
    const maxTotalToolCalls =
      agentRun?.budget.maxToolCalls ??
      PLUGIN_EXECUTION_LIMITS.maxTotalToolCalls;
    let executedToolCallCount = 0;
    let cumulativeUsage: NormalizedRoundUsage | null = null;
    const functionFingerprintCache = new Map<string, Promise<string>>();
    const pendingSkillInvocations = new Map<string, AppliedSkillInvocation>();
    const emittedSkillIds = new Set<string>();
    let skillAllowedToolNames: Set<string> | null = null;
    const compactLargeToolResult = async (
      toolCall: ToolCall,
      value: unknown,
    ): Promise<{
      value: unknown;
      resultRef?: { kind: "workspace_file"; id: string; contentHash: string };
    }> => {
      if (!agentModeEnabled) return { value };
      let serialized: string;
      try {
        serialized = JSON.stringify(value, null, 2);
      } catch {
        return { value };
      }
      if (serialized.length <= 48_000) return { value };

      const safeCallId =
        toolCall.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || uuidv7();
      const path = `tool-results/${safeCallId}.json`;
      const written = await writeWorkspaceText(
        sessionId,
        path,
        serialized,
        "create",
      );
      if (!written.ok) {
        return {
          value: {
            truncated: true,
            summary:
              "The tool returned a large result that could not be persisted in the workspace.",
            excerpt: serialized.slice(0, 8_000),
            originalCharacters: serialized.length,
          },
        };
      }
      return {
        value: {
          truncated: true,
          summary: `Large tool result stored in workspace file ${path}.`,
          workspacePath: path,
          revision: written.value.revision,
          contentHash: written.value.contentHash,
          originalCharacters: serialized.length,
          excerpt: serialized.slice(0, 4_000),
        },
        resultRef: {
          kind: "workspace_file",
          id: path,
          contentHash: written.value.contentHash,
        },
      };
    };

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
        if (agentRun?.status === "running") {
          await updateAgentRun((current) =>
            transitionAgentRunStatus(current, "completed", {
              stop: { reason: "completed" },
            }),
          );
        }
        return committedContent;
      }

      outputBlockBuilder.appendText(message);
      onChunk(
        committedContent + message,
        committedReasoning,
        outputBlockBuilder.getBlocks(),
      );
      if (agentRun?.status === "running") {
        await updateAgentRun((current) =>
          transitionAgentRunStatus(current, "completed", {
            stop: { reason: "completed" },
          }),
        );
      }
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
          result: createRuntimeToolFailure(current.name, {
            code,
            message,
            recoverable: true,
          }),
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
      let roundUsage: NormalizedRoundUsage | null = null;

      const getRoundPayload = (): ChatStreamRoundPayload => ({
        content: fullContent,
        reasoning: fullReasoning,
        toolCalls: roundToolCalls,
        ...(roundUsage ? { usage: roundUsage } : {}),
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
            const nextUsage = normalizeRoundUsage({
              ...(parsed.usage ? { usage: parsed.usage } : {}),
              ...(parsed.usageMetadata
                ? { usageMetadata: parsed.usageMetadata }
                : {}),
            });
            if (nextUsage) {
              const priorRound = roundUsage;
              const priorCumulative =
                cumulativeUsage?.format === nextUsage.format
                  ? cumulativeUsage
                  : null;
              cumulativeUsage = {
                format: nextUsage.format,
                promptTokens:
                  (priorCumulative?.promptTokens ?? 0) -
                  (priorRound?.promptTokens ?? 0) +
                  nextUsage.promptTokens,
                completionTokens:
                  (priorCumulative?.completionTokens ?? 0) -
                  (priorRound?.completionTokens ?? 0) +
                  nextUsage.completionTokens,
                totalTokens:
                  (priorCumulative?.totalTokens ?? 0) -
                  (priorRound?.totalTokens ?? 0) +
                  nextUsage.totalTokens,
              };
              roundUsage = nextUsage;
              onUsage?.(toUsagePayload(cumulativeUsage));
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
      const offeredToolNamesForRound = new Set(
        requestTools.map((tool) => tool.function.name),
      );
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
      if (agentRun) {
        const usage = result.usage;
        await updateAgentRun((current) =>
          recordAgentRoundCompleted(current, {
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            hasToolCalls: pendingToolCalls.length > 0,
          }),
        );
      }

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
        if (agentRun?.status === "running") {
          await updateAgentRun((current) =>
            transitionAgentRunStatus(current, "completed", {
              stop: { reason: "completed" },
            }),
          );
        }
        return committedContent + result.content;
      }

      const exceededBudget = agentRun
        ? getExceededAgentRunBudget(agentRun)
        : round >= maxToolRounds
          ? "tool_rounds"
          : null;
      if (exceededBudget) {
        pendingToolCalls.forEach((toolCall) => {
          const skippedToolCall: ToolCall = {
            ...toolCall,
            status: "skipped",
            isError: true,
            result: createRuntimeToolFailure(toolCall.name, {
              code: "AGENT_TOOL_ROUND_BUDGET_EXHAUSTED",
              message:
                "Tool execution was skipped because the maximum Tool-call rounds were reached.",
              recoverable: true,
            }),
          };
          outputBlockBuilder.updateToolCall(skippedToolCall);
          emitOutputBlocks();
          upsertToolCall(skippedToolCall);
        });
        if (agentRun?.status === "running") {
          await updateAgentRun((current) =>
            transitionAgentRunStatus(current, "failed", {
              stop: {
                reason: "budget_exhausted",
                budgetDimension: exceededBudget,
                error: {
                  code: "AGENT_BUDGET_EXHAUSTED",
                  message: `Agent execution reached its ${exceededBudget} budget.`,
                  recoverable: true,
                },
              },
            }),
          );
        }
        return committedContent + result.content;
      }

      const remainingToolBudget = Math.max(
        0,
        maxTotalToolCalls - executedToolCallCount,
      );
      const toolCallsToExecute = pendingToolCalls.slice(0, remainingToolBudget);
      const budgetSkippedToolCalls = pendingToolCalls
        .slice(remainingToolBudget)
        .map((toolCall): ToolCall => ({
          ...toolCall,
          status: "skipped",
          isError: true,
          result: createRuntimeToolFailure(toolCall.name, {
            code: "AGENT_TOOL_CALL_BUDGET_EXHAUSTED",
            message:
              "Tool execution was skipped because the total Tool-call budget was reached.",
            recoverable: true,
          }),
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
        if (!offeredToolNamesForRound.has(toolCall.name)) {
          const failed: ToolCall = {
            ...toolCall,
            status: "error",
            isError: true,
            errorInfo: {
              code: "TOOL_FUNCTION_NOT_FOUND",
              message: `Function ${toolCall.name} was not offered for this request.`,
              recoverable: true,
            },
            result: createRuntimeToolFailure(toolCall.name, {
              code: "TOOL_FUNCTION_NOT_FOUND",
              message: `Function ${toolCall.name} was not offered for this request.`,
              recoverable: true,
            }),
          };
          outputBlockBuilder.updateToolCall(failed);
          emitOutputBlocks();
          upsertToolCall(failed);
          nonExecutedToolCalls.push(failed);
          continue;
        }

        const builtinBinding = builtinBindingsByName.get(toolCall.name);
        const resolved = builtinBinding
          ? null
          : offeredPluginFunctionsByName.get(toolCall.name) || null;
        if (!builtinBinding && !resolved) {
          const failed: ToolCall = {
            ...toolCall,
            status: "error",
            isError: true,
            errorInfo: {
              code: "TOOL_FUNCTION_NOT_FOUND",
              message: `Function ${toolCall.name} is no longer available.`,
              recoverable: true,
            },
            result: createRuntimeToolFailure(toolCall.name, {
              code: "TOOL_FUNCTION_NOT_FOUND",
              message: `Function ${toolCall.name} is no longer available.`,
              recoverable: true,
            }),
          };
          outputBlockBuilder.updateToolCall(failed);
          emitOutputBlocks();
          upsertToolCall(failed);
          nonExecutedToolCalls.push(failed);
          continue;
        }

        const parameters = builtinBinding
          ? builtinBinding.definition.function.parameters
          : resolved!.functionDef.parameters;
        const validation = validateToolArguments(parameters, toolCall.args);
        if (!validation.ok) {
          const failed: ToolCall = {
            ...toolCall,
            ...(resolved
              ? {
                  pluginId: resolved.plugin.id,
                  pluginTitle: resolved.plugin.title,
                }
              : {}),
            status: "error",
            isError: true,
            errorInfo: {
              code: validation.error.code,
              message: validation.error.message,
              recoverable: true,
            },
            result: createRuntimeToolFailure(toolCall.name, {
              ...validation.error,
              recoverable: true,
            }),
          };
          outputBlockBuilder.updateToolCall(failed);
          emitOutputBlocks();
          upsertToolCall(failed);
          nonExecutedToolCalls.push(failed);
          continue;
        }

        const policy = builtinBinding
          ? resolveBuiltinToolInvocationPolicy(builtinBinding, toolCall.args)
          : getPluginFunctionInvocationPolicy(resolved!.functionDef, {
              args: toolCall.args,
              origin: resolved!.plugin.source === "mcp" ? "mcp" : "plugin",
            });
        const risk = toLegacyRisk(policy);
        const pluginId = resolved?.plugin.id || "builtin";
        const pluginTitle = resolved?.plugin.title || "Agent built-ins";
        const functionName = resolved?.functionDef.name || toolCall.name;
        let functionFingerprint: string;
        if (resolved) {
          const fingerprintCacheKey = `${pluginId}\u0000${functionName}`;
          let fingerprintPromise =
            functionFingerprintCache.get(fingerprintCacheKey);
          if (!fingerprintPromise) {
            fingerprintPromise = createPluginFunctionFingerprint(
              resolved.plugin,
              resolved.functionDef,
            );
            functionFingerprintCache.set(
              fingerprintCacheKey,
              fingerprintPromise,
            );
          }
          functionFingerprint = await fingerprintPromise;
        } else {
          functionFingerprint = await hashToolArguments({
            name: functionName,
            descriptor: builtinBinding!.descriptor,
          });
        }

        const argumentsHash = agentRun
          ? await hashToolArguments(toolCall.args)
          : undefined;
        if (agentRun && argumentsHash) {
          const priorWithSameArguments = agentRun.toolExecutions.find(
            (record) =>
              record.toolName === toolCall.name &&
              record.argumentsHash === argumentsHash,
          );
          if (
            priorWithSameArguments &&
            priorWithSameArguments.definitionFingerprint !== functionFingerprint
          ) {
            const failed: ToolCall = {
              ...toolCall,
              pluginId,
              pluginTitle,
              functionFingerprint,
              risk,
              invocationPolicy: policy,
              status: "error",
              isError: true,
              errorInfo: {
                code: "TOOL_DEFINITION_CHANGED",
                message:
                  "The Tool definition changed during this run. Review the updated capability before trying again.",
                recoverable: true,
              },
              result: normalizeToolResultEnvelope(
                {
                  ok: false,
                  error: {
                    code: "TOOL_DEFINITION_CHANGED",
                    message:
                      "The Tool definition changed during this run. Review the updated capability before trying again.",
                    recoverable: true,
                  },
                },
                {
                  trust: getToolResultTrust(policy),
                  provenance: {
                    origin: policy.origin,
                    toolName: toolCall.name,
                    retrievedAt: Date.now(),
                  },
                },
              ),
            };
            outputBlockBuilder.updateToolCall(failed);
            emitOutputBlocks();
            upsertToolCall(failed);
            nonExecutedToolCalls.push(failed);
            continue;
          }

          if (priorWithSameArguments) {
            const replay = getToolReplayDecision(priorWithSameArguments);
            if (replay.action === "reuse") {
              const cached = requestHistory
                .flatMap((message) => message.toolCalls || [])
                .find(
                  (historical) =>
                    historical.id === priorWithSameArguments.callId &&
                    historical.result !== undefined,
                );
              if (cached) {
                const reused: ToolCall = {
                  ...toolCall,
                  pluginId,
                  pluginTitle,
                  functionFingerprint,
                  executionRecordId: priorWithSameArguments.id,
                  risk,
                  invocationPolicy: policy,
                  status: cached.isError ? "error" : "success",
                  isError: cached.isError,
                  result: cached.result,
                  approvalReason: "automatic",
                  confirmation: {
                    required: false,
                    state: "approved",
                    decision: "automatic",
                    decidedAt: Date.now(),
                  },
                  startedAt: Date.now(),
                  endedAt: Date.now(),
                  durationMs: 0,
                };
                outputBlockBuilder.updateToolCall(reused);
                emitOutputBlocks();
                upsertToolCall(reused);
                nonExecutedToolCalls.push(reused);
                continue;
              }
            }
            if (replay.action === "block" || replay.action === "reuse") {
              const failed: ToolCall = {
                ...toolCall,
                pluginId,
                pluginTitle,
                functionFingerprint,
                executionRecordId: priorWithSameArguments.id,
                risk,
                invocationPolicy: policy,
                status: "error",
                isError: true,
                errorInfo: {
                  code: "TOOL_REPLAY_BLOCKED",
                  message:
                    replay.action === "reuse"
                      ? "The committed Tool result is unavailable; the side effect was not replayed."
                      : `The Tool effect cannot be replayed safely (${replay.reason}).`,
                  recoverable: true,
                },
                result: normalizeToolResultEnvelope(
                  {
                    ok: false,
                    error: {
                      code: "TOOL_REPLAY_BLOCKED",
                      message:
                        replay.action === "reuse"
                          ? "The committed Tool result is unavailable; the side effect was not replayed."
                          : `The Tool effect cannot be replayed safely (${replay.reason}).`,
                      recoverable: true,
                    },
                  },
                  {
                    trust: getToolResultTrust(policy),
                    provenance: {
                      origin: policy.origin,
                      toolName: toolCall.name,
                      retrievedAt: Date.now(),
                    },
                  },
                ),
              };
              outputBlockBuilder.updateToolCall(failed);
              emitOutputBlocks();
              upsertToolCall(failed);
              nonExecutedToolCalls.push(failed);
              continue;
            }
          }
        }

        let identifiedToolCall: ToolCall = {
          ...toolCall,
          pluginId,
          pluginTitle,
          functionFingerprint,
          risk,
          invocationPolicy: policy,
        };
        if (agentRun) {
          await updateAgentRun((current) =>
            prepareToolExecution(current, {
              callId: toolCall.id,
              toolName: toolCall.name,
              ...(resolved ? { pluginId } : {}),
              definitionFingerprint: functionFingerprint,
              argumentsHash: argumentsHash!,
              targetSummary: getToolTargetScope(toolCall.args),
              round: round + 1,
              policy,
            }),
          );
          const executionRecord = agentRun.toolExecutions.find(
            (record) => record.callId === toolCall.id,
          );
          if (executionRecord) {
            identifiedToolCall = {
              ...identifiedToolCall,
              executionRecordId: executionRecord.id,
            };
          }
        }

        const approval = evaluateToolInvocationApproval(policy, {
          profile: options?.approvalMode ?? "permissive",
          originTrusted: policy.origin !== "mcp",
          policyVerified: policy.origin !== "mcp",
        });
        identifiedToolCall.approvalReason = approval.reason;
        if (!approval.requiresConfirmation) {
          approvedToolCalls.push({
            ...identifiedToolCall,
            confirmation: {
              required: false,
              state: "approved",
              decision: "automatic",
              decidedAt: Date.now(),
            },
          });
          continue;
        }

        const approvalCandidate = {
          pluginId,
          functionName,
          risk,
          functionFingerprint,
          sessionId,
          identity: createToolApprovalIdentity({
            origin: policy.origin,
            providerId: pluginId,
            toolName: functionName,
            toolFingerprint: functionFingerprint,
            effects: policy.effects,
            targetScope: getToolTargetScope(toolCall.args),
          }),
        };
        let decision: ToolConfirmationDecision | undefined;

        if (
          approval.canPersist &&
          toolConfirmationController?.isSessionApproved?.(approvalCandidate)
        ) {
          decision = "allow_session";
        }

        if (!decision && toolConfirmationController) {
          const awaitingToolCall: ToolCall = {
            ...identifiedToolCall,
            status: "awaiting_confirmation",
            confirmation: {
              required: true,
              canPersist: approval.canPersist,
              state: "pending",
            },
          };
          outputBlockBuilder.updateToolCall(awaitingToolCall);
          emitOutputBlocks();
          upsertToolCall(awaitingToolCall);

          try {
            if (agentRun?.status === "running") {
              await updateAgentRun((current) =>
                transitionAgentRunStatus(current, "awaiting_approval"),
              );
            }
            decision = normalizeToolConfirmationDecision(
              await waitForToolConfirmation(
                toolConfirmationController,
                {
                  ...approvalCandidate,
                  approvedAt: Date.now(),
                  toolCallId: toolCall.id,
                  pluginTitle,
                  args: redactSensitiveToolArgs(toolCall.args),
                },
                signal,
              ),
              risk,
            );
            if (decision === "allow_session" && !approval.canPersist) {
              decision = "allow_once";
            }
            if (agentRun?.status === "awaiting_approval") {
              await updateAgentRun((current) =>
                transitionAgentRunStatus(current, "running"),
              );
            }
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
            if (agentRun?.status === "awaiting_approval") {
              await updateAgentRun((current) =>
                transitionAgentRunStatus(current, "running"),
              );
            }
            if (identifiedToolCall.executionRecordId) {
              await updateAgentRun((current) =>
                failToolExecution(
                  current,
                  identifiedToolCall.executionRecordId!,
                  {
                    code: "TOOL_CONFIRMATION_FAILED",
                    message: "Tool confirmation failed before execution.",
                    recoverable: true,
                  },
                ),
              );
            }
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
          if (identifiedToolCall.executionRecordId) {
            await updateAgentRun((current) =>
              failToolExecution(
                current,
                identifiedToolCall.executionRecordId!,
                {
                  code: "TOOL_CONFIRMATION_UNAVAILABLE",
                  message: "Tool confirmation was unavailable.",
                  recoverable: true,
                },
              ),
            );
          }
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
          if (identifiedToolCall.executionRecordId) {
            await updateAgentRun((current) =>
              failToolExecution(
                current,
                identifiedToolCall.executionRecordId!,
                {
                  code: "TOOL_CALL_DENIED",
                  message: "The user denied this tool call.",
                  recoverable: false,
                },
              ),
            );
          }
          nonExecutedToolCalls.push(rejected);
          continue;
        }

        const approvedAt = Date.now();
        if (decision === "allow_session" && approval.canPersist) {
          toolConfirmationController?.grantSessionApproval?.({
            ...approvalCandidate,
            approvedAt,
          });
        }
        const approvedToolCall: ToolCall = {
          ...identifiedToolCall,
          confirmation: {
            required: true,
            canPersist: approval.canPersist,
            state: "approved",
            decision,
            decidedAt: approvedAt,
          },
        };
        approvedToolCalls.push(approvedToolCall);
      }

      for (let index = 0; index < approvedToolCalls.length; index += 1) {
        const toolCall = approvedToolCalls[index];
        const startedAt = Date.now();
        if (toolCall.executionRecordId) {
          await updateAgentRun((current) =>
            markToolExecutionRunning(
              current,
              toolCall.executionRecordId!,
              startedAt,
            ),
          );
        }
        const runningToolCall: ToolCall = {
          ...toolCall,
          status: "running",
          startedAt,
        };
        approvedToolCalls[index] = runningToolCall;
        outputBlockBuilder.updateToolCall(runningToolCall);
        emitOutputBlocks();
        upsertToolCall(runningToolCall);
      }

      const pluginImagesByToolCallId = new Map<string, Attachment[]>();
      const completedToolCalls = await mapWithConcurrencyGroups(
        approvedToolCalls,
        PLUGIN_EXECUTION_LIMITS.maxToolConcurrency,
        (toolCall) => builtinBindingsByName.get(toolCall.name)?.executionGroup,
        async (toolCall) => {
          try {
            const builtinBinding = builtinBindingsByName.get(toolCall.name);
            const awaitsUserInput = toolCall.name === "request_user_input";
            if (awaitsUserInput && agentRun?.status === "running") {
              await updateAgentRun((current) =>
                transitionAgentRunStatus(current, "awaiting_input"),
              );
            }
            let resultData: unknown;
            try {
              resultData = builtinBinding
                ? await builtinBinding.execute(toolCall.args, {
                    signal,
                    sessionId,
                    toolCallId: toolCall.id,
                    userInputController: options?.userInputController,
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
                      skillToolRestriction: (allowedTools) => {
                        const next = new Set(allowedTools);
                        skillAllowedToolNames = skillAllowedToolNames
                          ? new Set(
                              [...skillAllowedToolNames].filter((name) =>
                                next.has(name),
                              ),
                            )
                          : next;
                      },
                      taskPlan: (plan) => {
                        outputBlockBuilder.upsertTaskPlan(plan);
                        emitOutputBlocks();
                      },
                      workspaceFile: (file) => {
                        outputBlockBuilder.upsertWorkspaceFile({
                          path: file.path,
                          fileName: file.fileName,
                          mimeType: file.mimeType,
                          bytes: file.bytes,
                          url: file.url,
                          revision: file.revision,
                          ...(file.title ? { title: file.title } : {}),
                        });
                        emitOutputBlocks();
                      },
                      archiveFile: (archive) => {
                        outputBlockBuilder.upsertArchiveFile({
                          fileName: archive.fileName,
                          bytes: archive.bytes,
                          entryCount: archive.entryCount,
                          url: archive.url,
                          ...(archive.title ? { title: archive.title } : {}),
                        });
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
                    offeredPluginFunctionsByName.get(toolCall.name)?.functionDef
                      .name || toolCall.name,
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
            } finally {
              if (awaitsUserInput && agentRun?.status === "awaiting_input") {
                await updateAgentRun((current) =>
                  transitionAgentRunStatus(current, "running"),
                );
              }
            }
            const outputSchema = builtinBinding
              ? undefined
              : offeredPluginFunctionsByName.get(toolCall.name)?.functionDef
                  .outputSchema;
            if (outputSchema) {
              const preliminaryEnvelope = normalizeToolResultEnvelope(
                resultData,
                {
                  trust: getToolResultTrust(toolCall.invocationPolicy!),
                  provenance: {
                    origin: toolCall.invocationPolicy!.origin,
                    toolName: toolCall.name,
                  },
                },
              );
              if (!isToolResultFailure(preliminaryEnvelope)) {
                const record =
                  resultData &&
                  typeof resultData === "object" &&
                  !Array.isArray(resultData)
                    ? (resultData as Record<string, unknown>)
                    : undefined;
                const outputValidation = validateToolOutput(
                  outputSchema,
                  record?.structuredContent ?? resultData,
                );
                if (!outputValidation.ok) {
                  resultData = {
                    ok: false,
                    error: {
                      ...outputValidation.error,
                      recoverable: false,
                    },
                  };
                }
              }
            }
            if (agentRun) {
              const defaultKind = toolCall.name.includes("mcp")
                ? "mcp"
                : toolCall.name.startsWith("fetch_") ||
                    toolCall.name === "fetch_url"
                  ? "fetch"
                  : toolCall.name.includes("attachment")
                    ? "attachment"
                    : "search";
              const evidence = collectAgentEvidenceRecords(resultData, {
                toolCallId: toolCall.id,
                defaultKind,
              });
              if (evidence.length > 0) {
                await updateAgentRun((current) =>
                  recordAgentEvidence(current, evidence),
                );
              }
            }
            const policy = toolCall.invocationPolicy!;
            const rawEnvelope = normalizeToolResultEnvelope(resultData, {
              trust: getToolResultTrust(policy),
              provenance: {
                origin: policy.origin,
                toolName: toolCall.name,
                retrievedAt: Date.now(),
              },
            });
            const isError = isToolResultFailure(rawEnvelope);
            if (!builtinBinding && !isError) {
              const pluginImages = extractPluginImageAttachments(resultData);
              if (pluginImages.length > 0) {
                pluginImagesByToolCallId.set(toolCall.id, pluginImages);
              }
            }
            const compactedResult = isError
              ? resultData
              : compactPluginImageResultForHistory(resultData);
            const historyResult = await compactLargeToolResult(
              toolCall,
              compactedResult,
            );
            const endedAt = Date.now();
            const hasSideEffect =
              !isError &&
              policy.effects.some(
                (effect) =>
                  effect === "local_write" ||
                  effect === "local_destructive" ||
                  effect === "external_write" ||
                  effect === "external_destructive",
              );
            const effectReceipt = hasSideEffect
              ? {
                  committedAt: endedAt,
                  effectId: toolCall.id,
                  targetHash: await hashToolArguments(
                    getToolTargetScope(toolCall.args),
                  ),
                  resultHash: await hashToolArguments(historyResult.value),
                  reversible:
                    policy.effects.includes("local_write") &&
                    !policy.effects.includes("local_destructive"),
                }
              : undefined;
            const storedResultData = normalizeToolResultEnvelope(
              historyResult.value,
              {
                trust: getToolResultTrust(policy),
                provenance: {
                  origin: policy.origin,
                  toolName: toolCall.name,
                  retrievedAt: Date.now(),
                },
                ...(historyResult.resultRef
                  ? {
                      artifacts: [
                        {
                          kind: "workspace_file" as const,
                          id: historyResult.resultRef.id,
                          contentHash: historyResult.resultRef.contentHash,
                        },
                      ],
                    }
                  : {}),
                ...(effectReceipt ? { receipt: effectReceipt } : {}),
              },
            );
            if (toolCall.executionRecordId) {
              if (isError) {
                await updateAgentRun((current) => {
                  const executionError = {
                    code: rawEnvelope.error.code,
                    message: rawEnvelope.error.message,
                    recoverable: rawEnvelope.error.recoverable,
                  };
                  if (rawEnvelope.error.effectUnknown) {
                    const uncertain = markToolExecutionEffectUnknown(
                      current,
                      toolCall.executionRecordId!,
                      executionError,
                      endedAt,
                    );
                    return transitionAgentRunStatus(uncertain, "failed", {
                      at: endedAt,
                      stop: {
                        reason: "effect_unknown",
                        error: executionError,
                      },
                    });
                  }
                  return failToolExecution(
                    current,
                    toolCall.executionRecordId!,
                    executionError,
                    endedAt,
                  );
                });
              } else {
                await updateAgentRun((current) =>
                  commitToolExecution(current, toolCall.executionRecordId!, {
                    at: endedAt,
                    resultRefs: historyResult.resultRef
                      ? [historyResult.resultRef]
                      : [{ kind: "tool_cache", id: toolCall.id }],
                    ...(effectReceipt ? { receipt: effectReceipt } : {}),
                  }),
                );
              }
            }
            const completed: ToolCall = {
              ...toolCall,
              status: isError ? "error" : "success",
              isError,
              result: storedResultData,
              endedAt,
              durationMs: toolCall.startedAt
                ? Math.max(0, endedAt - toolCall.startedAt)
                : undefined,
            };
            outputBlockBuilder.updateToolCall(completed);
            emitOutputBlocks();
            upsertToolCall(completed);
            return completed;
          } catch (toolError) {
            if (isAbortError(toolError, signal)) throw toolError;
            const endedAt = Date.now();
            if (toolCall.executionRecordId) {
              await updateAgentRun((current) =>
                failToolExecution(
                  current,
                  toolCall.executionRecordId!,
                  {
                    code: "TOOL_EXECUTION_FAILED",
                    message:
                      toolError instanceof Error
                        ? toolError.message
                        : String(toolError),
                    recoverable: false,
                  },
                  endedAt,
                ),
              );
            }
            const policy = toolCall.invocationPolicy!;
            const failed: ToolCall = {
              ...toolCall,
              status: "error",
              isError: true,
              result: normalizeToolResultEnvelope(
                {
                  ok: false,
                  error: {
                    code: "TOOL_EXECUTION_FAILED",
                    message:
                      toolError instanceof Error
                        ? toolError.message
                        : String(toolError),
                    recoverable: false,
                  },
                },
                {
                  trust: getToolResultTrust(policy),
                  provenance: {
                    origin: policy.origin,
                    toolName: toolCall.name,
                    retrievedAt: endedAt,
                  },
                },
              ),
              endedAt,
              durationMs: toolCall.startedAt
                ? Math.max(0, endedAt - toolCall.startedAt)
                : undefined,
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
      const unknownEffectCall = completedToolCalls.find(
        (toolCall) =>
          isToolResultFailure(toolCall.result) &&
          toolCall.result.error.effectUnknown,
      );
      if (unknownEffectCall) {
        throw new Error(
          `The effect of ${unknownEffectCall.name} could not be confirmed.`,
        );
      }
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
        requestTools = skillAllowedToolNames
          ? tools.filter((tool) =>
              skillAllowedToolNames!.has(tool.function.name),
            )
          : tools;
      }
      requestAttachments = roundPluginImages;
    }

    assertForcedPluginsCalled();
    if (agentRun?.status === "running") {
      await updateAgentRun((current) =>
        transitionAgentRunStatus(current, "completed", {
          stop: { reason: "completed" },
        }),
      );
    }
    return committedContent;
  } catch (error) {
    if (
      agentRun &&
      agentRun.status !== "completed" &&
      agentRun.status !== "failed" &&
      agentRun.status !== "cancelled"
    ) {
      await updateAgentRun((current) => {
        const recovered = recoverInterruptedToolExecutions(current);
        const hasUnknownEffect = recovered.toolExecutions.some(
          (record) => record.status === "effect_unknown",
        );
        if (hasUnknownEffect) {
          return transitionAgentRunStatus(recovered, "failed", {
            stop: {
              reason: "effect_unknown",
              error: {
                code: "TOOL_EFFECT_UNKNOWN",
                message:
                  "A tool may have produced a side effect before its result was saved.",
                recoverable: false,
              },
            },
          });
        }
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          return transitionAgentRunStatus(recovered, "interrupted", {
            stop: { reason: "offline" },
          });
        }
        if (isAbortError(error, signal)) {
          return transitionAgentRunStatus(recovered, "cancelled", {
            stop: { reason: "user_stopped" },
          });
        }
        return transitionAgentRunStatus(recovered, "failed", {
          stop: {
            reason: "runtime_error",
            error: {
              code: error instanceof Error ? error.name : undefined,
              message:
                error instanceof Error
                  ? error.message
                  : "Agent execution failed.",
              recoverable: true,
            },
          },
        });
      });
    }
    throw error;
  } finally {
    if (agentRunLease) releaseAgentRunLease(agentRunLease);
  }
};
