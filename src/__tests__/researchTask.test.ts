import { describe, expect, it } from "vitest";

import {
  canTransitionResearchTask,
  countUnresolvedResearchEvidenceConflicts,
  createResearchTask,
  filterResearchReadOnlyTools,
  getCurrentResearchReportRunIds,
  getResearchEvidenceIdentity,
  getResearchRunResumeDecision,
  isResearchReadOnlyPolicy,
  RESEARCH_TASK_SCHEMA_VERSION,
  recoverResearchTask,
  resolveResearchBudget,
  ResearchTaskTransitionError,
  transitionResearchTask,
} from "@/lib/research";
import {
  createAgentRun,
  resumeInterruptedAgentRun,
  transitionAgentRunStatus,
} from "@/lib/agent";
import type { ToolInvocationPolicy } from "@/lib/plugin/types";

const policy = (
  effects: ToolInvocationPolicy["effects"],
): ToolInvocationPolicy => ({
  effects,
  idempotency: "idempotent",
  sensitivity: "none",
  origin: "builtin",
});

describe("ResearchTask domain", () => {
  it("resolves preset budgets against lower profile caps", () => {
    expect(resolveResearchBudget("quick")).toEqual({
      maxToolRounds: 6,
      maxToolCalls: 20,
      maxDurationMs: 300_000,
    });
    expect(
      resolveResearchBudget("deep", {
        maxToolRounds: 8,
        maxToolCalls: 40,
        maxDurationMs: 600_000,
        maxTotalTokens: 75_000,
      }),
    ).toEqual({
      maxToolRounds: 8,
      maxToolCalls: 40,
      maxDurationMs: 600_000,
      maxTotalTokens: 75_000,
    });
    expect(
      resolveResearchBudget("standard", {
        maxToolRounds: 100,
        maxToolCalls: 500,
        maxDurationMs: 9_999_999,
      }),
    ).toEqual({
      maxToolRounds: 12,
      maxToolCalls: 50,
      maxDurationMs: 900_000,
    });
  });

  it("creates a standard draft and enforces pure status transitions", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Compare two architectures",
      now: 100,
    });

    expect(task.status).toBe("draft");
    expect(task.schemaVersion).toBe(RESEARCH_TASK_SCHEMA_VERSION);
    expect(task.budgetPreset).toBe("standard");
    expect(task.reportRuns).toEqual([]);
    expect(canTransitionResearchTask("draft", "plan_ready")).toBe(true);
    expect(canTransitionResearchTask("draft", "completed")).toBe(false);

    const planReady = transitionResearchTask(task, "plan_ready", { now: 110 });
    expect(planReady).not.toBe(task);
    expect(planReady.status).toBe("plan_ready");
    expect(task.status).toBe("draft");
    expect(() =>
      transitionResearchTask(task, "completed", { now: 110 }),
    ).toThrow(ResearchTaskTransitionError);
  });

  it("allows a recoverable failure to retry or be dismissed", () => {
    expect(canTransitionResearchTask("failed", "clarifying")).toBe(true);
    expect(canTransitionResearchTask("failed", "cancelled")).toBe(true);
    expect(canTransitionResearchTask("failed", "researching")).toBe(false);

    const failed = transitionResearchTask(
      createResearchTask({
        id: "research-failed",
        sessionId: "session-1",
        goal: "Retry a failed plan",
        now: 100,
      }),
      "failed",
      { now: 110 },
    );
    expect(
      transitionResearchTask(failed, "clarifying", { now: 120 }).status,
    ).toBe("clarifying");
    expect(
      transitionResearchTask(failed, "cancelled", { now: 120 }).status,
    ).toBe("cancelled");
  });

  it("recovers every non-terminal task as a manual pause", () => {
    const researching = transitionResearchTask(
      transitionResearchTask(
        createResearchTask({
          id: "research-1",
          sessionId: "session-1",
          goal: "Research",
          now: 100,
        }),
        "plan_ready",
        { now: 110 },
      ),
      "researching",
      { now: 120 },
    );

    const recovered = recoverResearchTask(researching, 130);
    expect(recovered.status).toBe("paused");
    expect(recovered.checkpoint).toEqual({
      createdAt: 130,
      resumeStatus: "researching",
      committedEvidenceIds: [],
      committedToolExecutionIds: [],
    });

    const completed = transitionResearchTask(
      transitionResearchTask(researching, "synthesizing", { now: 130 }),
      "completed",
      { now: 140 },
    );
    expect(recoverResearchTask(completed, 150)).toBe(completed);

    const durableCheckpoint = {
      createdAt: 125,
      resumeStatus: "researching" as const,
      committedEvidenceIds: ["evidence-1"],
      committedToolExecutionIds: ["execution-1"],
      historyPath: "research/checkpoints/wave.json",
    };
    expect(
      recoverResearchTask(
        { ...researching, checkpoint: durableCheckpoint },
        160,
      ).checkpoint,
    ).toBe(durableCheckpoint);
  });

  it("allows only policies with explicit read effects", () => {
    expect(isResearchReadOnlyPolicy(policy(["local_read"]))).toBe(true);
    expect(isResearchReadOnlyPolicy(policy(["network_read"]))).toBe(true);
    expect(
      isResearchReadOnlyPolicy(policy(["local_read", "network_read"])),
    ).toBe(true);
    expect(isResearchReadOnlyPolicy(policy([]))).toBe(false);
    expect(
      isResearchReadOnlyPolicy(policy(["local_read", "local_write"])),
    ).toBe(false);
    expect(isResearchReadOnlyPolicy(undefined)).toBe(false);

    const tools = [
      { id: "read", policy: policy(["network_read"]) },
      { id: "write", policy: policy(["external_write"]) },
      { id: "unknown" },
    ];
    expect(filterResearchReadOnlyTools(tools).map((tool) => tool.id)).toEqual([
      "read",
    ]);
  });

  it("deduplicates evidence identities and detects unresolved claim conflicts", () => {
    const shared = {
      id: "evidence-1",
      sourceId: "source-1",
      sourceType: "web" as const,
      stepId: "step-1",
      nodeId: "node-1",
      locator: "https://example.com/source",
      retrievedAt: 100,
      contentHash: "sha256:content",
      claimIds: ["C1"],
      stance: "supports" as const,
    };
    expect(getResearchEvidenceIdentity(shared)).toBe(
      "sha256:content\u0000https://example.com/source",
    );
    expect(
      countUnresolvedResearchEvidenceConflicts([
        shared,
        {
          ...shared,
          id: "evidence-2",
          sourceId: "source-2",
          contentHash: "sha256:other",
          stance: "contradicts",
        },
      ]),
    ).toBe(1);
    expect(countUnresolvedResearchEvidenceConflicts([shared])).toBe(0);
  });

  it("charges resumed runs to one report and resets the budget boundary for follow-ups", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Research",
      now: 100,
    });
    const reports = [
      {
        id: "report-1",
        version: 1,
        artifactId: "opfs://chat/workspace/session-1/artifacts/a-report.md",
        planVersion: 1,
        researchRunId: "research-run-1",
        createdAt: 200,
        summary: "First",
        keyFindings: [],
        gaps: [],
        agentRunId: "run-2",
        kind: "initial" as const,
      },
      {
        id: "report-2",
        version: 2,
        artifactId: "opfs://chat/workspace/session-1/artifacts/b-report.md",
        planVersion: 2,
        researchRunId: "research-run-2",
        createdAt: 300,
        summary: "Second",
        keyFindings: [],
        gaps: [],
        agentRunId: "run-4",
        kind: "continue" as const,
      },
    ];

    expect(
      getCurrentResearchReportRunIds({
        ...task,
        status: "completed",
        executionRunIds: ["run-1", "run-2"],
        reportVersions: reports.slice(0, 1),
      }),
    ).toEqual(["run-1", "run-2"]);
    expect(
      getCurrentResearchReportRunIds({
        ...task,
        status: "completed",
        executionRunIds: ["run-1", "run-2", "run-3", "run-4"],
        reportVersions: reports,
      }),
    ).toEqual(["run-3", "run-4"]);
    expect(
      getCurrentResearchReportRunIds({
        ...task,
        status: "plan_ready",
        executionRunIds: ["run-1", "run-2", "run-3", "run-4", "run-5"],
        reportVersions: reports,
      }),
    ).toEqual(["run-5"]);
  });

  it("resumes the same interrupted AgentRun and fails closed when it is missing", () => {
    const base = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Research",
      now: 100,
    });
    const task = {
      ...base,
      executionRunIds: ["run-1"],
      checkpoint: {
        createdAt: 130,
        resumeStatus: "researching" as const,
        committedEvidenceIds: [],
        committedToolExecutionIds: ["execution-1"],
        historyPath: "research/checkpoints/wave.json",
      },
    };
    const interrupted = transitionAgentRunStatus(
      createAgentRun({ id: "run-1", sessionId: "session-1", now: 100 }),
      "interrupted",
      { at: 130, stop: { reason: "page_interrupted" } },
    );

    expect(
      getResearchRunResumeDecision(task, { "run-1": interrupted }),
    ).toEqual({ action: "resume", runId: "run-1" });
    expect(getResearchRunResumeDecision(task, {})).toEqual({
      action: "unavailable",
      runId: "run-1",
    });
    expect(
      getResearchRunResumeDecision({ ...task, checkpoint: undefined }, {}),
    ).toEqual({ action: "new" });
    expect(
      getResearchRunResumeDecision(
        {
          ...task,
          checkpoint: { ...task.checkpoint, historyPath: undefined },
        },
        {},
      ),
    ).toEqual({ action: "new" });

    const resumed = resumeInterruptedAgentRun(interrupted, 10_000);
    expect(resumed.usage.wallTimeMs).toBe(interrupted.usage.wallTimeMs);
    expect(resumed.startedAt).toBe(10_000 - interrupted.usage.wallTimeMs);
  });
});
