import type { AgentRunBudget } from "@/lib/assistant/types";
import type { AgentRun } from "@/lib/agent";
import { resolveResearchStrategy } from "./orchestration";

import {
  INTERNAL_AGENT_RESEARCH_PROVIDER_ID,
  RESEARCH_TASK_SCHEMA_VERSION,
  type CreateResearchTaskInput,
  type ResearchActiveStatus,
  type ResearchBudgetPreset,
  type ResearchCheckpoint,
  type ResearchTask,
  type ResearchTaskStatus,
  type ResolvedResearchBudget,
} from "./types";

export const RESEARCH_BUDGET_PRESETS: Readonly<
  Record<ResearchBudgetPreset, ResolvedResearchBudget>
> = {
  quick: {
    maxToolRounds: 6,
    maxToolCalls: 20,
    maxDurationMs: 5 * 60 * 1_000,
  },
  standard: {
    maxToolRounds: 12,
    maxToolCalls: 50,
    maxDurationMs: 15 * 60 * 1_000,
  },
  deep: {
    maxToolRounds: 20,
    maxToolCalls: 100,
    maxDurationMs: 30 * 60 * 1_000,
  },
};

const TERMINAL_STATUSES = new Set<ResearchTaskStatus>([
  "completed",
  "partial_completed",
  "failed",
  "cancelled",
]);

const TRANSITIONS: Record<ResearchTaskStatus, Set<ResearchTaskStatus>> = {
  draft: new Set(["clarifying", "plan_ready", "paused", "failed", "cancelled"]),
  clarifying: new Set(["plan_ready", "paused", "failed", "cancelled"]),
  plan_ready: new Set([
    "clarifying",
    "researching",
    "paused",
    "failed",
    "cancelled",
  ]),
  researching: new Set([
    "verifying",
    "synthesizing",
    "paused",
    "failed",
    "cancelled",
  ]),
  verifying: new Set(["synthesizing", "paused", "failed", "cancelled"]),
  synthesizing: new Set([
    "completed",
    "partial_completed",
    "paused",
    "failed",
    "cancelled",
  ]),
  paused: new Set([
    "draft",
    "clarifying",
    "plan_ready",
    "researching",
    "verifying",
    "synthesizing",
    "failed",
    "cancelled",
  ]),
  completed: new Set(["clarifying", "plan_ready", "failed"]),
  partial_completed: new Set(["clarifying", "plan_ready", "failed"]),
  failed: new Set(["clarifying", "cancelled"]),
  cancelled: new Set(),
};

