import type {
  ResearchBudgetPreset,
  ResearchSourceType,
  ResearchTaskError,
  ResearchTaskStatus,
} from "@/lib/research/types";

export type { ResearchTaskStatus } from "@/lib/research/types";

export type ResearchDeliverableKind =
  "research_report" | "comparison" | "decision_memo" | "exact_answer";

export type ResearchRunPhaseView =
  | "queued"
  | "exploring"
  | "verifying"
  | "synthesizing"
  | "awaiting_scope_approval"
  | "completed"
  | "partial_completed"
  | "paused"
  | "blocked"
  | "failed"
  | "cancelled";

export type ResearchRunItemStatusView =
  "pending" | "in_progress" | "completed" | "blocked" | "failed" | "skipped";

export interface ResearchPlanScopeView {
  audience?: string;
  timeRange?: string;
  allowedSourceTypes?: ResearchSourceType[];
  includes: string[];
  excludes: string[];
}

export interface ResearchDeliverableView {
  kind: ResearchDeliverableKind;
  description?: string;
}

export interface ResearchStrategyView {
  initialBreadth: number;
  maxDepth: number;
  queryLimit: number;
  resultsPerQuery: number;
  reservedValidationQueries?: number;
  sourceContentLimit?: number;
}

export interface ResearchReconQueryView {
  id: string;
  query: string;
  status: "completed" | "failed";
  resultCount: number;
  domains: string[];
}

export interface ResearchStopReasonView {
  code: string;
  detail?: string;
}

export interface ResearchReconView {
  status: "completed" | "partial" | "unavailable";
  queryCount: number;
  maxQueries: number;
  resultsPerQuery: number;
  durationMs?: number;
  queries: ResearchReconQueryView[];
}

export interface ResearchPlanView {
  id: string;
  version: number;
  summary: string;
  objective?: string;
  scope?: ResearchPlanScopeView;
  assumptions?: string[];
  deliverable?: ResearchDeliverableView;
  strategy?: ResearchStrategyView;
  recon?: ResearchReconView;
  completionCriteria?: string[];
  steps: Array<{
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed";
    evidenceIds?: string[];
    objective?: string;
    queryTopics?: string[];
    sourcePriorities?: string[];
    evidenceStandard?: string;
    nodeIds?: string[];
  }>;
}

export interface ResearchWaveView {
  id: string;
  index: number;
  depth: number;
  status: ResearchRunItemStatusView;
  nodeIds: string[];
  queryCount: number;
  sourceCount: number;
  verifiedClaimCount: number;
}

export interface ResearchNodeView {
  id: string;
  parentId?: string;
  waveId: string;
  stepId?: string;
  depth: number;
  objective: string;
  query?: string;
  status: ResearchRunItemStatusView;
  evidenceIds: string[];
  claimIds: string[];
  verifiedClaimCount: number;
  conflictingClaimCount: number;
  learnings: string[];
  followUps: string[];
  stopReason?: ResearchStopReasonView;
  scopeImpact?: "within" | "source_expansion" | "scope_expansion";
}

export interface ResearchRunView {
  id: string;
  phase: ResearchRunPhaseView;
  currentWave?: number;
  currentDepth: number;
  maxDepth: number;
  queryUsage: {
    used: number;
    limit: number;
    reservedForValidation: number;
    planningUsed: number;
  };
  claimCounts: {
    total: number;
    verified: number;
    conflicting: number;
    unresolved: number;
  };
  waves: ResearchWaveView[];
  nodes: ResearchNodeView[];
  stopReason?: ResearchStopReasonView;
}

export interface ResearchEvidenceView {
  id: string;
  title: string;
  sourceType: ResearchSourceType;
  locator?: string;
  url?: string;
  retrievedAt: number;
  stance?: "supports" | "contradicts" | "context";
  freshness?: "current" | "stale" | "unknown";
  excerpt?: string;
  claimIds?: string[];
  stepId?: string;
  nodeId?: string;
  authority?: "primary" | "secondary" | "unknown";
  verificationStatus?: "pending" | "verified" | "unsupported" | "unresolved";
  questionIndexes?: number[];
  domain?: string;
}

export interface ResearchReportVersionView {
  id: string;
  version: number;
  planVersion?: number;
  researchRunId?: string;
  createdAt: number;
  title: string;
  markdown: string;
  changeSummary?: string;
  diff?: {
    added: number;
    changed: number;
    unchanged: number;
  };
}

export interface ResearchActivityView {
  id: string;
  createdAt: number;
  phase: ResearchTaskStatus;
  title: string;
  detail?: string;
}

export interface ResearchTaskViewModel {
  id: string;
  title: string;
  status: ResearchTaskStatus;
  budgetPreset?: ResearchBudgetPreset;
  plan?: ResearchPlanView;
  run?: ResearchRunView;
  summary?: string;
  error?: ResearchTaskError;
  findings?: string[];
  gapSummary?: string;
  completedQuestions: number;
  totalQuestions: number;
  evidence: ResearchEvidenceView[];
  activities: ResearchActivityView[];
  reportVersions: ResearchReportVersionView[];
  activeReportVersionId?: string;
  sourceScope?: {
    searchEnabled: boolean;
    toolIds: string[];
    knowledgeCount: number;
    attachmentCount: number;
    workspaceCount: number;
    pluginCount: number;
  };
  usage: {
    toolRounds: number;
    maxToolRounds: number;
    toolCalls: number;
    maxToolCalls: number;
    elapsedMs: number;
    maxWallTimeMs: number;
    totalTokens?: number;
    maxTotalTokens?: number;
  };
}

export interface ResearchTaskActions {
  onConfirmPlan?: () => void;
  onAdjustPlan?: (instruction: string) => void | Promise<void>;
  onUpdatePlanStrategy?: (strategy: {
    initialBreadth: number;
    maxDepth: number;
    maxQueries: number;
    resultsPerQuery: number;
  }) => void | Promise<void>;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  onNewFollowUp?: () => void;
}
