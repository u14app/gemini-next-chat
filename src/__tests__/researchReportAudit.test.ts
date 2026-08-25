import { describe, expect, it } from "vitest";

import {
  auditResearchReport,
  buildDeterministicSalvageReport,
  createResearchReportRun,
  createResearchTask,
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
      issues: [],
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
    expect(markdown).toContain("automatically salvaged partial report");
    expect(markdown).toContain("## Decision");
    expect(markdown).toContain("- step-1: answered");
    expect(
      auditResearchReport({ markdown, plan, run, evidence: [evidence] }).issues,
    ).toEqual([]);
  });
});
