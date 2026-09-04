import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNextResearchWave,
  createResearchReportRun,
  createResearchTask,
  type ResearchPlanVersion,
  type ResearchTask,
} from "@/lib/research";
import {
  appendResearchSteeringCommand,
  canSteerResearchTask,
  getUnansweredSteeringQuestions,
  hasUnattemptedSteeringQuestions,
  projectResearchSteering,
  type ResearchSteeringCommand,
  type ResearchSteeringRecord,
} from "@/lib/research/steering";
import {
  consumeResearchSteering,
  enqueueResearchSteering,
  initializeResearchSteering,
  withResearchExecutionLock,
} from "@/lib/research/runtime/steering";
import { runExplorationStage } from "@/lib/research/runtime/stages/exploration";
import type { ResearchExecutionContext } from "@/lib/research/runtime/executionContext";
import {
  createMemoryResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
} from "@/services/research/extensionRepository";

const mocks = vi.hoisted(() => ({
  task: null as ResearchTask | null,
  durable: true,
  save: vi.fn<() => Promise<void>>(),
  wave: vi.fn(),
}));
vi.mock("@/services/research/runtime", () => ({
  getResearchTaskRepository: () => ({
    get: async () => mocks.task,
    getStatus: () => ({ durable: mocks.durable }),
  }),
}));
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: { getState: () => ({}) },
}));
vi.mock("@/lib/research/runtime/usage", () => ({
  aggregateTaskUsage: () => ({
    toolCalls: 0,
    toolRounds: 0,
    wallTimeMs: 0,
    totalTokens: 0,
  }),
  aggregateExecutionUsage: () => ({
    toolCalls: 0,
    toolRounds: 0,
    wallTimeMs: 0,
    totalTokens: 0,
  }),
  remainingBudget: () => ({
    maxToolCalls: 100,
    maxToolRounds: 100,
    maxDurationMs: 1_000_000,
  }),
}));
vi.mock("@/lib/research/runtime/wave", () => ({
  executeWave: (...args: unknown[]) => mocks.wave(...args),
}));

function fixture() {
  const plan: ResearchPlanVersion = {
    id: "plan",
    version: 1,
    title: "Safety review",
    summary: "Review a system",
    objective: "Evaluate the system",
    scope: {
      audience: "Engineers",
      includes: ["System"],
      excludes: [],
      allowedSourceTypes: ["web"],
    },
    assumptions: [],
    deliverable: {
      kind: "research_report",
      description: "Review",
      requiredSections: ["Findings"],
    },
    strategy: {
      initialBreadth: 1,
      maxDepth: 2,
      maxQueries: 12,
      resultsPerQuery: 5,
    },
    recon: {
      status: "completed",
      sourceFeasibility: "verified",
      startedAt: 1,
      completedAt: 2,
      timeoutMs: 30000,
      queryLimit: 1,
      resultsPerQuery: 5,
      usage: { queryCount: 0, resultCount: 0, wallTimeMs: 0 },
      queries: [],
    },
    steps: ["Concurrency", "Storage", "Availability"].map((name, index) => ({
      id: `step-${index}`,
      title: name,
      objective: name,
      questions: [name],
      queryTopics: [name],
      sourcePriorities: [],
      evidenceCriteria: [],
      priority: "high" as const,
    })),
    completionCriteria: [],
    createdAt: 3,
  };
  const run = createResearchReportRun({
    id: "run",
    taskId: "task",
    plan,
    now: 5,
  });
  const task: ResearchTask = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Review",
      now: 1,
    }),
    status: "researching",
    planVersions: [plan],
    activePlanVersion: 1,
    activeReportRunId: run.id,
    reportRuns: [run],
  };
  const record: ResearchSteeringRecord = {
    taskId: task.id,
    runId: run.id,
    nextSequence: 1,
    closed: false,
    commands: [],
  };
  mocks.task = task;
  const ctx = {
    taskId: task.id,
    task,
    run,
    plan,
    evidence: [],
    controller: new AbortController(),
    steeringLockHeld: true,
    explorationQueryLimit: 10,
    explorationToolCallCap: 100,
    sourceBodyLimit: 40,
    store: {
      get tasksById() {
        return { task: mocks.task! };
      },
      updateTask: async (
        _id: string,
        update: (task: ResearchTask) => ResearchTask,
      ) => {
        mocks.task = update(mocks.task!);
        await mocks.save();
        return mocks.task;
      },
    },
  } as unknown as ResearchExecutionContext;
  return { plan, run, task, record, ctx };
}

