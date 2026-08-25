// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResearchGlobalBar,
  ResearchTaskCard,
  ResearchWorkbench,
  type ResearchTaskViewModel,
} from "@/components/research";
import researchMessages from "@/i18n/locales/en/Research.json";

vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <article data-testid="research-report-markdown">{content}</article>
  ),
}));

afterEach(cleanup);

const baseTask: ResearchTaskViewModel = {
  id: "research-1",
  title: "Compare evidence-backed research systems",
  status: "plan_ready",
  budgetPreset: "standard",
  plan: {
    id: "plan-1",
    version: 2,
    summary: "Compare the systems using primary documentation.",
    steps: [
      { id: "step-1", title: "Collect sources", status: "completed" },
      { id: "step-2", title: "Verify claims", status: "in_progress" },
      { id: "step-3", title: "Write report", status: "pending" },
      { id: "step-4", title: "Audit citations", status: "pending" },
    ],
  },
  completedQuestions: 1,
  totalQuestions: 4,
  summary: "A concise card summary.",
  findings: ["Finding one", "Finding two", "Finding three", "Finding four"],
  evidence: [
    {
      id: "evidence-1",
      title: "Primary product documentation",
      sourceType: "web",
      url: "https://example.com/research",
      retrievedAt: Date.UTC(2026, 7, 24),
      stance: "supports",
      freshness: "current",
      excerpt: "This evidence supports the first claim.",
      questionIndexes: [0],
      domain: "example.com",
    },
  ],
  activities: [
    {
      id: "activity-1",
      createdAt: Date.UTC(2026, 7, 24),
      phase: "researching",
      title: "Collected primary documentation",
      detail: "One source was committed to the evidence index.",
    },
  ],
  reportVersions: [],
  sourceScope: {
    searchEnabled: true,
    toolIds: ["fetch_url"],
    knowledgeCount: 2,
    attachmentCount: 0,
    workspaceCount: 0,
    pluginCount: 0,
  },
  usage: {
    toolRounds: 2,
    maxToolRounds: 12,
    toolCalls: 4,
    maxToolCalls: 50,
    elapsedMs: 90_000,
    maxWallTimeMs: 900_000,
  },
};

const completedTask: ResearchTaskViewModel = {
  ...baseTask,
  status: "partial_completed",
  gapSummary: "One source could not be independently verified.",
  activeReportVersionId: "report-2",
  reportVersions: [
    {
      id: "report-1",
      version: 1,
      createdAt: Date.UTC(2026, 7, 23),
      title: "Research systems report",
      markdown: "# Older full report body",
    },
    {
      id: "report-2",
      version: 2,
      createdAt: Date.UTC(2026, 7, 24),
      title: "Updated research systems report",
      markdown: "# Full report body that belongs only in the workbench",
      changeSummary: "Rechecked mutable web sources.",
    },
  ],
};

const v2Plan: NonNullable<ResearchTaskViewModel["plan"]> = {
  ...baseTask.plan!,
  objective: "Recommend a research workflow using verifiable evidence.",
  scope: {
    audience: "Product and engineering leads",
    timeRange: "2024–2026",
    allowedSourceTypes: ["web", "knowledge"],
    includes: ["Primary product documentation", "Independent benchmarks"],
    excludes: ["Anonymous social posts"],
  },
  assumptions: ["Public documentation is sufficient for this decision."],
  deliverable: {
    kind: "decision_memo",
    description: "A decision-ready recommendation.",
  },
  strategy: {
    initialBreadth: 4,
    maxDepth: 2,
    queryLimit: 16,
    resultsPerQuery: 5,
    reservedValidationQueries: 3,
    sourceContentLimit: 32,
  },
  recon: {
    status: "completed",
    queryCount: 2,
    maxQueries: 2,
    resultsPerQuery: 5,
    durationMs: 2_400,
    queries: [
      {
        id: "recon-1",
        query: "research workflow primary documentation",
        status: "completed",
        resultCount: 5,
        domains: ["example.com", "standards.example"],
      },
      {
        id: "recon-2",
        query: "research workflow independent benchmark",
        status: "completed",
        resultCount: 4,
        domains: ["benchmark.example"],
      },
    ],
  },
  completionCriteria: [
    "Every major recommendation is backed by verified evidence.",
  ],
  steps: baseTask.plan!.steps.map((step) => ({
    ...step,
    objective: `Evidence objective for ${step.title}`,
    queryTopics: [`${step.title} primary sources`],
    sourcePriorities: ["web:high — Prefer primary documentation"],
    evidenceStandard: "Major claims require independent support.",
  })),
};

