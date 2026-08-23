import { PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import type { ToolInvocationPolicy, ToolEffect } from "@/lib/plugin/types";

export const AGENT_RUN_SCHEMA_VERSION = 1 as const;

export type AgentRunStatus =
  | "running"
  | "awaiting_input"
  | "awaiting_approval"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRunStopReason =
  | "completed"
  | "user_stopped"
  | "budget_exhausted"
  | "offline"
  | "page_interrupted"
  | "effect_unknown"
  | "runtime_error";

export type AgentRunBudgetDimension =
  "tool_rounds" | "tool_calls" | "tokens" | "wall_time";

export interface ResolvedAgentRunBudget {
  maxToolRounds: number;
  maxToolCalls: number;
  maxTotalTokens?: number;
  maxDurationMs?: number;
}

export interface AgentRunUsage {
  modelRounds: number;
  toolRounds: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  wallTimeMs: number;
}

export interface AgentRunError {
  code?: string;
  message: string;
  recoverable?: boolean;
}

export interface AgentRunStop {
  reason: AgentRunStopReason;
  at: number;
  budgetDimension?: AgentRunBudgetDimension;
  error?: AgentRunError;
}

export type AgentActivityKind =
  | "run_started"
  | "status_changed"
  | "model_round_completed"
  | "tool_prepared"
  | "tool_running"
  | "tool_committed"
  | "tool_failed"
  | "tool_effect_unknown"
  | "checkpoint";

/**
 * A deliberately small event record. Raw prompts, tool arguments, and tool
 * results do not belong in the run journal.
 */
export interface AgentActivity {
  id: string;
  runId: string;
  sequence: number;
  kind: AgentActivityKind;
  at: number;
  status?: AgentRunStatus;
  toolExecutionId?: string;
  round?: number;
}

export type ToolExecutionStatus =
  "prepared" | "running" | "committed" | "failed" | "effect_unknown";

export interface ToolResultReference {
  kind: "artifact" | "workspace_file" | "tool_cache";
  id: string;
  contentHash?: string;
}

export interface ToolEffectReceipt {
  committedAt: number;
  effectId?: string;
  targetHash?: string;
  resultHash?: string;
  reversible?: boolean;
}

export interface AgentEvidenceRecord {
  sourceId: string;
  url: string;
  title?: string;
  retrievedAt: number;
  contentHash: string;
  retrievalKind: "search" | "fetch" | "attachment" | "mcp";
  toolCallId: string;
}

/**
 * The persisted execution record contains only digests and references. The
 * original arguments and result payload stay in their purpose-built stores.
 */
export interface ToolExecutionRecord {
  id: string;
  runId: string;
  callId: string;
  toolName: string;
  pluginId?: string;
  definitionFingerprint: string;
  argumentsHash: string;
  targetSummary?: string;
  round?: number;
  policy: ToolInvocationPolicy;
  status: ToolExecutionStatus;
  attempt: number;
  preparedAt: number;
  startedAt?: number;
  endedAt?: number;
  resultRefs?: ToolResultReference[];
  receipt?: ToolEffectReceipt;
  error?: AgentRunError;
}

export interface AgentRun {
  schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  userMessageId?: string;
  modelMessageId?: string;
  model?: string;
  status: AgentRunStatus;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  budget: ResolvedAgentRunBudget;
  usage: AgentRunUsage;
  stop?: AgentRunStop;
  activities: AgentActivity[];
  toolExecutions: ToolExecutionRecord[];
  evidence: AgentEvidenceRecord[];
}

export interface CreateAgentRunInput {
  id?: string;
  sessionId: string;
  userMessageId?: string;
  modelMessageId?: string;
  model?: string;
  budget?: Partial<ResolvedAgentRunBudget>;
  now?: number;
}

export interface PrepareToolExecutionInput {
  id?: string;
  callId: string;
  toolName: string;
  pluginId?: string;
  definitionFingerprint: string;
  argumentsHash: string;
  targetSummary?: string;
  round?: number;
  policy: ToolInvocationPolicy;
  at?: number;
}

export type ToolReplayDecision =
  | {
      action: "execute";
      reason: "not_started";
    }
  | {
      action: "reuse";
      reason: "committed";
      resultRefs: ToolResultReference[];
    }
  | {
      action: "retry";
      reason: "read_only" | "idempotent";
    }
  | {
      action: "block";
      reason:
        | "effect_unknown"
        | "in_flight_effect_unconfirmed"
        | "failed_non_idempotent";
    };

export const DEFAULT_AGENT_RUN_BUDGET: Readonly<ResolvedAgentRunBudget> = {
  maxToolRounds: PLUGIN_EXECUTION_LIMITS.maxToolRounds,
  maxToolCalls: PLUGIN_EXECUTION_LIMITS.maxTotalToolCalls,
};

const TERMINAL_RUN_STATUSES = new Set<AgentRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const RUN_STATUS_TRANSITIONS: Record<AgentRunStatus, Set<AgentRunStatus>> = {
  running: new Set([
    "awaiting_input",
    "awaiting_approval",
    "interrupted",
    "completed",
    "failed",
    "cancelled",
  ]),
  awaiting_input: new Set(["running", "interrupted", "failed", "cancelled"]),
  awaiting_approval: new Set(["running", "interrupted", "failed", "cancelled"]),
  interrupted: new Set(["running", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

const STOP_REASONS_BY_STATUS: Partial<
  Record<AgentRunStatus, Set<AgentRunStopReason>>
> = {
  interrupted: new Set(["offline", "page_interrupted", "effect_unknown"]),
  completed: new Set(["completed"]),
  failed: new Set(["budget_exhausted", "effect_unknown", "runtime_error"]),
  cancelled: new Set(["user_stopped"]),
};

const READ_ONLY_EFFECTS = new Set<ToolEffect>(["local_read", "network_read"]);
const UNCERTAIN_IN_FLIGHT_EFFECTS = new Set<ToolEffect>([
  "local_destructive",
  "external_write",
  "external_destructive",
]);

export class AgentRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunTransitionError";
  }
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return `${prefix}-${randomUuid()}`;

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new AgentRunTransitionError(`${label} must not be empty.`);
  }
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AgentRunTransitionError(
      `${label} must be a non-negative finite timestamp.`,
    );
  }
}

