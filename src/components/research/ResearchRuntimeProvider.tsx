"use client";

import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useLocale } from "next-intl";

import type {
  AgentUserInputController,
  ToolConfirmationController,
} from "@/types";
import {
  isTerminalResearchStatus,
  transitionResearchTask,
  type ResearchStrategy,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";

import { usePlanActions } from "@/hooks/research/usePlanActions";
import { usePreparePlan } from "@/hooks/research/usePreparePlan";
import { useResearchExecution } from "@/hooks/research/useResearchExecution";
import { useResearchOperations } from "@/hooks/research/useResearchOperations";
import { useResearchRuntimeText } from "@/hooks/research/useResearchRuntimeText";
import { useResearchTaskActions } from "@/hooks/research/useResearchTaskActions";
import { useResearchToolBridge } from "@/hooks/research/useResearchToolBridge";
import { cancelAllEvidenceAnswers } from "@/lib/research/runtime/evidenceConversation";
import { createAbortError } from "@/lib/research/runtime/operations";

interface ResearchRuntimeProviderProps {
  children: React.ReactNode;
  userInputController: AgentUserInputController;
  toolConfirmationController?: ToolConfirmationController;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}

export interface ResearchRuntimeActions {
  confirmPlan: (taskId: string) => Promise<void>;
  adjustPlan: (taskId: string, instruction: string) => Promise<void>;
  updatePlanStrategy: (
    taskId: string,
    overrides: Partial<ResearchStrategy>,
  ) => Promise<void>;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  continueResearch: (taskId: string, instruction: string) => Promise<void>;
  updateLatest: (taskId: string) => Promise<void>;
}

const ResearchRuntimeContext = createContext<ResearchRuntimeActions | null>(
  null,
);
let mountedRuntimeActions: ResearchRuntimeActions | null = null;

export async function cancelResearchTasksForSession(
  sessionId: string,
): Promise<void> {
  const store = useResearchStore.getState();
  const taskIds = Object.values(store.tasksById)
    .filter(
      (task) =>
        task.sessionId === sessionId && !isTerminalResearchStatus(task.status),
    )
    .map((task) => task.id);
  for (const taskId of taskIds) {
    if (mountedRuntimeActions) {
      await mountedRuntimeActions.cancelTask(taskId);
    } else {
      await store.updateTask(taskId, (task) =>
        isTerminalResearchStatus(task.status)
          ? task
          : transitionResearchTask(task, "cancelled"),
      );
    }
  }
}

export function ResearchRuntimeProvider({
  children,
  userInputController,
  toolConfirmationController,
  onError,
  onNotice,
}: ResearchRuntimeProviderProps) {
  const locale = useLocale();
  const { t, localizedRuntimeError, dependencyText } = useResearchRuntimeText();
  const {
    operationsRef,
    runOperation,
    pauseTask,
    cancelTask,
    claimActiveSlot,
  } = useResearchOperations({ userInputController, t });
  const preparePlan = usePreparePlan({
    runOperation,
    toolConfirmationController,
    t,
    localizedRuntimeError,
    locale,
    onError,
    onNotice,
  });
  const { launchResearch } = useResearchExecution({
    runOperation,
    operationsRef,
    userInputController,
    toolConfirmationController,
    t,
    localizedRuntimeError,
    dependencyText,
    onError,
    onNotice,
  });
  const { confirmPlan, adjustPlan, updatePlanStrategy } = usePlanActions({
    claimActiveSlot,
    dependencyText,
    launchResearch,
    pauseTask,
    preparePlan,
    t,
    onNotice,
  });
  const { retryTask, resumeTask, continueResearch, updateLatest } =
    useResearchTaskActions({
      claimActiveSlot,
      checkpointUnavailableText: dependencyText.checkpointUnavailable,
      launchResearch,
      preparePlan,
      onNotice,
    });

  useResearchToolBridge({
    adjustPlan,
    claimActiveSlot,
    confirmPlan,
    preparePlan,
    locale,
    t,
  });

  useEffect(() => {
    void useResearchStore.getState().hydrateTasks();
  }, []);

  useEffect(() => {
    const pauseActiveResearch = () => {
      cancelAllEvidenceAnswers();
      const taskId = useResearchStore.getState().activeTaskId;
      if (taskId) void pauseTask(taskId);
    };
    window.addEventListener("pagehide", pauseActiveResearch);
    return () => window.removeEventListener("pagehide", pauseActiveResearch);
  }, [pauseTask]);

  useEffect(
    () => () => {
      cancelAllEvidenceAnswers();
      for (const operation of operationsRef.current.values()) {
        operation.controller.abort(createAbortError());
      }
      operationsRef.current.clear();
    },
    [operationsRef],
  );

  const actions = useMemo<ResearchRuntimeActions>(
    () => ({
      confirmPlan,
      adjustPlan,
      updatePlanStrategy,
      pauseTask,
      resumeTask,
      retryTask,
      cancelTask,
      continueResearch,
      updateLatest,
    }),
    [
      adjustPlan,
      cancelTask,
      confirmPlan,
      continueResearch,
      pauseTask,
      retryTask,
      resumeTask,
      updateLatest,
      updatePlanStrategy,
    ],
  );

  useEffect(() => {
    mountedRuntimeActions = actions;
    return () => {
      if (mountedRuntimeActions === actions) mountedRuntimeActions = null;
    };
  }, [actions]);

  return (
    <ResearchRuntimeContext.Provider value={actions}>
      {children}
    </ResearchRuntimeContext.Provider>
  );
}

export function useResearchRuntime(): ResearchRuntimeActions {
  const value = useContext(ResearchRuntimeContext);
  if (!value) {
    throw new Error(
      "useResearchRuntime must be used inside ResearchRuntimeProvider.",
    );
  }
  return value;
}
