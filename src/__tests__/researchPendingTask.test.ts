import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createResearchTask,
  transitionResearchTask,
  type ResearchTask,
} from "@/lib/research";

vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => ({
    save: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
  }),
  deleteResearchReportArtifact: vi.fn(async () => {}),
  pruneUnreferencedResearchStorage: vi.fn(async () => {}),
}));

import { useResearchStore } from "@/store/core/researchStore";

import {
  getPendingResearchPlanTaskId,
  selectGlobalActiveResearchTaskId,
  selectVisibleResearchTaskId,
} from "@/lib/research/pendingTask";

function makeTask(
  id: string,
  sessionId: string,
  status: ResearchTask["status"],
  updatedAt: number,
): ResearchTask {
  const task = createResearchTask({
    id,
    sessionId,
    goal: `Goal for ${id}`,
    now: updatedAt,
  });
  let current = task;
  // Walk the real state machine so the fixtures cannot encode an
  // unreachable status.
  for (const next of [
    "clarifying",
    "plan_ready",
    "researching",
    "verifying",
    "synthesizing",
  ] as const) {
    if (current.status === status) break;
    current = transitionResearchTask(current, next, { now: updatedAt });
  }
  return { ...current, updatedAt };
}

describe("pending research plan routing", () => {
  beforeEach(() => {
    useResearchStore.setState({ tasksById: {}, activeTaskId: null });
  });

  it("prefers the active task and otherwise the newest live task", () => {
    const older = makeTask("task-old", "session-1", "researching", 10);
    const newer = makeTask("task-new", "session-1", "plan_ready", 20);
    const otherSession = makeTask("task-other", "session-2", "plan_ready", 30);
    const state = {
      tasksById: {
        [older.id]: older,
        [newer.id]: newer,
        [otherSession.id]: otherSession,
      },
      activeTaskId: null,
    };

    expect(selectVisibleResearchTaskId(state, "session-1")).toBe("task-new");
    expect(
      selectVisibleResearchTaskId(
        { ...state, activeTaskId: "task-old" },
        "session-1",
      ),
    ).toBe("task-old");
    // An active task belonging to another session must not leak across.
    expect(
      selectVisibleResearchTaskId(
        { ...state, activeTaskId: "task-other" },
        "session-1",
      ),
    ).toBe("task-new");
    expect(selectVisibleResearchTaskId(state, undefined)).toBeNull();
  });

  it("routes a reply to the plan only while it awaits approval", () => {
    const planReady = makeTask("task-plan", "session-1", "plan_ready", 20);
    useResearchStore.setState({
      tasksById: { [planReady.id]: planReady },
      activeTaskId: null,
    });
    expect(getPendingResearchPlanTaskId("session-1")).toBe("task-plan");

    // Once the run starts, a reply is an ordinary chat message again.
    const running = makeTask("task-plan", "session-1", "researching", 30);
    useResearchStore.setState({
      tasksById: { [running.id]: running },
      activeTaskId: null,
    });
    expect(getPendingResearchPlanTaskId("session-1")).toBeNull();
    expect(getPendingResearchPlanTaskId("session-2")).toBeNull();
  });

  it("keeps only a globally executing task visible across conversations", () => {
    const runningElsewhere = makeTask(
      "task-running",
      "session-2",
      "researching",
      30,
    );
    const planReadyHere = makeTask("task-plan", "session-1", "plan_ready", 40);
    const state = {
      tasksById: {
        [runningElsewhere.id]: runningElsewhere,
        [planReadyHere.id]: planReadyHere,
      },
      activeTaskId: runningElsewhere.id,
    };

    expect(selectGlobalActiveResearchTaskId(state)).toBe(runningElsewhere.id);
    for (const status of ["verifying", "synthesizing"] as const) {
      const executing = makeTask(`task-${status}`, "session-3", status, 50);
      expect(
        selectGlobalActiveResearchTaskId({
          tasksById: { [executing.id]: executing },
          activeTaskId: executing.id,
        }),
      ).toBe(executing.id);
    }
    expect(
      selectGlobalActiveResearchTaskId({
        ...state,
        activeTaskId: planReadyHere.id,
      }),
    ).toBeNull();
    expect(
      selectGlobalActiveResearchTaskId({ ...state, activeTaskId: null }),
    ).toBeNull();
  });
});
