import type {
  AgentApprovalMode,
  AgentMemoryScope,
} from "@/lib/assistant/types";

import type {
  ResearchDeliverableContract,
  ResearchPriority,
  ResearchReconSnapshot,
  ResearchScope,
  ResearchSourcePriority,
  ResearchStrategy,
} from "./primitives";

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
