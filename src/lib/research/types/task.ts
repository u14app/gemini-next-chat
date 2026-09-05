import type { AgentRunBudget } from "@/lib/assistant/types";

import type { ResearchEvidence } from "./evidence";
import type { ResearchPlanVersion, ResearchSourceSnapshot } from "./plan";
import type {
  INTERNAL_AGENT_RESEARCH_PROVIDER_ID,
  RESEARCH_TASK_SCHEMA_VERSION,
  ResearchBudgetPreset,
  ResearchStrategy,
  ResearchTaskStatus,
  ResearchUsage,
  ResolvedResearchBudget,
} from "./primitives";
import type {
  ResearchCheckpoint,
  ResearchReportKind,
  ResearchReportRun,
  ResearchReportVersion,
} from "./run";
import type { ResearchImageSource } from "./images";

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
  /** Exact model selected for the request that created this task. */
  requestModel?: string;
  goal: string;
  status: ResearchTaskStatus;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  budgetPreset: ResearchBudgetPreset;
  budget: ResolvedResearchBudget;
  requestedStrategy?: ResearchStrategy;
  usage: ResearchUsage;
  /** All normalized illustrative images discovered by this task. */
  imageSources?: ResearchImageSource[];
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
  requestModel?: string;
  goal: string;
  budgetPreset?: ResearchBudgetPreset;
  requestedStrategy?: ResearchStrategy;
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
