import {
  isActiveResearchStatus,
  isTerminalResearchStatus,
} from "@/lib/research/task";
import type { ResearchTask } from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";

/**
 * The task a session's Research UI is currently about: the active task when it
 * belongs to this session and is still live, otherwise the most recently
 * touched live task. Shared so the global bar and the send flow never disagree
 * about which plan a chat reply refers to.
 */
export function selectVisibleResearchTaskId(
  {
    tasksById,
    activeTaskId,
  }: {
    tasksById: Record<string, ResearchTask>;
    activeTaskId: string | null;
  },
  sessionId: string | null | undefined,
): string | null {
  if (!sessionId) return null;
  const active = activeTaskId ? tasksById[activeTaskId] : undefined;
  if (
    active?.sessionId === sessionId &&
    !isTerminalResearchStatus(active.status)
  ) {
    return active.id;
  }
  return (
    Object.values(tasksById)
      .filter(
        (task) =>
          task.sessionId === sessionId &&
          !isTerminalResearchStatus(task.status),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.id ?? null
  );
}

/** The one task that is actively executing, regardless of the visible chat. */
export function selectGlobalActiveResearchTaskId({
  tasksById,
  activeTaskId,
}: {
  tasksById: Record<string, ResearchTask>;
  activeTaskId: string | null;
}): string | null {
  if (!activeTaskId) return null;
  const active = tasksById[activeTaskId];
  return active && isActiveResearchStatus(active.status) ? active.id : null;
}

export function selectGlobalResearchAttentionTaskId({
  tasksById,
  activeTaskId,
}: {
  tasksById: Record<string, ResearchTask>;
  activeTaskId: string | null;
}): string | null {
  const active = selectGlobalActiveResearchTaskId({
    tasksById,
    activeTaskId,
  });
  if (active) return active;
  return (
    Object.values(tasksById)
      .filter(
        (task) =>
          task.status === "paused" &&
          task.checkpoint !== undefined &&
          isActiveResearchStatus(task.checkpoint.resumeStatus),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.id ?? null
  );
}

/**
 * The task whose plan is still awaiting the user's approval, if any. A chat
 * message sent while such a plan is on screen refines that plan instead of
 * starting a second research task.
 */
export function getPendingResearchPlanTaskId(
  sessionId: string | null | undefined,
): string | null {
  const state = useResearchStore.getState();
  const taskId = selectVisibleResearchTaskId(state, sessionId);
  if (!taskId) return null;
  return state.tasksById[taskId]?.status === "plan_ready" ? taskId : null;
}
