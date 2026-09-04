import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResearchTask } from "@/lib/research/task";
import {
  createResearchEvidenceSnapshot,
  selectEvidenceConversationHistory,
  validateEvidenceAnswerCitations,
  type ResearchEvidenceSnapshot,
  type ResearchEvidenceThread,
  type ResearchEvidenceTurn,
} from "@/lib/research/evidenceConversations";
import {
  createMemoryResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
  type ResearchExtensionRepository,
} from "@/services/research/extensionRepository";
import {
  createEvidenceThread,
  saveEvidenceSnapshot,
} from "@/services/research/evidenceConversations";
import {
  answerEvidenceQuestion,
  cancelAllEvidenceAnswers,
  getOrCreateEvidenceSnapshot,
} from "@/lib/research/runtime/evidenceConversation";
import { useResearchStore } from "@/store/core/researchStore";
import {
  cloneResearchExtensions,
  pruneResearchExtensions,
} from "@/services/research/extensionLifecycle";
import type {
  ResearchEvidence,
  ResearchReportVersion,
} from "@/lib/research/types";

const evidence: ResearchEvidence = {
  id: "evidence-1",
  sourceId: "source-1",
  sourceType: "web",
  stepId: "step",
  nodeId: "node",
  title: "Original finding",
  locator: "https://example.org/source",
  retrievedAt: 100,
  contentHash: "sha256:original",
  claimIds: [],
  freshness: "current",
};
const report: ResearchReportVersion = {
  id: "report-1",
  version: 1,
  artifactId: "opfs://report-1",
  planVersion: 1,
  researchRunId: "run-1",
  createdAt: 100,
  summary: "Summary",
  keyFindings: [],
  gaps: [],
  kind: "initial",
  evidenceIds: [evidence.id],
};
const task = () => ({
  ...createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Research",
    now: 50,
  }),
  status: "completed" as const,
  evidence: [structuredClone(evidence)],
  reportVersions: [report],
});
const snapshot = (): ResearchEvidenceSnapshot =>
  createResearchEvidenceSnapshot({
    task: task(),
    report,
    markdown:
      "# Report v1\nOriginal conclusion [Source 1](https://example.org/source)",
  });
const lock = async <T>(_id: string, work: () => Promise<T>) => work();
let repository: ResearchExtensionRepository;
beforeEach(() => {
  repository = createMemoryResearchExtensionRepository();
  setResearchExtensionRepositoryForTests(repository);
});
afterEach(() => {
  cancelAllEvidenceAnswers();
  setResearchExtensionRepositoryForTests(undefined);
  useResearchStore.setState({ tasksById: {} });
  vi.restoreAllMocks();
});

async function setup() {
  const scope = await saveEvidenceSnapshot(snapshot(), repository);
  return createEvidenceThread(scope, "Evidence topic", repository);
}
const input = (thread: ResearchEvidenceThread) => ({
  taskId: thread.taskId,
  reportId: thread.reportId,
  threadId: thread.id,
  question: "What does it show?",
});

