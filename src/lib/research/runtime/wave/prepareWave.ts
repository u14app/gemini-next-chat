import { v7 as uuidv7 } from "uuid";

import type { Message } from "@/types";
import {
  buildResearchWavePrompt,
  getCurrentResearchReportRunIds,
  getResearchQueriesFromToolCalls,
  getResearchRunResumeDecision,
  getResearchSourceLocatorsFromToolCalls,
  normalizeResearchQuery,
  type ResearchReportRun,
} from "@/lib/research";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import type {
  BuiltinResearchQueryBudget,
  BuiltinResearchSourceBudget,
} from "@/services/api/chat/builtinTools";

import { readCheckpoint } from "../checkpointStorage";
import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { getInvalidFrozenWorkspaceSource } from "../sourceSnapshot";
import { aggregateExecutionUsage, remainingBudget } from "../usage";
import type { ResearchWaveContext, ResearchWaveInput } from "./waveContext";

/**
 * Settles a wave's budget, resume decision and prompt, and marks its nodes as
 * running. Returns `null` when no budget is left, in which case the caller
 * must return the incoming run untouched.
 */
export async function prepareWave(
  ctx: ResearchExecutionContext,
  input: ResearchWaveInput,
): Promise<ResearchWaveContext | null> {
  const { run, waveId, nodeIds, phase, queryAllowance } = input;
  const invalidWorkspaceSource = await getInvalidFrozenWorkspaceSource(
    ctx.snapshot,
    ctx.task.sessionId,
  );
  if (invalidWorkspaceSource) {
    throw new Error(
      ctx.dependencyText.sourceUnavailable(invalidWorkspaceSource),
    );
  }
  const currentTask = ctx.store.tasksById[ctx.taskId];
  const availableBudget = remainingBudget(currentTask);
  if (!availableBudget) return null;
  const currentExecutionUsage = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(currentTask),
  );
  const phaseToolCallAllowance =
    phase === "exploring"
      ? Math.min(
          availableBudget.maxToolCalls,
          Math.max(
            0,
            ctx.explorationToolCallCap - currentExecutionUsage.toolCalls,
          ),
        )
      : availableBudget.maxToolCalls;
  // Every wave needs one tool-free archive pass and may need one
  // targeted repair pass. Neither pass may consume search budget.
  const reservedModelRounds = 2;
  if (
    phaseToolCallAllowance <= 0 ||
    availableBudget.maxToolRounds <= reservedModelRounds
  ) {
    return null;
  }

  const resumeDecision = getResearchRunResumeDecision(
    currentTask,
    useAgentRunStore.getState().runsById,
  );
  const resumeThisWave =
    currentTask.checkpoint?.researchRunId === run.id &&
    resumeDecision.action === "resume";
  if (
    currentTask.checkpoint?.researchRunId === run.id &&
    resumeDecision.action === "unavailable"
  ) {
    throw new Error(ctx.dependencyText.checkpointUnavailable);
  }
  const agentRunId = resumeThisWave ? resumeDecision.runId : uuidv7();
  ctx.lastAgentRunId = agentRunId;
  if (!resumeThisWave) {
    await ctx.store.updateTask(ctx.taskId, (current) => ({
      ...current,
      agentRunIds: [...current.agentRunIds, agentRunId],
      executionRunIds: [...current.executionRunIds, agentRunId],
    }));
  }

  const checkpointPath = `research/checkpoints/${ctx.task.id}-${run.id}-wave-${run.waves.find((wave) => wave.id === waveId)?.index || 0}.json`;
  const savedCheckpoint = resumeThisWave
    ? await readCheckpoint(currentTask)
    : null;

  const startedAt = Date.now();
  const activeRun: ResearchReportRun = {
    ...run,
    phase,
    waves: run.waves.map((wave) =>
      wave.id === waveId
        ? {
            ...wave,
            status: "running" as const,
            startedAt: wave.startedAt ?? startedAt,
          }
        : wave,
    ),
    nodes: run.nodes.map((node) =>
      nodeIds.includes(node.id)
        ? {
            ...node,
            status: "searching" as const,
            stopReason: undefined,
            updatedAt: startedAt,
          }
        : node,
    ),
    updatedAt: startedAt,
  };
  await persistRun(
    ctx,
    activeRun,
    ctx.evidence,
    resumeThisWave ? currentTask.checkpoint : undefined,
  );
  const executedQueries: string[] = getResearchQueriesFromToolCalls(
    savedCheckpoint?.toolCalls || [],
  );
  const readLocators: string[] = getResearchSourceLocatorsFromToolCalls(
    savedCheckpoint?.toolCalls || [],
  );
  const queryBudget: BuiltinResearchQueryBudget = {
    remainingQueries: Math.max(0, queryAllowance),
    maxResultsPerQuery: run.strategy.resultsPerQuery,
    seenQueries: new Set(
      [...run.executedQueries, ...executedQueries].map(normalizeResearchQuery),
    ),
    onQueriesExecuted: (queries) => executedQueries.push(...queries),
  };
  const sourceBudget: BuiltinResearchSourceBudget = {
    remainingSourceBodies: Math.max(
      0,
      ctx.sourceBodyLimit - run.usage.sourceBodyCount - readLocators.length,
    ),
    onSourceBodiesRead: (locators) => readLocators.push(...locators),
  };
  const wavePrompt = [
    buildResearchWavePrompt({
      task: ctx.store.tasksById[ctx.taskId],
      plan: ctx.plan,
      run: activeRun,
      nodeIds,
      evidence: ctx.evidence,
    }),
    phase === "verifying"
      ? `This is the reserved verification pass. Target unresolved, pending, or unsupported major claims only. At most ${queryAllowance} new queries are permitted. Do not expand the frontier.`
      : `This wave may execute at most ${queryAllowance} new queries. Batch up to four queries in search_web when useful.`,
    ctx.sourceContext.attachmentCatalog,
    ctx.sourceContext.workspaceCatalog,
  ]
    .filter(Boolean)
    .join("\n\n");
  const resumeHistory: Message[] = savedCheckpoint
    ? [
        {
          id: uuidv7(),
          role: "user",
          content: savedCheckpoint.prompt,
          timestamp: savedCheckpoint.savedAt,
        },
        {
          id: uuidv7(),
          role: "model",
          content: savedCheckpoint.partialContent,
          toolCalls: savedCheckpoint.toolCalls,
          outputBlocks: savedCheckpoint.outputBlocks,
          timestamp: savedCheckpoint.savedAt,
        },
      ]
    : [];

  return {
    ...input,
    ctx,
    agentRunId,
    resumeThisWave,
    savedCheckpoint,
    checkpointPath,
    availableBudget,
    phaseToolCallAllowance,
    reservedModelRounds,
    wavePrompt,
    executedQueries,
    readLocators,
    queryBudget,
    sourceBudget,
    resumeHistory,
    activeRun,
    latestContent: savedCheckpoint?.partialContent || "",
    latestToolCalls: savedCheckpoint?.toolCalls || [],
    webSources: [],
    knowledgeSources: [],
    checkpointQueue: Promise.resolve(),
  };
}
