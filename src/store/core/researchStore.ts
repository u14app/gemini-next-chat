import { create } from "zustand";

import { recoverResearchTask, type ResearchTask } from "@/lib/research";
import { logDevError } from "@/lib/utils/devLogger";
import {
  deleteResearchReportArtifact,
  getResearchTaskRepository,
  pruneUnreferencedResearchStorage,
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
  hydrateTasks: () => Promise<void>;
  loadSessionTasks: (sessionId: string) => Promise<void>;
  removeTask: (taskId: string) => Promise<void>;
  clearSessionTasks: (sessionId: string) => Promise<void>;
}

async function persistRecoveredTasks(
  tasks: ResearchTask[],
  recovered: ResearchTask[],
): Promise<void> {
  await Promise.all(
    recovered.map((task, index) =>
      task === tasks[index]
        ? Promise.resolve()
        : getResearchTaskRepository().save(task),
    ),
  );
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
        await pruneUnreferencedResearchStorage(retainedTasks);
      } catch (error) {
        logDevError("Failed to prune orphaned Research storage", error);
      }
      const recovered = tasks.map((task) => recoverResearchTask(task));
      await persistRecoveredTasks(tasks, recovered);
      set((state) => ({
        tasksById: Object.fromEntries([
          ...Object.entries(state.tasksById),
          ...recovered.map((task) => [task.id, task] as const),
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
      const recovered = tasks.map((task) => recoverResearchTask(task));
      await persistRecoveredTasks(tasks, recovered);
      set((state) => ({
        tasksById: Object.fromEntries([
          ...Object.entries(state.tasksById),
          ...recovered.map((task) => [task.id, task] as const),
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
    const repository = getResearchTaskRepository();
    let removedTask: ResearchTask | undefined = get().tasksById[taskId];
    if (!removedTask) {
      try {
        removedTask = (await repository.get(taskId)) || undefined;
      } catch (error) {
        logDevError("Failed to load research task Artifact references", error);
      }
    }
    set((state) => {
      return {
        tasksById: Object.fromEntries(
          Object.entries(state.tasksById).filter(([id]) => id !== taskId),
        ),
        activeTaskId: state.activeTaskId === taskId ? null : state.activeTaskId,
      };
    });
    try {
      await repository.remove(taskId);
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
  },

  clearSessionTasks: async (sessionId) => {
    const repository = getResearchTaskRepository();
    let removedTasks = Object.values(get().tasksById).filter(
      (task) => task.sessionId === sessionId,
    );
    try {
      const persistedTasks = await repository.list(sessionId);
      removedTasks = Array.from(
        new Map(
          [...removedTasks, ...persistedTasks].map((task) => [task.id, task]),
        ).values(),
      );
    } catch (error) {
      logDevError("Failed to load research task Artifact references", error);
    }
    set((state) => {
      const removedActiveTask = state.activeTaskId
        ? state.tasksById[state.activeTaskId]?.sessionId === sessionId
        : false;
      return {
        tasksById: Object.fromEntries(
          Object.entries(state.tasksById).filter(
            ([, task]) => task.sessionId !== sessionId,
          ),
        ),
        loadedSessionIds: Object.fromEntries(
          Object.entries(state.loadedSessionIds).filter(
            ([id]) => id !== sessionId,
          ),
        ),
        activeTaskId: removedActiveTask ? null : state.activeTaskId,
      };
    });
    try {
      await repository.clearSession(sessionId);
    } catch (error) {
      logDevError("Failed to clear research tasks", error);
      return;
    }
    try {
      await releaseUnreferencedReportArtifacts(
        getReportArtifactUrls(removedTasks),
      );
    } catch (error) {
      logDevError("Failed to release research report Artifacts", error);
    }
  },
}));
