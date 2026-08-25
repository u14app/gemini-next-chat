export const RESEARCH_TASK_NAVIGATE_EVENT = "neo-chat:research-task-navigate";

export interface ResearchTaskNavigationDetail {
  taskId: string;
}

export function openResearchTask(taskId: string): void {
  const normalized = taskId.trim();
  if (!normalized || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ResearchTaskNavigationDetail>(
      RESEARCH_TASK_NAVIGATE_EVENT,
      { detail: { taskId: normalized } },
    ),
  );
}
