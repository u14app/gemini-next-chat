import zh from "@/i18n/locales/zh/Research.json";
import ja from "@/i18n/locales/ja/Research.json";
import { describe, expect, it } from "vitest";

import {
  auditResearchReport,
  buildDeterministicSalvageReport,
  createResearchReportRun,
  createResearchTask,
  getCitableResearchClaims,
  getDegradedResearchStepIds,
  normalizeResearchReportMarkdown,
  prepareResearchReportForPublication,
  type ClaimRecord,
  type ResearchEvidence,
  type ResearchPlanVersion,
} from "@/lib/research";

function createPlan(): ResearchPlanVersion {
  return {
    id: "plan-1",
    version: 1,
    title: "Auditable decision",
    summary: "Verify one material decision.",
    objective: "Reach a cited decision.",
    scope: {
      audience: "Engineering leads",
      includes: ["Decision evidence"],
      excludes: [],
      allowedSourceTypes: ["web"],
    },
    assumptions: [],
    deliverable: {
      kind: "decision_memo",
      description: "A decision memo",
      requiredSections: ["Decision"],
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
      startedAt: 1,
      completedAt: 2,
      timeoutMs: 30_000,
      queryLimit: 2,
      resultsPerQuery: 5,
      usage: { queryCount: 1, resultCount: 5, wallTimeMs: 1 },
      queries: [],
    },
    steps: [
      {
        id: "step-1",
        title: "Verify the decision",
        objective: "Verify the material premise.",
        questions: ["Is the premise supported?"],
        queryTopics: ["official premise documentation"],
        sourcePriorities: [{ sourceType: "web", priority: "high" }],
        evidenceCriteria: ["One direct primary source"],
        priority: "high",
      },
    ],
    completionCriteria: ["The material premise is verified."],
    createdAt: 3,
  };
}

function createFixture(freshness: ResearchEvidence["freshness"] = "current") {
  const plan = createPlan();
  const evidence: ResearchEvidence = {
    id: "evidence-1",
    sourceId: "source-known",
    sourceType: "web",
    stepId: "step-1",
    nodeId: "node-1",
    title: "Official source",
    locator: "https://example.com/source?b=2&a=1",
    retrievedAt: 1,
    contentHash: "sha256:known",
    publisherId: "example.com",
    authority: "primary",
    claimIds: ["C1"],
    stance: "supports",
    freshness,
    availability: "available",
  };
  const run = createResearchReportRun({
    id: "run-1",
    taskId: "task-1",
    plan,
    now: 4,
  });
  const claim: ClaimRecord = {
    id: "C1",
    text: "The premise is supported.",
    importance: "major",
    stepId: "step-1",
    nodeIds: [run.nodes[0].id],
    supportingEvidenceIds: [evidence.id],
    contradictingEvidenceIds: [],
    verificationStatus: "verified",
    independentPublisherCount: 1,
    createdAt: 5,
    updatedAt: 5,
  };
  return { plan, evidence, run: { ...run, claims: [claim] } };
}

const completeReport = `# Auditable decision

## Executive summary

The decision is supported.

## Key findings

- [C1] The premise is supported. [source-known](https://example.com/source?a=1&b=2)

## Decision

Proceed within the stated scope.

## Research plan coverage

- step-1: answered - verified claim available

## Evidence gaps

No material evidence gaps.

## Sources

- [source-known](https://example.com/source?a=1&b=2)
`;