function append(
  record: ResearchSteeringRecord,
  intent: ResearchSteeringCommand["intent"],
  id = `command-${record.nextSequence}`,
) {
  return appendResearchSteeringCommand(record, {
    id,
    taskId: record.taskId,
    runId: record.runId,
    createdAt: 10,
    intent,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let repository = createMemoryResearchExtensionRepository();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.durable = true;
  mocks.save.mockResolvedValue(undefined);
  repository = createMemoryResearchExtensionRepository();
  vi.spyOn(repository, "getStatus").mockReturnValue({ durable: true });
  setResearchExtensionRepositoryForTests(repository);
  vi.stubGlobal("navigator", { locks: { request: vi.fn() } });
});
afterEach(() => {
  setResearchExtensionRepositoryForTests(undefined);
  vi.unstubAllGlobals();
});

describe("research steering projection", () => {
  it("changes same-depth order, preserves breadth/depth, and resets to original order", () => {
    const { plan, run, record } = fixture();
    const target = run.nodes[2];
    const promoted = append(record, {
      kind: "priority",
      nodeId: target.id,
      priority: -1,
    });
    const projected = projectResearchSteering(run, plan, promoted);
    expect(createNextResearchWave(projected.run)?.wave.nodeIds).toEqual([
      target.id,
    ]);
    const deeper = { ...target, id: "deep", depth: 2 };
    const withDeep = {
      ...run,
      nodes: [...run.nodes, deeper],
      frontierNodeIds: [deeper.id, ...run.frontierNodeIds],
    };
    expect(createNextResearchWave(withDeep)?.wave.nodeIds).toEqual([
      run.nodes[0].id,
    ]);
    const reset = append(
      { ...promoted, commands: projected.commands },
      { kind: "priority", nodeId: target.id, priority: 0 },
    );
    expect(
      projectResearchSteering(projected.run, plan, reset).run.frontierNodeIds,
    ).toEqual(run.frontierNodeIds);
  });

  it("rejects scheduled nodes and adds a deduplicated root inside an existing step", () => {
    const { plan, run, record } = fixture();
    const scheduled = createNextResearchWave(run)!.run;
    const bad = append(record, {
      kind: "priority",
      nodeId: scheduled.nodes[0].id,
      priority: 1,
    });
    expect(
      projectResearchSteering(scheduled, plan, bad).commands[0].reason,
    ).toBe("node_scheduled");
    const duplicate = append(record, {
      kind: "add",
      nodeId: "new",
      stepId: "step-0",
      question: run.nodes[0].query,
    });
    expect(
      projectResearchSteering(run, plan, duplicate).commands[0].reason,
    ).toBe("duplicate");
    const badStep = append(record, {
      kind: "add",
      nodeId: "new",
      stepId: "unknown",
      question: "What does a power failure lose?",
    });
    expect(projectResearchSteering(run, plan, badStep).commands[0].reason).toBe(
      "invalid_step",
    );
    const valid = append(record, {
      kind: "add",
      nodeId: "stable-new",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    const result = projectResearchSteering(run, plan, valid);
    expect(result.run.nodes.at(-1)).toMatchObject({
      id: "stable-new",
      depth: 1,
      stepId: "step-0",
      status: "pending",
    });
    expect(
      hasUnattemptedSteeringQuestions(result.run, {
        ...valid,
        commands: result.commands,
      }),
    ).toBe(true);
  });

  it("replays saved-but-unacknowledged additions and never resets completed nodes", () => {
    const { plan, run, record } = fixture();
    const queued = append(record, {
      kind: "add",
      nodeId: "stable-new",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    const first = projectResearchSteering(run, plan, queued);
    const replay = projectResearchSteering(first.run, plan, queued);
    expect(replay.run.nodes).toHaveLength(run.nodes.length + 1);
    const completed = {
      ...first.run,
      nodes: first.run.nodes.map((node) =>
        node.id === "stable-new"
          ? { ...node, status: "completed" as const, claimIds: ["C1"] }
          : node,
      ),
      frontierNodeIds: first.run.frontierNodeIds.filter(
        (id) => id !== "stable-new",
      ),
    };
    const done = projectResearchSteering(completed, plan, {
      ...queued,
      commands: first.commands,
    });
    expect(done.run).toBe(completed);
    expect(
      hasUnattemptedSteeringQuestions(done.run, {
        ...queued,
        commands: first.commands,
      }),
    ).toBe(false);
    expect(
      getUnansweredSteeringQuestions(done.run, {
        ...queued,
        commands: first.commands,
      }),
    ).toEqual([]);
  });

  it("enforces persisted node limits and keeps verification pauses closed", () => {
    const { plan, run, record, task } = fixture();
    const full = {
      ...run,
      nodes: Array.from({ length: 2000 }, (_, i) => ({
        ...run.nodes[0],
        id: `node-${i}`,
      })),
    };
    const queued = append(record, {
      kind: "add",
      nodeId: "stable-new",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    expect(projectResearchSteering(full, plan, queued).commands[0].reason).toBe(
      "node_limit",
    );
    expect(
      canSteerResearchTask({
        ...task,
        status: "paused",
        checkpoint: {
          resumeStatus: "verifying",
          createdAt: 1,
          committedEvidenceIds: [],
          committedToolExecutionIds: [],
        },
      }),
    ).toBe(false);
  });
});

describe("research steering persistence and concurrency", () => {
  it("disables optional controls when a new extension database cannot open", async () => {
    const { ctx } = fixture();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("storage denied"),
    );
    await initializeResearchSteering(ctx);
    expect(ctx.steeringRecord).toBeUndefined();
  });

  it("allows another tab to queue without mutating the active run, and serializes sequence numbers", async () => {
    const { ctx, run } = fixture();
    await initializeResearchSteering(ctx);
    await Promise.all([
      enqueueResearchSteering("task", {
        kind: "priority",
        nodeId: run.nodes[1].id,
        priority: -1,
      }),
      enqueueResearchSteering("task", {
        kind: "priority",
        nodeId: run.nodes[2].id,
        priority: 1,
      }),
    ]);
    expect(ctx.run).toBe(run);
    const record = await repository.get<ResearchSteeringRecord>(
      "steering",
      "run",
    );
    expect(record?.commands.map((command) => command.sequence)).toEqual([1, 2]);
    const saving = deferred();
    mocks.save.mockImplementationOnce(() => saving.promise);
    const consume = consumeResearchSteering(ctx);
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(
      (
        await repository.get<ResearchSteeringRecord>("steering", "run")
      )?.commands.every((command) => command.status === "pending"),
    ).toBe(true);
    saving.resolve();
    await consume;
    expect(
      ctx.steeringRecord?.commands.every(
        (command) => command.status === "applied",
      ),
    ).toBe(true);
    expect(ctx.run.frontierNodeIds[0]).toBe(run.nodes[1].id);
  });

  it("does not acknowledge commands when the core save silently loses durability", async () => {
    const { ctx, run } = fixture();
    await initializeResearchSteering(ctx);
    await enqueueResearchSteering("task", {
      kind: "priority",
      nodeId: run.nodes[1].id,
      priority: -1,
    });
    mocks.save.mockImplementationOnce(async () => {
      mocks.durable = false;
    });
    await expect(consumeResearchSteering(ctx)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(
      (await repository.get<ResearchSteeringRecord>("steering", "run"))
        ?.commands[0].status,
    ).toBe("pending");
  });

  it("preserves commands arriving while the previous core save is pending", async () => {
    const { ctx, run } = fixture();
    await initializeResearchSteering(ctx);
    await enqueueResearchSteering("task", {
      kind: "priority",
      nodeId: run.nodes[1].id,
      priority: -1,
    });
    const saving = deferred();
    mocks.save.mockImplementationOnce(() => saving.promise);
    const consume = consumeResearchSteering(ctx);
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    await enqueueResearchSteering("task", {
      kind: "priority",
      nodeId: run.nodes[2].id,
      priority: -1,
    });
    saving.resolve();
    await consume;
    expect(
      ctx.steeringRecord?.commands.map((command) => command.status),
    ).toEqual(["applied", "pending"]);
    await consumeResearchSteering(ctx);
    expect(
      ctx.steeringRecord?.commands.map((command) => command.status),
    ).toEqual(["applied", "applied"]);
  });

  it("recovers a core-save/ack interruption without duplicating the added node", async () => {
    const { ctx } = fixture();
    await initializeResearchSteering(ctx);
    await enqueueResearchSteering("task", {
      kind: "add",
      nodeId: "user-node",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("ack interrupted"),
    );
    await expect(consumeResearchSteering(ctx)).rejects.toThrow(
      "ack interrupted",
    );
    const recovered: ResearchExecutionContext = {
      ...ctx,
      run: mocks.task!.reportRuns[0],
      task: mocks.task!,
      steeringRecord: undefined,
    };
    await initializeResearchSteering(recovered);
    await consumeResearchSteering(recovered);
    expect(
      recovered.run.nodes.filter((node) => node.id === "user-node"),
    ).toHaveLength(1);
    expect(recovered.steeringRecord?.commands[0].status).toBe("applied");
  });

  it("requires the exclusive executor lock but leaves legacy research available without it", async () => {
    const held = deferred();
    let busy = false;
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object | null) => Promise<unknown>,
        ) => {
          if (busy) return callback(null);
          busy = true;
          try {
            return await callback({});
          } finally {
            busy = false;
          }
        },
      },
    });
    const first = vi.fn(async () => {
      await held.promise;
    });
    const second = vi.fn(async () => {});
    const conflict = vi.fn();
    const running = withResearchExecutionLock("task", first, conflict);
    await withResearchExecutionLock("task", second, conflict);
    expect(second).not.toHaveBeenCalled();
    expect(conflict).toHaveBeenCalledOnce();
    held.resolve();
    await running;
    vi.stubGlobal("navigator", {});
    await withResearchExecutionLock("task", second, conflict);
    expect(second).toHaveBeenCalledWith(false);
  });

  it("seals commands at the phase transition and rejects late submissions", async () => {
    const { ctx, run } = fixture();
    await initializeResearchSteering(ctx);
    await consumeResearchSteering(ctx, true);
    await expect(
      enqueueResearchSteering("task", {
        kind: "priority",
        nodeId: run.nodes[1].id,
        priority: -1,
      }),
    ).rejects.toMatchObject({ code: "closed" });
  });
});

describe("research steering wave scheduling", () => {
  function completeWave(ctx: ResearchExecutionContext) {
    const selected = new Set(ctx.run.waves.at(-1)!.nodeIds);
    return {
      ...ctx.run,
      phase: "exploring" as const,
      nodes: ctx.run.nodes.map((node) =>
        selected.has(node.id)
          ? { ...node, status: "completed" as const }
          : node,
      ),
      waves: ctx.run.waves.map((wave) =>
        wave === ctx.run.waves.at(-1)
          ? { ...wave, status: "completed" as const }
          : wave,
      ),
      coverage: { ...ctx.run.coverage, complete: true },
      usage: { ...ctx.run.usage, queryCount: ctx.run.usage.queryCount + 1 },
    };
  }

  it("waits for an in-flight wave, then attempts an added question despite satisfied coverage", async () => {
    const { ctx } = fixture();
    await initializeResearchSteering(ctx);
    const waveFinished = deferred();
    mocks.wave.mockImplementationOnce(async () => {
      await waveFinished.promise;
      return completeWave(ctx);
    });
    mocks.wave.mockImplementation(async () => completeWave(ctx));
    const running = runExplorationStage(ctx);
    await vi.waitFor(() => expect(mocks.wave).toHaveBeenCalledOnce());
    await enqueueResearchSteering("task", {
      kind: "add",
      nodeId: "user-node",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    expect(ctx.run.nodes.some((node) => node.id === "user-node")).toBe(false);
    waveFinished.resolve();
    await running;
    expect(
      mocks.wave.mock.calls.some(([, input]) =>
        input.nodeIds.includes("user-node"),
      ),
    ).toBe(true);
    expect(ctx.run.nodes.find((node) => node.id === "user-node")?.status).toBe(
      "completed",
    );
    expect(ctx.steeringRecord?.closed).toBe(true);
  });

  it("leaves unanswered additions as gaps when the hard exploration budget is spent", async () => {
    const { ctx } = fixture();
    await initializeResearchSteering(ctx);
    ctx.run.usage.queryCount = ctx.explorationQueryLimit;
    await enqueueResearchSteering("task", {
      kind: "add",
      nodeId: "user-node",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    await runExplorationStage(ctx);
    expect(mocks.wave).not.toHaveBeenCalled();
    expect(getUnansweredSteeringQuestions(ctx.run, ctx.steeringRecord)).toEqual(
      ["What does a power failure lose?"],
    );
  });

  it("honors an added question that wins the final intake-close race", async () => {
    const { ctx } = fixture();
    await initializeResearchSteering(ctx);
    const update = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementationOnce(
      (kind, id, updater, scope) =>
        update(
          kind,
          id,
          (current) => {
            const record = current as ResearchSteeringRecord;
            return updater(
              append(record, {
                kind: "add",
                nodeId: "last-moment-node",
                stepId: "step-0",
                question: "What does a power failure lose?",
              }) as typeof current,
            );
          },
          scope,
        ),
    );
    mocks.wave.mockImplementation(async () => completeWave(ctx));
    await runExplorationStage(ctx);
    expect(
      mocks.wave.mock.calls.some(([, input]) =>
        input.nodeIds.includes("last-moment-node"),
      ),
    ).toBe(true);
    expect(ctx.steeringRecord?.closed).toBe(true);
  });

  it("does not soft-stop for repeated empty waves until the user question is attempted", async () => {
    const { ctx } = fixture();
    await initializeResearchSteering(ctx);
    await enqueueResearchSteering("task", {
      kind: "add",
      nodeId: "user-node",
      stepId: "step-0",
      question: "What does a power failure lose?",
    });
    mocks.wave.mockImplementation(async () => ({
      ...completeWave(ctx),
      coverage: ctx.run.coverage,
    }));
    await runExplorationStage(ctx);
    expect(
      mocks.wave.mock.calls.some(([, input]) =>
        input.nodeIds.includes("user-node"),
      ),
    ).toBe(true);
    expect(ctx.run.stopReason?.code).toBe("no_new_sources");
  });

  it("keeps two degraded wave archives as an error stop despite a user question", async () => {
    const { ctx } = fixture();
    await initializeResearchSteering(ctx);
    mocks.wave.mockImplementation(async () => {
      await enqueueResearchSteering("task", {
        kind: "add",
        nodeId: "user-node",
        stepId: "step-0",
        question: "What does a power failure lose?",
      });
      const next = completeWave(ctx);
      return {
        ...next,
        waves: [0, 1].map((index) => ({
          ...next.waves[0],
          id: `degraded-${index}`,
          index,
          packetStatus: "degraded" as const,
        })),
      };
    });
    await runExplorationStage(ctx);
    expect(mocks.wave).toHaveBeenCalledOnce();
    expect(ctx.run.stopReason?.code).toBe("invalid_model_output");
  });
});
