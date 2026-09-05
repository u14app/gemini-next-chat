import { transitionResearchTask } from "@/lib/research/task";
import { useResearchStore } from "@/store/core/researchStore";
import {
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";

/** A failed chunk download never entered the runtime's own failure handler. */
export async function recordResearchModuleLoadFailure({
  taskId,
  phase,
  lease,
  signal,
  message,
}: {
  taskId: string;
  phase: "planning" | "research";
  lease?: ResearchTaskExecutionLease;
  signal: AbortSignal;
  message: string;
}): Promise<boolean> {
  if (signal.aborted) return false;
  const result = await withResearchTaskExecutionLock(
    taskId,
    async () => {
      const store = useResearchStore.getState();
      const task = await store.refreshTask(taskId);
      const allowed =
        phase === "planning"
          ? ["draft", "clarifying", "plan_ready", "failed"]
          : ["researching", "verifying", "synthesizing"];
      if (signal.aborted || !task || !allowed.includes(task.status))
        return false;
      await store.updateTask(taskId, (current) =>
        signal.aborted || !allowed.includes(current.status)
          ? current
          : {
              ...transitionResearchTask(current, "failed"),
              error: {
                code:
                  phase === "planning"
                    ? "RESEARCH_PLAN_FAILED"
                    : "RESEARCH_EXECUTION_FAILED",
                message,
                recoverable: true,
              },
            },
      );
      if (signal.aborted) return false;
      if (useResearchStore.getState().activeTaskId === taskId)
        store.setActiveTask(null);
      return true;
    },
    lease,
  );
  return result.acquired && result.value;
}
