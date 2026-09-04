import type { ResearchTask } from "@/lib/research/types";
import { useResearchStore } from "@/store/core/researchStore";
import { logDevError } from "@/lib/utils/devLogger";
import {
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";

export type LaunchResearch = (
  taskId: string,
  lease?: ResearchTaskExecutionLease,
) => Promise<void>;
export type PrepareResearchPlanAction = (
  taskId: string,
  adjustment?: string,
  requestModel?: string,
  lease?: ResearchTaskExecutionLease,
) => Promise<void>;
export interface ResearchTaskContinuation {
  run: (lease: ResearchTaskExecutionLease) => Promise<void>;
  /** Return the UI/tool action after startup, while retaining its execution lease. */
  background?: boolean;
}

/** Read, validate and mutate the latest persisted task under a single lease. */
export function runResearchTaskAction(
  taskId: string,
  action: (
    task: ResearchTask,
    lease: ResearchTaskExecutionLease,
  ) => Promise<ResearchTaskContinuation | void>,
  onConflict?: () => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    void withResearchTaskExecutionLock(taskId, async (lease) => {
      const task = await useResearchStore.getState().refreshTask(taskId);
      if (!task) return;
      const continuation = await action(task, lease);
      if (!continuation) return;
      const running = continuation.run(lease);
      if (continuation.background) resolve();
      await running;
    }).then(
      (result) => {
        if (!result.acquired) onConflict?.();
        resolve();
      },
      (error) => {
        logDevError("Research task action failed", error);
        reject(error);
      },
    );
  });
}
