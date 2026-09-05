import { describe, expect, it } from "vitest";
import Ajv from "ajv";

import {
  buildResearchExecutionPrompt,
  buildResearchPlanPrompt,
  buildResearchSynthesisPrompt,
  buildResearchWaveArchivePrompt,
  buildResearchWavePrompt,
  buildResearchWaveRepairPrompt,
  buildResearchWaveResponseFormat,
  createDegradedResearchWavePackets,
  createResearchReportRun,
  createResearchTask,
  createResearchWaveAliasContext,
  finalizeResearchWavePackets,
  getResearchClaimSignature,
  normalizeResearchPlanDraft,
  parseResearchPlan,
  parseResearchQuestionCoverage,
  parseResearchStepCoverage,
  parseResearchWavePackets,
  RESEARCH_WAVE_RESPONSE_FORMAT,
  summarizeResearchReport,
  type ResearchPlanVersion,
  type ResearchWaveAliasContext,
} from "@/lib/research";

const planDraft = {
  title: "Market review",
  summary: "Compare primary sources and record material conflicts.",
  objective: "Determine which system better fits the stated constraints.",
  scope: {
    audience: "Engineering leads",
    timeRange: { description: "Current as of 2026" },
    includes: ["Architecture", "Operating cost"],
    excludes: ["Unannounced products"],
    allowedSourceTypes: ["web"],
  },
  assumptions: ["Public documentation is available"],
  deliverable: {
    kind: "comparison",
    description: "A sourced comparison",
    requiredSections: ["Recommendation", "Trade-offs"],
  },
  strategy: {
    initialBreadth: 4,
    maxDepth: 2,
    maxQueries: 16,
    resultsPerQuery: 5,
  },
  steps: [
    {
      id: "step-1",
      title: "Document the systems",
      objective: "Establish each system's supported architecture.",
      questions: ["What architecture does each system support?"],
      queryTopics: ["official architecture documentation"],
      sourcePriorities: [
        {
          sourceType: "web",
          priority: "high",
          rationale: "Use primary documentation",
        },
      ],
      evidenceCriteria: ["One direct primary source per system"],
      priority: "high",
    },
    {
      id: "step-2",
      title: "Compare operating cost",
      objective: "Compare current public pricing and operating constraints.",
      questions: ["What are the material cost drivers?"],
      queryTopics: ["official pricing operating cost"],
      sourcePriorities: [{ sourceType: "web", priority: "high" }],
      evidenceCriteria: ["Current pricing pages with retrieval dates"],
      priority: "high",
    },
    {
      id: "step-3",
      title: "Verify the recommendation",
      objective: "Challenge the provisional recommendation.",
      questions: ["Which evidence could reverse the recommendation?"],
      queryTopics: ["system limitations independent analysis"],
      sourcePriorities: [{ sourceType: "web", priority: "medium" }],
      evidenceCriteria: ["Two independent sources for major claims"],
      priority: "medium",
    },
  ],
  completionCriteria: [
    "Every high-priority step has verified evidence",
    "Material conflicts remain visible",
  ],
} as const;

function createPlan(): ResearchPlanVersion {
  return {
    id: "plan-1",
    version: 1,
    ...JSON.parse(JSON.stringify(planDraft)),
    recon: {
      status: "completed",
      sourceFeasibility: "verified",
      startedAt: 101,
      completedAt: 102,
      timeoutMs: 30_000,
      queryLimit: 2,
      resultsPerQuery: 5,
      usage: { queryCount: 2, resultCount: 8, wallTimeMs: 1_000 },
      queries: [],
    },
    createdAt: 110,
  };
}

