import type { ResearchTemplate } from "../research/templates";

export interface LobeAgentMeta {
  avatar: string;
  description: string;
  tags: string[];
  title: string;
  category: string;
  systemRole?: string;
}

export type AgentApprovalMode = "permissive" | "balanced" | "strict";
export type AgentMemoryScope = "global" | "workspace" | "agent" | "session";
export type AgentSkillMode = "auto" | "manual" | "disabled";

export interface AgentRunBudget {
  maxToolRounds?: number;
  maxToolCalls?: number;
  maxTotalTokens?: number;
  maxDurationMs?: number;
}

export interface AgentSkillPolicy {
  skillId: string;
  mode: AgentSkillMode;
}

export interface AgentProfileRuntime {
  agentEnabled: boolean;
  approvalMode: AgentApprovalMode;
  preferredModel?: string;
  reasoningMode?: "off" | "auto" | "low" | "medium" | "high";
  searchEnabled?: boolean;
  budget?: AgentRunBudget;
}

export interface AgentProfileCapabilities {
  skillPolicies?: AgentSkillPolicy[];
  pluginIds?: string[];
  toolIds?: string[];
  knowledgeCollectionIds?: string[];
  memoryScopes?: AgentMemoryScope[];
}

/** Declarative, shareable Agent configuration. It never contains credentials. */
export interface AgentProfileV2 {
  schemaVersion: 2;
  runtime: AgentProfileRuntime;
  capabilities: AgentProfileCapabilities;
  /** Portable Research preset; null explicitly disables inherited templates. */
  researchTemplate?: ResearchTemplate | null;
}

export interface LobeAgent {
  identifier: string;
  meta: LobeAgentMeta;
  createdAt: string;
  homepage: string;
  author: string;
  isCustom?: boolean;
  profile?: AgentProfileV2;
}