describe("frozen report conversations", () => {
  it.each(["available", "unavailable"] as const)(
    "does not reconstruct a new %s version whose snapshot is missing",
    async (evidenceSnapshotStatus) => {
      useResearchStore.setState({
        tasksById: {
          task: {
            ...task(),
            reportVersions: [{ ...report, evidenceSnapshotStatus }],
          },
        },
      });
      await expect(
        getOrCreateEvidenceSnapshot("task", report.id),
      ).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
      expect(await repository.list("evidence_snapshot")).toEqual([]);
    },
  );

  it("still reconstructs an old version without snapshot status from that version's evidence", async () => {
    useResearchStore.setState({ tasksById: { task: task() } });
    vi.spyOn(
      await import("@/utils/opfs"),
      "resolveOPFSBlob",
    ).mockResolvedValueOnce(new Blob([snapshot().reportMarkdown]));
    const recovered = await getOrCreateEvidenceSnapshot("task", report.id);
    expect(recovered.origin).toBe("legacy_reconstruction");
    expect(recovered.evidence.map((item) => item.id)).toEqual([evidence.id]);
  });

  it("loads a successful new version's own frozen snapshot", async () => {
    await saveEvidenceSnapshot(snapshot(), repository);
    useResearchStore.setState({
      tasksById: {
        task: {
          ...task(),
          reportVersions: [{ ...report, evidenceSnapshotStatus: "available" }],
        },
      },
    });
    expect(await getOrCreateEvidenceSnapshot("task", report.id)).toMatchObject({
      origin: "publication",
      reportMarkdown: snapshot().reportMarkdown,
    });
  });

  it("rejects direct questions for a version marked unavailable even if an orphan snapshot exists", async () => {
    const thread = await setup();
    useResearchStore.setState({
      tasksById: {
        task: {
          ...task(),
          reportVersions: [
            { ...report, evidenceSnapshotStatus: "unavailable" },
          ],
        },
      },
    });
    const generate = vi.fn(async () => "Not allowed");
    await expect(
      answerEvidenceQuestion(input(thread), { repository, lock, generate }),
    ).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
    expect(generate).not.toHaveBeenCalled();
  });

  it("freezes local citation numbering before report evidence is filtered", () => {
    const local = {
      ...evidence,
      id: "local",
      sourceId: "source-local",
      locator: "workspace://notes.md",
    };
    const scope = createResearchEvidenceSnapshot({
      task: { ...task(), evidence: [evidence, local] },
      report: { ...report, evidenceIds: [local.id] },
      markdown: "A local finding [Source 2]. An unbound label [Source 9].",
    });
    expect(scope.citations["source 2"]).toEqual(["local"]);
    expect(validateEvidenceAnswerCitations("See [Source 2]", scope)).toBe(true);
    expect(validateEvidenceAnswerCitations("See [Source 1]", scope)).toBe(
      false,
    );
    expect(validateEvidenceAnswerCitations("See [Source 9]", scope)).toBe(
      false,
    );
  });
  it("validates decoded Markdown links and never permits image or HTML requests", () => {
    for (const content of [
      "[outside](https&#58;//outside.example/new)",
      "[outside](https\\://outside.example/new)",
      "![image](https&#58;//outside.example/track.png)",
      "<img src='https://example.org/source'>",
      "[outside][ref]\n\n[ref]: https://outside.example/new",
      "https://outside.example/new",
    ])
      expect(validateEvidenceAnswerCitations(content, snapshot())).toBe(false);
    expect(
      validateEvidenceAnswerCitations(
        "[inside](https&#58;//example.org/source)",
        snapshot(),
      ),
    ).toBe(true);
    const scope = snapshot();
    scope.evidence[0].locator = "https://example.org/source_(detail)";
    expect(
      validateEvidenceAnswerCitations(
        "[inside](https://example.org/source_(detail))",
        scope,
      ),
    ).toBe(true);
  });

  it("prunes unpublished snapshots but rechecks a concurrently published report", async () => {
    const current = task();
    const pending = { ...snapshot(), id: "pending", reportId: "pending" };
    await repository.put("evidence_snapshot", "pending", pending, {
      taskId: current.id,
      reportId: "pending",
    });
    await pruneResearchExtensions([current], repository, async () => ({
      ...current,
      reportVersions: [...current.reportVersions, { ...report, id: "pending" }],
    }));
    expect(await repository.get("evidence_snapshot", "pending")).not.toBeNull();
    await pruneResearchExtensions([current], repository);
    expect(await repository.get("evidence_snapshot", "pending")).toBeNull();
  });
  it("freezes evidence values and never replaces an existing report snapshot", async () => {
    const current = task();
    const original = createResearchEvidenceSnapshot({
      task: current,
      report,
      markdown: "Original",
    });
    current.evidence[0].freshness = "stale";
    current.evidence[0].title = "Updated";
    expect(original.evidence[0].freshness).toBe("current");
    await saveEvidenceSnapshot(original, repository);
    const saved = await saveEvidenceSnapshot(
      { ...original, reportMarkdown: "Changed", evidence: current.evidence },
      repository,
    );
    expect(saved.reportMarkdown).toBe("Original");
    expect(saved.evidence[0].title).toBe("Original finding");
    await expect(
      saveEvidenceSnapshot(
        { ...original, artifactId: "opfs://different" },
        repository,
      ),
    ).rejects.toThrow("identity changed");
  });

  it("does not reconstruct legacy evidence from unrelated task records", () => {
    const current = task();
    current.evidence.push({
      ...evidence,
      id: "unrelated",
      sourceId: "source-other",
    });
    const scope = createResearchEvidenceSnapshot({
      task: current,
      report: { ...report, evidenceIds: undefined },
      markdown: "No explicit relationships",
      origin: "legacy_reconstruction",
    });
    expect(scope.evidence).toEqual([]);
  });

  it("carries completed history only within the selected topic and version", async () => {
    const thread = await setup();
    const other = await createEvidenceThread(
      snapshot(),
      "Another topic",
      repository,
    );
    const generate = vi
      .fn()
      .mockResolvedValue("It supports the finding [source-1].");
    await answerEvidenceQuestion(input(thread), { repository, generate, lock });
    await answerEvidenceQuestion(
      { ...input(thread), question: "Why does that matter?" },
      { repository, generate, lock },
    );
    expect(
      selectEvidenceConversationHistory(generate.mock.calls[1][0].thread.turns),
    ).toHaveLength(1);
    expect(generate.mock.calls[1][0].snapshot.reportMarkdown).toContain(
      "Report v1",
    );
    await answerEvidenceQuestion(input(other), { repository, generate, lock });
    expect(
      selectEvidenceConversationHistory(generate.mock.calls[2][0].thread.turns),
    ).toEqual([]);
    await expect(
      answerEvidenceQuestion(
        { ...input(thread), reportId: "report-2" },
        { repository, generate, lock },
      ),
    ).rejects.toThrow("REPORT_UNAVAILABLE");
  });

  it("rejects citations outside the frozen source index and permits retry", async () => {
    const thread = await setup();
    await expect(
      answerEvidenceQuestion(input(thread), {
        repository,
        generate: async () => "See https://unrelated.example/new",
        lock,
      }),
    ).rejects.toThrow("INVALID_CITATION");
    const saved = (await repository.get<ResearchEvidenceThread>(
      "evidence_thread",
      thread.id,
    ))!;
    expect(saved.turns[0]).toMatchObject({
      status: "failed",
      answer: "",
      errorCode: "INVALID_CITATION",
    });
    await answerEvidenceQuestion(
      { ...input(thread), retryTurnId: saved.turns[0].id },
      {
        repository,
        generate: async () => "The saved material is insufficient.",
        lock,
      },
    );
    expect(
      (await repository.get<ResearchEvidenceThread>(
        "evidence_thread",
        thread.id,
      ))!.turns,
    ).toHaveLength(1);
    expect(
      validateEvidenceAnswerCitations("Unknown [source-other]", snapshot()),
    ).toBe(false);
    expect(
      validateEvidenceAnswerCitations("Unknown [Source 99]", snapshot()),
    ).toBe(false);
  });

  it("prevents concurrent answers and cannot resurrect a topic deleted during generation", async () => {
    const thread = await setup();
    let finish!: (value: string) => void;
    const generate = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const answering = answerEvidenceQuestion(input(thread), {
      repository,
      generate,
      lock,
    });
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    await expect(
      answerEvidenceQuestion(input(thread), { repository, generate, lock }),
    ).rejects.toThrow("ANSWER_BUSY");
    await repository.remove("evidence_thread", thread.id);
    finish("Late answer");
    await answering;
    expect(await repository.get("evidence_thread", thread.id)).toBeNull();
  });

  it("trims history in complete turns and excludes failed partial responses", () => {
    const turn: ResearchEvidenceTurn = {
      id: "turn",
      requestId: "request",
      question: "12345",
      answer: "67890",
      status: "completed",
      createdAt: 10,
    };
    const turns = [
      turn,
      { ...turn, id: "partial", status: "failed" as const },
      { ...turn, id: "last" },
    ];
    expect(
      selectEvidenceConversationHistory(turns, 15).map((item) => item.id),
    ).toEqual(["last"]);
  });

  it("copies historical evidence and topics with new identities, then prunes only orphans", async () => {
    const source = task();
    const thread = await setup();
    await repository.update<ResearchEvidenceThread>(
      "evidence_thread",
      thread.id,
      (value) => ({
        ...value!,
        turns: [
          {
            id: "turn",
            requestId: "request",
            question: "Question",
            answer: "Partial",
            status: "generating",
            createdAt: 100,
          },
        ],
      }),
    );
    source.evidence[0].freshness = "stale";
    const target = {
      ...source,
      id: "copy",
      sessionId: "session-copy",
      evidence: [{ ...source.evidence[0], id: "evidence-copy" }],
      reportVersions: [
        {
          ...report,
          id: "report-copy",
          artifactId: "opfs://copy",
          researchRunId: "run-copy",
        },
      ],
    };
    await cloneResearchExtensions(source, target, repository);
    const copied = (await repository.get<ResearchEvidenceSnapshot>(
      "evidence_snapshot",
      "report-copy",
    ))!;
    expect(copied.evidence[0]).toMatchObject({
      id: "evidence-copy",
      freshness: "current",
    });
    expect(copied.citations["source 1"]).toEqual(["evidence-copy"]);
    const topics = await repository.list<ResearchEvidenceThread>(
      "evidence_thread",
      { taskId: "copy" },
    );
    expect(topics[0].value).toMatchObject({
      reportId: "report-copy",
      turns: [{ status: "interrupted" }],
    });
    expect(topics[0].value.id).not.toBe(thread.id);
    await repository.put("template", "library", { name: "Reusable" });
    await pruneResearchExtensions([target], repository);
    expect(await repository.get("evidence_snapshot", "report-1")).toBeNull();
    expect(await repository.get("template", "library")).not.toBeNull();
  });
});
