import {
  runResearchTaskAction,
  type LaunchResearch,
  type PrepareResearchPlanAction,
} from "@/lib/research/runtime/taskLifecycle";
import { useCallback } from "react";
import { v7 as uuidv7 } from "uuid";

import { DEEP_RESEARCH_INSTRUCTION_MAX_CHARS } from "@/lib/research/toolArguments";
import { getActivePlan } from "@/lib/research/runState";
import {
  isActiveResearchStatus,
  isTerminalResearchStatus,
  transitionResearchTask,
} from "@/lib/research/task";
import { resolveResearchStrategy } from "@/lib/research/orchestration/strategy";
import {
  type ResearchPlanVersion,
  type ResearchSourceSnapshot,
  type ResearchStrategy,
} from "@/lib/research/types";
import { useResearchStore } from "@/store/core/researchStore";

import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import {
  captureApprovedWorkspaceSources,
  createSourceSnapshot,
  resolveResearchTaskModel,
} from "@/lib/research/runtime/sourceSnapshot";
import {
  ResearchModelUnavailableError,
  ResearchWorkspaceUnavailableError,
} from "@/lib/research/runtime/dependencyErrors";
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
  launchResearch: LaunchResearch;
  pauseTask: (taskId: string) => Promise<void>;
  preparePlan: PrepareResearchPlanAction;
  t: ResearchTranslate;
  onNotice?: (message: string) => void;
}) {
  const confirmPlan = useCallback(
    async (taskId: string) => {
      const displayed = useResearchStore.getState().tasksById[taskId];
      const displayedPlanId = displayed
        ? getActivePlan(displayed)?.id
        : undefined;
      return runResearchTaskAction(
        taskId,
        async (task) => {
          const store = useResearchStore.getState();
          if (
            task.status !== "plan_ready" ||
            !displayedPlanId ||
            getActivePlan(task)?.id !== displayedPlanId
          )
            return;
          if (!(await claimActiveSlot(task.sessionId, taskId))) return;
          let sourceSnapshot: ResearchSourceSnapshot;
          try {
            const baseSourceSnapshot =
              task.sourceSnapshot || (await createSourceSnapshot(task));
            const model =
              baseSourceSnapshot.model ||
              (await resolveResearchTaskModel(task));
            if (!model) throw new ResearchModelUnavailableError();
            sourceSnapshot = {
              ...baseSourceSnapshot,
              model,
              workspaceSources: await captureApprovedWorkspaceSources(
                task.sessionId,
                baseSourceSnapshot.toolIds,
              ),
              capturedAt: Date.now(),
            };
          } catch (error) {
            const workspaceUnavailable =
              error instanceof ResearchWorkspaceUnavailableError;
            const dependencyError: ResearchDependencyError = {
              code: workspaceUnavailable
                ? "RESEARCH_WORKSPACE_UNAVAILABLE"
                : "RESEARCH_MODEL_UNAVAILABLE",
              message: workspaceUnavailable
                ? dependencyText.sourceUnavailable("workspace")
                : dependencyText.modelUnavailable,
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
          return {
            run: (lease) => launchResearch(taskId, lease),
            background: true,
          };
        },
        () => onNotice?.(t("runtime.dependency.leaseConflict")),
      );
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
      await runResearchTaskAction(
        taskId,
        async (current) => {
          if (
            isTerminalResearchStatus(current.status) ||
            isActiveResearchStatus(current.status)
          )
            return;
          return {
            run: (lease) => preparePlan(taskId, value, undefined, lease),
          };
        },
        () => onNotice?.(t("runtime.dependency.leaseConflict")),
      );
    },
    [pauseTask, preparePlan, onNotice, t],
  );

  const updatePlanStrategy = useCallback(
    async (taskId: string, overrides: Partial<ResearchStrategy>) =>
      runResearchTaskAction(
        taskId,
        async (task) => {
          const store = useResearchStore.getState();
          const plan = getActivePlan(task);
          if (task.status !== "plan_ready" || !plan) return;
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
        () => onNotice?.(t("runtime.dependency.leaseConflict")),
      ),
    [onNotice, t],
  );

  return { confirmPlan, adjustPlan, updatePlanStrategy };
}
