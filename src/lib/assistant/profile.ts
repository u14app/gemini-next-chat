import type {
  AgentApprovalMode,
  AgentMemoryScope,
  AgentProfileCapabilities,
  AgentProfileRuntime,
  AgentProfileV2,
  AgentRunBudget,
  AgentSkillMode,
  AgentSkillPolicy,
} from "./types";
import {
  normalizeResearchTemplate,
  type ResearchTemplate,
} from "../research/templates";

export interface AgentProfileLayer {
  runtime?: Partial<AgentProfileRuntime> & {
    budget?: Partial<AgentRunBudget>;
  };
  capabilities?: Partial<AgentProfileCapabilities>;
  researchTemplate?: ResearchTemplate | null;
}

export interface AgentProfileDependencies {
  skillIds?: Iterable<string>;
  pluginIds?: Iterable<string>;
  toolIds?: Iterable<string>;
  knowledgeCollectionIds?: Iterable<string>;
}

export interface MissingAgentProfileDependencies {
  skillIds: string[];
  pluginIds: string[];
  toolIds: string[];
  knowledgeCollectionIds: string[];
}

export const DEFAULT_AGENT_PROFILE: AgentProfileV2 = {
  schemaVersion: 2,
  runtime: {
    agentEnabled: false,
    approvalMode: "permissive",
  },
  capabilities: {
    skillPolicies: [],
    pluginIds: [],
    toolIds: [],
    knowledgeCollectionIds: [],
    memoryScopes: ["global"],
  },
};

const APPROVAL_MODES = new Set<AgentApprovalMode>([
  "permissive",
  "balanced",
  "strict",
]);
const SKILL_MODES = new Set<AgentSkillMode>(["auto", "manual", "disabled"]);
const MEMORY_SCOPES = new Set<AgentMemoryScope>([
  "global",
  "workspace",
  "agent",
  "session",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringList(value: unknown, max = 100): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().slice(0, 160);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function normalizeBudget(value: unknown): AgentRunBudget | undefined {
  if (!isRecord(value)) return undefined;
  const budget: AgentRunBudget = {
    maxToolRounds: positiveInteger(value.maxToolRounds),
    maxToolCalls: positiveInteger(value.maxToolCalls),
    maxTotalTokens: positiveInteger(value.maxTotalTokens),
    maxDurationMs: positiveInteger(value.maxDurationMs),
  };
  return Object.values(budget).some((item) => item !== undefined)
    ? budget
    : undefined;
}

export function normalizeAgentSkillPolicies(
  value: unknown,
): AgentSkillPolicy[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, AgentSkillMode>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.skillId !== "string") continue;
    const skillId = item.skillId.trim().slice(0, 160);
    const mode = item.mode;
    if (
      !skillId ||
      typeof mode !== "string" ||
      !SKILL_MODES.has(mode as AgentSkillMode)
    ) {
      continue;
    }
    byId.set(skillId, mode as AgentSkillMode);
    if (byId.size >= 100) break;
  }
  return [...byId].map(([skillId, mode]) => ({ skillId, mode }));
}

/**
 * Explicitly selects shareable fields from untrusted market or persisted data.
 * Unknown keys, approvals, credentials, and run history are discarded.
 */
