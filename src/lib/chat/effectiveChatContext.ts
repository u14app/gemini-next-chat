import type {
  ChatConfig,
  ModelMetadata,
  ModelProvider,
  Plugin,
  PluginConfig,
  RAGConfig,
  SearchProviderID,
  SearchServiceConfig,
  Session,
  SystemPersonality,
  Workspace,
  AgentApprovalMode,
  AgentRunBudget,
  AgentMemoryScope,
} from "@/types";
import type { SkillCatalogEntry } from "../skills/types";
import {
  isPluginAuthRequired,
  normalizeActivePluginIds,
} from "../plugin/config";
import { normalizeSkillIdRefs } from "../skills";
import {
  hasPluginAuthValue,
  hasRagVectorStore,
} from "../security/localSecretResolvers";
import {
  resolveEffectiveSearchCapability,
  type SearchCompatibilityResult,
} from "../settings/searchRag";
import { buildDiagramPromptInstruction } from "./diagramPrompt";
import { buildHtmlVisualPromptInstruction } from "./htmlVisualPrompt";
import {
  parseModelString,
  resolveProviderModelMetadata,
  supportsModality,
  supportsToolCalls,
} from "../utils/model";
import { resolveAgentProfile } from "../assistant/profile";
import { normalizeChatMode } from "./mode";

export type CapabilityStatusCode =
  | "ok"
  | "search_unavailable"
  | "rag_unavailable"
  | "plugin_auth_missing"
  | "attachment_unsupported"
  | "audio_unsupported"
  | "reasoning_unsupported";

export interface CapabilityStatus {
  code: CapabilityStatusCode;
  level: "info" | "warning" | "error";
  message: string;
}

export interface ModelCapabilities {
  vision: boolean;
  attachment: boolean;
  audio: boolean;
  reasoning: boolean;
  toolCall: boolean;
}

export interface EffectiveChatContext {
  sessionId: string | null;
  systemInstruction?: string;
  workspaceFiles: Workspace["files"];
  workspaceKnowledgeCollectionIds: string[];
  activePluginIds: string[];
  activeSkillIds: string[];
  agentSkillIds: string[];
  agentToolIds: string[];
  approvalMode: AgentApprovalMode;
  agentBudget?: AgentRunBudget;
  agentProfileId?: string;
  memoryScopes: AgentMemoryScope[];
  memoryScopeIds: {
    workspace?: string;
    agent?: string;
    session?: string;
  };
  modelCapabilities: ModelCapabilities;
  agentModeEnabled: boolean;
  researchModeEnabled: boolean;
  orchestratedModeEnabled: boolean;
  searchCompatibility: SearchCompatibilityResult;
  capabilityStatuses: CapabilityStatus[];
}

export interface ResolveEffectiveChatContextOptions {
  session?: Session | null;
  workspace?: Workspace | null;
  systemPrompt?: string;
  personality?: SystemPersonality;
  enableHtmlVisualPrompt?: boolean;
  now?: Date | number;
  selectedModel: string;
  provider?: Pick<ModelProvider, "type"> | null;
  modelMetadata: Record<string, ModelMetadata>;
  customModelMetadata: Record<string, ModelMetadata>;
  chatConfig: ChatConfig;
  search: {
    provider: SearchProviderID;
    configs: Record<string, SearchServiceConfig>;
  };
  rag: RAGConfig;
  installedPlugins: Plugin[];
  installedSkills?: SkillCatalogEntry[];
  pluginConfigs: Record<string, PluginConfig>;
  activePlugins: string[];
}

function formatCurrentDateTime(now: Date | number | undefined): string {
  const date =
    now instanceof Date
      ? now
      : typeof now === "number"
        ? new Date(now)
        : new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return [
    "Current date and time:",
    `- ISO: ${date.toISOString()}`,
    `- Local: ${date.toLocaleString(undefined, { timeZone })}`,
    `- Time zone: ${timeZone}`,
  ].join("\n");
}

const PERSONALITY_INSTRUCTIONS: Record<
  Exclude<SystemPersonality, "default">,
  string
> = {
  professional:
    "Use a professional, precise, and dependable voice. Prioritize accuracy, structure, and practical detail.",
  friendly:
    "Use a warm, approachable, and supportive voice. Explain clearly without becoming overly formal.",
  direct:
    "Be candid and straightforward. State the main answer early and avoid unnecessary preamble.",
  imaginative:
    "Use imaginative framing and playful ideas while staying useful, accurate, and grounded.",
  efficient:
    "Be concise, direct, and practical. Focus on the fastest useful path and skip filler.",
  snarky:
    "Use dry wit sparingly while staying helpful, respectful, and technically accurate.",
};