function normalizeEventTime(run: AgentRun, at: number): number {
  assertTimestamp(at, "event time");
  return Math.max(run.updatedAt, at);
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number | undefined,
  label: string,
): number | undefined {
  const candidate = value ?? fallback;
  if (candidate === undefined) return undefined;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new AgentRunTransitionError(`${label} must be a positive integer.`);
  }
  return candidate;
}

function normalizeBudget(
  input?: Partial<ResolvedAgentRunBudget>,
): ResolvedAgentRunBudget {
  return {
    maxToolRounds: normalizePositiveInteger(
      input?.maxToolRounds,
      DEFAULT_AGENT_RUN_BUDGET.maxToolRounds,
      "maxToolRounds",
    )!,
    maxToolCalls: normalizePositiveInteger(
      input?.maxToolCalls,
      DEFAULT_AGENT_RUN_BUDGET.maxToolCalls,
      "maxToolCalls",
    )!,
    ...(normalizePositiveInteger(
      input?.maxTotalTokens,
      undefined,
      "maxTotalTokens",
    ) !== undefined
      ? {
          maxTotalTokens: normalizePositiveInteger(
            input?.maxTotalTokens,
            undefined,
            "maxTotalTokens",
          ),
        }
      : {}),
    ...(normalizePositiveInteger(
      input?.maxDurationMs,
      undefined,
      "maxDurationMs",
    ) !== undefined
      ? {
          maxDurationMs: normalizePositiveInteger(
            input?.maxDurationMs,
            undefined,
            "maxDurationMs",
          ),
        }
      : {}),
  };
}

