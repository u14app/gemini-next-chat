import type {
  AgentApprovalMode,
  AgentMemoryScope,
  AgentRunBudget,
} from "@/lib/assistant/types";

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

export interface ResearchPlanStepV2 {
  id: string;
  title: string;
  objective: string;
  questions: string[];
  queryTopics: string[];
  sourcePriorities: ResearchSourcePriority[];
  evidenceCriteria: string[];
  priority: ResearchPriority;
}

export interface ResearchPlanVersionV2 {
  id: string;
  version: number;
  title: string;
  summary: string;
  objective: string;
  scope: ResearchScope;
  assumptions: string[];
  deliverable: ResearchDeliverableContract;
  strategy: ResearchStrategy;
  recon: ResearchReconSnapshot;
  steps: ResearchPlanStepV2[];
  completionCriteria: string[];
  createdAt: number;
  adjustment?: string;
}

export type ResearchPlanVersion = ResearchPlanVersionV2;

export interface ResearchSourceSnapshot {
  model?: string;
  reasoningMode?: "off" | "auto" | "low" | "medium" | "high";
  approvalMode: AgentApprovalMode;
  searchEnabled: boolean;
  toolIds: string[];
  pluginIds: string[];
  skillIds: string[];
  knowledgeCollectionIds: string[];
  attachmentIds: string[];
  workspaceFileIds: string[];
  workspaceSources?: Array<{
    path: string;
    contentHash: string;
    revision: string;
  }>;
  memoryScopes: AgentMemoryScope[];
  memoryScopeIds: {
    workspace?: string;
    agent?: string;
    session?: string;
  };
  capturedAt: number;
}

export type ResearchEvidenceAuthority = "primary" | "secondary" | "unknown";

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  aliasSourceIds?: string[];
  sourceType: ResearchSourceType;
  stepId: string;
  nodeId: string;
  title?: string;
  locator: string;
  aliasLocators?: string[];
  retrievedAt: number;
  contentHash: string;
  publisherId?: string;
  authority?: ResearchEvidenceAuthority;
  mirrorOfSourceId?: string;
  toolCallId?: string;
  agentRunId?: string;
  claimIds: string[];
  stance?: "supports" | "contradicts" | "context";
  freshness?: "current" | "stale" | "unknown";
  availability?: "available" | "unavailable";
  relations?: ResearchEvidenceRelation[];
}

export interface ResearchEvidenceRelation {
  researchRunId: string;
  stepId: string;
  nodeId: string;
  claimIds: string[];
  stance: "supports" | "contradicts" | "context";
  boundAt: number;
}

export type ResearchClaimImportance = "major" | "background";
export type ResearchClaimVerificationStatus =
  "pending" | "verified" | "unsupported" | "unresolved";

export interface ClaimRecord {
  id: string;
  text: string;
  importance: ResearchClaimImportance;
  stepId: string;
  nodeIds: string[];
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  verificationStatus: ResearchClaimVerificationStatus;
  independentPublisherCount: number;
  createdAt: number;
  updatedAt: number;
}

export type ResearchScopeImpact =
  "within" | "source_expansion" | "scope_expansion";

export interface ResearchLearning {
  id: string;
  claimId: string;
  claimText: string;
  stepId: string;
  importance: ResearchClaimImportance;
  stance: "supports" | "contradicts" | "context";
  statement: string;
  sourceIds: string[];
  evidenceIds: string[];
}

export interface ResearchFollowUp {
  id: string;
  question: string;
  rationale: string;
  priority: ResearchPriority;
  scopeImpact: ResearchScopeImpact;
  requiredSourceTypes: ResearchSourceType[];
}

export interface ResearchSourceAssessment {
  sourceId: string;
  authority: ResearchEvidenceAuthority;
  publisherId?: string;
  mirrorOfSourceId?: string;
  rationale: string;
}

export interface LearningPacket {
  id: string;
  nodeId: string;
  learnings: ResearchLearning[];
  sourceAssessments: ResearchSourceAssessment[];
  followUps: ResearchFollowUp[];
  createdAt: number;
}

export type ResearchNodeStatus =
  | "pending"
  | "queued"
  | "searching"
  | "reading"
  | "learning"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type ResearchStopReasonCode =
  | "coverage_satisfied"
  | "max_depth"
  | "max_queries"
  | "max_sources"
  | "budget_exhausted"
  | "no_new_sources"
  | "no_new_verified_claims"
  | "frontier_exhausted"
  | "user_paused"
  | "user_cancelled"
  | "dependency_unavailable"
  | "scope_approval_required";

export interface ResearchStopReason {
  code: ResearchStopReasonCode;
  at: number;
  detail?: string;
}

export interface ResearchNode {
  id: string;
  parentNodeId?: string;
  waveId?: string;
  stepId: string;
  depth: number;
  objective: string;
  query: string;
  status: ResearchNodeStatus;
  sourceIds: string[];
  evidenceIds: string[];
  claimIds: string[];
  learningPacketId?: string;
  stopReason?: ResearchStopReason;
  createdAt: number;
  updatedAt: number;
}

