import {
  withResearchTaskExecutionLock,
  isResearchTaskLocallyLocked,
} from "@/services/research/taskExecutionLock";
import { create } from "zustand";

import { recoverResearchTask } from "@/lib/research/task";
import { type ResearchTask } from "@/lib/research/types";
import { logDevError } from "@/lib/utils/devLogger";
import { getResearchExtensionRepository } from "@/services/research/extensionRepository";
import { pruneResearchExtensions } from "@/services/research/extensionLifecycle";
import {
  deleteResearchReportArtifact,
  getResearchTaskRepository,
} from "@/services/research";

interface ResearchState {
  tasksById: Record<string, ResearchTask>;
  loadedSessionIds: Record<string, true>;
  hydrated: boolean;
  activeTaskId: string | null;
  setActiveTask: (taskId: string | null) => void;
  upsertTask: (task: ResearchTask) => Promise<void>;
  updateTask: (
    taskId: string,
    update: (task: ResearchTask) => ResearchTask,
  ) => Promise<ResearchTask | null>;
  /** Refresh the local view without writing it back; callers own any execution lease. */
  refreshTask: (taskId: string) => Promise<ResearchTask | null>;
  hydrateTasks: () => Promise<void>;
  loadSessionTasks: (sessionId: string) => Promise<void>;
  removeTask: (taskId: string) => Promise<void>;
  clearSessionTasks: (sessionId: string) => Promise<void>;
}

async function recoverPersistedTasks(
  tasks: ResearchTask[],
): Promise<ResearchTask[]> {
  const repository = getResearchTaskRepository();
  const loaded = await Promise.all(
    tasks.map(async (listed) => {
      const result = await withResearchTaskExecutionLock(
        listed.id,
        async () => {
          const current = await repository.get(listed.id);
          if (!current) return null;
          const recovered = recoverResearchTask(current);
          if (recovered !== current) await repository.save(recovered);
          return recovered;
        },
      );
      // Another tab owns live execution: observe its state without recovery writes.
      return result.acquired ? result.value : await repository.get(listed.id);
    }),
  );
  return loaded.filter((task): task is ResearchTask => Boolean(task));
}

function getReportArtifactUrls(tasks: Iterable<ResearchTask>): Set<string> {
  return new Set(
    [...tasks].flatMap((task) =>
      task.reportVersions.map((report) => report.artifactId),
    ),
  );
}

async function releaseUnreferencedReportArtifacts(
  candidates: Iterable<string>,
): Promise<void> {
  const remainingTasks = await getResearchTaskRepository().list();
  const retainedUrls = getReportArtifactUrls(remainingTasks);
  await Promise.all(
    [...new Set(candidates)]
      .filter((url) => !retainedUrls.has(url))
      .map((url) => deleteResearchReportArtifact(url)),
  );
}

