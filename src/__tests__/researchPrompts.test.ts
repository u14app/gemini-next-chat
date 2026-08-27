import { describe, expect, it } from "vitest";

import {
  buildResearchExecutionPrompt,
  buildResearchPlanPrompt,
  buildResearchScopeExpansionAdjustment,
  buildResearchSynthesisPrompt,
  buildResearchWavePrompt,
  buildResearchWaveRepairPrompt,
  createResearchReportRun,
  createResearchTask,
  getResearchClaimSignature,
  normalizeResearchPlanDraft,
  parseResearchPlan,
  parseResearchQuestionCoverage,
  parseResearchStepCoverage,
  parseResearchWavePackets,
  summarizeResearchReport,
  type ResearchPlanVersion,
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
  });

  it("accepts wave packets only when node and source references are committed", () => {
    const packet = {
      packets: [
        {
          nodeId: "node-1",
          learnings: [
            {
              claimId: "C1",
              claimText: "The documented limit is ten.",
              stepId: "step-1",
              importance: "major",
              stance: "supports",
              statement: "The primary documentation states a limit of ten.",
              sourceIds: ["source-1"],
              evidenceIds: ["evidence-1"],
            },
          ],
          sourceAssessments: [
            {
              sourceId: "source-1",
              authority: "primary",
              publisherId: "publisher-1",
              rationale: "Official publisher documentation",
            },
          ],
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
    const parsed = parseResearchWavePackets(JSON.stringify(packet), {
      allowedNodeIds: ["node-1"],
      allowedSourceIds: ["source-1"],
      allowedEvidenceIds: ["evidence-1"],
      allowedStepIds: ["step-1"],
      now: 200,
    });
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) throw new Error("Expected a valid packet.");
    expect(parsed.data[0]).toMatchObject({
      nodeId: "node-1",
      createdAt: 200,
      learnings: [{ claimId: "C1", sourceIds: ["source-1"] }],
      sourceAssessments: [{ sourceId: "source-1", authority: "primary" }],
    });

    const aliased = JSON.parse(JSON.stringify(packet));
    aliased.packets[0].learnings[0].sourceIds = ["source-alias"];
    aliased.packets[0].sourceAssessments[0].sourceId = "source-alias";
    const parsedAlias = parseResearchWavePackets(JSON.stringify(aliased), {
      allowedNodeIds: ["node-1"],
      allowedSourceIds: ["source-1"],
      allowedEvidenceIds: ["evidence-1"],
      allowedStepIds: ["step-1"],
      canonicalSourceIdByAlias: { "source-alias": "source-1" },
    });
    expect(parsedAlias.valid).toBe(true);
    if (!parsedAlias.valid) throw new Error("Expected alias normalization.");
    expect(parsedAlias.data[0].learnings[0].sourceIds).toEqual(["source-1"]);
    expect(parsedAlias.data[0].sourceAssessments[0].sourceId).toBe("source-1");

    const forged = JSON.parse(JSON.stringify(packet));
    forged.packets[0].learnings[0].sourceIds = ["source-forged"];
    const rejected = parseResearchWavePackets(JSON.stringify(forged), {
      allowedNodeIds: ["node-1"],
      allowedSourceIds: ["source-1"],
      allowedStepIds: ["step-1"],
    });
    expect(rejected).toMatchObject({
      valid: false,
      error: { code: "RESEARCH_WAVE_INVALID" },
    });

    const forgedMirror = JSON.parse(JSON.stringify(packet));
    forgedMirror.packets[0].sourceAssessments[0].mirrorOfSourceId =
      "source-forged";
    const rejectedMirror = parseResearchWavePackets(
      JSON.stringify(forgedMirror),
      {
        allowedNodeIds: ["node-1"],
        allowedSourceIds: ["source-1"],
        allowedStepIds: ["step-1"],
      },
    );
    expect(rejectedMirror.valid).toBe(false);

    const mirrorCycle = JSON.parse(JSON.stringify(packet));
    mirrorCycle.packets[0].sourceAssessments = [
      {
        sourceId: "source-1",
        authority: "secondary",
        mirrorOfSourceId: "source-2",
        rationale: "Mirrors source two.",
      },
      {
        sourceId: "source-2",
        authority: "secondary",
        mirrorOfSourceId: "source-1",
        rationale: "Mirrors source one.",
      },
    ];
    const rejectedMirrorCycle = parseResearchWavePackets(
      JSON.stringify(mirrorCycle),
      {
        allowedNodeIds: ["node-1"],
        allowedSourceIds: ["source-1", "source-2"],
        allowedEvidenceIds: ["evidence-1"],
        allowedStepIds: ["step-1"],
      },
    );
    expect(rejectedMirrorCycle.valid).toBe(false);
    if (rejectedMirrorCycle.valid) {
      throw new Error("Expected mirror-cycle rejection.");
    }
    expect(rejectedMirrorCycle.error.issues.join("\n")).toContain(
      "Mirror relationship contains a cycle",
    );

    const wrongStep = JSON.parse(JSON.stringify(packet));
    wrongStep.packets[0].learnings[0].stepId = "step-2";
    const rejectedStepBinding = parseResearchWavePackets(
      JSON.stringify(wrongStep),
      {
        allowedNodeIds: ["node-1"],
        allowedSourceIds: ["source-1"],
        allowedEvidenceIds: ["evidence-1"],
        allowedStepIds: ["step-1", "step-2"],
        expectedStepIdByNode: { "node-1": "step-1" },
      },
    );
    expect(rejectedStepBinding.valid).toBe(false);
    if (rejectedStepBinding.valid) {
      throw new Error("Expected node-to-step binding rejection.");
    }
    expect(rejectedStepBinding.error.issues.join("\n")).toContain(
      "Expected step-1 for node node-1",
    );

    const missingNode = parseResearchWavePackets(JSON.stringify(packet), {
      allowedNodeIds: ["node-1", "node-2"],
      allowedSourceIds: ["source-1"],
      allowedStepIds: ["step-1"],
    });
    expect(missingNode.valid).toBe(false);
    if (missingNode.valid) throw new Error("Expected missing-node rejection.");
    expect(missingNode.error.issues).toContain(
      "packets: Missing packet for node node-2.",
    );

    const claimCollision = JSON.parse(JSON.stringify(packet));
    claimCollision.packets.push({
      ...JSON.parse(JSON.stringify(packet.packets[0])),
      nodeId: "node-2",
      learnings: [
        {
          ...packet.packets[0].learnings[0],
          claimText: "A different claim reused the same ID.",
        },
      ],
    });
    const rejectedCollision = parseResearchWavePackets(
      JSON.stringify(claimCollision),
      {
        allowedNodeIds: ["node-1", "node-2"],
        allowedSourceIds: ["source-1"],
        allowedEvidenceIds: ["evidence-1"],
        allowedStepIds: ["step-1"],
      },
    );
    expect(rejectedCollision.valid).toBe(false);
    if (rejectedCollision.valid) {
      throw new Error("Expected a claim ID collision rejection.");
    }
    expect(rejectedCollision.error.issues.join("\n")).toContain(
      "reused for a different claim",
    );

    const rejectedPriorCollision = parseResearchWavePackets(
      JSON.stringify(packet),
      {
        allowedNodeIds: ["node-1"],
        allowedSourceIds: ["source-1"],
        allowedEvidenceIds: ["evidence-1"],
        allowedStepIds: ["step-1"],
        existingClaimSignatures: {
          C1: getResearchClaimSignature(
            "step-1",
            "A different claim from an earlier wave.",
          ),
        },
      },
    );
    expect(rejectedPriorCollision.valid).toBe(false);
  });

  it("builds a closed-book wave repair with exact committed ID bounds", () => {
    const prompt = buildResearchWaveRepairPrompt({
      invalidOutput: "The model returned prose instead of JSON.",
      issues: ["root: Expected one JSON object."],
      allowedNodeIds: ["node-1"],
      allowedSourceIds: ["source-1"],
      allowedEvidenceIds: ["evidence-1"],
      allowedStepIds: ["step-1"],
      expectedStepIdByNode: { "node-1": "step-1" },
    });

    expect(prompt).toContain("Do not use tools, add sources, or invent facts");
    expect(prompt).toContain('Allowed node IDs:\n["node-1"]');
    expect(prompt).toContain('Allowed source IDs:\n["source-1"]');
    expect(prompt).toContain('Allowed evidence IDs:\n["evidence-1"]');
    expect(prompt).toContain('Expected step by node:\n{"node-1":"step-1"}');
    expect(prompt).toContain("root: Expected one JSON object.");
    expect(
      parseResearchWavePackets("not json", {
        allowedNodeIds: ["node-1"],
        allowedSourceIds: ["source-1"],
      }).valid,
    ).toBe(false);
  });

  it("turns out-of-scope follow-ups into a bounded plan-regeneration request", () => {
    expect(
      buildResearchScopeExpansionAdjustment([
        {
          id: "packet-1",
          nodeId: "node-1",
          learnings: [],
          sourceAssessments: [],
          followUps: [
            {
              id: "follow-up-1",
              question: "Inspect the private benchmark.",
              rationale: "Close a material evidence gap.",
              priority: "high",
              scopeImpact: "source_expansion",
              requiredSourceTypes: ["mcp"],
            },
          ],
          createdAt: 1,
        },
      ]),
    ).toContain("Do not access any newly proposed source before approval");
    expect(
      buildResearchScopeExpansionAdjustment([
        {
          id: "packet-2",
          nodeId: "node-2",
          learnings: [],
          sourceAssessments: [],
          followUps: [
            {
              id: "follow-up-2",
              question: "Stay within scope.",
              rationale: "Continue the approved branch.",
              priority: "medium",
              scopeImpact: "within",
              requiredSourceTypes: ["web"],
            },
          ],
          createdAt: 1,
        },
      ]),
    ).toBeUndefined();
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
      task,
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
      },
      nodeIds: [run.nodes[0].id],
      evidence: [],
    });

    expect(execution).toContain("adaptive waves");
    expect(execution).toContain("step-id");
    expect(synthesis).toContain("Tools and network access are disabled");
    expect(synthesis).toContain("verified claim ledger");
    expect(synthesis).toContain("comparison contract");
    expect(synthesis).toContain("explicit criteria");
    expect(wave).toContain("existing primary-source query");
    expect(wave).toContain("one material gap");
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
