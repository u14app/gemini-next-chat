export const RESEARCH_TASK_SCHEMA_VERSION = 2 as const;
export const INTERNAL_AGENT_RESEARCH_PROVIDER_ID = "internal-agent" as const;

export type ResearchTaskStatus =
  | "draft"
  | "clarifying"
  | "plan_ready"
  | "researching"
  | "verifying"
  | "synthesizing"
  | "paused"
  | "completed"
  | "partial_completed"
  | "failed"
  | "cancelled";

export type ResearchActiveStatus = "researching" | "verifying" | "synthesizing";

export type ResearchBudgetPreset = "quick" | "standard" | "deep";

export interface ResolvedResearchBudget {
  maxToolRounds: number;
  maxToolCalls: number;
  maxDurationMs: number;
  maxTotalTokens?: number;
}

export interface ResearchUsage {
  toolRounds: number;
  toolCalls: number;
  wallTimeMs: number;
  totalTokens: number;
}

export type ResearchSourceType =
  "web" | "knowledge" | "attachment" | "workspace" | "plugin" | "mcp";

export type ResearchPriority = "high" | "medium" | "low";

export interface ResearchTimeRange {
  start?: string;
  end?: string;
  description?: string;
}

export interface ResearchScope {
  audience: string;
  timeRange?: ResearchTimeRange;
  includes: string[];
  excludes: string[];
  allowedSourceTypes: ResearchSourceType[];
}

export type ResearchDeliverableKind =
  "research_report" | "comparison" | "decision_memo" | "exact_answer";

export interface ResearchDeliverableContract {
  kind: ResearchDeliverableKind;
  description: string;
  requiredSections: string[];
}

export interface ResearchStrategy {
  initialBreadth: number;
  maxDepth: number;
  maxQueries: number;
  resultsPerQuery: number;
}

export type ResearchReconStatus = "completed" | "partial" | "unavailable";

export interface ResearchReconQuery {
  query: string;
  status: "completed" | "failed" | "timed_out";
  resultCount: number;
  domains: string[];
  error?: string;
}

export interface ResearchReconSnapshot {
  status: ResearchReconStatus;
  sourceFeasibility: "verified" | "unverified";
  startedAt: number;
  completedAt: number;
  timeoutMs: number;
  queryLimit: number;
  resultsPerQuery: number;
  usage: {
    queryCount: number;
    resultCount: number;
    wallTimeMs: number;
  };
  queries: ResearchReconQuery[];
  providerId?: string;
}

export interface ResearchSourcePriority {
  sourceType: ResearchSourceType;
  priority: ResearchPriority;
  rationale?: string;
}
