import type {
  LearningPacket,
  ResearchDeliverableContract,
  ResearchPlanStepV2,
  ResearchScope,
  ResearchSourceType,
  ResearchStrategy,
} from "../types";

export interface ResearchPlanDraftV2 {
  title: string;
  summary: string;
  objective: string;
  scope: ResearchScope;
  assumptions: string[];
  deliverable: ResearchDeliverableContract;
  strategy: ResearchStrategy;
  steps: ResearchPlanStepV2[];
  completionCriteria: string[];
}

export interface StructuredResearchParseError {
  code: "RESEARCH_PLAN_INVALID" | "RESEARCH_WAVE_INVALID";
  message: string;
  issues: string[];
}

export type ParsedResearchPlan =
  | { valid: true; data: ResearchPlanDraftV2 }
  | { valid: false; error: StructuredResearchParseError };

export type ParsedResearchWavePackets =
  | {
      valid: true;
      data: LearningPacket[];
      missingNodeKeys: [];
      invalidNodeKeys: [];
    }
  | {
      valid: false;
      data: LearningPacket[];
      missingNodeKeys: string[];
      invalidNodeKeys: string[];
      error: StructuredResearchParseError;
    };

export interface ResearchWaveNodeAlias {
  key: string;
  nodeId: string;
  stepId: string;
  objective: string;
}

export interface ResearchWaveSourceAlias {
  key: string;
  sourceId: string;
  evidenceIds: string[];
  title?: string;
  locator: string;
  sourceType: ResearchSourceType;
  retrievedAt: number;
}

export interface ResearchWaveAliasContext {
  nodes: ResearchWaveNodeAlias[];
  sources: ResearchWaveSourceAlias[];
}