function copyPolicy(policy: ToolInvocationPolicy): ToolInvocationPolicy {
  return {
    effects: [...policy.effects],
    idempotency: policy.idempotency,
    sensitivity: policy.sensitivity,
    origin: policy.origin,
  };
}

function nextActivity(
  run: AgentRun,
  activity: Omit<AgentActivity, "id" | "runId" | "sequence">,
): AgentActivity {
  return {
    id: createId("activity"),
    runId: run.id,
    sequence: run.activities.length + 1,
    ...activity,
  };
}

function withActivity(
  run: AgentRun,
  activity: Omit<AgentActivity, "id" | "runId" | "sequence">,
): AgentRun {
  const at = normalizeEventTime(run, activity.at);
  return {
    ...run,
    updatedAt: at,
    usage: {
      ...run.usage,
      wallTimeMs: Math.max(run.usage.wallTimeMs, at - run.startedAt),
    },
    activities: [
      ...run.activities,
      nextActivity(run, {
        ...activity,
        at,
      }),
    ],
  };
}

function replaceToolExecution(
  run: AgentRun,
  replacement: ToolExecutionRecord,
): AgentRun {
  return {
    ...run,
    toolExecutions: run.toolExecutions.map((record) =>
      record.id === replacement.id ? replacement : record,
    ),
  };
}

function requireToolExecution(
  run: AgentRun,
  executionId: string,
): ToolExecutionRecord {
  const record = run.toolExecutions.find((item) => item.id === executionId);
  if (!record) {
    throw new AgentRunTransitionError(
      `Tool execution ${executionId} does not exist in run ${run.id}.`,
    );
  }
  return record;
}

function assertRunCanExecuteTools(run: AgentRun): void {
  if (run.status !== "running") {
    throw new AgentRunTransitionError(
      `Run ${run.id} cannot execute tools while ${run.status}.`,
    );
  }
}

function isReadOnlyPolicy(policy: ToolInvocationPolicy): boolean {
  return policy.effects.every((effect) => READ_ONLY_EFFECTS.has(effect));
}

export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  assertNonEmpty(input.sessionId, "sessionId");
  const now = input.now ?? Date.now();
  assertTimestamp(now, "now");
  const id = input.id ?? createId("agent-run");
  assertNonEmpty(id, "id");

  const run: AgentRun = {
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    id,
    sessionId: input.sessionId,
    ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
    ...(input.modelMessageId ? { modelMessageId: input.modelMessageId } : {}),
    ...(input.model ? { model: input.model } : {}),
    status: "running",
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    budget: normalizeBudget(input.budget),
    usage: {
      modelRounds: 0,
      toolRounds: 0,
      toolCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      wallTimeMs: 0,
    },
    activities: [],
    toolExecutions: [],
    evidence: [],
  };

  return withActivity(run, {
    kind: "run_started",
    at: now,
    status: "running",
  });
}

export function recordAgentEvidence(
  run: AgentRun,
  records: readonly AgentEvidenceRecord[],
  at = Date.now(),
): AgentRun {
  if (records.length === 0) return run;
  const byId = new Map(run.evidence.map((record) => [record.sourceId, record]));
  records.forEach((record) => byId.set(record.sourceId, { ...record }));
  return checkpointAgentRun(
    { ...run, evidence: [...byId.values()].slice(-500) },
    at,
  );
}

