import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createResearchTask,
  createResearchReportRun,
  type ResearchTask,
  type ResearchPlanVersion,
} from "@/lib/research";
import {
  createMemoryResearchExtensionRepository,
  getResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
  subscribeResearchExtensions,
} from "@/services/research/extensionRepository";

const state = vi.hoisted(() => ({
  task: null as ResearchTask | null,
  persisted: null as ResearchTask | null,
  artifact: "",
  saveCore: true,
  publish: vi.fn(),
}));
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    getState: () => ({
      tasksById: { task: state.task },
      updateTask: async (
        _id: string,
        update: (task: ResearchTask) => ResearchTask,
      ) => {
        const next = update(state.task!);
        if (next.reportVersions.length) await state.publish(next);
        state.task = next;
        if (state.saveCore) state.persisted = next;
        return next;
      },
    }),
  },
}));
vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => ({
    getStatus: () => ({ durable: true }),
    get: async () => state.persisted,
  }),
  publishResearchReportArtifact: async () => ({
    ok: true,
    value: { url: "opfs://published-report" },
  }),
}));
vi.mock("@/services/workspace/sessionWorkspace", () => ({
  writeWorkspaceText: async (
    _session: string,
    _path: string,
    markdown: string,
  ) => {
    state.artifact = markdown;
    return { ok: true };
  },
  deleteWorkspaceFile: async () => {},
}));
vi.mock("@/utils/opfs", () => ({
  resolveOPFSBlob: vi.fn(async () => new Blob([state.artifact])),
}));
vi.mock("@/lib/research/runtime/usage", () => ({
  aggregateTaskUsage: () => ({
    toolCalls: 0,
    toolRounds: 0,
    wallTimeMs: 0,
    totalTokens: 0,
  }),
}));
import { publishResearchReportVersion } from "@/lib/research/runtime/reportPublication";
import { reportSchema } from "@/services/research/taskRepository/schema/task";

const plan: ResearchPlanVersion = {
  id: "plan",
  version: 1,
  title: "Review",
  summary: "Review",
  objective: "Review",
  scope: {
    audience: "Readers",
    includes: [],
    excludes: [],
    allowedSourceTypes: [],
  },
  assumptions: [],
  deliverable: {
    kind: "research_report",
    description: "Review",
    requiredSections: [],
  },
  strategy: {
    initialBreadth: 1,
    maxDepth: 1,
    maxQueries: 4,
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
    queries: [],
    usage: { queryCount: 0, resultCount: 0, wallTimeMs: 0 },
  },
  steps: [],
  completionCriteria: [],
  createdAt: 1,
};
const run = createResearchReportRun({ taskId: "task", plan });
const publish = (signal?: AbortSignal) =>
  publishResearchReportVersion({
    taskId: "task",
    plan,
    run,
    markdown:
      "# Report\n\n## Executive summary\n\nLimited material.\n\n## Key findings\n\nNone.",
    evidence: [],
    extraGaps: ["Unanswered added question"],
    noEvidenceGap: "No evidence",
    noKeyFindingsGap: "No findings",
    incompleteQuestionsGap: () => "Incomplete",
    singleSourceNote: () => "Single source",
    persistenceError: "Persistence failed",
    noEvidenceNotice: "Model knowledge; not verified during this research.",
    snapshotUnavailableWarning: "Report questions are unavailable.",
    signal,
  });
beforeEach(() => {
  setResearchExtensionRepositoryForTests(
    createMemoryResearchExtensionRepository(),
  );
  state.task = {
    ...createResearchTask({ id: "task", sessionId: "session", goal: "Review" }),
    status: "synthesizing",
    planVersions: [plan],
    activePlanVersion: 1,
    reportRuns: [run],
  };
  state.publish.mockReset();
  state.persisted = state.task;
  state.artifact = "";
  state.saveCore = true;
});
afterEach(() => setResearchExtensionRepositoryForTests(undefined));

it("durably stores the report's evidence and gaps before exposing the version", async () => {
  state.publish.mockImplementation(async (next: ResearchTask) => {
    const report = next.reportVersions.at(-1)!;
    expect(
      await getResearchExtensionRepository().get(
        "evidence_snapshot",
        report.id,
      ),
    ).toMatchObject({
      reportId: report.id,
      gaps: expect.arrayContaining(["Unanswered added question"]),
      citations: {},
      reportMarkdown: state.artifact,
    });
  });
  await publish();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.task!.reportVersions).toHaveLength(1);
  expect(state.task!.reportVersions[0].evidenceSnapshotStatus).toBe(
    "available",
  );
  expect(reportSchema.safeParse(state.task!.reportVersions[0]).success).toBe(
    true,
  );
  const legacy = { ...state.task!.reportVersions[0] };
  delete legacy.evidenceSnapshotStatus;
  expect(reportSchema.safeParse(legacy).success).toBe(true);
});

it("keeps report bytes, limitations, and the durable version when the optional snapshot fails", async () => {
  vi.spyOn(getResearchExtensionRepository(), "update").mockRejectedValue(
    new Error("Extension storage failed"),
  );
  await publish();
  expect(state.task!.reportVersions[0]).toMatchObject({
    evidenceSnapshotStatus: "unavailable",
    gaps: expect.arrayContaining(["Report questions are unavailable."]),
  });
  expect(state.artifact).toContain("Limited material.");
  expect(state.artifact).toContain(
    "Model knowledge; not verified during this research.",
  );
  expect(state.artifact).toContain("## Evidence gaps");
  expect(state.artifact).toContain("Unanswered added question");
  expect(state.artifact).not.toContain("Report questions are unavailable.");
  expect(state.persisted!.reportVersions).toHaveLength(1);
});

it("rejects a swallowed core save failure even if the repository still says durable", async () => {
  state.saveCore = false;
  await expect(publish()).rejects.toThrow("Persistence failed");
  expect(state.persisted!.reportVersions).toHaveLength(0);
  expect(
    await getResearchExtensionRepository().list("evidence_snapshot"),
  ).toEqual([]);
  await expect(publish()).rejects.toThrow("Persistence failed");
  expect(state.task!.reportVersions).toHaveLength(1);
});

it("does not append another version when delivery is retried after a successful commit", async () => {
  await publish();
  await publish();
  expect(state.task!.reportVersions).toHaveLength(1);
  expect(state.publish).toHaveBeenCalledTimes(1);
});

it("does not expose a version if the saved Artifact cannot be read back exactly", async () => {
  const { resolveOPFSBlob } = await import("@/utils/opfs");
  vi.mocked(resolveOPFSBlob).mockResolvedValueOnce(new Blob(["wrong bytes"]));
  await expect(publish()).rejects.toThrow("Persistence failed");
  expect(state.task!.reportVersions).toHaveLength(0);
});

it("removes an unpublished snapshot when cancellation occurs between the two database writes", async () => {
  const controller = new AbortController();
  const unsubscribe = subscribeResearchExtensions(() => controller.abort());
  try {
    await expect(publish(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.task!.reportVersions).toHaveLength(0);
    expect(
      await getResearchExtensionRepository().list("evidence_snapshot"),
    ).toEqual([]);
  } finally {
    unsubscribe();
  }
});