export function buildResponsePersonalizationInstruction({
  personality,
}: {
  personality?: SystemPersonality;
}): string {
  const instruction =
    personality && personality !== "default"
      ? PERSONALITY_INSTRUCTIONS[personality]
      : "";

  if (!instruction) return "";

  return [
    "<response-personalization>",
    instruction,
    "</response-personalization>",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemInstruction({
  systemPrompt,
  personality,
  workspacePrompt,
  sessionInstruction,
  enableHtmlVisualPrompt,
  now,
}: {
  systemPrompt?: string;
  personality?: SystemPersonality;
  workspacePrompt?: string;
  sessionInstruction?: string;
  enableHtmlVisualPrompt?: boolean;
  now?: Date | number;
}) {
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const value of [systemPrompt, workspacePrompt, sessionInstruction]) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    sections.push(trimmed);
  }
  const personalizationInstruction = buildResponsePersonalizationInstruction({
    personality,
  });
  if (personalizationInstruction) {
    sections.push(personalizationInstruction);
  }
  sections.push(
    buildDiagramPromptInstruction({
      enhanced: Boolean(enableHtmlVisualPrompt),
    }),
  );
  if (enableHtmlVisualPrompt) {
    sections.push(buildHtmlVisualPromptInstruction());
  }
  sections.push(formatCurrentDateTime(now));
  return sections.join("\n\n");
}

function getModelCapabilities({
  selectedModel,
  modelMetadata,
  customModelMetadata,
}: Pick<
  ResolveEffectiveChatContextOptions,
  "selectedModel" | "modelMetadata" | "customModelMetadata"
>): ModelCapabilities {
  const { providerId, modelName } = parseModelString(selectedModel);
  const meta = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const lower = modelName.toLowerCase();
  const reasoningByName =
    lower.includes("thinking") ||
    lower.includes("reasoner") ||
    lower.includes("o1") ||
    lower.includes("r1");

  return {
    vision: supportsModality(meta, "image", "input"),
    attachment: meta?.attachment ?? false,
    audio: supportsModality(meta, "audio", "input"),
    reasoning: meta?.reasoning ?? reasoningByName,
    toolCall: supportsToolCalls(meta),
  };
}