const approvalTask: ResearchTaskViewModel = {
  ...baseTask,
  plan: v2Plan,
};

const orchestratedTask: ResearchTaskViewModel = {
  ...baseTask,
  status: "researching",
  plan: v2Plan,
  evidence: [
    {
      ...baseTask.evidence[0],
      stepId: "step-1",
      nodeId: "node-1",
      claimIds: ["claim-1"],
      verificationStatus: "verified",
    },
  ],
  run: {
    id: "run-1",
    phase: "exploring",
    currentWave: 2,
    currentDepth: 2,
    maxDepth: 2,
    queryUsage: {
      used: 9,
      limit: 16,
      reservedForValidation: 3,
      planningUsed: 2,
    },
    claimCounts: {
      total: 4,
      verified: 2,
      conflicting: 1,
      unresolved: 1,
    },
    waves: [
      {
        id: "wave-1",
        index: 1,
        depth: 1,
        status: "completed",
        nodeIds: ["node-1"],
        queryCount: 4,
        sourceCount: 3,
        verifiedClaimCount: 1,
      },
      {
        id: "wave-2",
        index: 2,
        depth: 2,
        status: "in_progress",
        nodeIds: ["node-2", "node-3"],
        queryCount: 2,
        sourceCount: 1,
        verifiedClaimCount: 1,
      },
    ],
    nodes: [
      {
        id: "node-1",
        waveId: "wave-1",
        stepId: "step-1",
        depth: 1,
        objective: "Map the primary workflow",
        query: "primary research workflow documentation",
        status: "completed",
        evidenceIds: ["evidence-1"],
        claimIds: ["claim-1"],
        verifiedClaimCount: 1,
        conflictingClaimCount: 0,
        learnings: ["The workflow separates discovery from verification."],
        followUps: ["Check how the workflow handles source conflicts."],
      },
      {
        id: "node-2",
        parentId: "node-1",
        waveId: "wave-2",
        stepId: "step-2",
        depth: 2,
        objective: "Verify the conflict-handling model",
        query: "research workflow conflicting evidence",
        status: "in_progress",
        evidenceIds: [],
        claimIds: ["claim-2", "claim-3"],
        verifiedClaimCount: 1,
        conflictingClaimCount: 1,
        learnings: ["Independent publishers disagree on one boundary."],
        followUps: ["Check the relevant primary policy."],
      },
      {
        id: "node-3",
        parentId: "node-1",
        waveId: "wave-2",
        stepId: "step-2",
        depth: 2,
        objective: "Check regional deployment variants",
        status: "pending",
        evidenceIds: [],
        claimIds: [],
        verifiedClaimCount: 0,
        conflictingClaimCount: 0,
        learnings: [],
        followUps: ["Inspect a source outside the approved scope."],
        scopeImpact: "source_expansion",
      },
    ],
  },
};

function renderWithResearchMessages(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ Research: researchMessages }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

async function flushDialogFocus() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

