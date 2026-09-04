import { afterEach, expect, it, vi } from "vitest";
const stream = vi.hoisted(() =>
  vi.fn(async () => "The saved material is insufficient."),
);
vi.mock("@/services/api/chatService", () => ({ streamChatResponse: stream }));
vi.mock("@/lib/research/runtime/taskContext", () => ({
  resolveTaskContext: () => ({
    model: "test:approved",
    chatConfig: { useSearch: true, useAgentMode: true, useDeepResearch: true },
  }),
}));
import { useResearchStore } from "@/store/core/researchStore";
import { createResearchTask } from "@/lib/research/task";
import { createMemoryResearchExtensionRepository } from "@/services/research/extensionRepository";
import {
  createEvidenceThread,
  saveEvidenceSnapshot,
} from "@/services/research/evidenceConversations";
import { answerEvidenceQuestion } from "@/lib/research/runtime/evidenceConversation";

afterEach(() => useResearchStore.setState({ tasksById: {} }));
it("routes prior turns to the model with all tools, search and memory disabled", async () => {
  const task = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Research",
  });
  task.activeReportVersion = 2;
  task.reportVersions = [1, 2].map((version) => ({
    id: version === 1 ? "report" : "latest-report",
    version,
    artifactId: `opfs://report-${version}`,
    researchRunId: `run-${version}`,
    planVersion: 1,
    createdAt: version,
    summary: `Report v${version}`,
    keyFindings: [],
    gaps: [],
    kind: "initial" as const,
  }));
  useResearchStore.setState({ tasksById: { task } });
  const repository = createMemoryResearchExtensionRepository();
  const snapshot = await saveEvidenceSnapshot(
    {
      schemaVersion: 1,
      id: "report",
      taskId: "task",
      sessionId: "session",
      reportId: "report",
      runId: "run",
      artifactId: "opfs://report",
      reportMarkdown: "Stored v1",
      gaps: [],
      evidence: [],
      claims: [],
      citations: {},
      createdAt: 1,
      origin: "publication",
    },
    repository,
  );
  const topic = await createEvidenceThread(snapshot, "Topic", repository);
  const input = {
    taskId: "task",
    reportId: "report",
    threadId: topic.id,
    question: "First question",
  };
  const lock = async <T>(_id: string, work: () => Promise<T>) => work();
  await answerEvidenceQuestion(input, { repository, lock });
  await answerEvidenceQuestion(
    { ...input, question: "Explain that" },
    { repository, lock },
  );
  const args = (stream.mock.calls as unknown as unknown[][])[1];
  expect(args[1]).toBe("test:approved");
  expect(args[2]).toMatchObject([
    { role: "user", content: "First question" },
    { role: "model" },
  ]);
  expect(args[3]).toContain("Stored v1");
  expect(args[3]).not.toContain("Report v2");
  expect(args[5]).toMatchObject({
    chatMode: "chat",
    useAgentMode: false,
    useDeepResearch: false,
    useSearch: false,
  });
  expect(args[13]).toEqual([]);
  expect(args[17]).toMatchObject({
    disableTools: true,
    disableImageGeneration: true,
    allowedToolIds: [],
    enforceAllowedToolIds: true,
    memoryScopes: [],
  });
});