export const useResearchStore = create<ResearchState>((set, get) => ({
  tasksById: {},
  loadedSessionIds: {},
  hydrated: false,
  activeTaskId: null,

  setActiveTask: (taskId) => set({ activeTaskId: taskId }),

  upsertTask: async (task) => {
    set((state) => ({
      tasksById: { ...state.tasksById, [task.id]: task },
    }));
    try {
      await getResearchTaskRepository().save(task);
    } catch (error) {
      logDevError("Failed to persist research task", error);
    }
  },

  updateTask: async (taskId, update) => {
    const current = get().tasksById[taskId];
    if (!current) return null;
    const next = update(current);
    await get().upsertTask(next);
    return next;
  },

  refreshTask: async (taskId) => {
    const beforeRead = get().tasksById[taskId];
    const repository = getResearchTaskRepository();
    const wasDurable = repository.getStatus().durable;
    const persisted = await repository.get(taskId);
    if (wasDurable && !repository.getStatus().durable)
      throw new Error(
        "Research task storage became unavailable during refresh.",
      );
    // A local owner may pause/cancel while this IDB read is pending. Preserve
    // that newer control write instead of resurrecting the pre-stop snapshot.
    const current = get().tasksById[taskId];
    if (isResearchTaskLocallyLocked(taskId) && current !== beforeRead)
      return current ?? null;
    const task =
      persisted ??
      (!repository.getStatus().durable
        ? (get().tasksById[taskId] ?? null)
        : null);
    set((state) => ({
      tasksById: task
        ? { ...state.tasksById, [taskId]: task }
        : Object.fromEntries(
            Object.entries(state.tasksById).filter(([id]) => id !== taskId),
          ),
    }));
    return task;
  },

  hydrateTasks: async () => {
    if (get().hydrated) return;
    try {
      const tasks = await getResearchTaskRepository().list();
      try {
        const retainedTasks = Array.from(
          new Map(
            [...tasks, ...Object.values(get().tasksById)].map((task) => [
              task.id,
              task,
            ]),
          ).values(),
        );
        // Global OPFS pruning needs a maintenance lock shared by every writer.
        // Hydration may overlap another tab's artifact/checkpoint publication;
        // retain those files here and clean references on explicit task deletion.
        if (getResearchTaskRepository().getStatus().durable) {
          await pruneResearchExtensions(
            retainedTasks,
            getResearchExtensionRepository(),
            async (taskId) => {
              const repository = getResearchTaskRepository();
              const current = await repository.get(taskId);
              if (!repository.getStatus().durable)
                throw new Error(
                  "Research storage is unavailable during cleanup.",
                );
              return current;
            },
          );
        }
      } catch (error) {
        logDevError("Failed to prune orphaned Research storage", error);
      }
      const recovered = await recoverPersistedTasks(tasks);
      set((state) => ({
        tasksById: Object.fromEntries([
          ...Object.entries(state.tasksById),
          ...recovered
            .filter((task) => !isResearchTaskLocallyLocked(task.id))
            .map((task) => [task.id, task] as const),
        ]),
        loadedSessionIds: Object.fromEntries([
          ...Object.entries(state.loadedSessionIds),
          ...recovered.map((task) => [task.sessionId, true] as const),
        ]),
        hydrated: true,
        activeTaskId: null,
      }));
    } catch (error) {
      logDevError("Failed to hydrate research tasks", error);
    }
  },

  loadSessionTasks: async (sessionId) => {
    if (!sessionId || get().loadedSessionIds[sessionId]) return;
    try {
      const tasks = await getResearchTaskRepository().list(sessionId);
      const recovered = await recoverPersistedTasks(tasks);
      set((state) => ({
        tasksById: Object.fromEntries([
          ...Object.entries(state.tasksById),
          ...recovered
            .filter((task) => !isResearchTaskLocallyLocked(task.id))
            .map((task) => [task.id, task] as const),
        ]),
        loadedSessionIds: {
          ...state.loadedSessionIds,
          [sessionId]: true,
        },
      }));
    } catch (error) {
      logDevError("Failed to load research tasks", error);
    }
  },

  removeTask: async (taskId) => {
    await withResearchTaskExecutionLock(taskId, async () => {
      const { cancelAllEvidenceAnswers } =
        await import("@/lib/research/runtime/evidenceConversation");
      cancelAllEvidenceAnswers(taskId);
      const repository = getResearchTaskRepository();
      let removedTask: ResearchTask | undefined;
      try {
        removedTask = (await repository.get(taskId)) || get().tasksById[taskId];
      } catch (error) {
        logDevError("Failed to load research task Artifact references", error);
        return;
      }
      set((state) => {
        return {
          tasksById: Object.fromEntries(
            Object.entries(state.tasksById).filter(([id]) => id !== taskId),
          ),
          activeTaskId:
            state.activeTaskId === taskId ? null : state.activeTaskId,
        };
      });
      try {
        await repository.remove(taskId);
        if (repository.getStatus().durable)
          await getResearchExtensionRepository().removeTask(taskId);
      } catch (error) {
        logDevError("Failed to remove research task", error);
        return;
      }
      if (removedTask) {
        try {
          await releaseUnreferencedReportArtifacts(
            getReportArtifactUrls([removedTask]),
          );
        } catch (error) {
          logDevError("Failed to release research report Artifacts", error);
        }
      }
    });
  },

  clearSessionTasks: async (sessionId) => {
    const repository = getResearchTaskRepository();
    const persisted = await repository.list(sessionId);
    const candidates = new Map(
      [
        ...Object.values(get().tasksById).filter(
          (task) => task.sessionId === sessionId,
        ),
        ...persisted,
      ].map((task) => [task.id, task]),
    );
    // Do not issue clearSession: a different tab may own one of these tasks or
    // create another task while this list is being processed.
    await Promise.all(
      [...candidates.keys()].map((taskId) => get().removeTask(taskId)),
    );
    set((state) => ({
      loadedSessionIds: Object.fromEntries(
        Object.entries(state.loadedSessionIds).filter(
          ([id]) => id !== sessionId,
        ),
      ),
    }));
  },
}));
