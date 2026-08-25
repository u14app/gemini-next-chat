import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_BUDGET_PRESETS,
  AgentRunTransitionError,
  commitToolExecution,
  createAgentRun,
  getExceededAgentRunBudget,
  getAgentRunBudgetPreset,
  getToolExecutionByCallId,
  getToolReplayDecision,
  markToolExecutionRunning,
  prepareToolExecution,
  recordAgentEvidence,
  recordAgentRoundCompleted,
  recoverInterruptedToolExecutions,
  recoverInterruptedAgentRun,
  transitionAgentRunStatus,
} from "@/lib/agent/run";
import type { ToolInvocationPolicy } from "@/lib/plugin/types";

const readPolicy: ToolInvocationPolicy = {
  effects: ["network_read"],
  idempotency: "unknown",
  sensitivity: "none",
  origin: "builtin",
};

const externalWritePolicy: ToolInvocationPolicy = {
  effects: ["external_write"],
  idempotency: "non_idempotent",
  sensitivity: "user_data",
  origin: "plugin",
};

function prepare(policy: ToolInvocationPolicy = readPolicy, callId = "call-1") {
  return prepareToolExecution(
    createAgentRun({ id: "run-1", sessionId: "session-1", now: 100 }),
    {
      id: `execution-${callId}`,
      callId,
      toolName: "example_tool",
      definitionFingerprint: "sha256:definition",
      argumentsHash: "sha256:arguments",
      policy,
      at: 110,
    },
  );
}

