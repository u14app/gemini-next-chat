import { describe, expect, it, vi } from "vitest";

import {
  createResearchReportRun,
  createResearchTask,
  type ResearchPlanVersion,
  type ResearchTask,
} from "@/lib/research";
import {
  RESEARCH_TASK_STORAGE_VERSION,
  createResearchTaskRepository,
  parseResearchTaskValue,
  parseStoredResearchTask,
  toPersistedResearchTask,
} from "@/services/research";

function createV2TaskFixture(): ResearchTask {
  const task = createResearchTask({
    id: "research-v2",
    sessionId: "session-v2",
    goal: "Persist a v2 task",
    now: 100,
  });
  const plan: ResearchPlanVersion = {
    id: "plan-v2",
    version: 1,
    title: "Persistence plan",
    summary: "Verify strict v2 persistence.",
    objective: "Persist explicit plan, run, claim, and evidence mappings.",
    scope: {
      audience: "Maintainers",
      includes: ["v2 records"],
      excludes: ["legacy migration"],
      allowedSourceTypes: ["web"],
    },
    assumptions: [],
    deliverable: {
      kind: "exact_answer",
      description: "A persisted report.",
      requiredSections: ["Answer", "Sources"],
    },
    strategy: {
      initialBreadth: 2,
      maxDepth: 1,
      maxQueries: 6,
      resultsPerQuery: 5,
    },
    recon: {
      status: "completed",
      sourceFeasibility: "verified",
      startedAt: 100,
      completedAt: 101,
      timeoutMs: 30_000,
      queryLimit: 2,
      resultsPerQuery: 5,
      usage: { queryCount: 1, resultCount: 1, wallTimeMs: 1 },
      queries: [
        {
          query: "v2 persistence",
          status: "completed",
          resultCount: 1,
          domains: ["example.com"],
        },
      ],
    },
    steps: [
      {
        id: "step-v2",
        title: "Persist mappings",
        objective: "Persist explicit mappings.",
        questions: ["Are mappings preserved?"],
        queryTopics: ["v2 persistence"],
        sourcePriorities: [{ sourceType: "web", priority: "high" }],
        evidenceCriteria: ["A committed source."],
        priority: "high",
      },
      {
        id: "step-v2-context",
        title: "Check context",
        objective: "Confirm relevant persistence context.",
        questions: ["Is the surrounding context preserved?"],
        queryTopics: ["v2 persistence context"],
        sourcePriorities: [{ sourceType: "web", priority: "low" }],
        evidenceCriteria: ["A contextual source."],
        priority: "low",
      },
      {
        id: "step-v2-audit",
        title: "Audit references",
        objective: "Confirm report and run references.",
        questions: ["Are report references consistent?"],
        queryTopics: ["v2 report references"],
        sourcePriorities: [{ sourceType: "web", priority: "low" }],
        evidenceCriteria: ["A consistent run reference."],
        priority: "low",
      },
    ],
    completionCriteria: ["All v2 fields round-trip."],
    createdAt: 101,
  };
  const createdRun = createResearchReportRun({
    id: "run-v2",
    taskId: task.id,
    plan,
    now: 102,
  });
  const node = createdRun.nodes[0];
  const evidence = {
    id: "evidence-v2",
    sourceId: "source-v2",
    aliasSourceIds: ["source-v2-mirror"],
    sourceType: "web" as const,
    stepId: plan.steps[0].id,
    nodeId: node.id,
    locator: "https://example.com/v2",
    aliasLocators: ["https://mirror.example/v2"],
    retrievedAt: 103,
    contentHash: "sha256:v2",
    authority: "primary" as const,
    claimIds: ["claim-v2"],
    stance: "supports" as const,
    relations: [
      {
        researchRunId: createdRun.id,
        stepId: plan.steps[0].id,
        nodeId: node.id,
        claimIds: ["claim-v2"],
        stance: "supports" as const,
        boundAt: 104,
      },
    ],
  };
  const claim = {
    id: "claim-v2",
    text: "The v2 mapping is persisted.",
    importance: "major" as const,
    stepId: plan.steps[0].id,
    nodeIds: [node.id],
    supportingEvidenceIds: [evidence.id],
    contradictingEvidenceIds: [],
    verificationStatus: "verified" as const,
    independentPublisherCount: 1,
    createdAt: 103,
    updatedAt: 104,
  };
  const run = {
    ...createdRun,
    phase: "completed" as const,
    nodes: [
      {
        ...node,
        status: "completed" as const,
        sourceIds: [evidence.sourceId],
        evidenceIds: [evidence.id],
        claimIds: [claim.id],
        learningPacketId: "packet-v2",
        updatedAt: 104,
      },
    ],
    learningPackets: [
      {
        id: "packet-v2",
        nodeId: node.id,
        learnings: [],
        sourceAssessments: [
          {
            sourceId: evidence.sourceId,
            authority: "primary" as const,
            publisherId: "publisher-v2",
            rationale: "The source is the canonical publisher.",
          },
        ],
        followUps: [],
        createdAt: 104,
      },
    ],
    claims: [claim],
    frontierNodeIds: [],
    coverage: {
      requiredStepCount: 1,
      coveredStepCount: 1,
      majorClaimCount: 1,
      verifiedMajorClaimCount: 1,
      unresolvedMajorClaimCount: 0,
      stepRatio: 1,
      claimRatio: 1,
      overallRatio: 1,
      complete: true,
    },
    updatedAt: 104,
    endedAt: 104,
    stopReason: { code: "coverage_satisfied" as const, at: 104 },
  };
  return {
    ...task,
    status: "completed",
    updatedAt: 105,
    endedAt: 105,
    sourceSnapshot: {
      model: "openai:test",
      approvalMode: "balanced",
      searchEnabled: true,
      toolIds: ["search_web", "read_workspace_file"],
      pluginIds: [],
      skillIds: [],
      knowledgeCollectionIds: [],
      attachmentIds: [],
      workspaceFileIds: [],
      workspaceSources: [
        {
          path: "sources/approved.md",
          contentHash: "sha256:workspace",
          revision: "revision-workspace",
        },
      ],
      memoryScopes: [],
      memoryScopeIds: {},
      capturedAt: 102,
    },
    planVersions: [plan],
    activePlanVersion: 1,
    evidence: [evidence],
    reportRuns: [run],
    activeReportRunId: run.id,
    reportVersions: [
      {
        id: "report-v2",
        version: 1,
        artifactId: "opfs://chat/research-artifacts/v2.md",
        planVersion: 1,
        researchRunId: run.id,
        createdAt: 105,
        summary: "The v2 mapping is persisted.",
        keyFindings: ["Explicit mappings round-trip."],
        gaps: [],
        coveredStepIds: [plan.steps[0].id],
        evidenceIds: [evidence.id],
        kind: "initial",
      },
    ],
    activeReportVersion: 1,
  };
}

