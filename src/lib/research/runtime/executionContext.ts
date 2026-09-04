import type { RefObject } from "react";
import type { useTranslations } from "next-intl";

import type {
  AgentUserInputController,
  Message,
  ToolConfirmationController,
} from "@/types";
import {
  upsertResearchReportRun,
  type ResearchCheckpoint,
  type ResearchEvidence,
  type ResearchPlanVersion,
  type ResearchReportRun,
  type ResearchSourceSnapshot,
  type ResearchTask,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import type { ResearchSteeringRecord } from "@/lib/research/steering";

import type { RunningOperation } from "./operations";
import type { buildResearchExecutionSourceContext } from "./sourceSnapshot";
import type { ResearchDependencyText, resolveTaskContext } from "./taskContext";
import { aggregateTaskUsage } from "./usage";

export type ResearchTranslate = ReturnType<typeof useTranslations<"Research">>;

export type ResearchRuntimeErrorText = (
  error: unknown,
  fallbackKey: "planFallback" | "executionFallback" | "budgetFallback",
) => string;

type ResearchStoreState = ReturnType<typeof useResearchStore.getState>;
type ResearchTaskContext = ReturnType<typeof resolveTaskContext>;
type ResearchExecutionSourceContext = ReturnType<
  typeof buildResearchExecutionSourceContext
>;

/**
 * The former `executeResearch` closure, made explicit. Everything above the
 * mutable block is fixed for the whole run; the mutable block is the direct
 * translation of the locals the stages used to share through scope.
 *
 * `store` is a getter so asynchronous stages always see the latest task state.
 */
export interface ResearchExecutionContext {
  readonly store: ResearchStoreState;
  readonly taskId: string;
  readonly controller: AbortController;
  readonly plan: ResearchPlanVersion;
  readonly researchModel: string;
  readonly chatConfig: ResearchTaskContext["chatConfig"];
  readonly effective: ResearchTaskContext["effective"];
  readonly settings: ResearchTaskContext["settings"];
  readonly operationsRef: RefObject<Map<string, RunningOperation>>;
  readonly userInputController: AgentUserInputController;
  readonly toolConfirmationController?: ToolConfirmationController;
  readonly t: ResearchTranslate;
  readonly localizedRuntimeError: ResearchRuntimeErrorText;
  readonly dependencyText: ResearchDependencyText;
  readonly onNotice?: (message: string) => void;
  readonly currentAttachments: NonNullable<Message["attachments"]>;
  readonly priorReport: string;
  readonly resumeAtVerification: boolean;
  readonly resumeAtSynthesis: boolean;
  readonly explorationQueryLimit: number;
  readonly explorationToolCallCap: number;
  readonly sourceBodyLimit: number;
  task: ResearchTask;
  snapshot: ResearchSourceSnapshot;
  sourceContext: ResearchExecutionSourceContext;
  run: ResearchReportRun;
  evidence: ResearchEvidence[];
  /** Best generated text retained until this run's report is durably published. */
  reportDraft?: string;
  lastAgentRunId?: string;
  steeringLockHeld?: boolean;
  steeringRecord?: ResearchSteeringRecord;
}

export async function persistRun(
  ctx: ResearchExecutionContext,
  nextRun: ResearchReportRun,
  evidence: ResearchEvidence[] = ctx.evidence,
  checkpoint?: ResearchCheckpoint,
) {
  const savedTask = await ctx.store.updateTask(ctx.taskId, (current) => {
    const withRun = upsertResearchReportRun(current, nextRun);
    return {
      ...withRun,
      evidence,
      usage: aggregateTaskUsage(withRun),
      ...(checkpoint ? { checkpoint } : { checkpoint: undefined }),
    };
  });
  ctx.run = nextRun;
  ctx.evidence = evidence;
  if (savedTask) ctx.task = savedTask;
}
