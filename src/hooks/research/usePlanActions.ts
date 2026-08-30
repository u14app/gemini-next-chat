import { useCallback } from "react";
import { v7 as uuidv7 } from "uuid";

import {
  DEEP_RESEARCH_INSTRUCTION_MAX_CHARS,
  getActivePlan,
  isActiveResearchStatus,
  isTerminalResearchStatus,
  resolveResearchStrategy,
  transitionResearchTask,
  type ResearchPlanVersion,
  type ResearchSourceSnapshot,
  type ResearchStrategy,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";

import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import {
  captureApprovedWorkspaceSources,
  createSourceSnapshot,
} from "@/lib/research/runtime/sourceSnapshot";
import {
  getResearchDependencyError,
  type ResearchDependencyError,
  type ResearchDependencyText,
} from "@/lib/research/runtime/taskContext";

/**
 * The three plan-stage actions exposed to the UI: approve the current plan and
 * start executing, replan from an instruction, or retune its numeric strategy.
 */
export function usePlanActions({
  claimActiveSlot,
  dependencyText,
  launchResearch,
  pauseTask,
  preparePlan,
  t,
  onNotice,
}: {
  claimActiveSlot: (sessionId: string, nextTaskId?: string) => Promise<boolean>;
  dependencyText: ResearchDependencyText;
  launchResearch: (taskId: string) => void;
  pauseTask: (taskId: string) => Promise<void>;
  preparePlan: (
    taskId: string,
    adjustment?: string,
    requestModel?: string,
  ) => Promise<void>;
  t: ResearchTranslate;
  onNotice?: (message: string) => void;
}) {
  const confirmPlan = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (!task || task.status !== "plan_ready" || !getActivePlan(task)) return;
      if (!(await claimActiveSlot(task.sessionId, taskId))) return;
      let sourceSnapshot: ResearchSourceSnapshot;
      try {
        const baseSourceSnapshot =
          task.sourceSnapshot || (await createSourceSnapshot(task));
        sourceSnapshot = {
          ...baseSourceSnapshot,
          workspaceSources: await captureApprovedWorkspaceSources(
            task.sessionId,
            baseSourceSnapshot.toolIds,
          ),
          capturedAt: Date.now(),
        };
      } catch {
        const dependencyError: ResearchDependencyError = {
          code: "RESEARCH_MODEL_UNAVAILABLE",
          message: t("runtime.dependency.modelUnavailable"),
        };
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "paused"),
          error: { ...dependencyError, recoverable: true },
        }));
        onNotice?.(dependencyError.message);
        return;
      }
      const dependencyError = getResearchDependencyError(
        { ...task, sourceSnapshot },
        dependencyText,
      );
      if (dependencyError) {
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "paused"),
          sourceSnapshot,
          error: { ...dependencyError, recoverable: true },
        }));
        onNotice?.(dependencyError.message);
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...transitionResearchTask(current, "researching"),
        sourceSnapshot,
        checkpoint: undefined,
        error: undefined,
      }));
      store.setActiveTask(taskId);
      launchResearch(taskId);
    },
    [claimActiveSlot, dependencyText, launchResearch, onNotice, t],
  );

  const adjustPlan = useCallback(
    async (taskId: string, instruction: string) => {
      const value = instruction
        .trim()
        .slice(0, DEEP_RESEARCH_INSTRUCTION_MAX_CHARS);
      if (!value) return;
      const task = useResearchStore.getState().tasksById[taskId];
      if (!task || isTerminalResearchStatus(task.status)) return;
      if (isActiveResearchStatus(task.status)) await pauseTask(taskId);
      await preparePlan(taskId, value);
    },
    [pauseTask, preparePlan],
  );

  const updatePlanStrategy = useCallback(
    async (taskId: string, overrides: Partial<ResearchStrategy>) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      const plan = task ? getActivePlan(task) : undefined;
      if (!task || task.status !== "plan_ready" || !plan) return;
      const strategy = resolveResearchStrategy(task.budgetPreset, {
        ...plan.strategy,
        ...overrides,
      });
      if (
        (Object.keys(strategy) as Array<keyof ResearchStrategy>).every(
          (key) => strategy[key] === plan.strategy[key],
        )
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => {
        const active = getActivePlan(current);
        if (current.status !== "plan_ready" || !active) return current;
        const version = current.planVersions.length + 1;
        const nextPlan: ResearchPlanVersion = {
          ...active,
          id: uuidv7(),
          version,
          strategy,
          createdAt: Date.now(),
          adjustment: "Approved numeric strategy tuning.",
        };
        return {
          ...current,
          requestedStrategy: strategy,
          planVersions: [...current.planVersions, nextPlan],
          activePlanVersion: version,
          updatedAt: Date.now(),
        };
      });
    },
    [],
  );

  return { confirmPlan, adjustPlan, updatePlanStrategy };
}