describe("Deep Research report audit", () => {
  it("accepts a complete report with canonical committed citations", () => {
    const { plan, run, evidence } = createFixture();
    expect(
      auditResearchReport({
        markdown: completeReport,
        plan,
        run,
        evidence: [evidence],
      }),
    ).toEqual({
      blocking: [],
      advisory: [],
      unknownCitationCount: 0,
      unsupportedFindingCount: 0,
      missingSectionCount: 0,
    });
  });

  it("rejects missing contract sections and fabricated citations", () => {
    const { plan, run, evidence } = createFixture();
    const audit = auditResearchReport({
      markdown:
        "## Key findings\n\n- [C999] Unsupported. [source-fake](https://fake.example/source)",
      plan,
      run,
      evidence: [evidence],
    });
    expect(audit.missingSectionCount).toBeGreaterThan(0);
    expect(audit.unknownCitationCount).toBe(2);
    expect(audit.unsupportedFindingCount).toBe(1);
  });

  it("does not let stale evidence satisfy a published key finding", () => {
    const { plan, run, evidence } = createFixture("stale");
    expect(
      auditResearchReport({
        markdown: completeReport,
        plan,
        run,
        evidence: [evidence],
      }).unsupportedFindingCount,
    ).toBe(1);
  });

  it("requires only uncovered degraded steps under Evidence gaps", () => {
    const { plan, run, evidence } = createFixture();
    const degradedRun = {
      ...run,
      claims: [],
      waves: [
        {
          id: "wave-degraded",
          index: 1,
          depth: 1,
          breadth: 1,
          nodeIds: [run.nodes[0].id],
          status: "completed" as const,
          packetStatus: "degraded" as const,
          degradedNodeIds: [run.nodes[0].id],
          newEvidenceCount: 1,
          newVerifiedClaimCount: 0,
        },
      ],
    };

    expect(getDegradedResearchStepIds(degradedRun, [evidence])).toEqual([
      "step-1",
    ]);
    expect(
      auditResearchReport({
        markdown: completeReport,
        plan,
        run: degradedRun,
        evidence: [evidence],
      }).advisory,
    ).toContain(
      "Evidence gaps must identify these degraded research steps: step-1.",
    );

    const reportWithGap = completeReport.replace(
      "No material evidence gaps.",
      "- step-1: the learning packet was degraded.",
    );
    expect(
      auditResearchReport({
        markdown: reportWithGap,
        plan,
        run: degradedRun,
        evidence: [evidence],
      }).advisory,
    ).not.toContain(
      "Evidence gaps must identify these degraded research steps: step-1.",
    );
  });

  it("does not require a degraded step already covered by a verified claim", () => {
    const { plan, run, evidence } = createFixture();
    const degradedRun = {
      ...run,
      waves: [
        {
          id: "wave-degraded-covered",
          index: 1,
          depth: 1,
          breadth: 1,
          nodeIds: [run.nodes[0].id],
          status: "completed" as const,
          packetStatus: "degraded" as const,
          degradedNodeIds: [run.nodes[0].id],
          newEvidenceCount: 1,
          newVerifiedClaimCount: 1,
        },
      ],
    };

    expect(getDegradedResearchStepIds(degradedRun, [evidence])).toEqual([]);
    expect(
      auditResearchReport({
        markdown: completeReport,
        plan,
        run: degradedRun,
        evidence: [evidence],
      }),
    ).toMatchObject({ blocking: [], advisory: [] });
  });

  it("accepts explicit required evidence-gap step IDs", () => {
    const { plan, run, evidence } = createFixture();
    const audit = auditResearchReport({
      markdown: completeReport,
      plan,
      run,
      evidence: [evidence],
      requiredEvidenceGapStepIds: ["step-1"],
    });

    expect(audit.advisory).toContain(
      "Evidence gaps must identify these degraded research steps: step-1.",
    );
    expect(
      auditResearchReport({
        markdown: completeReport.replace(
          "No material evidence gaps.",
          "- step-10: a different step was degraded.",
        ),
        plan,
        run,
        evidence: [evidence],
        requiredEvidenceGapStepIds: ["step-1"],
      }).advisory,
    ).toContain(
      "Evidence gaps must identify these degraded research steps: step-1.",
    );
  });

  it.each([zh, ja])(
    "uses localized sections and fallback prose without losing audit metadata",
    (messages) => {
      const { plan, run, evidence } = createFixture();
      const task = createResearchTask({
        id: "task-1",
        sessionId: "session-1",
        goal: "Research",
      });
      const markdown = buildDeterministicSalvageReport({
        task,
        plan,
        run,
        evidence: [evidence],
        reason: "A limitation.",
        sectionLabels: messages.report.sections,
        text: messages.report.fallbackText,
      });
      expect(markdown).toContain(
        `## ${messages.report.sections.executiveSummary}`,
      );
      expect(markdown).toContain(messages.report.fallbackText.partialSummary);
      expect(markdown).not.toContain("[object Object]");
      expect(markdown).not.toContain("## Executive summary");
      expect(
        auditResearchReport({ markdown, plan, run, evidence: [evidence] })
          .missingSectionCount,
      ).toBe(0);
    },
  );

  it("audits rendered references and preserves their Markdown syntax on publication", () => {
    const { plan, run, evidence } = createFixture();
    const markdown = `# Report

## Executive summary
Summary. [Back to report](#report) [Contact](mailto:editor@example.com).

## Key findings
- [C1] The premise is supported. [foo][source-known].

## Decision
Decide.

## Research plan coverage
- step-1: answered - complete

## Evidence gaps
None.

## Sources
[source-known]: ${evidence.locator}
[unused]: https://not-cited.example

\`\`\`text
https://code-example.example
\`\`\``;
    const audit = auditResearchReport({
      markdown,
      plan,
      run,
      evidence: [evidence],
    });
    expect(audit.unknownCitationCount).toBe(0);
    expect(audit.unsupportedFindingCount).toBe(0);
    const published = prepareResearchReportForPublication({
      markdown,
      plan,
      run,
      evidence: [evidence],
    });
    expect(published).toContain("[foo][source-known]");
    expect(published).toContain(`[source-known]: ${evidence.locator}`);
    expect(published).toContain("https://code-example.example");
  });

  it("localizes optional standard chapters in the deterministic fallback", () => {
    const { plan, run, evidence } = createFixture();
    const markdown = buildDeterministicSalvageReport({
      task: createResearchTask({ sessionId: "session-1", goal: "研究" }),
      plan: {
        ...plan,
        deliverable: {
          ...plan.deliverable,
          requiredSections: ["Knowledge supplement"],
        },
      },
      run,
      evidence: [evidence],
      reason: "限制",
      sectionLabels: zh.report.sections,
      text: zh.report.fallbackText,
    });
    expect(markdown).toContain(`## ${zh.report.sections.knowledgeSupplement}`);
    expect(markdown).not.toContain("## Knowledge supplement");
  });

  it("preserves code and reference definitions during publication", () => {
    const { plan, run, evidence } = createFixture();
    const code =
      "```markdown\n## Sources\n[C1] [source-known]\n\n\nconst x = 1;\n```";
    const published = prepareResearchReportForPublication({
      markdown: `# Report\n\n## Key findings\n[C1] Finding [source-known].\n\n${code}\n\n## Sources\n[ref]: https://example.com/source`,
      plan,
      run,
      evidence: [evidence],
    });
    expect(published).toContain(code);
    expect(published).toContain("[ref]: https://example.com/source");
  });

  it("builds an auditable partial report when synthesis is interrupted", () => {
    const { plan, run, evidence } = createFixture();
    const task = createResearchTask({
      id: "task-1",
      sessionId: "session-1",
      goal: "Reach a cited decision.",
      now: 1,
    });
    const markdown = buildDeterministicSalvageReport({
      task,
      plan,
      run,
      evidence: [evidence],
      reason: "The synthesis dependency became unavailable.",
    });
    expect(markdown).toContain(
      "This partial report includes findings supported by the available cited evidence.",
    );
    expect(markdown).toContain("## Decision");
    expect(markdown).toContain("- step-1: answered");
    expect(
      auditResearchReport({ markdown, plan, run, evidence: [evidence] }),
    ).toMatchObject({ blocking: [], advisory: [] });
  });

  it("includes degraded steps in deterministic salvage evidence gaps", () => {
    const { plan, run, evidence } = createFixture();
    const task = createResearchTask({
      id: "task-1",
      sessionId: "session-1",
      goal: "Reach a cited decision.",
      now: 1,
    });
    const degradedRun = {
      ...run,
      claims: run.claims.map((claim) => ({
        ...claim,
        importance: "background" as const,
      })),
      waves: [
        {
          id: "wave-degraded",
          index: 1,
          depth: 1,
          breadth: 1,
          nodeIds: [run.nodes[0].id],
          status: "completed" as const,
          packetStatus: "degraded" as const,
          degradedNodeIds: [run.nodes[0].id],
          newEvidenceCount: 1,
          newVerifiedClaimCount: 0,
        },
      ],
    };
    const markdown = buildDeterministicSalvageReport({
      task,
      plan,
      run: degradedRun,
      evidence: [evidence],
      reason: "The synthesis dependency became unavailable.",
    });

    expect(markdown).toContain(
      "- step-1: the research round did not produce a validated learning packet.",
    );
    expect(
      auditResearchReport({
        markdown,
        plan,
        run: degradedRun,
        evidence: [evidence],
      }),
    ).toMatchObject({ blocking: [], advisory: [] });
  });

  it("normalizes wrapped reports, localized headings, and orphan fences", () => {
    const normalized = normalizeResearchReportMarkdown(`Model preamble

\`\`\`markdown
# 原始报告标题

## 执行摘要
Summary.

## 关键发现
- Finding.

## 研究计划覆盖情况
- step-1: answered - covered

## 证据缺口
No material evidence gaps.

## 来源
- Source.
\`\`\``);

    expect(normalized).toMatch(/^# 原始报告标题/);
    expect(normalized).toContain("## 执行摘要");
    expect(normalized).toContain("## 关键发现");
    expect(normalized).toContain("## 研究计划覆盖情况");
    expect(normalized).toContain("## 证据缺口");
    expect(normalized).toContain("## 来源");
    expect(normalized).not.toMatch(/\`\`\`\s*$/);

    expect(normalizeResearchReportMarkdown("# Report\n\nContent.\n\n```")).toBe(
      "# Report\n\nContent.",
    );
    expect(
      normalizeResearchReportMarkdown(
        "~~~markdown\n# Report\n\n## Sources\n\n- Source.\n~~~",
      ),
    ).toBe("# Report\n\n## Sources\n\n- Source.");
    expect(
      normalizeResearchReportMarkdown("# Report\n\n```\nconst value = 1;\n```"),
    ).toBe("# Report\n\n```\nconst value = 1;\n```");
  });

  it("rebuilds a publishable report from citable committed evidence", () => {
    const { plan, run, evidence } = createFixture();
    const task = createResearchTask({
      id: "task-1",
      sessionId: "session-1",
      goal: "Reach a cited decision.",
      now: 1,
    });
    const markdown = buildDeterministicSalvageReport({
      task,
      plan,
      run,
      evidence: [evidence],
      reason: "No material evidence gaps.",
    });

    expect(markdown).not.toContain("reconstructed deterministically");
    expect(markdown).toContain("- [C1] The premise is supported.");
    expect(markdown).toContain("No material evidence gaps.");
    expect(
      auditResearchReport({ markdown, plan, run, evidence: [evidence] }),
    ).toMatchObject({ blocking: [], advisory: [] });
  });

  it("publishes a clean article while retaining descriptive citations", () => {
    const { plan, run, evidence } = createFixture();
    const task = createResearchTask({
      id: "task-1",
      sessionId: "session-1",
      goal: "Reach a cited decision.",
      now: 1,
    });
    const audited = buildDeterministicSalvageReport({
      task,
      plan,
      run,
      evidence: [evidence],
      reason: "No material evidence gaps.",
    });
    const published = prepareResearchReportForPublication({
      markdown: audited,
      plan,
      run,
      evidence: [evidence],
    });

    expect(published).toContain("The premise is supported.");
    expect(published).toContain(
      "[Official source](https://example.com/source?b=2&a=1)",
    );
    expect(published).toContain("## Sources");
    expect(published).not.toContain("C1");
    expect(published).not.toContain("source-known");
    expect(published).not.toContain("step-1");
    expect(published).not.toContain("## Research plan coverage");
    expect(published).toContain("## Evidence gaps");
    expect(published).not.toContain("publication audit");
    expect(published).not.toContain("claim ledger");
  });

  it("publishes a single-source claim and audits it clean", () => {
    const { plan, run, evidence } = createFixture();
    const singleSourceRun = {
      ...run,
      claims: run.claims.map((claim) => ({
        ...claim,
        verificationStatus: "pending" as const,
      })),
    };

    expect(getCitableResearchClaims(singleSourceRun, [evidence])).toMatchObject(
      [{ claim: { id: "C1" }, confidence: "single_source" }],
    );
    expect(
      auditResearchReport({
        markdown: completeReport,
        plan,
        run: singleSourceRun,
        evidence: [evidence],
      }),
    ).toMatchObject({ blocking: [], advisory: [] });
  });

  it("appends the single-source note to published key findings", () => {
    const { plan, run, evidence } = createFixture();
    const singleSourceRun = {
      ...run,
      claims: run.claims.map((claim) => ({
        ...claim,
        verificationStatus: "pending" as const,
      })),
    };
    const published = prepareResearchReportForPublication({
      markdown: completeReport,
      plan,
      run: singleSourceRun,
      evidence: [evidence],
      singleSourceNote: (count, total) =>
        `${count} of ${total} findings above rest on a single source.`,
    });

    expect(published).toContain(
      "_1 of 1 findings above rest on a single source._",
    );
    expect(published.indexOf("single source.")).toBeLessThan(
      published.indexOf("## Decision"),
    );
    expect(
      prepareResearchReportForPublication({
        markdown: completeReport,
        plan,
        run,
        evidence: [evidence],
        singleSourceNote: () => "note",
      }),
    ).not.toContain("note");
  });

  it("reports a report without key findings as blocking", () => {
    const { plan, run, evidence } = createFixture();
    const emptyRun = { ...run, claims: [] };

    expect(
      auditResearchReport({
        markdown: "# Report\n\n## Executive summary\n\nNothing to report.",
        plan,
        run: emptyRun,
        evidence: [evidence],
      }).blocking,
    ).toContain("The report has no auditable key findings.");
  });
});