describe("Deep Research prompts", () => {
  it("accepts only a complete structured v2 plan", () => {
    const parsed = parseResearchPlan(
      `\`\`\`json\n${JSON.stringify(planDraft)}\n\`\`\``,
      "Fallback goal",
    );
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) throw new Error("Expected a valid plan.");
    expect(parsed.data.strategy.maxQueries).toBe(16);
    expect(parsed.data.steps.map((step) => step.id)).toEqual([
      "step-1",
      "step-2",
      "step-3",
    ]);

    const legacy = parseResearchPlan(
      JSON.stringify({
        title: "Legacy",
        summary: "Old shape",
        questions: ["One generic step"],
      }),
      "Fallback goal",
    );
    expect(legacy).toMatchObject({
      valid: false,
      error: { code: "RESEARCH_PLAN_INVALID" },
    });
    expect(parseResearchPlan("not json", "Fallback goal")).toMatchObject({
      valid: false,
      error: { code: "RESEARCH_PLAN_INVALID" },
    });
  });

  it("normalizes blank optional time ranges without spending repair rounds", () => {
    const blankRange = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        scope: {
          ...planDraft.scope,
          timeRange: { start: "", end: "  ", description: "\n" },
        },
      }),
    );
    expect(blankRange.valid).toBe(true);
    if (!blankRange.valid) throw new Error("Expected a valid plan.");
    expect(blankRange.data.scope.timeRange).toBeUndefined();

    const partialRange = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        scope: {
          ...planDraft.scope,
          timeRange: {
            start: " ",
            end: "2026-12-31",
            description: "Through the end of 2026",
          },
        },
      }),
    );
    expect(partialRange.valid).toBe(true);
    if (!partialRange.valid) throw new Error("Expected a valid plan.");
    expect(partialRange.data.scope.timeRange).toEqual({
      end: "2026-12-31",
      description: "Through the end of 2026",
    });

    const invalidRange = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        scope: {
          ...planDraft.scope,
          timeRange: { start: 2026, end: "" },
        },
      }),
    );
    expect(invalidRange.valid).toBe(false);
    if (invalidRange.valid) throw new Error("Expected an invalid plan.");
    expect(invalidRange.error.issues.join("\n")).toContain(
      "scope.timeRange.start",
    );

    const reversedRange = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        scope: {
          ...planDraft.scope,
          timeRange: { start: "2026-12-31", end: "2026-01-01" },
        },
      }),
    );
    expect(reversedRange.valid).toBe(false);
    if (reversedRange.valid) throw new Error("Expected an invalid plan.");
    expect(reversedRange.error.issues.join("\n")).toContain(
      "scope.timeRange.end",
    );
  });

  it("keeps budget violations and duplicate step IDs fatal while tolerating stray keys", () => {
    const invalid = {
      ...planDraft,
      strategy: { ...planDraft.strategy, maxQueries: 49 },
      scope: { ...planDraft.scope, surprise: true },
      steps: [
        planDraft.steps[0],
        { ...planDraft.steps[1], id: "step-1" },
        {
          ...planDraft.steps[2],
          sourcePriorities: [{ sourceType: "mcp", priority: "high" }],
        },
      ],
    };
    const parsed = parseResearchPlan(JSON.stringify(invalid));
    expect(parsed.valid).toBe(false);
    if (parsed.valid) throw new Error("Expected an invalid plan.");
    expect(parsed.error.issues.join("\n")).toContain("maxQueries");

    // A stray key is dropped rather than failing the whole plan.
    const tolerated = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        scope: { ...planDraft.scope, surprise: true },
      }),
    );
    expect(tolerated.valid).toBe(true);
    if (!tolerated.valid) throw new Error("Expected a valid plan.");
    expect(tolerated.data.scope).not.toHaveProperty("surprise");

    const semantic = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        steps: [
          planDraft.steps[0],
          { ...planDraft.steps[1], id: "step-1" },
          planDraft.steps[2],
        ],
      }),
    );
    expect(semantic.valid).toBe(false);
    if (semantic.valid) throw new Error("Expected semantic rejection.");
    expect(semantic.error.issues.join("\n")).toContain(
      "Step IDs must be unique",
    );
  });

  it("repairs host-owned plan properties instead of failing the plan", () => {
    const drifted = parseResearchPlan(
      JSON.stringify({
        ...planDraft,
        steps: [
          planDraft.steps[0],
          {
            ...planDraft.steps[1],
            queryTopics: [
              planDraft.steps[0].queryTopics[0].toUpperCase(),
              ...planDraft.steps[1].queryTopics,
            ],
          },
          {
            ...planDraft.steps[2],
            sourcePriorities: [{ sourceType: "mcp", priority: "high" }],
          },
        ],
      }),
    );
    expect(drifted.valid).toBe(true);
    if (!drifted.valid) throw new Error("Expected a valid plan.");

    const strategy = { ...planDraft.strategy, maxDepth: 3 };
    const normalized = normalizeResearchPlanDraft({
      plan: drifted.data,
      strategy,
      allowedSourceTypes: ["web"],
    });
    expect(normalized.strategy).toEqual(strategy);
    // The duplicated topic is dropped, but every step keeps at least one.
    expect(normalized.steps[1].queryTopics).toEqual(
      planDraft.steps[1].queryTopics,
    );
    expect(
      normalized.steps.flatMap((step) =>
        step.sourcePriorities.map((source) => source.sourceType),
      ),
    ).toEqual(["web", "web", "web"]);
    expect(normalized.scope.allowedSourceTypes).toEqual(["web"]);
  });

  it("pins the selected strategy and strict output contract in the plan prompt", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Compare systems",
      now: 100,
    });
    const prompt = buildResearchPlanPrompt({ task });
    expect(prompt).toContain('"maxQueries":16');
    expect(prompt).toContain('"initialBreadth":4');
    expect(prompt).toContain("3-8 non-overlapping steps");
    expect(prompt).not.toContain("request_user_input");
    expect(prompt).toContain("Do not ask the user questions in this call");
    expect(prompt).toContain("omit `scope.timeRange` entirely");
    expect(prompt).toContain("Never emit empty strings");
    expect(prompt).not.toContain('"start": "optional"');
  });

  it("extracts the last valid alias archive and maps host-owned IDs", () => {
    const aliases = {
      nodes: [
        {
          key: "N1",
          nodeId: "node-internal-1",
          stepId: "step-1",
          objective: "Document the systems",
        },
      ],
      sources: [
        {
          key: "S1",
          sourceId: "source-internal-1",
          evidenceIds: ["evidence-internal-1"],
          locator: "https://example.com/primary",
          sourceType: "web" as const,
          retrievedAt: 100,
        },
      ],
    };
    const packet = {
      packets: [
        {
          nodeKey: "N1",
          learnings: [
            {
              claim: "The documented limit is ten.",
              importance: "major",
              stance: "supports",
              finding:
                "The primary documentation states a {bounded} limit of ten.",
              sourceKeys: ["S1"],
            },
          ],
          // Omission is deliberately safe: the host defaults to unknown.
          sourceAssessments: [],
          followUps: [
            {
              question: "Has the limit changed?",
              rationale: "Verify freshness",
              priority: "high",
              scopeImpact: "within",
              requiredSourceTypes: ["web"],
            },
          ],
        },
      ],
    };
    const previous = JSON.stringify({ packets: [{ nodeKey: "N8" }] });
    const parsed = parseResearchWavePackets(
      `Preliminary object: ${previous}\n\n\`\`\`json\n${JSON.stringify(packet)}\n\`\`\`\nDone.`,
      {
        aliases,
        existingClaimSignatures: {
          "claim-existing": getResearchClaimSignature(
            "step-1",
            "The documented limit is ten.",
          ),
        },
        now: 200,
      },
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.data[0]).toMatchObject({
      nodeId: "node-internal-1",
      createdAt: 200,
      learnings: [
        {
          claimId: "claim-existing",
          stepId: "step-1",
          sourceIds: ["source-internal-1"],
          evidenceIds: ["evidence-internal-1"],
        },
      ],
      sourceAssessments: [
        { sourceId: "source-internal-1", authority: "unknown" },
      ],
    });
    expect(parsed.data[0].id).toMatch(/^learning-packet-/);
    expect(parsed.data[0].learnings[0].id).toMatch(/^learning-/);
    expect(parsed.data[0].followUps[0].id).toMatch(/^follow-up-/);

    const newer = structuredClone(packet);
    newer.packets[0].learnings[0].claim = "The newer object wins.";
    const chosen = parseResearchWavePackets(
      `${JSON.stringify(packet)}\n${JSON.stringify(newer)}`,
      { aliases },
    );
    expect(chosen.data[0].learnings[0].claimText).toBe(
      "The newer object wins.",
    );
  });

  it("isolates invalid and duplicate alias packets without losing valid packets", () => {
    const aliases = {
      nodes: [
        { key: "N1", nodeId: "node-1", stepId: "step-1", objective: "One" },
        { key: "N2", nodeId: "node-2", stepId: "step-2", objective: "Two" },
      ],
      sources: [
        {
          key: "S1",
          sourceId: "source-1",
          evidenceIds: ["evidence-1"],
          locator: "https://example.com/one",
          sourceType: "web" as const,
          retrievedAt: 1,
        },
      ],
    };
    const learning = {
      claim: "A bounded claim.",
      importance: "major",
      stance: "supports",
      finding: "A bounded finding.",
      sourceKeys: ["S1"],
    };
    const output = {
      packets: [
        {
          nodeKey: "N1",
          learnings: [learning],
          sourceAssessments: [],
          followUps: [],
        },
        {
          nodeKey: "N1",
          learnings: [{ ...learning, claim: "Do not overwrite the first." }],
          sourceAssessments: [],
          followUps: [],
        },
        {
          nodeKey: "N2",
          learnings: [{ ...learning, sourceKeys: ["S80"] }],
          sourceAssessments: [],
          followUps: [],
        },
        {
          nodeKey: "N8",
          learnings: [],
          sourceAssessments: [],
          followUps: [],
        },
      ],
    };
    const parsed = parseResearchWavePackets(JSON.stringify(output), {
      aliases,
    });
    expect(parsed).toMatchObject({
      valid: false,
      data: [{ nodeId: "node-1" }],
      missingNodeKeys: [],
      invalidNodeKeys: ["N2"],
      error: { code: "RESEARCH_WAVE_INVALID" },
    });
    expect(parsed.data[0].learnings[0].claimText).toBe("A bounded claim.");

    const repaired = parseResearchWavePackets(
      JSON.stringify({
        packets: [
          {
            nodeKey: "N2",
            learnings: [learning],
            sourceAssessments: [],
            followUps: [],
          },
        ],
      }),
      { aliases, requestedNodeKeys: ["N2"] },
    );
    expect(repaired).toMatchObject({
      valid: true,
      data: [{ nodeId: "node-2" }],
      missingNodeKeys: [],
    });
  });

  it("rejects truncated archives and creates host-owned degraded packets", () => {
    const aliases = {
      nodes: [
        { key: "N1", nodeId: "node-1", stepId: "step-1", objective: "One" },
      ],
      sources: [],
    };
    const truncated = parseResearchWavePackets(
      '{"packets":[{"nodeKey":"N1","learnings":[]',
      { aliases },
    );
    expect(truncated).toMatchObject({
      valid: false,
      data: [],
      missingNodeKeys: ["N1"],
    });
    const degraded = createDegradedResearchWavePackets({
      aliases,
      nodeKeys: ["N1"],
      now: 300,
    });
    expect(degraded).toMatchObject([
      {
        nodeId: "node-1",
        learnings: [],
        sourceAssessments: [],
        followUps: [],
        createdAt: 300,
      },
    ]);
  });

  it("merges a targeted repair without overwriting valid packets and degrades only the remainder", () => {
    const aliases = {
      nodes: [
        { key: "N1", nodeId: "node-1", stepId: "step-1", objective: "One" },
        { key: "N2", nodeId: "node-2", stepId: "step-2", objective: "Two" },
        {
          key: "N3",
          nodeId: "node-3",
          stepId: "step-3",
          objective: "Three",
        },
      ],
      sources: [],
    };
    const packet = (id: string, nodeId: string) => ({
      id,
      nodeId,
      learnings: [],
      sourceAssessments: [],
      followUps: [],
      createdAt: 1,
    });
    const finalized = finalizeResearchWavePackets({
      aliases,
      initialPackets: [packet("valid-1", "node-1")],
      repairedPackets: [
        packet("must-not-overwrite", "node-1"),
        packet("repaired-2", "node-2"),
      ],
      now: 500,
    });
    expect(finalized.packets.map((item) => item.id)).toEqual([
      "valid-1",
      "repaired-2",
      expect.stringMatching(/^learning-packet-/),
    ]);
    expect(finalized.repairedNodeIds).toEqual(["node-2"]);
    expect(finalized.degradedNodeIds).toEqual(["node-3"]);
    expect(finalized.packets[2]).toMatchObject({
      nodeId: "node-3",
      learnings: [],
      createdAt: 500,
    });
  });

  it("builds aliases and closed-book archive/repair prompts without internal IDs in output", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Compare systems",
      now: 100,
    });
    const plan = createPlan();
    const run = createResearchReportRun({
      id: "run-1",
      taskId: task.id,
      plan,
      now: 120,
    });
    const node = run.nodes[0];
    const evidence = {
      id: "evidence-internal-1",
      sourceId: "source-internal-1",
      sourceType: "web" as const,
      stepId: node.stepId,
      nodeId: node.id,
      locator: "https://example.com/source",
      retrievedAt: 130,
      contentHash: "sha256:one",
      claimIds: [],
    };
    const withEvidence = {
      ...run,
      nodes: run.nodes.map((item) =>
        item.id === node.id ? { ...item, evidenceIds: [evidence.id] } : item,
      ),
    };
    const aliases = createResearchWaveAliasContext({
      run: withEvidence,
      nodeIds: [node.id],
      evidence: [evidence],
      preferredEvidenceIds: [evidence.id],
    });
    expect(aliases).toMatchObject({
      nodes: [{ key: "N1", nodeId: node.id, stepId: node.stepId }],
      sources: [
        {
          key: "S1",
          sourceId: evidence.sourceId,
          evidenceIds: [evidence.id],
        },
      ],
    });
    const archivePrompt = buildResearchWaveArchivePrompt({
      task,
      plan,
      run: withEvidence,
      aliases,
    });
    expect(archivePrompt).toContain("closed-book pass");
    expect(archivePrompt).toContain('"nodeKey":"N1"');
    expect(archivePrompt).not.toContain('"nodeId":"research-node-id"');

    const prompt = buildResearchWaveRepairPrompt({
      invalidOutput: "The model returned prose instead of JSON.",
      issues: ["root: Expected one JSON object."],
      aliases,
      requestedNodeKeys: ["N1"],
    });

    expect(prompt).toContain("Do not use tools, add sources, or invent facts");
    expect(prompt).toContain('"key":"N1"');
    expect(prompt).toContain('"key":"S1"');
    expect(prompt).toContain("Do not repeat or revise packets");
    expect(prompt).toContain("root: Expected one JSON object.");
    expect(RESEARCH_WAVE_RESPONSE_FORMAT).toMatchObject({
      name: "deep_research_wave_archive",
      strict: true,
      schema: { type: "object" },
    });
  });

  it("separates adaptive execution from tool-free synthesis", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Compare systems",
      now: 100,
    });
    const plan = createPlan();
    const run = createResearchReportRun({
      id: "run-1",
      taskId: task.id,
      plan,
      now: 120,
    });
    const execution = buildResearchExecutionPrompt({ task, plan });
    const synthesis = buildResearchSynthesisPrompt({
      task,
      plan,
      run,
      evidence: [],
    });
    const wave = buildResearchWavePrompt({
      task: {
        ...task,
        sourceSnapshot: {
          model: "provider:model",
          approvalMode: "balanced",
          searchEnabled: true,
          toolIds: ["web_search", "plugin_read"],
          pluginIds: ["plugin-1"],
          skillIds: [],
          knowledgeCollectionIds: [],
          attachmentIds: [],
          workspaceFileIds: [],
          memoryScopes: [],
          memoryScopeIds: {},
          capturedAt: 120,
        },
      },
      plan,
      run: {
        ...run,
        executedQueries: ["existing primary-source query"],
        learningPackets: [
          {
            id: "packet-1",
            nodeId: run.nodes[0].id,
            learnings: [
              {
                id: "learning-1",
                claimId: "C1",
                claimText: "One source is incomplete.",
                stepId: plan.steps[0].id,
                importance: "major",
                stance: "supports",
                statement: "The existing source leaves one material gap.",
                sourceIds: ["source-1"],
                evidenceIds: ["evidence-1"],
              },
            ],
            sourceAssessments: [],
            followUps: [],
            createdAt: 121,
          },
        ],
        scopeExpansionEvents: [
          {
            id: "scope-expansion-1",
            at: 122,
            sourceSnapshotCapturedAt: 120,
            packetIds: ["packet-1"],
            addedSourceTypes: ["mcp"],
            scheduledFollowUpIds: ["follow-up-1"],
            unavailableSourceFollowUpIds: [],
            duplicateFollowUpIds: [],
            breadthLimitedFollowUpIds: [],
            depthLimitedFollowUpIds: [],
          },
        ],
      },
      nodeIds: [run.nodes[0].id],
      evidence: [],
    });

    expect(execution).toContain("adaptive waves");
    expect(execution).toContain("step-id");
    expect(execution).toContain("standalone Markdown image syntax");
    expect(execution).toContain("Never use `>` to wrap or represent an image");
    expect(execution).toContain("raw `<img>` HTML tag");
    expect(synthesis).toContain("Tools and network access are disabled");
    expect(synthesis).toContain("cited findings ledger");
    expect(synthesis).toContain("standalone Markdown image syntax");
    expect(synthesis).toContain("Never use `>` to wrap or represent an image");
    expect(synthesis).toContain("raw `<img>` HTML tag");
    expect(synthesis).toContain("comparison contract");
    expect(synthesis).toContain("explicit criteria");
    expect(wave).toContain("existing primary-source query");
    expect(wave).toContain("one material gap");
    expect(wave).toContain("Host-authorized source types");
    expect(wave).toContain('"mcp"');
    expect(wave).toContain("without rewriting prior work");
  });

  it("provides a distinct synthesis contract for every supported deliverable", () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Answer with evidence",
      now: 100,
    });
    const expected = {
      research_report: "neutral research report",
      comparison: "explicit criteria",
      decision_memo: "Lead with the decision",
      exact_answer: "exact answer first",
    } as const;
    for (const [kind, phrase] of Object.entries(expected)) {
      const plan = {
        ...createPlan(),
        deliverable: {
          ...createPlan().deliverable,
          kind: kind as keyof typeof expected,
        },
      };
      const run = createResearchReportRun({
        taskId: task.id,
        plan,
        now: 120,
      });
      expect(
        buildResearchSynthesisPrompt({ task, plan, run, evidence: [] }),
      ).toContain(phrase);
    }
  });

  it("treats explicit no-gap language as complete and preserves real gaps", () => {
    const complete = summarizeResearchReport(`# Report

## Executive summary
Supported conclusion.

## Key findings
- [C1] Finding [Source 1]

## Evidence gaps
None.
`);
    expect(complete.gaps).toEqual([]);
    expect(complete.keyFindings).toEqual(["[C1] Finding [Source 1]"]);

    const partial = summarizeResearchReport(`# Report

## Evidence gaps
- A primary source was unavailable.
`);
    expect(partial.gaps).toEqual(["A primary source was unavailable."]);
  });

  it("counts only explicitly answered approved coverage entries", () => {
    expect(
      parseResearchStepCoverage(
        `# Report

## Research plan coverage
- step-1: answered - Supported by two sources.
- step-2: partial - One source is unavailable.
- forged: answered - Not approved.
`,
        ["step-1", "step-2"],
      ),
    ).toEqual(["step-1"]);

    expect(
      parseResearchQuestionCoverage(
        `# Legacy report

## Research question coverage
- Q1: answered - Supported by two sources.
- Q2: partial - One source is unavailable.
- Q9: answered - Out of range.
`,
        2,
      ),
    ).toEqual([0]);
  });
});

