import { describe, expect, it } from "vitest";

import {
  commitToolExecution,
  createAgentRun,
  markToolExecutionRunning,
  prepareToolExecution,
  recordAgentEvidence,
} from "@/lib/agent";
import {
  createResearchTask,
  transitionResearchTask,
  type ResearchPlanVersion,
  type ResearchReportRun,
} from "@/lib/research";
import { createResearchTaskViewModel } from "@/features/research/researchViewModel";

function createPlan(
  id: string,
  titles: string[],
  createdAt = 105,
): ResearchPlanVersion {
  return {
    id,
    version: 1,
    title: "Evidence-led research",
    summary: "Answer each step with explicit evidence links.",
    objective: "Produce a verifiable answer.",
    scope: {
      audience: "Product decision makers",
      includes: ["Primary documentation"],
      excludes: ["Unverified social posts"],
      allowedSourceTypes: ["web"],
    },
    assumptions: ["Public sources are sufficient."],
    deliverable: {
      kind: "decision_memo",
      description: "A concise decision memo.",
      requiredSections: ["Recommendation", "Evidence"],
    },
    strategy: {
      initialBreadth: 4,
      maxDepth: 2,
      maxQueries: 16,
      resultsPerQuery: 5,
    },
    recon: {
      status: "completed",
      sourceFeasibility: "verified",
      startedAt: 101,
      completedAt: 104,
      timeoutMs: 30_000,
      queryLimit: 2,
      resultsPerQuery: 5,
      usage: { queryCount: 2, resultCount: 8, wallTimeMs: 3_000 },
      queries: [
        {
          query: "primary documentation",
          status: "completed",
          resultCount: 5,
          domains: ["example.com"],
        },
      ],
    },
    steps: titles.map((title, index) => ({
      id: `${id}-step-${index + 1}`,
      title,
      objective: title,
      questions: [title],
      queryTopics: [`${title} primary source`],
      sourcePriorities: [{ sourceType: "web", priority: "high" }],
      evidenceCriteria: ["Use explicit source IDs."],
      priority: index === 0 ? "high" : "medium",
    })),
    completionCriteria: ["Every major claim is verified."],
    createdAt,
  };
}

function createRun(
  plan: ResearchPlanVersion,
  taskId: string,
): ResearchReportRun {
  return {
    id: "research-run-live",
    taskId,
    planVersion: plan.version,
    reportKind: "initial",
    phase: "exploring",
    strategy: plan.strategy,
    waves: [
      {
        id: "wave-1",
        index: 0,
        depth: 1,
        breadth: 2,
        nodeIds: ["node-1", "node-2"],
        status: "running",
        newEvidenceCount: 1,
        newVerifiedClaimCount: 1,
        startedAt: 120,
      },
    ],
    nodes: [
      {
        id: "node-1",
        waveId: "wave-1",
        stepId: plan.steps[0].id,
        depth: 1,
        objective: plan.steps[0].objective,
        query: "primary source one",
        status: "completed",
        sourceIds: ["source-live"],
        evidenceIds: ["evidence-live"],
        claimIds: ["claim-1"],
        learningPacketId: "learning-1",
        createdAt: 120,
        updatedAt: 130,
      },
      {
        id: "node-2",
        waveId: "wave-1",
        stepId: plan.steps[1].id,
        depth: 1,
        objective: plan.steps[1].objective,
        query: "primary source two",
        status: "searching",
        sourceIds: [],
        evidenceIds: [],
        claimIds: [],
        createdAt: 125,
        updatedAt: 135,
      },
    ],
    learningPackets: [
      {
        id: "learning-1",
        nodeId: "node-1",
        learnings: [
          {
            id: "learning-item-1",
            claimId: "claim-1",
            claimText: "The first claim is verified.",
            stepId: plan.steps[0].id,
            importance: "major",
            stance: "supports",
            statement: "The primary source confirms the first claim.",
            sourceIds: ["source-live"],
            evidenceIds: ["evidence-live"],
          },
        ],
        sourceAssessments: [
          {
            sourceId: "source-live",
            authority: "primary",
            rationale: "Official product documentation.",
          },
        ],
        followUps: [],
        createdAt: 130,
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "The first claim is verified.",
        importance: "major",
        stepId: plan.steps[0].id,
        nodeIds: ["node-1"],
        supportingEvidenceIds: ["evidence-live"],
        contradictingEvidenceIds: [],
        verificationStatus: "verified",
        independentPublisherCount: 1,
        createdAt: 125,
        updatedAt: 130,
      },
    ],
    executedQueries: ["primary source one", "primary source two"],
    frontierNodeIds: ["node-2"],
    coverage: {
      requiredStepCount: plan.steps.length,
      coveredStepCount: 1,
      majorClaimCount: 1,
      verifiedMajorClaimCount: 1,
      unresolvedMajorClaimCount: 0,
      stepRatio: 1 / plan.steps.length,
      claimRatio: 1,
      overallRatio: 0.5,
      complete: false,
    },
    usage: {
      queryCount: 5,
      sourceBodyCount: 1,
      toolRounds: 2,
      toolCalls: 4,
      wallTimeMs: 10_000,
      totalTokens: 2_000,
    },
    startedAt: 120,
    updatedAt: 135,
  };
}

