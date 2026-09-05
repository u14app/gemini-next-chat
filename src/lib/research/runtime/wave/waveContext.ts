import type { Message, Source, ToolCall } from "@/types";
import type {
  ResearchReportRun,
  ResearchImageSource,
  SavedResearchCheckpoint,
} from "@/lib/research";
import type {
  BuiltinResearchQueryBudget,
  BuiltinResearchSourceBudget,
} from "@/services/api/chat/builtinTools";

import type { ResearchExecutionContext } from "../executionContext";
import type { collectTaskEvidence } from "../evidenceCollection";
import type { remainingBudget } from "../usage";

export interface ResearchWaveInput {
  run: ResearchReportRun;
  waveId: string;
  nodeIds: string[];
  phase: "exploring" | "verifying";
  queryAllowance: number;
  expandFrontier: boolean;
}

export type ResearchWaveEvidence = Awaited<
  ReturnType<typeof collectTaskEvidence>
>;

/**
 * The former `executeWave` closure. Fields above the mutable block are settled
 * by `prepareWave`; the mutable block is written by the streaming callbacks and
 * read back by the checkpoint writer.
 */
export interface ResearchWaveContext extends ResearchWaveInput {
  readonly ctx: ResearchExecutionContext;
  readonly agentRunId: string;
  readonly resumeThisWave: boolean;
  readonly savedCheckpoint: SavedResearchCheckpoint | null;
  readonly checkpointPath: string;
  readonly availableBudget: NonNullable<ReturnType<typeof remainingBudget>>;
  readonly phaseToolCallAllowance: number;
  readonly reservedModelRounds: number;
  readonly wavePrompt: string;
  readonly executedQueries: string[];
  readonly readLocators: string[];
  readonly queryBudget: BuiltinResearchQueryBudget;
  readonly sourceBudget: BuiltinResearchSourceBudget;
  readonly resumeHistory: Message[];
  activeRun: ResearchReportRun;
  latestContent: string;
  latestToolCalls: ToolCall[];
  webSources: Source[];
  knowledgeSources: Source[];
  imageSources: ResearchImageSource[];
  checkpointQueue: Promise<void>;
}