describe("Research wave source contract", () => {
  const aliases: ResearchWaveAliasContext = {
    nodes: [
      { key: "N1", nodeId: "node-1", stepId: "step-1", objective: "Verify" },
    ],
    sources: [
      {
        key: "S1",
        sourceId: "source-1",
        aliasSourceIds: ["source-mirror-1"],
        evidenceIds: ["evidence-1"],
        locator: "https://example.test/one",
        sourceType: "web",
        retrievedAt: 1,
      },
      {
        key: "S2",
        sourceId: "source-2",
        aliasSourceIds: ["source-mirror-2"],
        evidenceIds: ["evidence-2"],
        locator: "https://example.test/two",
        sourceType: "web",
        retrievedAt: 1,
      },
    ],
  };
  const packet = (sourceKeys: string[]) => ({
    nodeKey: "N1",
    learnings: [
      {
        claim: "One claim",
        importance: "major",
        stance: "supports",
        finding: "One finding",
        sourceKeys,
      },
    ],
    sourceAssessments: [] as {
      sourceKey: string;
      authority: string;
      rationale: string;
      mirrorOfSourceKey?: string;
    }[],
    followUps: [],
  });

  it("maps only exact committed identities across every source-reference field", () => {
    const output = packet([
      " S1 ",
      "source-1",
      "evidence-1",
      "source-mirror-1",
    ]);
    output.sourceAssessments = [
      {
        sourceKey: "evidence-1",
        authority: "secondary",
        rationale: "Known mirror",
        mirrorOfSourceKey: "source-mirror-2",
      },
    ];
    const parsed = parseResearchWavePackets(
      JSON.stringify({ packets: [output] }),
      { aliases },
    );
    expect(parsed).toMatchObject({
      valid: true,
      data: [
        {
          learnings: [{ sourceIds: ["source-1"], evidenceIds: ["evidence-1"] }],
          sourceAssessments: [
            { sourceId: "source-1", mirrorOfSourceId: "source-2" },
          ],
        },
      ],
    });
  });

  it.each([
    "source-uncommitted",
    "https://example.test/one",
    "S80",
    "S81",
    "S01",
    "s1",
    "[S1]",
  ])("rejects unregistered or guessed reference %s", (sourceKey) => {
    const parsed = parseResearchWavePackets(
      JSON.stringify({ packets: [packet([sourceKey])] }),
      { aliases },
    );
    expect(parsed).toMatchObject({
      valid: false,
      data: [],
      invalidNodeKeys: ["N1"],
    });
  });

  it("rejects ambiguous identity mappings instead of choosing a source", () => {
    const ambiguous = {
      ...aliases,
      sources: aliases.sources.map((source) =>
        source.key === "S2"
          ? { ...source, aliasSourceIds: ["source-1"] }
          : source,
      ),
    };
    const parsed = parseResearchWavePackets(
      JSON.stringify({ packets: [packet(["source-1"])] }),
      { aliases: ambiguous },
    );
    expect(parsed.valid).toBe(false);
    if (parsed.valid) throw new Error("Expected ambiguous source rejection.");
    expect(parsed.error.issues.join("\n")).toContain(
      "matches multiple host sources",
    );
  });

  it("keeps duplicate assessments and mirror-cycle checks after identity normalization", () => {
    const output = packet(["S1"]);
    output.sourceAssessments = [
      { sourceKey: "source-1", authority: "unknown", rationale: "Unknown" },
      { sourceKey: "evidence-1", authority: "unknown", rationale: "Duplicate" },
    ];
    let parsed = parseResearchWavePackets(
      JSON.stringify({ packets: [output] }),
      { aliases },
    );
    expect(parsed.valid).toBe(false);
    if (!parsed.valid)
      expect(parsed.error.issues.join("\n")).toContain(
        "Duplicate source assessment",
      );
    output.sourceAssessments = [
      {
        sourceKey: "source-1",
        authority: "unknown",
        rationale: "Mirror",
        mirrorOfSourceKey: "evidence-2",
      },
      {
        sourceKey: "source-2",
        authority: "unknown",
        rationale: "Mirror",
        mirrorOfSourceKey: "evidence-1",
      },
    ];
    parsed = parseResearchWavePackets(JSON.stringify({ packets: [output] }), {
      aliases,
    });
    expect(parsed.valid).toBe(false);
    if (!parsed.valid)
      expect(parsed.error.issues.join("\n")).toContain("contains a cycle");
  });

  it("constrains native output to this wave's keys, including a valid zero-source schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(
      buildResearchWaveResponseFormat(aliases).schema,
    );
    expect(validate({ packets: [packet(["S1"])] })).toBe(true);
    expect(validate({ packets: [packet(["S80"])] })).toBe(false);
    const emptyFormat = buildResearchWaveResponseFormat({
      ...aliases,
      sources: [],
    });
    expect(JSON.stringify(emptyFormat)).not.toContain('"enum":[]');
    const validateEmpty = ajv.compile(emptyFormat.schema);
    expect(validateEmpty({ packets: [{ ...packet([]), learnings: [] }] })).toBe(
      true,
    );
    expect(validateEmpty({ packets: [packet(["S1"])] })).toBe(false);
  });

  it("freezes the selected index, retains 80 sources, and excludes the overflow from compatibility mapping", () => {
    const run = createResearchReportRun({ taskId: "task", plan: createPlan() });
    const node = run.nodes[0];
    const evidence = Array.from({ length: 81 }, (_, index) => ({
      id: `evidence-${index}`,
      sourceId: `source-${index}`,
      aliasSourceIds: [`mirror-${index}`],
      stepId: node.stepId,
      nodeId: node.id,
      locator: `https://example.test/${index}`,
      sourceType: "web" as const,
      retrievedAt: 1,
      contentHash: `hash-${index}`,
      claimIds: [],
    }));
    const context = createResearchWaveAliasContext({
      run,
      nodeIds: [node.id],
      evidence,
    });
    expect(context.sources).toHaveLength(80);
    expect(context.sources.at(-1)?.key).toBe("S80");
    evidence[0].aliasSourceIds.push("late-source");
    expect(context.sources[0].aliasSourceIds).toEqual(["mirror-0"]);
    expect(Object.isFrozen(context.sources)).toBe(true);
    expect(Object.isFrozen(context.sources[0].evidenceIds)).toBe(true);
    const parsed = parseResearchWavePackets(
      JSON.stringify({ packets: [packet(["source-80"])] }),
      { aliases: context },
    );
    expect(parsed).toMatchObject({ valid: false, data: [] });
  });
});
