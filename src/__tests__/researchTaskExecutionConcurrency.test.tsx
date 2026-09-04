// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResearchTask,
  ResearchSourceSnapshot,
  ResearchPlanVersion,
} from "@/lib/research";
const data = vi.hoisted(() => ({
  tasks: new Map<string, ResearchTask>(),
  saves: vi.fn(),
  list: vi.fn(),
  capture: vi.fn(),
  pruneFiles: vi.fn(),
  deleteArtifact: vi.fn(),
}));
const repository = vi.hoisted(() => ({
  getStatus: () => ({ durable: true, mode: "persistent" }),
  get: vi.fn(async (id: string) => structuredClone(data.tasks.get(id) ?? null)),
  save: async (task: ResearchTask) => {
    data.saves(structuredClone(task));
    data.tasks.set(task.id, structuredClone(task));
  },
  list: async (sessionId?: string) =>
    data.list(sessionId) ??
    structuredClone(
      [...data.tasks.values()].filter(
        (task) => !sessionId || task.sessionId === sessionId,
      ),
    ),
  remove: vi.fn(async (id: string) => {
    data.tasks.delete(id);
  }),
}));
vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => repository,
  deleteResearchReportArtifact: data.deleteArtifact,
  pruneUnreferencedResearchStorage: data.pruneFiles,
}));
vi.mock("@/services/research/runtime", () => ({
  getResearchTaskRepository: () => repository,
}));
vi.mock("@/lib/research/runtime/sourceSnapshot", () => ({
  captureApprovedWorkspaceSources: data.capture,
  createSourceSnapshot: vi.fn(),
}));
vi.mock("@/lib/research/runtime/taskContext", () => ({
  getResearchDependencyError: vi.fn(() => undefined),
}));
vi.mock("@/lib/research/runtime/evidenceConversation", () => ({
  cancelAllEvidenceAnswers: vi.fn(),
}));
vi.mock("@/services/research/extensionLifecycle", () => ({
  pruneResearchExtensions: vi.fn(),
}));
import { createResearchTask } from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import { useResearchOperations } from "@/hooks/research/useResearchOperations";
import { runResearchTaskAction } from "@/lib/research/runtime/taskLifecycle";
import { useResearchTaskActions } from "@/hooks/research/useResearchTaskActions";
import { usePlanActions } from "@/hooks/research/usePlanActions";
import {
  isResearchTaskExecutionLease,
  isResearchTaskLocallyLocked,
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";
import {
  createMemoryResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
} from "@/services/research/extensionRepository";

const browserLocks = new Set<string>();
const lockRequest = vi.fn(
  async (
    name: string,
    _options: unknown,
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ) => {
    if (browserLocks.has(name)) return callback(null);
    browserLocks.add(name);
    try {
      return await callback({ name });
    } finally {
      browserLocks.delete(name);
    }
  },
);
function task(status: ResearchTask["status"]): ResearchTask {
  const base = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Review",
    now: 1,
  });
  return {
    ...base,
    status,
    activePlanVersion: 1,
    requestedStrategy: {
      initialBreadth: 2,
      maxDepth: 2,
      maxQueries: 6,
      resultsPerQuery: 5,
    },
    planVersions: [
      {
        id: "plan",
        version: 1,
        strategy: {
          initialBreadth: 2,
          maxDepth: 2,
          maxQueries: 6,
          resultsPerQuery: 5,
        },
        steps: [],
      } as unknown as ResearchPlanVersion,
    ],
    sourceSnapshot: {
      model: "provider:model",
      pluginIds: [],
      toolIds: [],
    } as unknown as ResearchSourceSnapshot,
    checkpoint: {
      createdAt: 2,
      resumeStatus: "researching",
      committedEvidenceIds: [],
      committedToolExecutionIds: [],
    },
  };
}
function latestReport(): ResearchTask {
  return {
    ...task("completed"),
    updatedAt: 50,
    checkpoint: undefined,
    reportVersions: [
      {
        id: "new-report",
        researchRunId: "latest-run",
        version: 2,
        artifactId: "opfs://latest",
        planVersion: 1,
        createdAt: 50,
        summary: "Latest report",
        keyFindings: ["Latest evidence"],
        gaps: [],
        kind: "initial",
      },
    ],
  };
}
function hydrateLocal(value: ResearchTask) {
  useResearchStore.setState({
    tasksById: { task: value },
    hydrated: true,
    loadedSessionIds: { session: true },
  });
}
function dependencies(
  launchResearch = vi.fn<
    (id: string, lease?: ResearchTaskExecutionLease) => Promise<void>
  >(async () => {}),
) {
  return {
    claimActiveSlot: vi.fn(async () => true),
    checkpointUnavailableText: "Unavailable",
    launchResearch,
    preparePlan: vi.fn(async () => {}),
    onNotice: vi.fn(),
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  data.tasks.clear();
  data.saves.mockClear();
  data.list.mockReset();
  data.capture.mockReset().mockResolvedValue([]);
  data.pruneFiles.mockReset();
  data.deleteArtifact.mockReset();
  repository.get.mockClear();
  repository.remove.mockClear();
  browserLocks.clear();
  lockRequest.mockClear();
  vi.stubGlobal("navigator", { locks: { request: lockRequest } });
  setResearchExtensionRepositoryForTests(
    createMemoryResearchExtensionRepository(),
  );
  useResearchStore.setState({
    tasksById: {},
    loadedSessionIds: {},
    hydrated: false,
    activeTaskId: null,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setResearchExtensionRepositoryForTests(undefined);
});

describe("fresh task ownership across tabs", () => {
  it("does not let an old paused tab overwrite a completed newer report on Resume", async () => {
    const latest = latestReport();
    data.tasks.set("task", latest);
    hydrateLocal(task("paused"));
    const deps = dependencies();
    const { result } = renderHook(() => useResearchTaskActions(deps));
    await act(() => result.current.resumeTask("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(
      useResearchStore.getState().tasksById.task.reportVersions[0].id,
    ).toBe("new-report");
  });
  it("does not let an old plan-ready tab overwrite a completed report on Confirm", async () => {
    const latest = latestReport();
    data.tasks.set("task", latest);
    hydrateLocal(task("plan_ready"));
    const deps = {
      ...dependencies(),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));
    await act(() => result.current.confirmPlan("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.capture).not.toHaveBeenCalled();
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
  });
  it("does not approve a new plan revision the stale tab has not displayed", async () => {
    const old = task("plan_ready");
    const latest = {
      ...old,
      activePlanVersion: 2,
      planVersions: [
        ...old.planVersions,
        { ...old.planVersions[0], id: "new-plan", version: 2 },
      ],
    };
    data.tasks.set("task", latest);
    hydrateLocal(old);
    const deps = {
      ...dependencies(),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));
    await act(() => result.current.confirmPlan("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(useResearchStore.getState().tasksById.task.activePlanVersion).toBe(
      2,
    );
  });

  it("performs no Resume write while a different tab owns execution", async () => {
    const latest = task("researching");
    latest.updatedAt = 30;
    data.tasks.set("task", latest);
    hydrateLocal(task("paused"));
    browserLocks.add("research-execution:task");
    const deps = dependencies();
    const { result } = renderHook(() => useResearchTaskActions(deps));
    await act(() => result.current.resumeTask("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
  });
  it("hands Resume the same lease and retains ownership after the UI action returns", async () => {
    const saved = task("paused");
    data.tasks.set("task", saved);
    hydrateLocal(saved);
    const finished = deferred();
    let lease: ResearchTaskExecutionLease | undefined;
    const launch = vi.fn(
      async (_id: string, owned?: ResearchTaskExecutionLease) => {
        lease = owned;
        await withResearchTaskExecutionLock(
          "task",
          async (inner) => {
            expect(inner).toBe(owned);
            expect(data.tasks.get("task")?.status).toBe("researching");
            await finished.promise;
          },
          owned,
        );
      },
    );
    const { result } = renderHook(() =>
      useResearchTaskActions(dependencies(launch)),
    );
    await act(() => result.current.resumeTask("task"));
    expect(launch).toHaveBeenCalledOnce();
    expect(isResearchTaskExecutionLease(lease, "task")).toBe(true);
    expect(lockRequest).toHaveBeenCalledOnce();
    const unrelated = vi.fn(async () => {});
    expect(await withResearchTaskExecutionLock("task", unrelated)).toEqual({
      acquired: false,
    });
    expect(unrelated).not.toHaveBeenCalled();
    finished.resolve();
    await waitFor(() =>
      expect(isResearchTaskLocallyLocked("task")).toBe(false),
    );
    expect(isResearchTaskExecutionLease(lease, "task")).toBe(false);
    await expect(
      withResearchTaskExecutionLock("task", unrelated, lease),
    ).rejects.toThrow(/no longer valid/);
  });
  it("holds Confirm's capture, state write and continuation in one browser lock", async () => {
    const saved = task("plan_ready");
    data.tasks.set("task", saved);
    hydrateLocal(saved);
    const finished = deferred();
    data.capture.mockImplementation(async () => {
      expect(browserLocks.has("research-execution:task")).toBe(true);
      return [];
    });
    const launch = vi.fn(
      async (_id: string, lease?: ResearchTaskExecutionLease) => {
        expect(isResearchTaskExecutionLease(lease, "task")).toBe(true);
        await finished.promise;
      },
    );
    const deps = {
      ...dependencies(launch),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));
    await act(() => result.current.confirmPlan("task"));
    expect(data.tasks.get("task")?.status).toBe("researching");
    expect(lockRequest).toHaveBeenCalledOnce();
    expect(isResearchTaskLocallyLocked("task")).toBe(true);
    finished.resolve();
    await waitFor(() =>
      expect(isResearchTaskLocallyLocked("task")).toBe(false),
    );
  });
  it("loads another tab's active task without writing a recovery checkpoint", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    browserLocks.add("research-execution:task");
    await useResearchStore.getState().hydrateTasks();
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.pruneFiles).not.toHaveBeenCalled();
    expect(data.deleteArtifact).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(active);
    expect(useResearchStore.getState().tasksById.task.status).toBe(
      "researching",
    );
  });
  it("re-reads under the recovery lock instead of saving a stale list result", async () => {
    const latest = latestReport();
    data.tasks.set("task", latest);
    data.list.mockReturnValue([task("researching")]);
    await useResearchStore.getState().loadSessionTasks("session");
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
    expect(
      useResearchStore.getState().tasksById.task.reportVersions[0].id,
    ).toBe("new-report");
  });
  it("recovers an orphaned active task only when no executor owns it", async () => {
    data.tasks.set("task", task("researching"));
    await useResearchStore.getState().hydrateTasks();
    expect(data.tasks.get("task")?.status).toBe("paused");
    expect(data.saves).toHaveBeenCalledOnce();
    expect(lockRequest).toHaveBeenCalledOnce();
  });
  it("does not resurrect a local cancellation when an earlier persisted read finishes late", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    hydrateLocal(active);
    const readFinished = deferred();
    repository.get.mockImplementationOnce(async () => {
      await readFinished.promise;
      return structuredClone(active);
    });
    await withResearchTaskExecutionLock("task", async () => {
      const refresh = useResearchStore.getState().refreshTask("task");
      await useResearchStore
        .getState()
        .updateTask("task", (current) => ({ ...current, status: "cancelled" }));
      readFinished.resolve();
      expect((await refresh)?.status).toBe("cancelled");
      expect(useResearchStore.getState().tasksById.task.status).toBe(
        "cancelled",
      );
    });
    expect(data.tasks.get("task")?.status).toBe("cancelled");
  });

  it("waits for the outer local lease before cancel returns so immediate deletion succeeds", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    hydrateLocal(active);
    const nativeRelease = deferred();
    const callbackFinished = deferred();
    lockRequest.mockImplementationOnce(async (name, _options, callback) => {
      browserLocks.add(name);
      try {
        const value = await callback({ name });
        callbackFinished.resolve();
        await nativeRelease.promise;
        return value;
      } finally {
        browserLocks.delete(name);
      }
    });
    const { result } = renderHook(() =>
      useResearchOperations({
        userInputController: { requestInput: vi.fn() } as unknown as Parameters<
          typeof useResearchOperations
        >[0]["userInputController"],
        t: ((key: string) => key) as Parameters<
          typeof useResearchOperations
        >[0]["t"],
      }),
    );
    await act(() =>
      runResearchTaskAction("task", async () => ({
        background: true,
        run: () =>
          result.current.runOperation(
            "task",
            "research",
            (controller) =>
              new Promise<void>((resolve) =>
                controller.signal.addEventListener("abort", () => resolve(), {
                  once: true,
                }),
              ),
          ),
      })),
    );
    expect(isResearchTaskLocallyLocked("task")).toBe(true);
    await act(async () => {
      let cancelReturned = false;
      const stopping = result.current.cancelTask("task").then(() => {
        cancelReturned = true;
      });
      await callbackFinished.promise;
      expect(cancelReturned).toBe(false);
      expect(isResearchTaskLocallyLocked("task")).toBe(true);
      nativeRelease.resolve();
      await stopping;
      expect(isResearchTaskLocallyLocked("task")).toBe(false);
      await useResearchStore.getState().removeTask("task");
    });
    expect(repository.remove).toHaveBeenCalledWith("task");
    expect(data.tasks.has("task")).toBe(false);
    expect(useResearchStore.getState().tasksById.task).toBeUndefined();
  });

  it("does not delete an active other-tab task during session cleanup", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    hydrateLocal(active);
    browserLocks.add("research-execution:task");
    await useResearchStore.getState().clearSessionTasks("session");
    expect(repository.remove).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(active);
    expect(useResearchStore.getState().tasksById.task).toEqual(active);
  });
});
