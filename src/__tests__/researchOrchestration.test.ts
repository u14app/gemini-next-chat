import { describe, expect, it, vi } from "vitest";

import {
  applyResearchRunUserStop,
  calculateResearchCoverage,
  applyResearchSourceAssessments,
  createClaimRecordsFromLearningPackets,
  createNextResearchWave,
  createResearchReportRun,
  dedupeResearchQueries,
  evaluateResearchClaimVerification,
  expandResearchFrontier,
  findInvalidResearchWorkspaceSource,
  finalizeResearchReportRun,
  getCitableResearchClaims,
  getNextResearchBreadth,
  getResearchEvidenceDedupKeys,
  getResearchExplorationQueryLimit,
  getResearchExplorationToolCallLimit,
  getResearchReservedModelRounds,
  getResearchSourceBodyLimit,
  getResearchStopReason,
  getResearchVerificationQueryReserve,
  getResearchVerificationQueryAllowance,
  isResearchWorkspaceSnapshotPath,
  markMutableResearchEvidenceStale,
  mergeResearchSourceSnapshotForExpansion,
  resolveResearchStrategy,
  type ClaimRecord,
  type LearningPacket,
  type ResearchEvidence,
  type ResearchPlanVersion,
} from "@/lib/research";

function createPlan(): ResearchPlanVersion {
  const steps = Array.from({ length: 4 }, (_, index) => ({
    id: `step-${index + 1}`,
    title: `Step ${index + 1}`,
    objective: `Establish area ${index + 1}`,
    questions: [`Question ${index + 1}`],
    queryTopics: [`Topic ${index + 1}`],
    sourcePriorities: [
      { sourceType: "web" as const, priority: "high" as const },
    ],
    evidenceCriteria: ["Verified source"],
    priority: "high" as const,
  }));
  return {
    id: "plan-1",
    version: 1,
    title: "Plan",
    summary: "Structured plan",
    objective: "Reach a supported conclusion",
    scope: {
      audience: "Engineers",
      includes: ["Systems"],
      excludes: [],
      allowedSourceTypes: ["web"],
    },
    assumptions: [],
    deliverable: {
      kind: "research_report",
      description: "Cited report",
      requiredSections: ["Findings"],
    },
    strategy: resolveResearchStrategy("standard"),
    recon: {
      status: "completed",
      sourceFeasibility: "verified",
      startedAt: 1,
      completedAt: 2,
      timeoutMs: 30_000,
      queryLimit: 2,
      resultsPerQuery: 5,
      usage: { queryCount: 2, resultCount: 10, wallTimeMs: 1 },
      queries: [],
    },
    steps,
    completionCriteria: ["All high-priority steps are supported"],
    createdAt: 3,
  };
}

const evidence = (
  id: string,
  overrides: Partial<ResearchEvidence> = {},
): ResearchEvidence => ({
  id,
  sourceId: `source-${id}`,
  sourceType: "web",
  stepId: "step-1",
  nodeId: "node-1",
  locator: `https://${id}.example/source`,
  retrievedAt: 1,
  contentHash: `sha256:${id}`,
  publisherId: id,
  claimIds: ["C1"],
  stance: "supports",
  availability: "available",
  ...overrides,
});

