import {
  getCurrentResearchReportRunIds,
  type ResearchTask,
} from "@/lib/research";
import { useAgentRunStore } from "@/store/core/agentRunStore";

export function aggregateExecutionUsage(runIds: string[]) {
  const runs = useAgentRunStore.getState().runsById;
  return runIds.reduce(
    (usage, runId) => {
      const run = runs[runId];
      if (!run) return usage;
      usage.toolRounds += run.usage.toolRounds;
      usage.toolCalls += run.usage.toolCalls;
      usage.wallTimeMs += run.usage.wallTimeMs;
      usage.totalTokens += run.usage.totalTokens;
      return usage;
    },
    { toolRounds: 0, toolCalls: 0, wallTimeMs: 0, totalTokens: 0 },
  );
}

export function aggregateTaskUsage(task: ResearchTask) {
  return aggregateExecutionUsage(task.executionRunIds);
}

export function remainingBudget(task: ResearchTask) {
  const currentRunUsage = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(task),
  );
  const maxToolRounds = task.budget.maxToolRounds - currentRunUsage.toolRounds;
  const maxToolCalls = task.budget.maxToolCalls - currentRunUsage.toolCalls;
  const maxDurationMs = task.budget.maxDurationMs - currentRunUsage.wallTimeMs;
  const maxTotalTokens = task.budget.maxTotalTokens
    ? task.budget.maxTotalTokens - currentRunUsage.totalTokens
    : undefined;
  if (
    maxToolRounds <= 0 ||
    maxToolCalls <= 0 ||
    maxDurationMs <= 0 ||
    (maxTotalTokens !== undefined && maxTotalTokens <= 0)
  ) {
    return null;
  }
  return {
    maxToolRounds,
    maxToolCalls,
    maxDurationMs,
    ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
  };
}