describe("ResearchTaskCard", () => {
  it("keeps the full report out of chat while exposing summary and gaps", () => {
    renderWithResearchMessages(
      <ResearchTaskCard task={completedTask} onOpenWorkbench={vi.fn()} />,
    );

    expect(screen.getByText("A concise card summary.")).toBeTruthy();
    expect(screen.getByText("Finding one")).toBeTruthy();
    expect(screen.queryByText("Finding four")).toBeNull();
    expect(
      screen.queryByText(
        "# Full report body that belongs only in the workbench",
      ),
    ).toBeNull();
    expect(screen.getByText(/One source could not/)).toBeTruthy();
  });

  it("confirms a plan and submits a natural-language adjustment", async () => {
    const onConfirmPlan = vi.fn();
    const onAdjustPlan = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={baseTask}
        onOpenWorkbench={vi.fn()}
        onConfirmPlan={onConfirmPlan}
        onAdjustPlan={onAdjustPlan}
        onCancel={vi.fn()}
      />,
    );

    for (const step of [
      "Collect sources",
      "Verify claims",
      "Write report",
      "Audit citations",
    ]) {
      expect(screen.getByText(step)).toBeTruthy();
    }
    expect(
      screen.queryByText("Compare the systems using primary documentation."),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start research" }));
    expect(onConfirmPlan).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Adjust plan" }));
    await user.type(
      screen.getByRole("textbox", { name: "Describe the change" }),
      "Prioritize primary sources",
    );
    await user.click(screen.getByRole("button", { name: "Create new plan" }));
    expect(onAdjustPlan).toHaveBeenCalledWith("Prioritize primary sources");
  });

  it("shows a recoverable error separately with retry and dismiss actions", async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...baseTask,
          status: "failed",
          summary: "The original research goal.",
          error: {
            message: "The research run lost its model connection.",
            recoverable: true,
          },
        }}
        onOpenWorkbench={vi.fn()}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );

    expect(
      screen.getByText("The research run lost its model connection."),
    ).toBeTruthy();
    expect(screen.getByText("The original research goal.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers retry while a recoverable plan conflict stays clarifying", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...baseTask,
          status: "clarifying",
          error: {
            message: "Another tab is running this session.",
            recoverable: true,
          },
        }}
        onOpenWorkbench={vi.fn()}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("submits bounded advanced strategy values before plan approval", async () => {
    const onUpdatePlanStrategy = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={approvalTask}
        onOpenWorkbench={vi.fn()}
        onUpdatePlanStrategy={onUpdatePlanStrategy}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Tune strategy" }));
    const breadth = screen.getByRole("spinbutton", { name: "Breadth" });
    const depth = screen.getByRole("spinbutton", { name: "Depth" });
    const queries = screen.getByRole("spinbutton", { name: "Queries" });
    const results = screen.getByRole("spinbutton", { name: "Results" });
    expect(breadth.getAttribute("min")).toBe("1");
    expect(breadth.getAttribute("max")).toBe("8");
    expect(depth.getAttribute("max")).toBe("4");
    expect(queries.getAttribute("min")).toBe("2");
    expect(queries.getAttribute("max")).toBe("48");
    expect(results.getAttribute("min")).toBe("3");
    expect(results.getAttribute("max")).toBe("10");

    await user.clear(breadth);
    await user.type(breadth, "6");
    await user.clear(depth);
    await user.type(depth, "3");
    await user.clear(queries);
    await user.type(queries, "32");
    await user.clear(results);
    await user.type(results, "8");
    await user.click(screen.getByRole("button", { name: "Save strategy" }));

    expect(onUpdatePlanStrategy).toHaveBeenCalledWith({
      initialBreadth: 6,
      maxDepth: 3,
      maxQueries: 32,
      resultsPerQuery: 8,
    });
  });
});

describe("ResearchGlobalBar", () => {
  it("announces the active task and exposes return and pause actions", async () => {
    const onOpenWorkbench = vi.fn();
    const onPause = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchGlobalBar
        task={{ ...baseTask, status: "researching" }}
        onOpenWorkbench={onOpenWorkbench}
        onPause={onPause}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause safely" }));
    await user.click(
      screen.getByRole("button", { name: "Return to research" }),
    );
    expect(onPause).toHaveBeenCalledOnce();
    expect(onOpenWorkbench).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Active deep research")).toBeTruthy();
  });
});

