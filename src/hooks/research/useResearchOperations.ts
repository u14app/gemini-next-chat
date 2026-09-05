import {
  isResearchTaskLocallyLocked,
  waitForLocalResearchTaskExecution,
} from "@/services/research/taskExecutionLock";
import { runResearchTaskAction } from "@/lib/research/runtime/taskLifecycle";
import { useCallback, useRef } from "react";
import { v7 as uuidv7 } from "uuid";

import type { AgentUserInputController } from "@/types";
import { applyResearchRunUserStop } from "@/lib/research/orchestration/stopConditions";
import {
  isActiveResearchStatus,
  isTerminalResearchStatus,
  transitionResearchTask,
} from "@/lib/research/task";
import { useResearchStore } from "@/store/core/researchStore";
import { logDevError } from "@/lib/utils/devLogger";

import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import {
  createAbortError,
  isAbortError,
  type RunningOperation,
} from "@/lib/research/runtime/operations";

/**
 * Owns the single-operation-per-task registry: every runtime action goes
 * through `runOperation`, and pause/cancel/slot arbitration read the same map.
 */
export function useResearchOperations({
  userInputController,
  t,
}: {
  userInputController: AgentUserInputController;
  t: ResearchTranslate;
}) {
  const operationsRef = useRef(new Map<string, RunningOperation>());

  const runOperation = useCallback(
    (
      taskId: string,
      kind: RunningOperation["kind"],
      operation: (controller: AbortController) => Promise<void>,
    ) => {
      const existing = operationsRef.current.get(taskId);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const promise = operation(controller)
        .catch((error) => {
          if (!isAbortError(error)) {
            logDevError(`Research ${kind} failed`, error);
          }
          throw error;
        })
        .finally(() => {
          const current = operationsRef.current.get(taskId);
          if (current?.controller === controller) {
            operationsRef.current.delete(taskId);
          }
        });
      operationsRef.current.set(taskId, {
        kind,
        controller,
        promise,
        phase: "idle",
        pauseRequested: false,
      });
      return promise;
    },
    [],
  );

  const pauseTask = useCallback(async (taskId: string) => {
    const store = useResearchStore.getState();
    const task = store.tasksById[taskId];
    if (!task || isTerminalResearchStatus(task.status)) return;
    const operation = operationsRef.current.get(taskId);
    if (!operation || !isResearchTaskLocallyLocked(taskId)) {
      await runResearchTaskAction(taskId, async (current) => {
        if (
          !isTerminalResearchStatus(current.status) &&
          current.status !== "paused"
        )
          await useResearchStore
            .getState()
            .updateTask(taskId, (latest) =>
              transitionResearchTask(latest, "paused"),
            );
      });
      return;
    }
    if (
      operation?.kind === "research" &&
      operation.phase === "tool_execution"
    ) {
      operation.pauseRequested = true;
    } else {
      operation?.controller.abort(
        createAbortError("Research paused by the user."),
      );
    }
    await store.updateTask(taskId, (current) =>
      current.status === "paused" || isTerminalResearchStatus(current.status)
        ? current
        : transitionResearchTask(current, "paused"),
    );
    if (store.activeTaskId === taskId) store.setActiveTask(null);
    await operation?.promise.catch(() => undefined);
    await waitForLocalResearchTaskExecution(taskId);
  }, []);

  const cancelTask = useCallback(async (taskId: string) => {
    const store = useResearchStore.getState();
    const task = store.tasksById[taskId];
    if (
      !task ||
      task.status === "completed" ||
      task.status === "partial_completed" ||
      task.status === "cancelled"
    ) {
      return;
    }
    const operation = operationsRef.current.get(taskId);
    if (!operation || !isResearchTaskLocallyLocked(taskId)) {
      await runResearchTaskAction(taskId, async (current) => {
        if (
          ["completed", "partial_completed", "cancelled"].includes(
            current.status,
          )
        )
          return;
        await useResearchStore.getState().updateTask(taskId, (latest) => ({
          ...transitionResearchTask(latest, "cancelled"),
          reportRuns: latest.reportRuns.map((run) =>
            run.id === latest.activeReportRunId
              ? applyResearchRunUserStop(run, "cancel")
              : run,
          ),
          checkpoint: undefined,
        }));
      });
      return;
    }
    operation?.controller.abort(
      createAbortError("Research cancelled by the user."),
    );
    await store.updateTask(taskId, (current) =>
      current.status === "completed" ||
      current.status === "partial_completed" ||
      current.status === "cancelled"
        ? current
        : {
            ...transitionResearchTask(current, "cancelled"),
            reportRuns: current.reportRuns.map((run) =>
              run.id === current.activeReportRunId
                ? applyResearchRunUserStop(run, "cancel")
                : run,
            ),
            checkpoint: undefined,
          },
    );
    if (store.activeTaskId === taskId) store.setActiveTask(null);
    await operation?.promise.catch(() => undefined);
    await waitForLocalResearchTaskExecution(taskId);
  }, []);

  const claimActiveSlot = useCallback(
    async (sessionId: string, nextTaskId?: string): Promise<boolean> => {
      const store = useResearchStore.getState();
      const activeId =
        store.activeTaskId ||
        [...operationsRef.current.keys()].find(
          (taskId) => taskId !== nextTaskId,
        );
      if (!activeId || activeId === nextTaskId) return true;
      const active = store.tasksById[activeId];
      if (
        !active ||
        (!isActiveResearchStatus(active.status) &&
          !operationsRef.current.has(activeId))
      ) {
        store.setActiveTask(null);
        return true;
      }
      const response = await userInputController.requestInput({
        requestId: uuidv7(),
        toolCallId: `research-slot-${uuidv7()}`,
        sessionId,
        questions: [
          {
            id: "research_slot",
            header: t("global.label"),
            question: t("runtime.slot.question"),
            kind: "single_choice",
            options: [
              {
                value: "pause",
                label: t("runtime.slot.pause"),
                description: t("runtime.slot.pauseDescription"),
              },
              {
                value: "cancel",
                label: t("runtime.slot.cancel"),
                description: t("runtime.slot.cancelDescription"),
              },
              {
                value: "return",
                label: t("runtime.slot.return"),
                description: t("runtime.slot.returnDescription"),
              },
            ],
          },
        ],
      });
      if (response.status !== "answered") return false;
      const decision = response.answers.research_slot;
      if (decision === "pause") await pauseTask(activeId);
      else if (decision === "cancel") await cancelTask(activeId);
      else return false;
      return true;
    },
    [cancelTask, pauseTask, t, userInputController],
  );

  return {
    operationsRef,
    runOperation,
    pauseTask,
    cancelTask,
    claimActiveSlot,
  };
}
