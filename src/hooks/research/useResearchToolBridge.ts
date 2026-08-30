import { useEffect } from "react";

import {
  createResearchTask,
  resolveResearchStrategy,
  transitionResearchTask,
  type ResearchTask,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import { useChatStore } from "@/store/core/chatStore";
import {
  getResearchTaskRepository,
  registerResearchToolEmitters,
} from "@/services/research";

import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import { resolveTaskContext } from "@/lib/research/runtime/taskContext";

/**
 * Wires the `deep_research` builtin tool to the runtime actions, so a model
 * turn can start a task and drive its plan through the same code path the UI
 * uses.
 */
export function useResearchToolBridge({
  adjustPlan,
  claimActiveSlot,
  confirmPlan,
  preparePlan,
  t,
}: {
  adjustPlan: (taskId: string, instruction: string) => Promise<void>;
  claimActiveSlot: (sessionId: string, nextTaskId?: string) => Promise<boolean>;
  confirmPlan: (taskId: string) => Promise<void>;
  preparePlan: (
    taskId: string,
    adjustment?: string,
    requestModel?: string,
  ) => Promise<void>;
  t: ResearchTranslate;
}) {
  useEffect(() => {
    const dispose = registerResearchToolEmitters({
      start: async (args, context) => {
        context.signal?.throwIfAborted();
        if (!(await claimActiveSlot(context.sessionId))) {
          throw new Error(t("runtime.error.activeTaskKept"));
        }
        const session = useChatStore
          .getState()
          .sessions.find((item) => item.id === context.sessionId);
        if (!session) throw new Error(t("runtime.error.chatMissing"));
        const budgetPreset = session.config?.researchBudgetPreset || "standard";
        const requestedStrategy = resolveResearchStrategy(
          budgetPreset,
          session.config?.researchStrategy,
        );
        const draftContext = resolveTaskContext(
          {
            ...createResearchTask({
              sessionId: context.sessionId,
              goal: args.query,
              budgetPreset,
              requestedStrategy,
            }),
            sourceSnapshot: undefined,
          },
          context.model,
        );
        const task = createResearchTask({
          sessionId: context.sessionId,
          userMessageId: context.userMessageId,
          cardMessageId: context.modelMessageId,
          goal: args.query,
          budgetPreset,
          requestedStrategy,
          profileBudget: draftContext.effective.agentBudget,
        });
        const withRun = context.agentRunId
          ? { ...task, agentRunIds: [context.agentRunId] }
          : task;
        await useResearchStore.getState().upsertTask(withRun);
        if (!getResearchTaskRepository().getStatus().durable) {
          const failed = {
            ...transitionResearchTask(withRun, "failed"),
            error: {
              code: "RESEARCH_PERSISTENCE_UNAVAILABLE",
              message: t("runtime.error.persistence"),
              recoverable: true,
            },
          };
          await useResearchStore.getState().upsertTask(failed);
          return { taskId: failed.id, status: failed.status };
        }
        void preparePlan(withRun.id, undefined, context.model);
        return { taskId: withRun.id, status: withRun.status };
      },
      adjustPlan: async (args, context) => {
        context.signal?.throwIfAborted();
        let task: ResearchTask | null | undefined =
          useResearchStore.getState().tasksById[args.taskId];
        if (!task) {
          task = await getResearchTaskRepository().get(args.taskId);
          if (task) await useResearchStore.getState().upsertTask(task);
        }
        if (!task || task.sessionId !== context.sessionId) {
          throw new Error(t("runtime.error.taskMissing"));
        }
        await adjustPlan(args.taskId, args.instruction);
        context.signal?.throwIfAborted();
      },
      confirmPlan: async (args, context) => {
        context.signal?.throwIfAborted();
        let task: ResearchTask | null | undefined =
          useResearchStore.getState().tasksById[args.taskId];
        if (!task) {
          task = await getResearchTaskRepository().get(args.taskId);
          if (task) await useResearchStore.getState().upsertTask(task);
        }
        if (!task || task.sessionId !== context.sessionId) {
          throw new Error(t("runtime.error.taskMissing"));
        }
        await confirmPlan(args.taskId);
        context.signal?.throwIfAborted();
      },
    });
    return dispose;
  }, [adjustPlan, claimActiveSlot, confirmPlan, preparePlan, t]);
}
