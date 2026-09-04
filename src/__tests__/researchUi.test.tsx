// @vitest-environment jsdom

import React from "react";
import {
  act,
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
import messageMessages from "@/i18n/locales/en/Message.json";
import researchMessages from "@/i18n/locales/en/Research.json";
import evidenceQuestionMessages from "@/i18n/locales/en/EvidenceQuestions.json";
import steeringMessages from "@/i18n/locales/en/ResearchSteering.json";
import templateMessages from "@/i18n/locales/en/ResearchTemplates.json";
import japaneseResearchMessages from "@/i18n/locales/ja/Research.json";
import chineseResearchMessages from "@/i18n/locales/zh/Research.json";

vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <article data-testid="research-report-markdown">{content}</article>
  ),
}));

vi.mock("@/components/research/workbench/EvidenceQuestionsPanel", () => ({
  default: ({ reportId }: { reportId?: string }) => (
    <div data-testid="evidence-topic-panel" data-report-id={reportId} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
      linkedClaims: [
        {
          id: "claim-1",
          text: "The documented workflow separates discovery from verification.",
          importance: "major",
          verificationStatus: "verified",
        },
      ],
      questionIndexes: [0],
      domain: "example.com",
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "The documented workflow separates discovery from verification.",
      importance: "major",
      verificationStatus: "verified",
      independentPublisherCount: 2,
      supportingEvidenceIds: ["evidence-1"],
      contradictingEvidenceIds: [],
      stepId: "step-1",
    },
  ],
  activities: [
    {
      id: "activity-1",
      createdAt: Date.UTC(2026, 7, 24),
      phase: "researching",
      status: "committed",
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

const partialTask: ResearchTaskViewModel = {
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
      markdown: "# Research systems report\n\nOlder full report body",
      kind: "initial",
      gaps: [],
      coveredStepIds: ["step-1", "step-2", "step-3", "step-4"],
      planStepCount: 4,
      claims: [
        {
          id: "claim-1",
          text: "The documented workflow separates discovery from verification.",
          importance: "major",
          verificationStatus: "verified",
          independentPublisherCount: 2,
          supportingEvidenceIds: ["evidence-1"],
          contradictingEvidenceIds: [],
          stepId: "step-1",
        },
      ],
    },
    {
      id: "report-2",
      version: 2,
      createdAt: Date.UTC(2026, 7, 24),
      title: "Updated research systems report",
      markdown: "# Updated research systems report\n\nFull report body",
      kind: "update",
      gaps: ["One source could not be independently verified."],
      coveredStepIds: ["step-1", "step-2", "step-3"],
      planStepCount: 4,
      stopReason: { code: "max_queries" },
      diff: {
        addedEvidenceIds: ["evidence-1"],
        changedSourceIds: ["source-1"],
        unchangedSourceIds: [],
      },
      audit: {
        blocking: [],
        advisory: ["One finding needs a stronger citation."],
        unknownCitationCount: 0,
        unsupportedFindingCount: 1,
        missingSectionCount: 0,
      },
      claims: [...(baseTask.claims ?? [])],
    },
  ],
};

const completedTask: ResearchTaskViewModel = {
  ...partialTask,
  status: "completed",
  gapSummary: undefined,
};

const v2Plan: NonNullable<ResearchTaskViewModel["plan"]> = {
  ...baseTask.plan!,
  objective: "Recommend a research workflow using verifiable evidence.",
  scope: {
    audience: "Product and engineering leads",
    timeRange: "2024-2026",
    allowedSourceTypes: ["web", "knowledge"],
    includes: ["Primary product documentation", "Independent benchmarks"],
    excludes: ["Anonymous social posts"],
    preferredDomains: ["docs.example.com"],
    excludedDomains: ["archive.example.com"],
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
    sourcePriorities: ["web:high - Prefer primary documentation"],
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
    startedAt: 1_000,
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
    coverage: {
      coveredStepCount: 1,
      requiredStepCount: 4,
      ratio: 0.25,
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
      messages={{
        EvidenceQuestions: evidenceQuestionMessages,
        ResearchSteering: steeringMessages,
        ResearchTemplates: templateMessages,
        Message: messageMessages,
        Research: researchMessages,
      }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

async function flushDialogFocus() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

describe("ResearchTaskCard", () => {
  it("localizes legacy report headings in the chat document preview", () => {
    render(
      <NextIntlClientProvider
        locale="zh"
        messages={{
          Research: chineseResearchMessages,
          Message: messageMessages,
          ResearchSteering: steeringMessages,
          ResearchTemplates: templateMessages,
          EvidenceQuestions: evidenceQuestionMessages,
        }}
      >
        <ResearchTaskCard
          task={{
            ...completedTask,
            reportVersions: completedTask.reportVersions.map((report) => ({
              ...report,
              markdown: "# Report\n\n## Executive summary\nBody.",
            })),
          }}
          onOpenWorkbench={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("## 执行摘要");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).not.toContain("## Executive summary");
  });

  it("omits volatile coverage progress and uses activity lifecycle status", () => {
    renderWithResearchMessages(
      <ResearchTaskCard task={orchestratedTask} onOpenWorkbench={vi.fn()} />,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Verified coverage/)).toBeNull();
    const activity = screen
      .getByText("Collected primary documentation")
      .closest("h3");
    expect(activity?.querySelector(".lucide-circle-check")).toBeTruthy();
    expect(activity?.querySelector(".lucide-loader-circle")).toBeNull();
  });

  it("explains that a legacy scope pause resumes from committed evidence", async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...orchestratedTask,
          status: "paused",
          error: {
            code: "RESEARCH_SCOPE_APPROVAL_REQUIRED",
            message: "Scope expansion requires approval.",
            recoverable: true,
          },
        }}
        onOpenWorkbench={vi.fn()}
        onResume={onResume}
      />,
    );

    expect(
      screen.getByText(/Resume to continue from committed evidence/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("shows the active final report without repeating summary or findings", async () => {
    const onOpenWorkbench = vi.fn();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={completedTask}
        onOpenWorkbench={onOpenWorkbench}
      />,
    );

    expect(screen.queryByText("A concise card summary.")).toBeNull();
    expect(screen.queryByText("Finding one")).toBeNull();
    expect(screen.queryByText("Finding four")).toBeNull();
    expect(
      screen.getByText(/# Updated research systems report\s+Full report body/),
    ).toBeTruthy();
    expect(screen.queryByText(/# Research systems report\s+Older/)).toBeNull();
    expect(
      screen.getByLabelText(
        "Long text document: Updated research systems report",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/One source could not/)).toBeNull();

    await userEvent.click(
      screen.getAllByRole("button", {
        name: "Open long text document Updated research systems report in full screen",
      })[0],
    );
    expect(onOpenWorkbench).toHaveBeenCalledOnce();
  });

  it("shows a partial report in the chat document block", () => {
    renderWithResearchMessages(
      <ResearchTaskCard task={partialTask} onOpenWorkbench={vi.fn()} />,
    );

    expect(screen.getByText(/One source could not/)).toBeTruthy();
    expect(screen.queryByText("A concise card summary.")).toBeNull();
    expect(screen.queryByText("Finding one")).toBeNull();
    expect(
      screen.getByText(/# Updated research systems report\s+Full report body/),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Long text document: Updated research systems report",
      ),
    ).toBeTruthy();
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
  it("freezes elapsed time at the recorded end even when reopened days later", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10 * 24 * 60 * 60 * 1_000);
    renderWithResearchMessages(
      <ResearchGlobalBar
        task={{
          ...orchestratedTask,
          status: "completed",
          run: {
            ...orchestratedTask.run!,
            startedAt: 1_000,
            endedAt: 61_000,
          },
        }}
        onOpenWorkbench={vi.fn()}
      />,
    );

    expect(screen.getByText("1m 0s")).toBeTruthy();
  });

  it("falls back to persisted usage for a stopped run without an end time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10 * 24 * 60 * 60 * 1_000);
    renderWithResearchMessages(
      <ResearchGlobalBar
        task={{
          ...orchestratedTask,
          status: "paused",
          run: { ...orchestratedTask.run!, startedAt: 1_000 },
        }}
        onOpenWorkbench={vi.fn()}
      />,
    );

    expect(screen.getByText("1m 30s")).toBeTruthy();
  });

  it("ticks elapsed time only while the run is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(11_000);
    renderWithResearchMessages(
      <ResearchGlobalBar
        task={{
          ...orchestratedTask,
          run: { ...orchestratedTask.run!, startedAt: 1_000 },
        }}
        onOpenWorkbench={vi.fn()}
      />,
    );

    expect(screen.getByText("10s")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("12s")).toBeTruthy();
  });

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
    const returnButton = screen.getByRole("button", {
      name: "Return to research",
    });
    expect(returnButton.className).toContain("border-gray-200");
    expect(returnButton.className).not.toContain("bg-research-solid");
    await user.click(returnButton);
    expect(onPause).toHaveBeenCalledOnce();
    expect(onOpenWorkbench).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Active deep research")).toBeTruthy();
  });

  it("prioritizes a running activity and falls back to the current phase", () => {
    const { rerender } = renderWithResearchMessages(
      <ResearchGlobalBar
        task={{
          ...orchestratedTask,
          activities: [
            { ...orchestratedTask.activities[0], status: "committed" },
            {
              id: "activity-running",
              createdAt: Date.UTC(2026, 7, 24, 1),
              phase: "researching",
              status: "running",
              title: "Fetching the primary policy",
            },
          ],
        }}
        onOpenWorkbench={vi.fn()}
      />,
    );

    expect(screen.getByText("Fetching the primary policy")).toBeTruthy();
    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{
          EvidenceQuestions: evidenceQuestionMessages,
          ResearchSteering: steeringMessages,
          ResearchTemplates: templateMessages,
          Message: messageMessages,
          Research: researchMessages,
        }}
      >
        <ResearchGlobalBar
          task={{
            ...orchestratedTask,
            activities: [
              { ...orchestratedTask.activities[0], status: "committed" },
            ],
          }}
          onOpenWorkbench={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Exploring sources")).toBeTruthy();
  });

  it("offers a paused task for explicit resume", async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchGlobalBar
        task={{ ...orchestratedTask, status: "paused" }}
        onOpenWorkbench={vi.fn()}
        onResume={onResume}
      />,
    );

    expect(screen.getByLabelText("Deep research ready to resume")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledOnce();
  });
});

describe("ResearchWorkbench", () => {
  it("keeps the review brief and dialog keys in all research locales", () => {
    for (const messages of [
      researchMessages,
      chineseResearchMessages,
      japaneseResearchMessages,
    ]) {
      expect(messages.plan.willResearch).toBeTruthy();
      expect(messages.plan.willNotResearch).toBeTruthy();
      expect(messages.plan.advancedDisclosure).toBeTruthy();
      expect(messages.adjust.title).toBeTruthy();
      expect(messages.actions.closeAdjust).toBeTruthy();
      expect(messages.actions.closeStrategy).toBeTruthy();
      expect(messages.activity.degradedWaveTitle).toBeTruthy();
    }
  });

  it("keeps the selected report version across body, supplements, and exports", async () => {
    const onDownloadMarkdown = vi.fn();
    const onPrintPdf = vi.fn();
    const onSelectReportVersion = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={partialTask}
        onClose={vi.fn()}
        onDownloadMarkdown={onDownloadMarkdown}
        onPrintPdf={onPrintPdf}
        onSelectReportVersion={onSelectReportVersion}
      />,
    );

    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Full report body");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).not.toContain("# Updated research systems report");
    expect(screen.queryByText("3 of 4 research steps covered")).toBeNull();
    expect(
      screen.queryByText("One source could not be independently verified."),
    ).toBeNull();
    await user.click(
      screen.getByRole("tab", { name: "Supplementary material" }),
    );
    expect(screen.getByText("3 of 4 research steps covered")).toBeTruthy();
    expect(
      screen.getByText("One source could not be independently verified."),
    ).toBeTruthy();
    expect(
      screen.getByText("1 publication check needs attention."),
    ).toBeTruthy();
    expect(screen.getByText("1 evidence item added")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Report" }));
    await user.click(screen.getByRole("combobox", { name: "Report version" }));
    await user.click(
      screen.getByRole("option", {
        name: "Version 1",
      }),
    );
    expect(onSelectReportVersion).toHaveBeenCalledWith("report-1");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Older full report");

    await user.click(screen.getByRole("button", { name: "Download" }));
    await user.click(screen.getByRole("menuitem", { name: "Markdown" }));
    await user.click(screen.getByRole("button", { name: "Download" }));
    await user.click(screen.getByRole("menuitem", { name: "PDF" }));
    expect(onDownloadMarkdown).toHaveBeenCalledWith("report-1");
    expect(onPrintPdf).toHaveBeenCalledWith("report-1");
  });

  it("projects report appendices into supplementary material", async () => {
    const user = userEvent.setup();
    const task = {
      ...completedTask,
      reportVersions: [
        {
          ...completedTask.reportVersions[1],
          markdown: `# Updated research systems report

## Executive summary

Body summary.

## Sources

- Primary documentation [Source 1]

## Evidence gaps

- One gap remains.

## Knowledge supplement (not verified in this research)

Model context is clearly labeled.`,
        },
      ],
      activeReportVersionId: "report-2",
    };
    renderWithResearchMessages(
      <ResearchWorkbench task={task} onClose={vi.fn()} />,
    );

    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Body summary.");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).not.toContain("Primary documentation");

    await user.click(
      screen.getByRole("tab", { name: "Supplementary material" }),
    );
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Primary documentation");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Model context is clearly labeled.");
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("One gap remains.");
  });

  it("opens version-scoped evidence topics and collects continuation goals", async () => {
    const onContinueResearch = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={completedTask}
        onClose={vi.fn()}
        onContinueResearch={onContinueResearch}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Ask existing evidence" }),
    );
    expect(
      screen
        .getByRole("tab", { name: "Questions" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      (await screen.findByTestId("evidence-topic-panel")).getAttribute(
        "data-report-id",
      ),
    ).toBe(completedTask.activeReportVersionId);
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

    expect(screen.getAllByRole("tab")).toHaveLength(7);
    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByRole("tabpanel", { name: "Evidence" })).toBeTruthy();
    expect(screen.queryByLabelText("Select evidence")).toBeNull();
    expect(
      screen.getByText(
        "The documented workflow separates discovery from verification.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Step 1: Collect sources" }),
    ).toBeTruthy();
    const sourceLinks = screen.getAllByRole("link", {
      name: "Open source: Primary product documentation",
    });
    expect(sourceLinks[0].getAttribute("href")).toBe(
      "https://example.com/research",
    );

    await user.type(
      screen.getByRole("searchbox", { name: "Search evidence" }),
      "discovery from verification",
    );
    expect(screen.getByText("1 evidence item")).toBeTruthy();
    await user.clear(
      screen.getByRole("searchbox", { name: "Search evidence" }),
    );
    await user.click(
      screen.getByRole("combobox", { name: "Source authority" }),
    );
    await user.click(screen.getByRole("option", { name: "Primary source" }));
    expect(screen.getByText("0 evidence items")).toBeTruthy();
  });

  it("explains claim verification and links back to evidence", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={completedTask} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: "Claims" }));
    expect(
      screen.getByText(
        "The documented workflow separates discovery from verification.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 independent publishers")).toBeTruthy();
    await user.click(
      screen.getByText(
        "The documented workflow separates discovery from verification.",
      ),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Inspect evidence: Primary product documentation",
      }),
    );
    expect(screen.getByRole("tabpanel", { name: "Evidence" })).toBeTruthy();
  });

  it("shows internal results as subdued metadata instead of claim titles", async () => {
    const user = userEvent.setup();
    const internalPath =
      "workspace:///tool-results/call_20c0093384754c92a9e8eef2.json";
    renderWithResearchMessages(
      <ResearchWorkbench
        task={{
          ...completedTask,
          evidence: [
            {
              id: "evidence-internal",
              title: "tool-results/call_20c0093384754c92a9e8eef2.json",
              sourceType: "workspace",
              locator: internalPath,
              retrievedAt: Date.UTC(2026, 7, 24),
              linkedClaims: [],
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByText("Not yet linked to a formal claim.")).toBeTruthy();
    expect(screen.getAllByText("Internal tool result").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByRole("heading", {
        name: "tool-results/call_20c0093384754c92a9e8eef2.json",
      }),
    ).toBeNull();
    const technicalDetails = screen.getByText("Technical details");
    expect(
      (technicalDetails.closest("details") as HTMLDetailsElement).open,
    ).toBe(false);
  });

  it("uses max-w-5xl for every tab and opens the first pre-run step", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={completedTask} onClose={vi.fn()} />,
    );

    for (const tabName of [
      "Report",
      "Research plan",
      "Evidence",
      "Claims",
      "Activity",
      "Supplementary material",
    ]) {
      await user.click(screen.getByRole("tab", { name: tabName }));
      expect(
        screen.getByRole("tabpanel", { name: tabName }).firstElementChild
          ?.className,
      ).toContain("max-w-5xl");
    }

    await user.click(screen.getByRole("tab", { name: "Research plan" }));
    const firstStepTrigger = screen
      .getAllByText("Collect sources")
      .map((item) => item.closest("button"))
      .find(Boolean)!;
    expect(firstStepTrigger.getAttribute("aria-expanded")).toBe("true");
    const contentId = firstStepTrigger.getAttribute("aria-controls")!;
    const content = document.getElementById(contentId)!;
    expect(content.className).toContain("grid-rows-[1fr]");
    expect(content.className).toContain("duration-200");
    expect(content.className).toContain("ease-out");
    expect(content.hasAttribute("inert")).toBe(false);
    await user.click(firstStepTrigger);
    expect(firstStepTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(content.hasAttribute("inert")).toBe(true);
    expect(content.className).toContain("grid-rows-[0fr]");
  });

  it("shows the review brief and closes adjustment dialogs with button, backdrop, or Escape", async () => {
    const onAdjustPlan = vi.fn();
    const onUpdatePlanStrategy = vi.fn();
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={approvalTask}
        onClose={vi.fn()}
        onConfirmPlan={vi.fn()}
        onAdjustPlan={onAdjustPlan}
        onUpdatePlanStrategy={onUpdatePlanStrategy}
      />,
    );

    expect(screen.getByText("Will research")).toBeTruthy();
    expect(screen.getByText("Will not research")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Recommend a research workflow using verifiable evidence.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Anonymous social posts")).toBeTruthy();
    expect(
      screen.getAllByText("Preferred domains: docs.example.com").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Excluded domains: archive.example.com").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Web search")).toBeTruthy();
    expect(screen.getByText("Fetch URL")).toBeTruthy();
    expect(screen.getByText("Knowledge (2)")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Research steps" }),
    ).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy();
    expect(
      within(document.querySelector("footer")!)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Advanced strategy", "Adjust plan", "Start research"]);
    for (const step of approvalTask.plan!.steps) {
      expect(screen.getByText(step.title)).toBeTruthy();
    }
    const advancedDisclosure = screen
      .getByText("Reconnaissance and advanced strategy")
      .closest("button")!;
    expect(advancedDisclosure.getAttribute("aria-expanded")).toBe("false");
    expect(advancedDisclosure.parentElement?.className).toContain("rounded-lg");
    const advancedContent = document.getElementById(
      advancedDisclosure.getAttribute("aria-controls")!,
    )!;
    expect(advancedContent.getAttribute("aria-hidden")).toBe("true");
    expect(advancedContent.hasAttribute("inert")).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Start research" }),
    ).toHaveLength(1);

    const adjustPlan = screen.getByRole("button", { name: "Adjust plan" });
    await user.click(adjustPlan);
    await flushDialogFocus();
    let dialog = screen.getByRole("dialog", { name: "Adjust research plan" });

    await user.click(
      within(dialog).getByRole("button", { name: "Close plan adjustment" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Adjust research plan" }),
    ).toBeNull();
    expect(document.activeElement).toBe(adjustPlan);

    await user.click(adjustPlan);
    await flushDialogFocus();
    dialog = screen.getByRole("dialog", { name: "Adjust research plan" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(
      screen.queryByRole("dialog", { name: "Adjust research plan" }),
    ).toBeNull();
    expect(document.activeElement).toBe(adjustPlan);

    await user.click(adjustPlan);
    await flushDialogFocus();
    dialog = screen.getByRole("dialog", { name: "Adjust research plan" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Adjust research plan" }),
    ).toBeNull();
    expect(document.activeElement).toBe(adjustPlan);

    const strategy = screen.getByRole("button", {
      name: "Advanced strategy",
    });
    await user.click(strategy);
    await flushDialogFocus();
    const strategyDialog = screen.getByRole("dialog", {
      name: "Advanced research strategy",
    });
    expect(
      within(strategyDialog).getByRole("spinbutton", { name: "Breadth" }),
    ).toBeTruthy();
    await user.click(
      within(strategyDialog).getByRole("button", {
        name: "Close advanced strategy",
      }),
    );
    expect(document.activeElement).toBe(strategy);
  });

  it("lets the activity list use the full workbench width", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={completedTask} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    const panel = screen
      .getByRole("heading", { name: "Research activity" })
      .closest(".max-w-5xl")!;
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

  it("discloses the approved strategy, scope, deliverable, and reconnaissance", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={approvalTask}
        onClose={vi.fn()}
        onConfirmPlan={vi.fn()}
      />,
    );

    const advancedDisclosure = screen
      .getByText("Reconnaissance and advanced strategy")
      .closest("button")!;
    await user.click(advancedDisclosure);
    expect(advancedDisclosure.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getAllByText("Decision memo").length).toBeGreaterThan(0);
    expect(screen.getByText(/Product and engineering leads/)).toBeTruthy();
    expect(screen.getAllByText("16").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Planning precheck is on demand: it checks selected knowledge bases first, then public search summaries only if needed. Results inform the plan and are not formal evidence.",
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
    const strategyGrid = screen.getAllByText("Deliverable")[0].closest("dl")!;
    expect(strategyGrid.className).toContain("rounded-lg");

    const reconDisclosure = screen.getByRole("button", {
      name: /Planning reconnaissance: 2\/2 queries/,
    });
    expect(reconDisclosure.getAttribute("aria-expanded")).toBe("false");
    const closedChevron = reconDisclosure.lastElementChild!;
    expect(closedChevron.getAttribute("class")).not.toContain("rotate-180");
    await user.click(reconDisclosure);
    expect(reconDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect(reconDisclosure.lastElementChild?.getAttribute("class")).toContain(
      "rotate-180",
    );
    const reconContent = document.getElementById(
      reconDisclosure.getAttribute("aria-controls")!,
    )!;
    expect(
      reconContent.firstElementChild?.firstElementChild?.className,
    ).toContain("rounded-md");
    expect(
      reconContent.firstElementChild?.firstElementChild?.className,
    ).toContain("border");
  });

  it("uses one responsive semantic topology and inspects nodes by keyboard", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench task={orchestratedTask} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByLabelText("Research run status")).toBeTruthy();
    expect(screen.getAllByText("9/16").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2/4").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "Research plan" }));
    const waves = screen.getByRole("list", { name: "Research rounds" });
    expect(waves.tagName).toBe("OL");
    expect(
      screen.getAllByRole("list", { name: "Research rounds" }),
    ).toHaveLength(1);
    expect(waves.parentElement?.parentElement?.className).toContain(
      "lg:grid-cols",
    );
    expect(screen.getByText("Round 1")).toBeTruthy();
    expect(screen.getByText("Round 2")).toBeTruthy();

    const pendingNodeTrigger = screen
      .getByText("Check regional deployment variants")
      .closest("button")!;
    expect(pendingNodeTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(pendingNodeTrigger.className).toContain("rounded-md");
    expect(pendingNodeTrigger.className).toContain("border-transparent");
    pendingNodeTrigger.focus();
    await user.keyboard("{Enter}");
    expect(pendingNodeTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(pendingNodeTrigger.className).toContain("border-research-border");

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
    const activeStepSummary = screen
      .getAllByText("Verify claims")
      .map((item) => item.closest("button"))
      .find(Boolean)!;
    expect(activeStepSummary.getAttribute("aria-expanded")).toBe("true");
    const stepLedger = screen.getByRole("heading", {
      name: "Research steps",
    }).parentElement!;
    const topologyHeading = screen.getByRole("heading", {
      name: "Research topology",
    });
    const topology = topologyHeading.parentElement!.parentElement!;
    const topologyFrame = waves.parentElement!.parentElement!;
    expect(topologyFrame.className).toContain("rounded-lg");
    expect(
      within(inspector).getByRole("heading", {
        name: "Check regional deployment variants",
      }).parentElement?.previousElementSibling?.className,
    ).toContain("rounded-md");
    const metricGrid = within(inspector).getByText("Evidence").closest("dl")!;
    expect(metricGrid.className).toContain("rounded-lg");
    expect(
      stepLedger.compareDocumentPosition(topology) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows degraded wave warnings as non-blocking research activity", async () => {
    const user = userEvent.setup();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={{
          ...orchestratedTask,
          activities: [
            ...orchestratedTask.activities,
            {
              id: "wave-2-degraded",
              createdAt: Date.UTC(2026, 7, 24, 1),
              phase: "researching",
              status: "completed",
              title: "Round 2 archived with evidence gaps",
              detail:
                "One research node produced no valid learning packet; preserved evidence remains available.",
              tone: "warning",
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    const warning = screen.getByRole("heading", {
      name: "Round 2 archived with evidence gaps",
    });
    expect(warning.className).toContain("text-amber");
    const warningItem = warning.closest("li")!;
    expect(warningItem.querySelector('[class*="bg-amber"]')).toBeNull();
    expect(warningItem.querySelector('[class*="rounded-md"]')).toBeNull();
    expect(warningItem.querySelector("svg")?.className.baseVal).toContain(
      "text-amber",
    );
    expect(
      screen.getByText(/preserved evidence remains available/i),
    ).toBeTruthy();
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

  it("has no automated WCAG A/AA violations before plan approval", async () => {
    const { container } = renderWithResearchMessages(
      <ResearchWorkbench
        task={approvalTask}
        onClose={vi.fn()}
        onConfirmPlan={vi.fn()}
        onAdjustPlan={vi.fn()}
        onUpdatePlanStrategy={vi.fn()}
      />,
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

  it("has no automated WCAG A/AA violations in degraded activity", async () => {
    const user = userEvent.setup();
    const { container } = renderWithResearchMessages(
      <ResearchWorkbench
        task={{
          ...orchestratedTask,
          activities: [
            ...orchestratedTask.activities,
            {
              id: "wave-degraded-a11y",
              createdAt: Date.UTC(2026, 7, 24, 2),
              phase: "researching",
              status: "completed",
              title: "Round 2 archived with evidence gaps",
              detail: "Preserved evidence remains available.",
              tone: "warning",
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Activity" }));
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