describe("AgentRun domain", () => {
  it("maps the three session budget presets without persisting a preset name", () => {
    expect(AGENT_RUN_BUDGET_PRESETS).toEqual({
      light: {
        maxToolRounds: 8,
        maxToolCalls: 30,
        maxDurationMs: 600_000,
      },
      standard: {
        maxToolRounds: 16,
        maxToolCalls: 75,
        maxDurationMs: 1_500_000,
      },
      extended: {
        maxToolRounds: 24,
        maxToolCalls: 150,
        maxDurationMs: 2_700_000,
      },
    });
    expect(getAgentRunBudgetPreset(AGENT_RUN_BUDGET_PRESETS.standard)).toBe(
      "standard",
    );
    expect(
      getAgentRunBudgetPreset({
        ...AGENT_RUN_BUDGET_PRESETS.standard,
        maxTotalTokens: 40_000,
      }),
    ).toBeNull();
    expect(getAgentRunBudgetPreset()).toBeNull();
  });

  it("creates a serializable run with the existing tool-loop limits", () => {
    const run = createAgentRun({
      id: "run-1",
      sessionId: "session-1",
      userMessageId: "message-1",
      now: 100,
    });

    expect(run).toMatchObject({
      schemaVersion: 1,
      id: "run-1",
      status: "running",
      budget: { maxToolRounds: 20, maxToolCalls: 100 },
      usage: {
        modelRounds: 0,
        toolRounds: 0,
        toolCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        wallTimeMs: 0,
      },
    });
    expect(run.activities).toHaveLength(1);
    expect(run.activities[0]).toMatchObject({
      runId: "run-1",
      sequence: 1,
      kind: "run_started",
    });
    expect(() => JSON.stringify(run)).not.toThrow();
  });

  it("enforces run status and structured stop-reason transitions", () => {
    const initial = createAgentRun({
      id: "run-1",
      sessionId: "session-1",
      now: 100,
    });
    const waiting = transitionAgentRunStatus(initial, "awaiting_approval", {
      at: 110,
    });
    const resumed = transitionAgentRunStatus(waiting, "running", { at: 120 });
    const completed = transitionAgentRunStatus(resumed, "completed", {
      at: 130,
      stop: { reason: "completed" },
    });

    expect(completed).toMatchObject({
      status: "completed",
      endedAt: 130,
      stop: { reason: "completed", at: 130 },
    });
    expect(completed.activities.map((activity) => activity.sequence)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(() =>
      transitionAgentRunStatus(initial, "completed", { at: 130 }),
    ).toThrow(AgentRunTransitionError);
    expect(() =>
      transitionAgentRunStatus(completed, "running", { at: 140 }),
    ).toThrow(AgentRunTransitionError);
  });

  it("deduplicates the persistent Evidence ledger by source ID", () => {
    const run = recordAgentEvidence(
      createAgentRun({ id: "run-1", sessionId: "session-1", now: 100 }),
      [
        {
          sourceId: "source-1",
          url: "https://example.com/one",
          title: "First",
          retrievedAt: 110,
          contentHash: "sha256:first",
          retrievalKind: "fetch",
          toolCallId: "call-1",
        },
        {
          sourceId: "source-1",
          url: "https://example.com/one",
          title: "Updated",
          retrievedAt: 120,
          contentHash: "sha256:first",
          retrievalKind: "fetch",
          toolCallId: "call-2",
        },
      ],
      120,
    );

    expect(run.evidence).toEqual([
      expect.objectContaining({
        sourceId: "source-1",
        title: "Updated",
        toolCallId: "call-2",
      }),
    ]);
  });

  it("journals a tool once and reuses its committed result reference", () => {
    const prepared = prepare();
    const duplicate = prepareToolExecution(prepared, {
      callId: "call-1",
      toolName: "example_tool",
      definitionFingerprint: "sha256:definition",
      argumentsHash: "sha256:arguments",
      policy: readPolicy,
      at: 111,
    });
    expect(duplicate).toBe(prepared);
    expect(prepared.usage.toolCalls).toBe(1);

    const running = markToolExecutionRunning(prepared, "execution-call-1", 120);
    const committed = commitToolExecution(running, "execution-call-1", {
      at: 130,
      resultRefs: [
        {
          kind: "artifact",
          id: "artifact-1",
          contentHash: "sha256:result",
        },
      ],
      receipt: {
        committedAt: 130,
        effectId: "effect-1",
        resultHash: "sha256:result",
      },
    });
    const record = getToolExecutionByCallId(committed, "call-1")!;

    expect(record).toMatchObject({
      status: "committed",
      attempt: 1,
      argumentsHash: "sha256:arguments",
      endedAt: 130,
    });
    expect(getToolReplayDecision(record)).toEqual({
      action: "reuse",
      reason: "committed",
      resultRefs: [
        {
          kind: "artifact",
          id: "artifact-1",
          contentHash: "sha256:result",
        },
      ],
    });
    expect(record).not.toHaveProperty("args");
    expect(record).not.toHaveProperty("result");
  });

  it("does not reuse a committed result without a content hash", () => {
    const prepared = prepare();
    const running = markToolExecutionRunning(prepared, "execution-call-1", 120);
    const committed = commitToolExecution(running, "execution-call-1", {
      at: 130,
      resultRefs: [{ kind: "tool_cache", id: "call-1" }],
    });

    expect(
      getToolReplayDecision(getToolExecutionByCallId(committed, "call-1")!),
    ).toEqual({
      action: "block",
      reason: "committed_result_unverifiable",
    });
  });

  it("rejects a call id reused with different invocation inputs", () => {
    const run = prepare();
    expect(() =>
      prepareToolExecution(run, {
        callId: "call-1",
        toolName: "example_tool",
        definitionFingerprint: "sha256:definition",
        argumentsHash: "sha256:different",
        policy: readPolicy,
        at: 120,
      }),
    ).toThrow(/already prepared with different inputs/);
  });

  it("recovers reads as retryable and blocks unknown external effects", () => {
    let run = createAgentRun({
      id: "run-1",
      sessionId: "session-1",
      now: 100,
    });
    run = prepareToolExecution(run, {
      id: "read-execution",
      callId: "read-call",
      toolName: "read_tool",
      definitionFingerprint: "read-definition",
      argumentsHash: "read-arguments",
      policy: readPolicy,
      at: 110,
    });
    run = markToolExecutionRunning(run, "read-execution", 120);
    run = prepareToolExecution(run, {
      id: "write-execution",
      callId: "write-call",
      toolName: "write_tool",
      definitionFingerprint: "write-definition",
      argumentsHash: "write-arguments",
      policy: externalWritePolicy,
      at: 130,
    });
    run = markToolExecutionRunning(run, "write-execution", 140);

    const recovered = recoverInterruptedToolExecutions(run, 150);
    const readRecord = getToolExecutionByCallId(recovered, "read-call")!;
    const writeRecord = getToolExecutionByCallId(recovered, "write-call")!;

    expect(readRecord.status).toBe("failed");
    expect(getToolReplayDecision(readRecord)).toEqual({
      action: "retry",
      reason: "read_only",
    });
    expect(writeRecord.status).toBe("effect_unknown");
    expect(getToolReplayDecision(writeRecord)).toEqual({
      action: "block",
      reason: "effect_unknown",
    });
  });

  it("does not replay an unconfirmed in-flight external effect marked idempotent", () => {
    const run = markToolExecutionRunning(
      prepare(
        {
          ...externalWritePolicy,
          idempotency: "idempotent",
        },
        "external-idempotent",
      ),
      "execution-external-idempotent",
      120,
    );

    expect(
      getToolReplayDecision(
        getToolExecutionByCallId(run, "external-idempotent")!,
      ),
    ).toEqual({
      action: "block",
      reason: "in_flight_effect_unconfirmed",
    });
    expect(
      getToolExecutionByCallId(
        recoverInterruptedToolExecutions(run, 130),
        "external-idempotent",
      )?.status,
    ).toBe("effect_unknown");
  });

  it("recovers a persisted foreground run into an explicit interruption", () => {
    let run = createAgentRun({
      id: "run-recovery",
      sessionId: "session-1",
      now: 100,
    });
    run = transitionAgentRunStatus(run, "awaiting_input", { at: 120 });

    const recovered = recoverInterruptedAgentRun(run, 150);

    expect(recovered.status).toBe("interrupted");
    expect(recovered.stop).toMatchObject({ reason: "page_interrupted" });
    expect(recovered.endedAt).toBe(150);
  });

  it("aggregates per-round usage and reports the first exhausted budget", () => {
    let run = createAgentRun({
      id: "run-1",
      sessionId: "session-1",
      now: 100,
      budget: {
        maxToolRounds: 2,
        maxToolCalls: 5,
        maxTotalTokens: 30,
        maxDurationMs: 1_000,
      },
    });
    run = recordAgentRoundCompleted(run, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 18,
      at: 200,
    });
    expect(getExceededAgentRunBudget(run, 200)).toBeNull();

    run = recordAgentRoundCompleted(run, {
      promptTokens: 5,
      completionTokens: 5,
      totalTokens: 12,
      at: 300,
    });
    expect(run.usage).toMatchObject({
      modelRounds: 2,
      toolRounds: 2,
      promptTokens: 15,
      completionTokens: 10,
      totalTokens: 30,
      wallTimeMs: 200,
    });
    expect(getExceededAgentRunBudget(run, 300)).toBe("tokens");

    run = recordAgentRoundCompleted(run, {
      hasToolCalls: true,
      at: 400,
    });
    expect(getExceededAgentRunBudget(run, 400)).toBe("tool_rounds");
  });
});