export function transitionAgentRunStatus(
  run: AgentRun,
  status: AgentRunStatus,
  options: {
    at?: number;
    stop?: Omit<AgentRunStop, "at">;
  } = {},
): AgentRun {
  if (run.status === status) return run;
  if (!RUN_STATUS_TRANSITIONS[run.status].has(status)) {
    throw new AgentRunTransitionError(
      `Agent run cannot transition from ${run.status} to ${status}.`,
    );
  }

  const at = normalizeEventTime(run, options.at ?? Date.now());
  const allowedStopReasons = STOP_REASONS_BY_STATUS[status];
  if (allowedStopReasons) {
    if (!options.stop || !allowedStopReasons.has(options.stop.reason)) {
      throw new AgentRunTransitionError(
        `Agent run status ${status} requires a compatible stop reason.`,
      );
    }
  } else if (options.stop) {
    throw new AgentRunTransitionError(
      `Agent run status ${status} must not include a stop reason.`,
    );
  }

  if (
    options.stop?.reason === "budget_exhausted" &&
    !options.stop.budgetDimension
  ) {
    throw new AgentRunTransitionError(
      "A budget-exhausted stop requires a budget dimension.",
    );
  }

  const next = withActivity(
    {
      ...run,
      status,
      ...(options.stop
        ? { stop: { ...options.stop, at } }
        : { stop: undefined }),
      ...(TERMINAL_RUN_STATUSES.has(status) || status === "interrupted"
        ? { endedAt: at }
        : { endedAt: undefined }),
    },
    {
      kind: "status_changed",
      at,
      status,
    },
  );

  return next;
}

export function checkpointAgentRun(run: AgentRun, at = Date.now()): AgentRun {
  return withActivity(run, { kind: "checkpoint", at, status: run.status });
}

export function recordAgentRoundCompleted(
  run: AgentRun,
  input: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    hasToolCalls?: boolean;
    at?: number;
  } = {},
): AgentRun {
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new AgentRunTransitionError(
      `Cannot record usage for terminal run ${run.id}.`,
    );
  }

  const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0));
  const totalTokens = Math.max(
    promptTokens + completionTokens,
    Math.trunc(input.totalTokens ?? 0),
  );
  const modelRound = run.usage.modelRounds + 1;
  const toolRound =
    run.usage.toolRounds + (input.hasToolCalls === false ? 0 : 1);
  const next = {
    ...run,
    usage: {
      ...run.usage,
      modelRounds: modelRound,
      toolRounds: toolRound,
      promptTokens: run.usage.promptTokens + promptTokens,
      completionTokens: run.usage.completionTokens + completionTokens,
      totalTokens: run.usage.totalTokens + totalTokens,
    },
  };

  return withActivity(next, {
    kind: "model_round_completed",
    at: input.at ?? Date.now(),
    round: modelRound,
  });
}

export function getExceededAgentRunBudget(
  run: AgentRun,
  at = Date.now(),
): AgentRunBudgetDimension | null {
  if (run.usage.toolRounds > run.budget.maxToolRounds) return "tool_rounds";
  if (run.usage.toolCalls >= run.budget.maxToolCalls) return "tool_calls";
  if (
    run.budget.maxTotalTokens &&
    run.usage.totalTokens >= run.budget.maxTotalTokens
  ) {
    return "tokens";
  }
  const wallTimeMs = Math.max(run.usage.wallTimeMs, at - run.startedAt);
  if (run.budget.maxDurationMs && wallTimeMs >= run.budget.maxDurationMs) {
    return "wall_time";
  }
  return null;
}