export function normalizeAgentProfile(
  value: unknown,
): AgentProfileV2 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 2) return undefined;
  const runtime = isRecord(value.runtime) ? value.runtime : {};
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  const approvalMode =
    typeof runtime.approvalMode === "string" &&
    APPROVAL_MODES.has(runtime.approvalMode as AgentApprovalMode)
      ? (runtime.approvalMode as AgentApprovalMode)
      : "permissive";
  const reasoningMode =
    runtime.reasoningMode === "off" ||
    runtime.reasoningMode === "auto" ||
    runtime.reasoningMode === "low" ||
    runtime.reasoningMode === "medium" ||
    runtime.reasoningMode === "high"
      ? runtime.reasoningMode
      : undefined;
  const rawScopes = stringList(capabilities.memoryScopes, 4);
  const memoryScopes = rawScopes?.filter((scope): scope is AgentMemoryScope =>
    MEMORY_SCOPES.has(scope as AgentMemoryScope),
  );
  const profileRecord = value as Record<string, unknown>;
  const hasResearchTemplate = Object.prototype.hasOwnProperty.call(
    profileRecord,
    "researchTemplate",
  );
  const researchTemplate = !hasResearchTemplate
    ? undefined
    : profileRecord.researchTemplate === null
      ? null
      : normalizeResearchTemplate(profileRecord.researchTemplate) || undefined;

  return {
    schemaVersion: 2,
    runtime: {
      agentEnabled: runtime.agentEnabled === true,
      approvalMode,
      ...(typeof runtime.preferredModel === "string" &&
      runtime.preferredModel.trim()
        ? { preferredModel: runtime.preferredModel.trim().slice(0, 240) }
        : {}),
      ...(reasoningMode ? { reasoningMode } : {}),
      ...(typeof runtime.searchEnabled === "boolean"
        ? { searchEnabled: runtime.searchEnabled }
        : {}),
      ...(normalizeBudget(runtime.budget)
        ? { budget: normalizeBudget(runtime.budget) }
        : {}),
    },
    capabilities: {
      skillPolicies:
        normalizeAgentSkillPolicies(capabilities.skillPolicies) || [],
      pluginIds: stringList(capabilities.pluginIds) || [],
      toolIds: stringList(capabilities.toolIds) || [],
      knowledgeCollectionIds:
        stringList(capabilities.knowledgeCollectionIds) || [],
      memoryScopes: memoryScopes ?? ["global"],
    },
    ...(researchTemplate !== undefined ? { researchTemplate } : {}),
  };
}

function mergeSkillPolicies(
  current: AgentSkillPolicy[],
  next: AgentSkillPolicy[] | undefined,
): AgentSkillPolicy[] {
  if (!next) return current;
  const merged = new Map(current.map((item) => [item.skillId, item.mode]));
  next.forEach((item) => merged.set(item.skillId, item.mode));
  return [...merged].map(([skillId, mode]) => ({ skillId, mode }));
}

/** Applies layers in order; callers pass global, workspace, profile, session, turn. */
export function resolveAgentProfile(
  ...layers: Array<AgentProfileLayer | null | undefined>
): AgentProfileV2 {
  let runtime: AgentProfileRuntime = { ...DEFAULT_AGENT_PROFILE.runtime };
  let capabilities: AgentProfileCapabilities = {
    ...DEFAULT_AGENT_PROFILE.capabilities,
    skillPolicies: [],
  };
  let researchTemplate: ResearchTemplate | null | undefined;

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.runtime) {
      runtime = {
        ...runtime,
        ...layer.runtime,
        budget: layer.runtime.budget
          ? { ...runtime.budget, ...layer.runtime.budget }
          : runtime.budget,
      };
    }
    if (layer.capabilities) {
      const next = layer.capabilities;
      capabilities = {
        ...capabilities,
        ...next,
        skillPolicies: mergeSkillPolicies(
          capabilities.skillPolicies || [],
          next.skillPolicies,
        ),
      };
    }
    if (Object.prototype.hasOwnProperty.call(layer, "researchTemplate")) {
      researchTemplate = layer.researchTemplate;
    }
  }

  return {
    schemaVersion: 2,
    runtime,
    capabilities,
    ...(researchTemplate !== undefined ? { researchTemplate } : {}),
  };
}

function missing(required: readonly string[], available?: Iterable<string>) {
  const known = new Set(available || []);
  return required.filter((id) => !known.has(id));
}

export function getMissingAgentProfileDependencies(
  profile: AgentProfileV2,
  available: AgentProfileDependencies,
): MissingAgentProfileDependencies {
  const automaticSkills = (profile.capabilities.skillPolicies || [])
    .filter((item) => item.mode !== "disabled")
    .map((item) => item.skillId);
  return {
    skillIds: missing(automaticSkills, available.skillIds),
    pluginIds: missing(
      profile.capabilities.pluginIds || [],
      available.pluginIds,
    ),
    toolIds: missing(profile.capabilities.toolIds || [], available.toolIds),
    knowledgeCollectionIds: missing(
      profile.capabilities.knowledgeCollectionIds || [],
      available.knowledgeCollectionIds,
    ),
  };
}