describe("ResearchWorkbench", () => {
  it("renders full report versions only in the workbench and wires exports", async () => {
    const onDownloadMarkdown = vi.fn();
    const onPrintPdf = vi.fn();
    const onSelectReportVersion = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={completedTask}
        onClose={vi.fn()}
        onDownloadMarkdown={onDownloadMarkdown}
        onPrintPdf={onPrintPdf}
        onSelectReportVersion={onSelectReportVersion}
      />,
    );

    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Full report body");
    await user.selectOptions(
      screen.getByLabelText("Report version"),
      "report-1",
    );
    expect(onSelectReportVersion).toHaveBeenCalledWith("report-1");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Older full report");

    await user.click(screen.getByRole("button", { name: "Markdown" }));
    await user.click(screen.getByRole("button", { name: "PDF" }));
    expect(onDownloadMarkdown).toHaveBeenCalledWith("report-1");
    expect(onPrintPdf).toHaveBeenCalledWith("report-1");
  });

  it("collects evidence questions and continuation goals before invoking callbacks", async () => {
    const onAskEvidence = vi.fn();
    const onContinueResearch = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={completedTask}
        onClose={vi.fn()}
        onAskEvidence={onAskEvidence}
        onContinueResearch={onContinueResearch}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Ask existing evidence" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Ask the existing evidence" }),
    ).toBeTruthy();
    await flushDialogFocus();
    await user.type(
      screen.getByRole("textbox", { name: "Question" }),
      "Where does the evidence disagree?",
    );
    await user.click(screen.getByRole("button", { name: "Ask question" }));
    expect(onAskEvidence).toHaveBeenCalledWith(
      "Where does the evidence disagree?",
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "New follow-up" }));
    expect(
      screen.getByRole("dialog", { name: "Continue the research" }),
    ).toBeTruthy();
    await flushDialogFocus();
    await user.type(
      screen.getByRole("textbox", { name: "Additional research goal" }),
      "Check another primary source",
    );
    await user.click(screen.getByRole("button", { name: "Prepare plan" }));
    expect(onContinueResearch).toHaveBeenCalledWith(
      "Check another primary source",
    );
  });

  it("uses one tab strip and an inspectable, filterable evidence list", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={completedTask} onClose={vi.fn()} />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByRole("tabpanel", { name: "Evidence" })).toBeTruthy();
    expect(screen.queryByLabelText("Select evidence")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Step 1: Collect sources" }),
    ).toBeTruthy();
    const sourceLinks = screen.getAllByRole("link", {
      name: "Open source: Primary product documentation",
    });
    expect(sourceLinks[0].getAttribute("href")).toBe(
      "https://example.com/research",
    );
  });

  it("shows every plan step and closes the plan with button, backdrop, or Escape", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={baseTask}
        onClose={vi.fn()}
        onConfirmPlan={vi.fn()}
        onAdjustPlan={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Plan ready for review")).toHaveLength(2);
    expect(screen.getByText("Web search")).toBeTruthy();
    expect(screen.getByText("Fetch URL")).toBeTruthy();
    expect(screen.getByText("Knowledge (2)")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Start research" }),
    ).toHaveLength(1);
    const showFullPlan = screen.getByRole("button", {
      name: "Show full plan",
    });
    await user.click(showFullPlan);
    await flushDialogFocus();
    let dialog = screen.getByRole("dialog", { name: "Research plan" });
    expect(
      within(dialog).getByText(
        "Compare the systems using primary documentation.",
      ),
    ).toBeTruthy();
    for (const step of baseTask.plan!.steps) {
      expect(within(dialog).getByText(step.title)).toBeTruthy();
    }
    expect(within(dialog).getByText("Web search")).toBeTruthy();

    await user.click(
      within(dialog).getByRole("button", { name: "Close research plan" }),
    );
    expect(screen.queryByRole("dialog", { name: "Research plan" })).toBeNull();
    expect(document.activeElement).toBe(showFullPlan);

    await user.click(showFullPlan);
    await flushDialogFocus();
    dialog = screen.getByRole("dialog", { name: "Research plan" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog", { name: "Research plan" })).toBeNull();
    expect(document.activeElement).toBe(showFullPlan);

    await user.click(showFullPlan);
    await flushDialogFocus();
    dialog = screen.getByRole("dialog", { name: "Research plan" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Research plan" })).toBeNull();
    expect(document.activeElement).toBe(showFullPlan);
  });

  it("lets the activity list use the full workbench width", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={completedTask} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    const panel = screen.getByRole("heading", {
      name: "Research activity",
    }).parentElement!;
    expect(panel.className).toContain("w-full");
    expect(panel.className).not.toContain("max-w-3xl");
    expect(
      screen.getByText("Collected primary documentation").className,
    ).toContain("wrap-break-word");
  });

  it("warns before approval when web search is outside the source scope", () => {
    renderWithResearchMessages(
      <ResearchWorkbench
        task={{
          ...baseTask,
          sourceScope: {
            ...baseTask.sourceScope!,
            searchEnabled: false,
          },
        }}
        onClose={vi.fn()}
        onConfirmPlan={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Web search is not available in this source scope. Enable a compatible external search provider before starting.",
      ),
    ).toBeTruthy();
  });

  it("discloses the approved strategy, scope, deliverable, and reconnaissance", () => {
    renderWithResearchMessages(
      <ResearchWorkbench
        task={approvalTask}
        onClose={vi.fn()}
        onConfirmPlan={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Decision memo").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Product and engineering leads").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("16").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Planning reconnaissance sends the research question to the configured public search service. Its snippets inform the plan only and are not report evidence.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Planning reconnaissance: 2/2 queries").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Verify claims primary sources").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Major claims require independent support.").length,
    ).toBeGreaterThan(0);
  });

  it("uses one responsive semantic topology and inspects nodes by keyboard", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={orchestratedTask} onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText("Research run status")).toBeTruthy();
    const waves = screen.getByRole("list", { name: "Research waves" });
    expect(waves.tagName).toBe("OL");
    expect(
      screen.getAllByRole("list", { name: "Research waves" }),
    ).toHaveLength(1);
    expect(waves.parentElement?.parentElement?.className).toContain(
      "lg:grid-cols",
    );
    expect(screen.getByText("Wave 1")).toBeTruthy();
    expect(screen.getByText("Wave 2")).toBeTruthy();

    const pendingNodeSummary = screen
      .getByText("Check regional deployment variants")
      .closest("summary")!;
    const pendingNode = pendingNodeSummary.parentElement as HTMLDetailsElement;
    expect(pendingNode.open).toBe(false);
    pendingNodeSummary.focus();
    await user.keyboard("{Enter}");
    expect(pendingNode.open).toBe(true);

    const inspector = screen.getByLabelText("Research node inspector");
    expect(
      within(inspector).getByRole("heading", {
        name: "Check regional deployment variants",
      }),
    ).toBeTruthy();
    expect(
      within(inspector).getByText(
        "This direction expands the approved source or research scope and requires approval before access.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("9/16").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2/4").length).toBeGreaterThan(0);
  });

  it("has no automated WCAG A/AA violations in the orchestration view", async () => {
    const { container } = renderWithResearchMessages(
      <ResearchWorkbench task={orchestratedTask} onClose={vi.fn()} />,
    );
    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it("has no automated WCAG A/AA violations in the completed state", async () => {
    const { container } = renderWithResearchMessages(
      <ResearchWorkbench task={completedTask} onClose={vi.fn()} />,
    );
    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