export class ResearchTaskTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchTaskTransitionError";
  }
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return `${prefix}-${randomUuid()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value! > 0 ? value : undefined;
}

function minWithCap(value: number, cap: number | undefined): number {
  const validCap = positiveInteger(cap);
  return validCap === undefined ? value : Math.min(value, validCap);
}

export function resolveResearchBudget(
  preset: ResearchBudgetPreset,
  profileBudget?: AgentRunBudget,
): ResolvedResearchBudget {
  const defaults = RESEARCH_BUDGET_PRESETS[preset];
  return {
    maxToolRounds: minWithCap(
      defaults.maxToolRounds,
      profileBudget?.maxToolRounds,
    ),
    maxToolCalls: minWithCap(
      defaults.maxToolCalls,
      profileBudget?.maxToolCalls,
    ),
    maxDurationMs: minWithCap(
      defaults.maxDurationMs,
      profileBudget?.maxDurationMs,
    ),
    ...(positiveInteger(profileBudget?.maxTotalTokens) !== undefined
      ? { maxTotalTokens: profileBudget!.maxTotalTokens }
      : {}),
  };
}

export function isTerminalResearchStatus(status: ResearchTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransitionResearchTask(
  from: ResearchTaskStatus,
  to: ResearchTaskStatus,
): boolean {
  return from === to || TRANSITIONS[from].has(to);
}

export function createResearchTask(
  input: CreateResearchTaskInput,
): ResearchTask {
  const now = input.now ?? Date.now();
  if (!input.sessionId.trim()) {
    throw new ResearchTaskTransitionError("sessionId must not be empty.");
  }
  if (!input.goal.trim()) {
    throw new ResearchTaskTransitionError("goal must not be empty.");
  }
  const budgetPreset = input.budgetPreset ?? "standard";
  return {
    schemaVersion: RESEARCH_TASK_SCHEMA_VERSION,
    providerId: INTERNAL_AGENT_RESEARCH_PROVIDER_ID,
    id: input.id ?? createId("research"),
    sessionId: input.sessionId,
    ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
    ...(input.cardMessageId ? { cardMessageId: input.cardMessageId } : {}),
    goal: input.goal.trim(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    budgetPreset,
    budget: resolveResearchBudget(budgetPreset, input.profileBudget),
    requestedStrategy: resolveResearchStrategy(
      budgetPreset,
      input.requestedStrategy,
    ),
    usage: { toolRounds: 0, toolCalls: 0, wallTimeMs: 0, totalTokens: 0 },
    planVersions: [],
    evidence: [],
    reportRuns: [],
    reportVersions: [],
    pendingReportKind: "initial",
    agentRunIds: [],
    executionRunIds: [],
  };
}

export interface TransitionResearchTaskOptions {
  now?: number;
  checkpoint?: ResearchCheckpoint;
}

export function transitionResearchTask(
  task: ResearchTask,
  status: ResearchTaskStatus,
  options: TransitionResearchTaskOptions = {},
): ResearchTask {
  if (!canTransitionResearchTask(task.status, status)) {
    throw new ResearchTaskTransitionError(
      `Cannot transition research task from ${task.status} to ${status}.`,
    );
  }
  if (task.status === status) return task;

  const now = Math.max(task.updatedAt, options.now ?? Date.now());
  const isTerminal = isTerminalResearchStatus(status);
  return {
    ...task,
    status,
    updatedAt: now,
    ...(isTerminal ? { endedAt: now } : { endedAt: undefined }),
    ...(status === "paused"
      ? {
          checkpoint:
            options.checkpoint ??
            createRecoveryCheckpoint(task, task.status, now),
        }
      : {}),
  };
}

function createRecoveryCheckpoint(
  task: ResearchTask,
  resumeStatus: ResearchTaskStatus,
  now: number,
): ResearchCheckpoint {
  return {
    createdAt: now,
    resumeStatus,
    committedEvidenceIds: task.evidence.map((item) => item.id),
    committedToolExecutionIds: [],
    ...(task.activeReportRunId
      ? { researchRunId: task.activeReportRunId }
      : {}),
  };
}

export function recoverResearchTask(
  task: ResearchTask,
  now: number = Date.now(),
): ResearchTask {
  const activePlan = task.planVersions.find(
    (plan) => plan.version === task.activePlanVersion,
  );
  const recovered = task.requestedStrategy
    ? task
    : {
        ...task,
        requestedStrategy: resolveResearchStrategy(
          task.budgetPreset,
          activePlan?.strategy,
        ),
      };
  if (
    isTerminalResearchStatus(recovered.status) ||
    recovered.status === "paused"
  ) {
    return recovered;
  }
  return transitionResearchTask(recovered, "paused", {
    now,
    ...(recovered.checkpoint ? { checkpoint: recovered.checkpoint } : {}),
  });
}

export function isActiveResearchStatus(
  status: ResearchTaskStatus,
): status is ResearchActiveStatus {
  return (
    status === "researching" ||
    status === "verifying" ||
    status === "synthesizing"
  );
}

/**
 * Returns the execution runs charged to the current report attempt. Completed
 * report versions include every resumed run since the preceding report;
 * follow-up plans start after the latest published report.
 */
export function getCurrentResearchReportRunIds(task: ResearchTask): string[] {
  const completedCurrentReport =
    task.status === "completed" || task.status === "partial_completed";
  const boundaryReport = completedCurrentReport
    ? task.reportVersions.at(-2)
    : task.reportVersions.at(-1);
  const boundaryRunId = boundaryReport?.agentRunId;
  if (!boundaryRunId) return [...task.executionRunIds];
  const boundaryIndex = task.executionRunIds.lastIndexOf(boundaryRunId);
  return boundaryIndex < 0
    ? [...task.executionRunIds]
    : task.executionRunIds.slice(boundaryIndex + 1);
}

export type ResearchRunResumeDecision =
  | { action: "new" }
  | { action: "resume"; runId: string }
  | { action: "unavailable"; runId: string };

/** Resume only the same interrupted run so committed calls cannot be replayed. */
export function getResearchRunResumeDecision(
  task: ResearchTask,
  runsById: Readonly<Record<string, AgentRun>>,
): ResearchRunResumeDecision {
  const runId = getCurrentResearchReportRunIds(task).at(-1);
  if (!task.checkpoint || !runId) return { action: "new" };
  if (!task.checkpoint.historyPath) return { action: "new" };
  return runsById[runId]?.status === "interrupted"
    ? { action: "resume", runId }
    : { action: "unavailable", runId };
}
