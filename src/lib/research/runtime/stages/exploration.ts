import {
  countTrailingWaves,
  createNextResearchWave,
  getCurrentResearchReportRunIds,
  getResearchFrontier,
  getResearchStopReason,
} from "@/lib/research";

import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { aggregateExecutionUsage, remainingBudget } from "../usage";
import { executeWave } from "../wave";

/**
 * Schedules exploration waves until coverage, budget, or a stop reason ends the
 * frontier. The guard only bounds runaway scheduling; every real exit is below.
 */
export async function runExplorationStage(ctx: ResearchExecutionContext) {
  let waveGuard = 0;
  while (waveGuard < 64) {
    waveGuard += 1;
    ctx.controller.signal.throwIfAborted();
    if (ctx.run.phase === "awaiting_scope_approval" || ctx.run.stopReason) {
      break;
    }
    if (
      ctx.run.usage.queryCount >= ctx.explorationQueryLimit ||
      ctx.run.usage.sourceBodyCount >= ctx.sourceBodyLimit
    ) {
      break;
    }
    const executionUsage = aggregateExecutionUsage(
      getCurrentResearchReportRunIds(ctx.store.tasksById[ctx.taskId]),
    );
    if (
      executionUsage.toolCalls >= ctx.explorationToolCallCap ||
      executionUsage.toolRounds >=
        Math.max(0, ctx.task.budget.maxToolRounds - 2)
    ) {
      break;
    }
    let activeWave = ctx.run.waves.find((wave) =>
      ["queued", "running", "paused"].includes(wave.status),
    );
    if (!activeWave) {
      const next = createNextResearchWave(ctx.run);
      if (!next) break;
      ctx.run = next.run;
      activeWave = next.wave;
    }
    const queryAllowance = Math.min(
      ctx.explorationQueryLimit - ctx.run.usage.queryCount,
      Math.max(1, activeWave.breadth),
    );
    ctx.run = await executeWave(ctx, {
      run: ctx.run,
      waveId: activeWave.id,
      nodeIds: [...activeWave.nodeIds],
      phase: "exploring",
      queryAllowance,
      expandFrontier: true,
    });
    if (ctx.run.phase === "awaiting_scope_approval") break;
    const remaining = remainingBudget(ctx.store.tasksById[ctx.taskId]);
    const stopReason = getResearchStopReason(ctx.run.strategy, {
      coverage: ctx.run.coverage,
      frontierCount: getResearchFrontier(ctx.run).length,
      currentDepth: Math.max(0, ...ctx.run.nodes.map((node) => node.depth)),
      queryCount: ctx.run.usage.queryCount,
      sourceBodyCount: ctx.run.usage.sourceBodyCount,
      sourceBodyLimit: ctx.sourceBodyLimit,
      remainingToolCalls: remaining?.maxToolCalls || 0,
      wavesWithoutNewSources: countTrailingWaves(ctx.run, "newEvidenceCount"),
      wavesWithoutNewVerifiedClaims: countTrailingWaves(
        ctx.run,
        "newVerifiedClaimCount",
      ),
    });
    if (stopReason) {
      ctx.run = {
        ...ctx.run,
        stopReason,
        updatedAt: Date.now(),
      };
      await persistRun(ctx, ctx.run);
      break;
    }
  }
}