export function prepareToolExecution(
  run: AgentRun,
  input: PrepareToolExecutionInput,
): AgentRun {
  assertRunCanExecuteTools(run);
  assertNonEmpty(input.callId, "callId");
  assertNonEmpty(input.toolName, "toolName");
  assertNonEmpty(input.definitionFingerprint, "definitionFingerprint");
  assertNonEmpty(input.argumentsHash, "argumentsHash");

  const existing = run.toolExecutions.find(
    (record) => record.callId === input.callId,
  );
  if (existing) {
    const sameInvocation =
      existing.toolName === input.toolName &&
      existing.definitionFingerprint === input.definitionFingerprint &&
      existing.argumentsHash === input.argumentsHash;
    if (!sameInvocation) {
      throw new AgentRunTransitionError(
        `Tool call ${input.callId} was already prepared with different inputs.`,
      );
    }
    return run;
  }

  const at = normalizeEventTime(run, input.at ?? Date.now());
  const record: ToolExecutionRecord = {
    id: input.id ?? createId("tool-execution"),
    runId: run.id,
    callId: input.callId,
    toolName: input.toolName,
    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
    definitionFingerprint: input.definitionFingerprint,
    argumentsHash: input.argumentsHash,
    ...(input.targetSummary ? { targetSummary: input.targetSummary } : {}),
    ...(input.round && input.round > 0
      ? { round: Math.trunc(input.round) }
      : {}),
    policy: copyPolicy(input.policy),
    status: "prepared",
    attempt: 0,
    preparedAt: at,
  };
  const next = {
    ...run,
    usage: {
      ...run.usage,
      toolCalls: run.usage.toolCalls + 1,
    },
    toolExecutions: [...run.toolExecutions, record],
  };

  return withActivity(next, {
    kind: "tool_prepared",
    at,
    toolExecutionId: record.id,
    ...(record.round ? { round: record.round } : {}),
  });
}

export function markToolExecutionRunning(
  run: AgentRun,
  executionId: string,
  at = Date.now(),
): AgentRun {
  assertRunCanExecuteTools(run);
  const record = requireToolExecution(run, executionId);
  if (record.status !== "prepared" && record.status !== "failed") {
    throw new AgentRunTransitionError(
      `Tool execution cannot transition from ${record.status} to running.`,
    );
  }
  if (
    record.status === "failed" &&
    getToolReplayDecision(record).action !== "retry"
  ) {
    throw new AgentRunTransitionError(
      "A non-idempotent failed tool execution cannot be retried automatically.",
    );
  }

  const eventAt = normalizeEventTime(run, at);
  const replacement: ToolExecutionRecord = {
    ...record,
    status: "running",
    attempt: record.attempt + 1,
    startedAt: eventAt,
    endedAt: undefined,
    error: undefined,
  };
  return withActivity(replaceToolExecution(run, replacement), {
    kind: "tool_running",
    at: eventAt,
    toolExecutionId: record.id,
  });
}

export function commitToolExecution(
  run: AgentRun,
  executionId: string,
  input: {
    resultRefs?: ToolResultReference[];
    receipt?: ToolEffectReceipt;
    at?: number;
  } = {},
): AgentRun {
  const record = requireToolExecution(run, executionId);
  if (record.status !== "running") {
    throw new AgentRunTransitionError(
      `Tool execution cannot transition from ${record.status} to committed.`,
    );
  }
  const at = normalizeEventTime(run, input.at ?? Date.now());
  const replacement: ToolExecutionRecord = {
    ...record,
    status: "committed",
    endedAt: at,
    ...(input.resultRefs
      ? { resultRefs: input.resultRefs.map((reference) => ({ ...reference })) }
      : {}),
    ...(input.receipt ? { receipt: { ...input.receipt } } : {}),
    error: undefined,
  };
  return withActivity(replaceToolExecution(run, replacement), {
    kind: "tool_committed",
    at,
    toolExecutionId: record.id,
  });
}

export function failToolExecution(
  run: AgentRun,
  executionId: string,
  error: AgentRunError,
  at = Date.now(),
): AgentRun {
  const record = requireToolExecution(run, executionId);
  if (record.status !== "prepared" && record.status !== "running") {
    throw new AgentRunTransitionError(
      `Tool execution cannot transition from ${record.status} to failed.`,
    );
  }
  const eventAt = normalizeEventTime(run, at);
  const replacement: ToolExecutionRecord = {
    ...record,
    status: "failed",
    endedAt: eventAt,
    error: { ...error },
  };
  return withActivity(replaceToolExecution(run, replacement), {
    kind: "tool_failed",
    at: eventAt,
    toolExecutionId: record.id,
  });
}