const claim = (
  id: string,
  overrides: Partial<ClaimRecord> = {},
): ClaimRecord => ({
  id,
  text: `Claim ${id}`,
  importance: "major",
  stepId: "step-1",
  nodeIds: ["node-1"],
  supportingEvidenceIds: ["evidence-1"],
  contradictingEvidenceIds: [],
  verificationStatus: "pending",
  independentPublisherCount: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("Deep Research orchestration", () => {
  it("excludes host-owned research artifacts from approved workspace snapshots", () => {
    expect(isResearchWorkspaceSnapshotPath("sources/approved.md")).toBe(true);
    expect(
      isResearchWorkspaceSnapshotPath("research/checkpoints/wave.json"),
    ).toBe(false);
    expect(
      isResearchWorkspaceSnapshotPath("tool-results/call-large.json"),
    ).toBe(false);
  });

  it("resolves raised query presets and clamps advanced settings", () => {
    expect(resolveResearchStrategy("quick")).toEqual({
      initialBreadth: 2,
      maxDepth: 1,
      maxQueries: 6,
      resultsPerQuery: 5,
    });
    expect(resolveResearchStrategy("standard").maxQueries).toBe(16);
    expect(resolveResearchStrategy("deep").maxQueries).toBe(32);
    expect(
      resolveResearchStrategy("standard", {
        initialBreadth: 99,
        maxDepth: -2,
        maxQueries: 100,
        resultsPerQuery: 1,
      }),
    ).toEqual({
      initialBreadth: 8,
      maxDepth: 1,
      maxQueries: 48,
      resultsPerQuery: 3,
    });
  });

  it("reserves verification queries and caps source-body reads", () => {
    const quick = resolveResearchStrategy("quick");
    const standard = resolveResearchStrategy("standard");
    const deep = resolveResearchStrategy("deep");
    expect(getResearchVerificationQueryReserve(quick)).toBe(2);
    expect(getResearchVerificationQueryReserve(standard)).toBe(3);
    expect(getResearchVerificationQueryReserve(deep)).toBe(5);
    expect(getResearchVerificationQueryReserve({ maxQueries: 48 })).toBe(8);
    expect(getResearchExplorationQueryLimit(standard)).toBe(13);
    expect(getResearchExplorationQueryLimit({ maxQueries: 48 })).toBe(40);
    expect(getResearchVerificationQueryAllowance(standard, 13)).toBe(3);
    expect(getResearchVerificationQueryAllowance(standard, 5)).toBe(11);
    expect(getResearchSourceBodyLimit(quick, 100)).toBe(12);
    expect(getResearchSourceBodyLimit(deep, 100)).toBe(64);
    expect(getResearchSourceBodyLimit(deep, 11)).toBe(11);
    expect(getResearchExplorationToolCallLimit({ maxToolCalls: 50 })).toBe(40);
    expect(getResearchReservedModelRounds({ maxToolRounds: 12 })).toBe(2);
  });

  it("normalizes queries and halves breadth with ceiling semantics", () => {
    expect(
      dedupeResearchQueries(
        ["  Alpha   BETA ", "alpha beta", "Ｇａｍｍａ", ""],
        ["Existing"],
      ),
    ).toEqual(["Alpha   BETA", "Ｇａｍｍａ"]);
    expect(dedupeResearchQueries(["existing"], ["Existing"])).toEqual([]);
    expect(getNextResearchBreadth(6)).toBe(3);
    expect(getNextResearchBreadth(3)).toBe(2);
    expect(getNextResearchBreadth(1)).toBe(1);
  });

  it("creates a run frontier and schedules only the current wave breadth", () => {
    const plan = createPlan();
    const run = createResearchReportRun({
      id: "run-1",
      taskId: "task-1",
      plan: {
        ...plan,
        strategy: { ...plan.strategy, initialBreadth: 2 },
      },
      now: 10,
    });
    expect(run.nodes).toHaveLength(4);
    expect(run.frontierNodeIds).toHaveLength(4);
    expect(run.nodes.every((node) => node.depth === 1)).toBe(true);

    const scheduled = createNextResearchWave(run, 20);
    expect(scheduled?.wave).toMatchObject({
      index: 1,
      depth: 1,
      breadth: 2,
      status: "queued",
    });
    expect(scheduled?.wave.nodeIds).toHaveLength(2);
    expect(scheduled?.run.frontierNodeIds).toHaveLength(2);
    expect(
      scheduled?.run.nodes.filter((node) => node.status === "queued"),
    ).toHaveLength(2);
  });

  it("keeps the legacy default bounded to in-scope follow-ups", () => {
    const plan = createPlan();
    const run = createResearchReportRun({
      id: "run-1",
      taskId: "task-1",
      plan,
      now: 10,
    });
    const parent = run.nodes[0];
    const packet: LearningPacket = {
      id: "packet-1",
      nodeId: parent.id,
      createdAt: 20,
      learnings: [],
      sourceAssessments: [],
      followUps: [
        {
          id: "follow-up-1",
          question: "A new in-scope question",
          rationale: "Close the evidence gap",
          priority: "high",
          scopeImpact: "within",
          requiredSourceTypes: ["web"],
        },
        {
          id: "follow-up-2",
          question: parent.query.toUpperCase(),
          rationale: "Duplicate",
          priority: "low",
          scopeImpact: "within",
          requiredSourceTypes: ["web"],
        },
        {
          id: "follow-up-3",
          question: "Use a private source",
          rationale: "Requires permission",
          priority: "high",
          scopeImpact: "source_expansion",
          requiredSourceTypes: ["mcp"],
        },
        {
          id: "follow-up-4",
          question: "A second in-scope question",
          rationale: "Close another gap",
          priority: "high",
          scopeImpact: "within",
          requiredSourceTypes: ["web"],
        },
        {
          id: "follow-up-5",
          question: "A third in-scope question",
          rationale: "Would exceed the reduced breadth",
          priority: "medium",
          scopeImpact: "within",
          requiredSourceTypes: ["web"],
        },
        {
          id: "follow-up-6",
          question: "A fourth in-scope question",
          rationale: "Would also exceed the reduced breadth",
          priority: "low",
          scopeImpact: "within",
          requiredSourceTypes: ["web"],
        },
      ],
    };

    const expanded = expandResearchFrontier(run, packet, 20);
    expect(expanded.addedNodeIds).toHaveLength(2);
    expect(expanded.duplicateFollowUpIds).toEqual(["follow-up-2"]);
    expect(expanded.breadthLimitedFollowUpIds).toEqual([
      "follow-up-5",
      "follow-up-6",
    ]);
    expect(expanded.depthLimitedFollowUpIds).toEqual([]);
    expect(expanded.unavailableSourceFollowUpIds).toEqual(["follow-up-3"]);
    expect(expanded.run.phase).toBe("awaiting_scope_approval");
    expect(
      expanded.run.nodes.find((node) => node.id === expanded.addedNodeIds[0]),
    ).toMatchObject({ parentNodeId: parent.id, depth: 2, stepId: "step-1" });
  });

  it("adds an authorized scope expansion to the same run", () => {
    const plan = createPlan();
    const run = createResearchReportRun({
      id: "run-auto-scope",
      taskId: "task-auto-scope",
      plan,
      now: 10,
    });
    const packet: LearningPacket = {
      id: "packet-auto-scope",
      nodeId: run.nodes[0].id,
      createdAt: 20,
      learnings: [],
      sourceAssessments: [],
      followUps: [
        {
          id: "follow-up-auto-scope",
          question: "Inspect the configured private benchmark",
          rationale: "Close the remaining benchmark gap",
          priority: "high",
          scopeImpact: "source_expansion",
          requiredSourceTypes: ["mcp"],
        },
      ],
    };

    const expanded = expandResearchFrontier(run, packet, 20, {
      autoExpandScope: true,
      allowedSourceTypes: ["web", "mcp"],
    });

    expect(expanded.run.id).toBe(run.id);
    expect(expanded.run.phase).toBe(run.phase);
    expect(expanded.scheduledFollowUpIds).toEqual(["follow-up-auto-scope"]);
    expect(expanded.unavailableSourceFollowUpIds).toEqual([]);
    expect(expanded.run.learningPackets).toHaveLength(1);
  });

  it("skips unavailable expansion sources without pausing other research", () => {
    const plan = createPlan();
    const run = createResearchReportRun({
      id: "run-partial-scope",
      taskId: "task-partial-scope",
      plan,
      now: 10,
    });
    const packet: LearningPacket = {
      id: "packet-partial-scope",
      nodeId: run.nodes[0].id,
      createdAt: 20,
      learnings: [],
      sourceAssessments: [],
      followUps: [
        {
          id: "follow-up-within",
          question: "Continue with the approved public sources",
          rationale: "Close the public evidence gap",
          priority: "high",
          scopeImpact: "within",
          requiredSourceTypes: ["web"],
        },
        {
          id: "follow-up-unavailable",
          question: "Inspect an unavailable private knowledge collection",
          rationale: "Would close a private evidence gap",
          priority: "high",
          scopeImpact: "source_expansion",
          requiredSourceTypes: ["knowledge"],
        },
      ],
    };

    const expanded = expandResearchFrontier(run, packet, 20, {
      autoExpandScope: true,
      allowedSourceTypes: ["web"],
    });

    expect(expanded.run.id).toBe(run.id);
    expect(expanded.run.phase).toBe(run.phase);
    expect(expanded.scheduledFollowUpIds).toEqual(["follow-up-within"]);
    expect(expanded.unavailableSourceFollowUpIds).toEqual([
      "follow-up-unavailable",
    ]);
    expect(expanded.run.frontierNodeIds).toHaveLength(
      run.frontierNodeIds.length,
    );
  });

  it("adds only required current-context sources to an expansion snapshot", () => {
    const approved = {
      model: "provider:approved-model",
      reasoningMode: "high" as const,
      approvalMode: "balanced" as const,
      searchEnabled: false,
      toolIds: ["fetch_url"],
      pluginIds: [],
      skillIds: [],
      knowledgeCollectionIds: [],
      attachmentIds: [],
      workspaceFileIds: [],
      memoryScopes: [],
      memoryScopeIds: {},
      capturedAt: 10,
    };
    const configured = {
      ...approved,
      model: "provider:changed-model",
      approvalMode: "strict" as const,
      searchEnabled: true,
      toolIds: [
        "web_search",
        "search_knowledge",
        "inspect_attachment",
        "read_workspace_file",
        "plugin_read_benchmark",
      ],
      pluginIds: ["plugin-1"],
      knowledgeCollectionIds: ["knowledge-1"],
      attachmentIds: ["attachment-1"],
      workspaceFileIds: ["workspace-1"],
      capturedAt: 20,
    };

    const merged = mergeResearchSourceSnapshotForExpansion({
      approved,
      configured,
      requiredSourceTypes: ["knowledge", "mcp"],
      capturedAt: 30,
    });

    expect(merged.model).toBe("provider:approved-model");
    expect(merged.approvalMode).toBe("balanced");
    expect(merged.toolIds).toEqual([
      "fetch_url",
      "search_knowledge",
      "plugin_read_benchmark",
    ]);
    expect(merged.pluginIds).toEqual(["plugin-1"]);
    expect(merged.knowledgeCollectionIds).toEqual(["knowledge-1"]);
    expect(merged.attachmentIds).toEqual([]);
    expect(merged.workspaceFileIds).toEqual([]);
    expect(merged.capturedAt).toBe(30);
  });

  it("verifies claims using primary or independent evidence and preserves conflicts", () => {
    const baseClaim = {
      importance: "major" as const,
      supportingEvidenceIds: ["evidence-1"],
      contradictingEvidenceIds: [],
    };
    expect(
      evaluateResearchClaimVerification(baseClaim, [
        evidence("evidence-1", { authority: "primary" }),
      ]).status,
    ).toBe("verified");
    expect(
      evaluateResearchClaimVerification(baseClaim, [evidence("evidence-1")])
        .status,
    ).toBe("pending");
    expect(
      evaluateResearchClaimVerification(baseClaim, [
        evidence("evidence-1", {
          authority: "primary",
          freshness: "stale",
        }),
      ]).status,
    ).toBe("unsupported");
    expect(
      evaluateResearchClaimVerification(
        {
          ...baseClaim,
          supportingEvidenceIds: ["evidence-1", "evidence-2"],
        },
        [evidence("evidence-1"), evidence("evidence-2")],
      ).status,
    ).toBe("verified");
    expect(
      evaluateResearchClaimVerification(
        { ...baseClaim, contradictingEvidenceIds: ["evidence-2"] },
        [evidence("evidence-1"), evidence("evidence-2")],
      ).status,
    ).toBe("unresolved");
    const cyclicMirrors = [
      evidence("evidence-1", {
        mirrorOfSourceId: "source-evidence-2",
      }),
      evidence("evidence-2", {
        mirrorOfSourceId: "source-evidence-1",
      }),
    ];
    expect(
      evaluateResearchClaimVerification(
        {
          ...baseClaim,
          supportingEvidenceIds: ["evidence-1", "evidence-2"],
        },
        cyclicMirrors,
      ),
    ).toMatchObject({ status: "pending", independentPublisherCount: 1 });
    const unclassifiedWorkspaceSources = [
      evidence("workspace-1", {
        sourceType: "workspace",
        publisherId: undefined,
      }),
      evidence("workspace-2", {
        sourceType: "workspace",
        publisherId: undefined,
      }),
    ];
    expect(
      evaluateResearchClaimVerification(
        {
          ...baseClaim,
          supportingEvidenceIds: ["workspace-1", "workspace-2"],
        },
        unclassifiedWorkspaceSources,
      ),
    ).toMatchObject({ status: "pending", independentPublisherCount: 1 });
  });

  it("treats every supported claim as citable with derived confidence", () => {
    const run = {
      claims: [
        claim("verified-claim", { verificationStatus: "verified" }),
        claim("pending-claim", { verificationStatus: "pending" }),
        claim("unresolved-claim", {
          verificationStatus: "unresolved",
          contradictingEvidenceIds: ["evidence-2"],
        }),
        claim("unsupported-claim", { verificationStatus: "unsupported" }),
        claim("stale-claim", { supportingEvidenceIds: ["evidence-stale"] }),
        claim("gone-claim", { supportingEvidenceIds: ["evidence-gone"] }),
      ],
    };

    expect(
      getCitableResearchClaims(run, [
        evidence("evidence-1"),
        evidence("evidence-2"),
        evidence("evidence-stale", { freshness: "stale" }),
        evidence("evidence-gone", { availability: "unavailable" }),
      ]).map((citable) => [citable.claim.id, citable.confidence]),
    ).toEqual([
      ["verified-claim", "corroborated"],
      ["pending-claim", "single_source"],
      ["unresolved-claim", "contested"],
    ]);
  });

  it("keeps changed source versions distinct while deduplicating mirrored content", () => {
    const original = evidence("evidence-1", {
      locator: "https://example.com/source/",
      contentHash: "sha256:original",
    });
    const changed = evidence("evidence-2", {
      sourceId: original.sourceId,
      locator: "https://example.com/source",
      contentHash: "sha256:changed",
    });
    const mirror = evidence("evidence-3", {
      locator: "https://mirror.example/copy",
      contentHash: original.contentHash,
    });
    const originalKeys = new Set(getResearchEvidenceDedupKeys(original));
    expect(
      getResearchEvidenceDedupKeys(changed).some((key) =>
        originalKeys.has(key),
      ),
    ).toBe(false);
    expect(
      getResearchEvidenceDedupKeys(mirror).some((key) => originalKeys.has(key)),
    ).toBe(true);
  });

  it("expires mutable sources for an update without invalidating local evidence", () => {
    const web = evidence("web", { sourceType: "web", freshness: "current" });
    const plugin = evidence("plugin", {
      sourceType: "plugin",
      freshness: "current",
    });
    const local = evidence("local", {
      sourceType: "knowledge",
      freshness: "current",
    });
    expect(markMutableResearchEvidenceStale([web, plugin, local])).toEqual([
      { ...web, freshness: "stale" },
      { ...plugin, freshness: "stale" },
      local,
    ]);
  });

  it("builds host-owned claim records from source-bound learning packets", () => {
    const sources = [
      evidence("evidence-1", { authority: "primary" }),
      evidence("evidence-2"),
    ];
    const packets: LearningPacket[] = [
      {
        id: "packet-1",
        nodeId: "node-1",
        createdAt: 10,
        learnings: [
          {
            id: "learning-1",
            claimId: "C1",
            claimText: "The limit is ten.",
            stepId: "step-1",
            importance: "major",
            stance: "supports",
            statement: "The primary source states a limit of ten.",
            sourceIds: [sources[0].sourceId],
            evidenceIds: [],
          },
          {
            id: "learning-2",
            claimId: "C1",
            claimText: "The limit is ten.",
            stepId: "step-1",
            importance: "major",
            stance: "contradicts",
            statement: "A second source reports a different limit.",
            sourceIds: [sources[1].sourceId],
            evidenceIds: [],
          },
        ],
        sourceAssessments: [
          {
            sourceId: sources[0].sourceId,
            authority: "primary",
            publisherId: "official-publisher",
            rationale: "Official documentation",
          },
          {
            sourceId: sources[1].sourceId,
            authority: "secondary",
            rationale: "Independent analysis",
          },
        ],
        followUps: [],
      },
    ];
    expect(applyResearchSourceAssessments(sources, packets)[0]).toMatchObject({
      authority: "primary",
      publisherId: "evidence-1.example",
    });
    expect(createClaimRecordsFromLearningPackets(packets, sources, 20)).toEqual(
      [
        expect.objectContaining({
          id: "C1",
          nodeIds: ["node-1"],
          supportingEvidenceIds: ["evidence-1"],
          contradictingEvidenceIds: ["evidence-2"],
          verificationStatus: "unresolved",
          updatedAt: 20,
        }),
      ],
    );
  });

  it("computes explicit high-priority coverage and structured stop reasons", () => {
    const plan = createPlan();
    const run = createResearchReportRun({
      taskId: "task-1",
      plan,
      now: 10,
    });
    const claims: ClaimRecord[] = plan.steps.map((step, index) => ({
      id: `C${index + 1}`,
      text: `Claim ${index + 1}`,
      importance: "major",
      stepId: step.id,
      nodeIds: [run.nodes[index].id],
      supportingEvidenceIds: [`evidence-${index + 1}`],
      contradictingEvidenceIds: [],
      verificationStatus: "verified",
      independentPublisherCount: 2,
      createdAt: 20,
      updatedAt: 20,
    }));
    const coverage = calculateResearchCoverage(
      plan.steps,
      run.nodes.map((node) => ({ ...node, status: "completed" })),
      claims,
    );
    expect(coverage).toMatchObject({
      requiredStepCount: 4,
      coveredStepCount: 4,
      overallRatio: 1,
      complete: true,
    });
    const regressedCoverage = calculateResearchCoverage(
      plan.steps,
      run.nodes.map((node) => ({ ...node, status: "completed" })),
      claims.map((claim, index) =>
        index === 0
          ? { ...claim, verificationStatus: "unresolved" as const }
          : claim,
      ),
    );
    expect(regressedCoverage).toMatchObject({
      requiredStepCount: 4,
      coveredStepCount: 3,
      stepRatio: 0.75,
      complete: false,
    });
    const baseEvaluation = {
      now: 30,
      coverage: { ...coverage, complete: false },
      frontierCount: 1,
      currentDepth: 1,
      queryCount: 1,
      sourceBodyCount: 1,
      sourceBodyLimit: 32,
      remainingToolCalls: 10,
      wavesWithoutNewSources: 0,
      wavesWithoutNewVerifiedClaims: 0,
    };
    expect(
      getResearchStopReason(plan.strategy, {
        ...baseEvaluation,
        coverage,
      })?.code,
    ).toBe("coverage_satisfied");
    expect(
      getResearchStopReason(plan.strategy, {
        ...baseEvaluation,
        queryCount: plan.strategy.maxQueries,
      })?.code,
    ).toBe("max_queries");
    expect(
      getResearchStopReason(plan.strategy, {
        ...baseEvaluation,
        wavesWithoutNewVerifiedClaims: 2,
      }),
    ).toBeUndefined();
    expect(
      getResearchStopReason(plan.strategy, {
        ...baseEvaluation,
        wavesWithoutNewSources: 1,
        wavesWithoutNewVerifiedClaims: 1,
      }),
    ).toBeUndefined();
    expect(
      getResearchStopReason(plan.strategy, {
        ...baseEvaluation,
        wavesWithoutNewSources: 2,
        wavesWithoutNewVerifiedClaims: 2,
      })?.code,
    ).toBe("no_new_sources");

    const stopCases = [
      [{ userAction: "cancel" as const }, "user_cancelled"],
      [{ userAction: "pause" as const }, "user_paused"],
      [{ pendingScopeApproval: true }, "scope_approval_required"],
      [{ dependencyAvailable: false }, "dependency_unavailable"],
      [{ remainingToolCalls: 0 }, "budget_exhausted"],
      [{ sourceBodyCount: baseEvaluation.sourceBodyLimit }, "max_sources"],
      [{ frontierCount: 0, currentDepth: plan.strategy.maxDepth }, "max_depth"],
      [{ frontierCount: 0 }, "frontier_exhausted"],
    ] as const;
    for (const [overrides, expected] of stopCases) {
      expect(
        getResearchStopReason(plan.strategy, {
          ...baseEvaluation,
          ...overrides,
        })?.code,
      ).toBe(expected);
    }
  });

  it("records host-owned pause and cancel reasons on active runs", () => {
    const run = createResearchReportRun({
      id: "run-stop",
      taskId: "task-1",
      plan: createPlan(),
      now: 10,
    });
    const scheduled = createNextResearchWave(run, 20)!;
    const running = {
      ...scheduled.run,
      waves: scheduled.run.waves.map((wave) => ({
        ...wave,
        status: "running" as const,
      })),
      nodes: scheduled.run.nodes.map((node) =>
        scheduled.wave.nodeIds.includes(node.id)
          ? { ...node, status: "searching" as const }
          : node,
      ),
    };
    expect(applyResearchRunUserStop(running, "pause", 30)).toMatchObject({
      phase: "paused",
      stopReason: { code: "user_paused", at: 30 },
      waves: [{ status: "paused" }],
    });
    expect(applyResearchRunUserStop(running, "cancel", 40)).toMatchObject({
      phase: "cancelled",
      endedAt: 40,
      stopReason: { code: "user_cancelled", at: 40 },
      waves: [{ status: "failed" }],
    });
  });

  it("uses one terminal timestamp for a finalized report run", () => {
    const plan = createPlan();
    const running = createResearchReportRun({
      taskId: "task-1",
      plan,
      now: 10,
    });
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(25)
      .mockReturnValueOnce(26);

    try {
      expect(finalizeResearchReportRun(running, "completed")).toMatchObject({
        phase: "completed",
        startedAt: 10,
        updatedAt: 25,
        endedAt: 25,
        checkpoint: undefined,
      });
      expect(now).toHaveBeenCalledOnce();
    } finally {
      now.mockRestore();
    }
  });

  it("fails closed when a frozen workspace source changes or disappears", () => {
    const frozen = [
      { path: "sources/a.md", contentHash: "sha256:a", revision: "rev-a" },
      { path: "sources/b.md", contentHash: "sha256:b", revision: "rev-b" },
    ];
    expect(findInvalidResearchWorkspaceSource(frozen, frozen)).toBeUndefined();
    expect(
      findInvalidResearchWorkspaceSource(frozen, [
        frozen[0],
        { ...frozen[1], contentHash: "sha256:changed" },
      ]),
    ).toBe("sources/b.md");
    expect(findInvalidResearchWorkspaceSource(frozen, [frozen[1]])).toBe(
      "sources/a.md",
    );
  });
});