describe("ResearchTask repository", () => {
  it("uses storage version 2 and rejects legacy v1 records", () => {
    const task = createResearchTask({
      id: "research-legacy",
      sessionId: "session-1",
      goal: "Legacy research",
      now: 100,
    });

    expect(RESEARCH_TASK_STORAGE_VERSION).toBe(2);
    expect(
      parseStoredResearchTask({
        storageVersion: 1,
        taskId: task.id,
        sessionId: task.sessionId,
        updatedAt: task.updatedAt,
        task,
      }),
    ).toBeNull();
  });

  it("clears the research-only object store when IndexedDB upgrades from v1", async () => {
    const store = {
      indexNames: { contains: vi.fn(() => true) },
      clear: vi.fn(),
      getAll: vi.fn(() => {
        const request = { result: [] } as unknown as IDBRequest<unknown[]>;
        queueMicrotask(() => request.onsuccess?.(new Event("success")));
        return request;
      }),
    };
    const database = {
      objectStoreNames: { contains: vi.fn(() => true) },
      transaction: vi.fn(() => ({ objectStore: () => store })),
      close: vi.fn(),
      onversionchange: null,
    };
    const openRequest = {
      result: database,
      transaction: { objectStore: () => store },
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    } as unknown as IDBOpenDBRequest;
    const open = vi.fn(() => {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.call(
          openRequest,
          Object.assign(new Event("upgradeneeded"), {
            oldVersion: 1,
          }) as IDBVersionChangeEvent,
        );
        openRequest.onsuccess?.call(openRequest, new Event("success"));
      });
      return openRequest;
    });
    const repository = createResearchTaskRepository({
      indexedDb: { open } as unknown as IDBFactory,
    });

    await expect(repository.list()).resolves.toEqual([]);

    expect(open).toHaveBeenCalledWith(
      "neo-chat-research-tasks",
      RESEARCH_TASK_STORAGE_VERSION,
    );
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it("round-trips strict v2 plans, runs, reports, claims, and evidence mappings", async () => {
    const repository = createResearchTaskRepository({ indexedDb: null });
    const task = createV2TaskFixture();

    await repository.save(task);

    const restored = await repository.get(task.id);
    expect(restored?.planVersions[0].steps[0]).toMatchObject({ id: "step-v2" });
    expect(restored?.evidence[0]).toMatchObject({
      id: "evidence-v2",
      stepId: "step-v2",
      nodeId: task.reportRuns[0].nodes[0].id,
    });
    expect(restored?.reportRuns[0]).toMatchObject({
      id: "run-v2",
      claims: [{ id: "claim-v2", verificationStatus: "verified" }],
      learningPackets: [
        {
          id: "packet-v2",
          sourceAssessments: [{ sourceId: "source-v2", authority: "primary" }],
        },
      ],
    });
    expect(restored?.reportVersions[0]).toMatchObject({
      researchRunId: "run-v2",
      coveredStepIds: ["step-v2"],
    });
    expect(parseResearchTaskValue(task)).toEqual(task);
    expect(
      parseResearchTaskValue({ ...task, unsupportedLegacyField: true }),
    ).toBeNull();
    const evidenceWithoutStep: Record<string, unknown> = {
      ...task.evidence[0],
    };
    delete evidenceWithoutStep.stepId;
    expect(
      parseResearchTaskValue({
        ...task,
        evidence: [evidenceWithoutStep],
      }),
    ).toBeNull();
  });

  it("falls back to memory and lists newest tasks first", async () => {
    const repository = createResearchTaskRepository({ indexedDb: null });
    const first = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "First",
      now: 100,
    });
    const second = createResearchTask({
      id: "research-2",
      sessionId: "session-1",
      goal: "Second",
      now: 200,
    });
    const other = createResearchTask({
      id: "research-3",
      sessionId: "session-2",
      goal: "Other",
      now: 300,
    });

    await repository.save(first);
    await repository.save(second);
    await repository.save(other);

    expect(repository.getStatus()).toEqual({
      mode: "memory",
      durable: false,
      fallbackReason: "indexeddb_unavailable",
    });
    expect((await repository.list("session-1")).map((task) => task.id)).toEqual(
      ["research-2", "research-1"],
    );

    await repository.remove("research-1");
    expect(await repository.get("research-1")).toBeNull();
    await repository.clearSession("session-1");
    expect((await repository.list()).map((task) => task.id)).toEqual([
      "research-3",
    ]);
    await repository.clear();
    expect(await repository.list()).toEqual([]);
  });

  it("redacts credential-bearing errors and evidence URLs", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Research",
      now: 100,
    });
    task.error = {
      code: "REMOTE_ERROR",
      message: "Authorization: Bearer private-token password=hunter2",
    };
    task.evidence.push({
      id: "evidence-1",
      sourceId: "source-1",
      sourceType: "web",
      stepId: "step-1",
      nodeId: "node-1",
      locator: "https://example.com/page?token=private-token&view=full",
      retrievedAt: 100,
      contentHash: "sha256:content",
      claimIds: [],
    });

    const serialized = JSON.stringify(toPersistedResearchTask(task));
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("view=full");
  });

  it("rejects malformed records and downgrades after an IDB failure", async () => {
    expect(parseStoredResearchTask(null)).toBeNull();
    expect(
      parseStoredResearchTask({
        storageVersion: 99,
        taskId: "research-1",
        sessionId: "session-1",
        updatedAt: 100,
        task: createResearchTask({
          id: "research-1",
          sessionId: "session-1",
          goal: "Research",
          now: 100,
        }),
      }),
    ).toBeNull();

    const open = vi.fn(() => {
      throw new Error("storage disabled");
    });
    const repository = createResearchTaskRepository({
      indexedDb: { open } as unknown as IDBFactory,
    });
    await repository.save(
      createResearchTask({
        id: "research-1",
        sessionId: "session-1",
        goal: "Research",
        now: 100,
      }),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(repository.getStatus()).toEqual({
      mode: "memory",
      durable: false,
      fallbackReason: "indexeddb_operation_failed",
    });
  });
});