export type ResearchWaveStatus =
  "queued" | "running" | "completed" | "paused" | "failed";

export interface ResearchWave {
  id: string;
  index: number;
  depth: number;
  breadth: number;
  nodeIds: string[];
  status: ResearchWaveStatus;
  newEvidenceCount: number;
  newVerifiedClaimCount: number;
  startedAt?: number;
  completedAt?: number;
}

export type ResearchRunPhase =
  | "queued"
  | "exploring"
  | "verifying"
  | "synthesizing"
  | "awaiting_scope_approval"
  | "paused"
  | "completed"
  | "partial_completed"
  | "failed"
  | "cancelled";

export interface ResearchCoverage {
  requiredStepCount: number;
  coveredStepCount: number;
  majorClaimCount: number;
  verifiedMajorClaimCount: number;
  unresolvedMajorClaimCount: number;
  stepRatio: number;
  claimRatio: number;
  overallRatio: number;
  complete: boolean;
}

export interface ResearchReportRunUsage {
  queryCount: number;
  sourceBodyCount: number;
  toolRounds: number;
  toolCalls: number;
  wallTimeMs: number;
  totalTokens: number;
}

export interface ResearchRunCheckpoint {
  createdAt: number;
  waveIndex: number;
  frontierNodeIds: string[];
  committedEvidenceIds: string[];
  committedToolExecutionIds: string[];
}

export type ResearchReportKind = "initial" | "continue" | "update";

export interface ResearchReportRun {
  id: string;
  taskId: string;
  planVersion: number;
  reportKind: ResearchReportKind;
  phase: ResearchRunPhase;
  strategy: ResearchStrategy;
  waves: ResearchWave[];
  nodes: ResearchNode[];
  learningPackets: LearningPacket[];
  claims: ClaimRecord[];
  executedQueries: string[];
  frontierNodeIds: string[];
  coverage: ResearchCoverage;
  usage: ResearchReportRunUsage;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  stopReason?: ResearchStopReason;
  checkpoint?: ResearchRunCheckpoint;
}

export interface ResearchReportVersion {
  id: string;
  version: number;
  artifactId: string;
  planVersion: number;
  researchRunId: string;
  createdAt: number;
  summary: string;
  keyFindings: string[];
  gaps: string[];
  coveredStepIds?: string[];
  evidenceIds?: string[];
  diff?: {
    addedEvidenceIds: string[];
    changedSourceIds: string[];
    unchangedSourceIds: string[];
  };
  agentRunId?: string;
  kind: ResearchReportKind;
}

export interface ResearchCheckpoint {
  createdAt: number;
  resumeStatus: ResearchTaskStatus;
  committedEvidenceIds: string[];
  committedToolExecutionIds: string[];
  researchRunId?: string;
  historyPath?: string;
}

export interface ResearchTaskError {
  code?: string;
  message: string;
  recoverable?: boolean;
}

export interface ResearchTask {
  schemaVersion: typeof RESEARCH_TASK_SCHEMA_VERSION;
  providerId: typeof INTERNAL_AGENT_RESEARCH_PROVIDER_ID;
  id: string;
  sessionId: string;
  userMessageId?: string;
  cardMessageId?: string;
  goal: string;
  status: ResearchTaskStatus;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  budgetPreset: ResearchBudgetPreset;
  budget: ResolvedResearchBudget;
  usage: ResearchUsage;
  sourceSnapshot?: ResearchSourceSnapshot;
  planVersions: ResearchPlanVersion[];
  activePlanVersion?: number;
  evidence: ResearchEvidence[];
  reportRuns: ResearchReportRun[];
  activeReportRunId?: string;
  reportVersions: ResearchReportVersion[];
  activeReportVersion?: number;
  pendingReportKind: ResearchReportKind;
  agentRunIds: string[];
  executionRunIds: string[];
  checkpoint?: ResearchCheckpoint;
  error?: ResearchTaskError;
}

export interface CreateResearchTaskInput {
  id?: string;
  sessionId: string;
  userMessageId?: string;
  cardMessageId?: string;
  goal: string;
  budgetPreset?: ResearchBudgetPreset;
  profileBudget?: AgentRunBudget;
  now?: number;
}

export type ResearchProviderEvent =
  | { type: "status"; status: ResearchTaskStatus; at: number }
  | { type: "evidence"; evidence: ResearchEvidence; at: number }
  | { type: "usage"; usage: ResearchUsage; at: number }
  | { type: "run"; run: ResearchReportRun; at: number }
  | { type: "report"; report: ResearchReportVersion; at: number };

export interface PrepareResearchPlanInput {
  task: ResearchTask;
  adjustment?: string;
  signal?: AbortSignal;
}

export interface ExecuteResearchInput {
  task: ResearchTask;
  checkpoint?: ResearchCheckpoint;
  signal: AbortSignal;
  onEvent: (event: ResearchProviderEvent) => void | Promise<void>;
}

export interface ResearchProvider {
  readonly id: string;
  preparePlan(input: PrepareResearchPlanInput): Promise<ResearchPlanVersion>;
  execute(input: ExecuteResearchInput): Promise<void>;
}