describe("research task view model", () => {
  it("builds a safe Tool and source activity without raw arguments or results", async () => {
    let run = createAgentRun({
      id: "run-1",
      sessionId: "session-1",
      now: 100,
    });
    run = prepareToolExecution(run, {
      id: "execution-1",
      callId: "call-1",
      toolName: "fetch_url",
      definitionFingerprint: "fingerprint",
      argumentsHash: "arguments-hash",
      targetSummary: "must not be rendered",
      policy: {
        effects: ["network_read"],
        idempotency: "idempotent",
        sensitivity: "none",
        origin: "builtin",
      },
      at: 110,
    });
    run = markToolExecutionRunning(run, "execution-1", 120);
    run = commitToolExecution(run, "execution-1", { at: 130 });
    run = recordAgentEvidence(
      run,
      [
        {
          sourceId: "source-safe-id",
          url: "https://example.com/private?token=must-not-render",
          title: "Primary documentation",
          retrievedAt: 125,
          contentHash: "sha256:abc",
          retrievalKind: "fetch",
          toolCallId: "call-1",
        },
      ],
      135,
    );
    const task = {
      ...createResearchTask({
        id: "research-1",
        sessionId: "session-1",
        goal: "Research safely",
        now: 100,
      }),
      executionRunIds: [run.id],
    };

    const viewModel = await createResearchTaskViewModel(task, {
      [run.id]: run,
    });
    const activity = viewModel.activities.find(
      (item) => item.id === "execution-1",
    );

    expect(activity).toMatchObject({
      phase: "researching",
      title: "Completed fetch_url",
      detail: "Read-only source: Primary documentation",
    });
    expect(JSON.stringify(activity)).not.toContain("must-not-render");
  });

  it("hides legacy internal result filenames in Research activity", async () => {
    let run = createAgentRun({
      id: "run-internal",
      sessionId: "session-1",
      now: 100,
    });
    run = prepareToolExecution(run, {
      id: "execution-internal",
      callId: "call-internal",
      toolName: "read_workspace_file",
      definitionFingerprint: "fingerprint",
      argumentsHash: "arguments-hash",
      policy: {
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      at: 110,
    });
    run = markToolExecutionRunning(run, "execution-internal", 120);
    run = commitToolExecution(run, "execution-internal", { at: 130 });
    run = recordAgentEvidence(
      run,
      [
        {
          sourceId: "source-internal",
          url: "workspace:///tool-results/call-internal.json",
          title: "tool-results/call-internal.json",
          retrievedAt: 125,
          contentHash: "sha256:internal",
          retrievalKind: "attachment",
          toolCallId: "call-internal",
        },
      ],
      135,
    );
    const task = {
      ...createResearchTask({
        id: "research-internal",
        sessionId: "session-1",
        goal: "Research safely",
        now: 100,
      }),
      executionRunIds: [run.id],
    };

    const viewModel = await createResearchTaskViewModel(task, {
      [run.id]: run,
    });
    expect(
      viewModel.activities.find((item) => item.id === "execution-internal"),
    ).toMatchObject({
      title: "Completed read_workspace_file",
      detail: "Read-only source: Internal tool result",
    });
  });

  it("maps explicit v2 run, step, node, claim, and query state", async () => {
    const draft = createResearchTask({
      id: "research-live",
      sessionId: "session-live",
      goal: "Research with live progress",
      now: 100,
    });
    const plan = createPlan("plan-live", [
      "Question one",
      "Question two",
      "Question three",
    ]);
    const reportRun = createRun(plan, draft.id);
    const withPlan = {
      ...draft,
      planVersions: [plan],
      activePlanVersion: 1,
      reportRuns: [reportRun],
      activeReportRunId: reportRun.id,
      evidence: [
        {
          id: "evidence-live",
          sourceId: "source-live",
          sourceType: "web" as const,
          stepId: plan.steps[0].id,
          nodeId: "node-1",
          title: "Live primary source",
          locator: "https://example.com/live",
          retrievedAt: 125,
          contentHash: "sha256:live",
          claimIds: ["claim-1"],
          authority: "primary" as const,
        },
      ],
      sourceSnapshot: {
        model: "test-model",
        approvalMode: "balanced" as const,
        searchEnabled: true,
        toolIds: ["fetch_url"],
        pluginIds: [],
        skillIds: [],
        knowledgeCollectionIds: ["knowledge-1", "knowledge-2"],
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
        capturedAt: 115,
      },
    };
    const researching = transitionResearchTask(
      transitionResearchTask(withPlan, "plan_ready", { now: 110 }),
      "researching",
      { now: 120 },
    );

    const viewModel = await createResearchTaskViewModel(researching);

    expect(viewModel.completedQuestions).toBe(1);
    expect(viewModel.plan?.steps.map((step) => step.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
    expect(viewModel.evidence[0]).toMatchObject({
      title: "Live primary source",
      domain: "example.com",
      questionIndexes: [0],
      stepId: plan.steps[0].id,
      nodeId: "node-1",
      verificationStatus: "verified",
      linkedClaims: [
        {
          id: "claim-1",
          text: "The first claim is verified.",
          importance: "major",
          verificationStatus: "verified",
        },
      ],
    });
    expect(viewModel.plan?.steps[0].evidenceIds).toEqual([
      viewModel.evidence[0].id,
    ]);
    expect(viewModel.sourceScope).toMatchObject({
      searchEnabled: true,
      knowledgeCount: 2,
      workspaceCount: 1,
    });
    expect(viewModel.plan).toMatchObject({
      objective: "Produce a verifiable answer.",
      deliverable: { kind: "decision_memo" },
      strategy: { queryLimit: 16, maxDepth: 2, sourceContentLimit: 32 },
      recon: { queryCount: 2, maxQueries: 2 },
    });
    expect(viewModel.run).toMatchObject({
      id: "research-run-live",
      phase: "exploring",
      currentWave: 1,
      currentDepth: 1,
      queryUsage: {
        used: 5,
        limit: 16,
        reservedForValidation: 3,
        planningUsed: 2,
      },
      claimCounts: { total: 1, verified: 1 },
    });
    expect(viewModel.run?.nodes[0]).toMatchObject({
      id: "node-1",
      evidenceIds: ["evidence-live"],
      verifiedClaimCount: 1,
      learnings: ["The primary source confirms the first claim."],
    });
  });

  it("does not infer completion from evidence that lacks a completed node", async () => {
    const draft = createResearchTask({
      id: "research-persisted",
      sessionId: "session-persisted",
      goal: "Keep progress while the run journal loads",
      now: 100,
    });
    const plan = createPlan("plan-persisted", ["Question one", "Question two"]);
    const withPlan = {
      ...draft,
      planVersions: [plan],
      activePlanVersion: 1,
      evidence: [
        {
          id: "evidence-persisted",
          sourceId: "source-persisted",
          sourceType: "web" as const,
          stepId: plan.steps[0].id,
          nodeId: "node-persisted",
          title: "Persisted primary source",
          locator: "https://example.com/persisted",
          retrievedAt: 115,
          contentHash: "sha256:persisted",
          claimIds: [],
        },
      ],
    };
    const researching = transitionResearchTask(
      transitionResearchTask(withPlan, "plan_ready", { now: 110 }),
      "researching",
      { now: 120 },
    );

    const viewModel = await createResearchTaskViewModel(researching);

    expect(viewModel.completedQuestions).toBe(0);
    expect(viewModel.evidence[0].questionIndexes).toEqual([0]);
    expect(viewModel.plan?.steps.map((step) => step.status)).toEqual([
      "in_progress",
      "pending",
    ]);
  });

  it("keeps a recoverable error separate from the task summary", async () => {
    const task = {
      ...createResearchTask({
        id: "research-error",
        sessionId: "session-1",
        goal: "Original research goal",
        now: 100,
      }),
      status: "clarifying" as const,
      error: {
        code: "AGENT_RUN_LEASE_CONFLICT",
        message: "Another tab is running this session.",
        recoverable: true,
      },
    };

    const viewModel = await createResearchTaskViewModel(task);

    expect(viewModel.summary).toBe("Original research goal");
    expect(viewModel.error).toEqual(task.error);
  });
});
