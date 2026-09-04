import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createResearchTask,
  transitionResearchTask,
  type ResearchTask,
} from "@/lib/research";

const repository = vi.hoisted(() => ({
  getStatus: () => ({ durable: true, mode: "persistent" }),
  save: vi.fn(async () => undefined),
  list: vi.fn<() => Promise<ResearchTask[]>>(async () => []),
  get: vi.fn<(taskId: string) => Promise<ResearchTask | null>>(
    async () => null,
  ),
  remove: vi.fn(async () => undefined),
  clearSession: vi.fn(async () => undefined),
}));

const deleteResearchReportArtifact = vi.hoisted(() => vi.fn(async () => {}));
const pruneUnreferencedResearchStorage = vi.hoisted(() =>
  vi.fn(async () => {}),
);

vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => repository,
  deleteResearchReportArtifact,
  pruneUnreferencedResearchStorage,
}));

import { useResearchStore } from "@/store/core/researchStore";

describe("researchStore", () => {
  beforeEach(() => {
    repository.save.mockClear();
    repository.list.mockReset();
    repository.list.mockResolvedValue([]);
    repository.get.mockClear();
    repository.get.mockResolvedValue(null);
    repository.remove.mockClear();
    repository.clearSession.mockClear();
    deleteResearchReportArtifact.mockClear();
    pruneUnreferencedResearchStorage.mockClear();
    useResearchStore.setState({
      tasksById: {},
      loadedSessionIds: {},
      hydrated: false,
      activeTaskId: null,
    });
  });

  it("updates live state before persisting", async () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Research",
      now: 100,
    });
    const pending = useResearchStore.getState().upsertTask(task);
    expect(useResearchStore.getState().tasksById[task.id]).toEqual(task);
    await pending;
    expect(repository.save).toHaveBeenCalledWith(task);
  });

  it("hydrates all tasks and pauses non-terminal work", async () => {
    const running = transitionResearchTask(
      transitionResearchTask(
        createResearchTask({
          id: "research-1",
          sessionId: "session-1",
          goal: "Research",
          now: 100,
        }),
        "plan_ready",
        { now: 110 },
      ),
      "researching",
      { now: 120 },
    );
    repository.list.mockResolvedValue([running]);
    repository.get.mockResolvedValue(running);

    await useResearchStore.getState().hydrateTasks();
    expect(pruneUnreferencedResearchStorage).not.toHaveBeenCalled();
    expect(useResearchStore.getState().tasksById[running.id].status).toBe(
      "paused",
    );
    expect(useResearchStore.getState().activeTaskId).toBeNull();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: running.id, status: "paused" }),
    );
  });

  it("loads a session once and clears its tasks", async () => {
    const task = createResearchTask({
      id: "research-1",
      sessionId: "session-1",
      goal: "Research",
      now: 100,
    });
    repository.list.mockResolvedValue([task]);
    repository.get.mockResolvedValue(task);

    await useResearchStore.getState().loadSessionTasks("session-1");
    await useResearchStore.getState().loadSessionTasks("session-1");
    expect(repository.list).toHaveBeenCalledTimes(1);

    useResearchStore.getState().setActiveTask(task.id);
    await useResearchStore.getState().clearSessionTasks("session-1");
    expect(useResearchStore.getState().tasksById).toEqual({});
    expect(useResearchStore.getState().activeTaskId).toBeNull();
    expect(repository.remove).toHaveBeenCalledWith(task.id);
    expect(repository.clearSession).not.toHaveBeenCalled();
  });

  it("releases a shared report Artifact only after its last task is removed", async () => {
    const artifactId = `opfs://chat/research-artifacts/${"a".repeat(64)}.md`;
    const first = {
      ...createResearchTask({
        id: "research-1",
        sessionId: "session-1",
        goal: "Research",
        now: 100,
      }),
      reportVersions: [
        {
          id: "report-1",
          version: 1,
          artifactId,
          planVersion: 1,
          researchRunId: "research-run-1",
          createdAt: 110,
          summary: "Summary",
          keyFindings: [],
          gaps: [],
          kind: "initial" as const,
        },
      ],
    };
    const copied = {
      ...first,
      id: "research-2",
      sessionId: "session-2",
      reportVersions: [{ ...first.reportVersions[0], id: "report-2" }],
    };
    useResearchStore.setState({ tasksById: { [first.id]: first } });
    repository.list.mockResolvedValueOnce([copied]);

    await useResearchStore.getState().removeTask(first.id);
    expect(deleteResearchReportArtifact).not.toHaveBeenCalled();

    useResearchStore.setState({ tasksById: { [copied.id]: copied } });
    repository.list.mockResolvedValueOnce([]);
    await useResearchStore.getState().removeTask(copied.id);
    expect(deleteResearchReportArtifact).toHaveBeenCalledWith(artifactId);
  });
});