export function markToolExecutionEffectUnknown(
  run: AgentRun,
  executionId: string,
  error: AgentRunError,
  at = Date.now(),
): AgentRun {
  const record = requireToolExecution(run, executionId);
  if (record.status !== "running") {
    throw new AgentRunTransitionError(
      `Tool execution cannot transition from ${record.status} to effect_unknown.`,
    );
  }
  const eventAt = normalizeEventTime(run, at);
  const replacement: ToolExecutionRecord = {
    ...record,
    status: "effect_unknown",
    endedAt: eventAt,
    error: { ...error, recoverable: false },
  };
  return withActivity(replaceToolExecution(run, replacement), {
    kind: "tool_effect_unknown",
    at: eventAt,
    toolExecutionId: record.id,
  });
}

export function getToolExecutionByCallId(
  run: AgentRun,
  callId: string,
): ToolExecutionRecord | undefined {
  return run.toolExecutions.find((record) => record.callId === callId);
}

export function getToolReplayDecision(
  record: ToolExecutionRecord,
): ToolReplayDecision {
  if (record.status === "prepared") {
    return { action: "execute", reason: "not_started" };
  }
  if (record.status === "committed") {
    return {
      action: "reuse",
      reason: "committed",
      resultRefs:
        record.resultRefs?.map((reference) => ({ ...reference })) ?? [],
    };
  }
  if (record.status === "effect_unknown") {
    return { action: "block", reason: "effect_unknown" };
  }

  if (
    record.status === "running" &&
    record.policy.effects.some((effect) =>
      UNCERTAIN_IN_FLIGHT_EFFECTS.has(effect),
    )
  ) {
    return { action: "block", reason: "in_flight_effect_unconfirmed" };
  }

  const safeReason = isReadOnlyPolicy(record.policy)
    ? "read_only"
    : record.policy.idempotency === "idempotent"
      ? "idempotent"
      : null;
  if (safeReason) return { action: "retry", reason: safeReason };

  return {
    action: "block",
    reason:
      record.status === "running"
        ? "in_flight_effect_unconfirmed"
        : "failed_non_idempotent",
  };
}

/**
 * Converts records left running by an interrupted page into a deterministic
 * recovery state. Reads and explicitly idempotent operations become retryable
 * failures; other operations become effect_unknown and must not be replayed.
 */
export function recoverInterruptedToolExecutions(
  run: AgentRun,
  at = Date.now(),
): AgentRun {
  return run.toolExecutions.reduce((current, record) => {
    if (record.status !== "running") return current;
    const decision = getToolReplayDecision(record);
    if (decision.action === "retry") {
      return failToolExecution(
        current,
        record.id,
        {
          code: "AGENT_RUN_INTERRUPTED",
          message:
            "Tool execution was interrupted before its result was saved.",
          recoverable: true,
        },
        at,
      );
    }

    return markToolExecutionEffectUnknown(
      current,
      record.id,
      {
        code: "TOOL_EFFECT_UNKNOWN",
        message:
          "The tool may have produced a side effect before the run was interrupted.",
        recoverable: false,
      },
      at,
    );
  }, run);
}

/** Marks a persisted foreground run as interrupted when no live executor owns it. */
export function recoverInterruptedAgentRun(
  run: AgentRun,
  at = Date.now(),
): AgentRun {
  if (
    run.status !== "running" &&
    run.status !== "awaiting_input" &&
    run.status !== "awaiting_approval"
  ) {
    return run;
  }
  const eventAt = Math.max(at, run.updatedAt);
  const recovered = recoverInterruptedToolExecutions(run, eventAt);
  const hasUnknownEffect = recovered.toolExecutions.some(
    (record) => record.status === "effect_unknown",
  );
  return transitionAgentRunStatus(recovered, "interrupted", {
    at: eventAt,
    stop: {
      reason: hasUnknownEffect ? "effect_unknown" : "page_interrupted",
      ...(hasUnknownEffect
        ? {
            error: {
              code: "TOOL_EFFECT_UNKNOWN",
              message:
                "A side effect could not be confirmed after the page stopped executing.",
              recoverable: false,
            },
          }
        : {}),
    },
  });
}
