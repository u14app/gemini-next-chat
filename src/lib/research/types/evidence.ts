import type { ResearchPriority, ResearchSourceType } from "./primitives";

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