export function resolveEffectiveChatContext(
  options: ResolveEffectiveChatContextOptions,
): EffectiveChatContext {
  const {
    session,
    workspace,
    systemPrompt,
    personality,
    enableHtmlVisualPrompt,
    now,
    selectedModel,
    provider,
    modelMetadata,
    customModelMetadata,
    chatConfig,
    search,
    rag,
    installedPlugins,
    installedSkills = [],
    pluginConfigs,
    activePlugins,
  } = options;

  const searchConfig =
    search.provider === "google" ? undefined : search.configs[search.provider];
  const searchCompatibility = resolveEffectiveSearchCapability({
    searchProvider: search.provider,
    searchConfig,
    modelProviderType: provider?.type,
    selectedModel,
  });
  const modelCapabilities = getModelCapabilities({
    selectedModel,
    modelMetadata,
    customModelMetadata,
  });
  const chatMode = normalizeChatMode(
    chatConfig.chatMode,
    chatConfig.useAgentMode,
    chatConfig.useDeepResearch,
  );
  const agentModeEnabled = chatMode === "agent" && modelCapabilities.toolCall;
  const researchModeEnabled =
    chatMode === "research" && modelCapabilities.toolCall;
  const requestedPluginIds = activePlugins;
  const resolvedAgentProfile = resolveAgentProfile(
    workspace?.agentProfile,
    session?.config?.agentProfile,
    {
      runtime: {
        ...(session?.config?.approvalMode
          ? { approvalMode: session.config.approvalMode }
          : {}),
        ...(session?.config?.agentBudget
          ? { budget: session.config.agentBudget }
          : {}),
      },
      capabilities: {
        ...(session?.config?.skillPolicies
          ? { skillPolicies: session.config.skillPolicies }
          : {}),
      },
    },
  );
  const profilePluginIds = resolvedAgentProfile.capabilities.pluginIds || [];
  const hasAgentProfileLayer = Boolean(
    session?.config?.agentProfile || workspace?.agentProfile,
  );
  const hasAgentSkillPolicyLayer =
    hasAgentProfileLayer || session?.config?.skillPolicies !== undefined;
  const requestedPluginIdsWithProfile =
    session?.config?.activePlugins !== undefined
      ? session.config.activePlugins
      : hasAgentProfileLayer
        ? profilePluginIds
        : requestedPluginIds;
  const activePluginIds = normalizeActivePluginIds(
    requestedPluginIdsWithProfile,
    installedPlugins,
    pluginConfigs,
    { unauthenticatedAllowedPluginIds: ["unsplash"] },
  );
  const activeSkillIds = normalizeSkillIdRefs(
    session?.config?.activeSkills ||
      workspace?.activeSkills ||
      (resolvedAgentProfile.capabilities.skillPolicies || [])
        .filter((policy) => policy.mode !== "disabled")
        .map((policy) => policy.skillId),
    installedSkills,
  );
  const configuredAgentSkillIds = (
    resolvedAgentProfile.capabilities.skillPolicies || []
  )
    .filter((policy) => policy.mode === "auto")
    .map((policy) => policy.skillId);
  const agentSkillIds = normalizeSkillIdRefs(
    hasAgentSkillPolicyLayer ? configuredAgentSkillIds : activeSkillIds,
    installedSkills,
  );
  const statuses: CapabilityStatus[] = [];

  if (chatConfig.useSearch && !searchCompatibility.enabled) {
    statuses.push({
      code: "search_unavailable",
      level: "warning",
      message:
        "Search is enabled but the selected model or provider configuration cannot use it.",
    });
  }

  if (chatConfig.useRAG && (!rag.enabled || !hasRagVectorStore(rag))) {
    statuses.push({
      code: "rag_unavailable",
      level: "warning",
      message:
        "RAG is enabled but the vector endpoint or token is not configured.",
    });
  }

  for (const pluginId of requestedPluginIdsWithProfile) {
    const plugin = installedPlugins.find((item) => item.id === pluginId);
    if (!plugin || !isPluginAuthRequired(plugin) || pluginId === "unsplash") {
      continue;
    }
    if (!hasPluginAuthValue(pluginConfigs[pluginId]?.auth)) {
      statuses.push({
        code: "plugin_auth_missing",
        level: "warning",
        message: `Plugin "${plugin.title || plugin.id}" is active but missing authentication.`,
      });
    }
  }

  if (chatConfig.useReasoning && !modelCapabilities.reasoning) {
    statuses.push({
      code: "reasoning_unsupported",
      level: "info",
      message:
        "Reasoning is enabled but the selected model is not marked as reasoning-capable.",
    });
  }

  return {
    sessionId: session?.id || null,
    systemInstruction: buildSystemInstruction({
      systemPrompt,
      personality,
      workspacePrompt: workspace?.systemPrompt,
      sessionInstruction: session?.systemInstruction,
      enableHtmlVisualPrompt,
      now,
    }),
    workspaceFiles: workspace?.files || [],
    workspaceKnowledgeCollectionIds: resolvedAgentProfile.capabilities
      .knowledgeCollectionIds?.length
      ? resolvedAgentProfile.capabilities.knowledgeCollectionIds
      : workspace?.knowledgeCollectionIds || [],
    activePluginIds,
    activeSkillIds,
    agentSkillIds,
    agentToolIds: resolvedAgentProfile.capabilities.toolIds || [],
    approvalMode: resolvedAgentProfile.runtime.approvalMode,
    agentBudget: resolvedAgentProfile.runtime.budget,
    agentProfileId: session?.config?.agentProfileId,
    memoryScopes: resolvedAgentProfile.capabilities.memoryScopes || ["global"],
    memoryScopeIds: {
      ...(session?.workspaceId ? { workspace: session.workspaceId } : {}),
      ...(session?.config?.agentProfileId
        ? { agent: session.config.agentProfileId }
        : {}),
      ...(session?.id ? { session: session.id } : {}),
    },
    modelCapabilities,
    agentModeEnabled,
    researchModeEnabled,
    orchestratedModeEnabled: agentModeEnabled || researchModeEnabled,
    searchCompatibility,
    capabilityStatuses: statuses.length
      ? statuses
      : [{ code: "ok", level: "info", message: "Ready" }],
  };
}
