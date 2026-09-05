import type { ClaimRecord, LearningPacket } from "./evidence";
import type {
  ResearchSourceType,
  ResearchStrategy,
  ResearchTaskStatus,
} from "./primitives";
import type { ResearchImageSource } from "./images";

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
  | "coverage_sufficient"
  | "max_depth"
  | "max_queries"
  | "max_sources"
  | "budget_exhausted"
  | "no_new_sources"
  | "invalid_model_output"
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

export interface ResearchScopeExpansionEvent {
  id: string;
  at: number;
  sourceSnapshotCapturedAt: number;
  packetIds: string[];
  addedSourceTypes: ResearchSourceType[];
  scheduledFollowUpIds: string[];
  unavailableSourceFollowUpIds: string[];
  duplicateFollowUpIds: string[];
  breadthLimitedFollowUpIds: string[];
  depthLimitedFollowUpIds: string[];
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

export type ResearchWavePacketStatus = "valid" | "repaired" | "degraded";

export interface ResearchWave {
  id: string;
  index: number;
  depth: number;
  breadth: number;
  nodeIds: string[];
  status: ResearchWaveStatus;
  packetStatus?: ResearchWavePacketStatus;
  degradedNodeIds?: string[];
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
  /** Image material is separate from formal evidence and never affects budget. */
  committedImageSourceIds?: string[];
}

export type ResearchReportKind = "initial" | "continue" | "update";

export interface ResearchReportAuditSnapshot {
  blocking: string[];
  advisory: string[];
  unknownCitationCount: number;
  unsupportedFindingCount: number;
  missingSectionCount: number;
}

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
  /** Illustrative search material collected during this run. */
  imageSources?: ResearchImageSource[];
  executedQueries: string[];
  frontierNodeIds: string[];
  coverage: ResearchCoverage;
  usage: ResearchReportRunUsage;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  stopReason?: ResearchStopReason;
  checkpoint?: ResearchRunCheckpoint;
  scopeExpansionEvents?: ResearchScopeExpansionEvent[];
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
  /** Snapshot of the image catalog available when this report was published. */
  imageSources?: ResearchImageSource[];
  /** Missing only on legacy versions, which may use restricted reconstruction. */
  evidenceSnapshotStatus?: "available" | "unavailable";
  diff?: {
    addedEvidenceIds: string[];
    changedSourceIds: string[];
    unchangedSourceIds: string[];
  };
  audit?: ResearchReportAuditSnapshot;
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
  committedImageSourceIds?: string[];
}
