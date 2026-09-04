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
  preferredDomains?: string[];
  excludedDomains?: string[];
}

export interface ResearchDeliverableView {
  kind: ResearchDeliverableKind;
  description?: string;
  requiredSections?: string[];
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
  status: "completed" | "failed" | "timed_out";
  resultCount: number;
  domains: string[];
}

export interface ResearchStopReasonView {
  code: string;
  detail?: string;
}

export interface ResearchReconView {
  status: "completed" | "partial" | "unavailable" | "skipped";
  queryCount: number;
  maxQueries: number;
  resultsPerQuery: number;
  durationMs?: number;
  queries: ResearchReconQueryView[];
  knowledgeQueries?: Array<Omit<ResearchReconQueryView, "domains">>;
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
  packetStatus?: "valid" | "repaired" | "degraded";
  degradedNodeIds?: string[];
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
  /** Wall-clock start of the live run, so the UI can tick elapsed time. */
  startedAt: number;
  /** Set once the run stops, freezing the elapsed clock. */
  endedAt?: number;
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
  coverage: {
    coveredStepCount: number;
    requiredStepCount: number;
    ratio: number;
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
  linkedClaims: Array<{
    id: string;
    text: string;
    importance: "major" | "background";
    verificationStatus: "pending" | "verified" | "unsupported" | "unresolved";
  }>;
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
  kind?: "initial" | "continue" | "update";
  gaps?: string[];
  coveredStepIds?: string[];
  planStepCount?: number;
  stopReason?: ResearchStopReasonView;
  diff?: {
    addedEvidenceIds: string[];
    changedSourceIds: string[];
    unchangedSourceIds: string[];
  };
  audit?: {
    blocking: string[];
    advisory: string[];
    unknownCitationCount: number;
    unsupportedFindingCount: number;
    missingSectionCount: number;
  };
  claims?: ResearchClaimView[];
}

/**
 * A persisted tool execution can outlive the task state that produced it.
 * Keeping this status on the activity view lets the UI distinguish an active
 * operation from a stale prepared record without inferring from list order.
 */
export type ResearchActivityStatus =
  | "info"
  | "prepared"
  | "running"
  | "committed"
  | "completed"
  | "failed"
  | "effect_unknown"
  | "interrupted";

export interface ResearchClaimView {
  id: string;
  text: string;
  importance: "major" | "background";
  verificationStatus: "pending" | "verified" | "unsupported" | "unresolved";
  independentPublisherCount: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  stepId: string;
}

export interface ResearchActivityView {
  id: string;
  createdAt: number;
  phase: ResearchTaskStatus;
  status: ResearchActivityStatus;
  title: string;
  detail?: string;
  tone?: "warning";
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
  claims?: ResearchClaimView[];
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
