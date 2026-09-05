"use client";

import React, { useMemo } from "react";
import ResearchGlobalBar from "./ResearchGlobalBar";
import {
  getResearchRunResumeDecision,
  isActiveResearchStatus,
} from "@/lib/research/task";
import { openResearchTask } from "@/lib/research/navigation";
import { selectGlobalResearchAttentionTaskId } from "@/lib/research/pendingTask";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { useResearchStore } from "@/store/core/researchStore";
import { useResearchTaskViewModel } from "@/hooks/research/useResearchTaskViewModel";
import { useResearchRuntime } from "./ResearchRuntimeProvider";

export function ConnectedResearchGlobalBar() {
  const activeTaskId = useResearchStore((state) => state.activeTaskId);
  const tasksById = useResearchStore((state) => state.tasksById);
  const visibleTaskId = useMemo(
    () => selectGlobalResearchAttentionTaskId({ tasksById, activeTaskId }),
    [activeTaskId, tasksById],
  );
  const { task, viewModel } = useResearchTaskViewModel(visibleTaskId);
  const runsById = useAgentRunStore((state) => state.runsById);
  const runtime = useResearchRuntime();
  if (!visibleTaskId || !viewModel) return null;
  const resumeDecision = task
    ? getResearchRunResumeDecision(task, runsById)
    : { action: "unavailable" as const };
  if (
    viewModel.status === "paused" &&
    resumeDecision.action === "unavailable"
  ) {
    return null;
  }
  return (
    <ResearchGlobalBar
      task={viewModel}
      onOpenWorkbench={() => openResearchTask(visibleTaskId)}
      onPause={
        isActiveResearchStatus(viewModel.status)
          ? () => void runtime.pauseTask(visibleTaskId)
          : undefined
      }
      onResume={
        viewModel.status === "paused"
          ? () => void runtime.resumeTask(visibleTaskId)
          : undefined
      }
    />
  );
}
