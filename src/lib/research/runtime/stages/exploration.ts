import {
  countTrailingDegradedWaves,
  countTrailingWaves,
  createNextResearchWave,
  getCurrentResearchReportRunIds,
  getResearchFrontier,
  getResearchStopReason,
} from "@/lib/research";

import { hasUnattemptedSteeringQuestions } from "@/lib/research/steering";

import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { consumeResearchSteering, reopenResearchSteering } from "../steering";
import { aggregateExecutionUsage, remainingBudget } from "../usage";
import { executeWave } from "../wave";

/** Hard limits also apply to newly submitted questions. */
function explorationBudgetAvailable(ctx: ResearchExecutionContext): boolean {
  const usage = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(ctx.store.tasksById[ctx.taskId]),
  );
  return Boolean(
    remainingBudget(ctx.store.tasksById[ctx.taskId]) &&
    ctx.run.usage.queryCount < ctx.explorationQueryLimit &&
    ctx.run.usage.sourceBodyCount < ctx.sourceBodyLimit &&
    usage.toolCalls < ctx.explorationToolCallCap &&
    usage.toolRounds < Math.max(0, ctx.task.budget.maxToolRounds - 2),
  );
}

function evaluateExplorationStop(ctx: ResearchExecutionContext) {
  const mustAttempt = hasUnattemptedSteeringQuestions(
    ctx.run,
    ctx.steeringRecord,
  );
  const remaining = remainingBudget(ctx.store.tasksById[ctx.taskId]);
  return getResearchStopReason(ctx.run.strategy, {
    coverage: mustAttempt
      ? {
          ...ctx.run.coverage,
          complete: false,
          overallRatio: 0,
          stepRatio: 0,
          claimRatio: 0,
        }
      : ctx.run.coverage,
    frontierCount: getResearchFrontier(ctx.run).length,
    currentDepth: Math.max(0, ...ctx.run.nodes.map((node) => node.depth)),
    queryCount: ctx.run.usage.queryCount,
    sourceBodyCount: ctx.run.usage.sourceBodyCount,
    sourceBodyLimit: ctx.sourceBodyLimit,
    remainingToolCalls: remaining?.maxToolCalls || 0,
    wavesWithoutNewSources: mustAttempt
      ? 0
      : countTrailingWaves(ctx.run, "newEvidenceCount"),
    wavesWithoutNewVerifiedClaims: mustAttempt
      ? 0
      : countTrailingWaves(ctx.run, "newVerifiedClaimCount"),
    consecutiveDegradedWaves: countTrailingDegradedWaves(ctx.run),
  });
}

/** Commands cross into the run only between committed, flushed waves. */
export async function runExplorationStage(ctx: ResearchExecutionContext) {
  let waveGuard = 0;
  while (waveGuard < 64) {
    waveGuard += 1;
    ctx.controller.signal.throwIfAborted();
    await consumeResearchSteering(ctx);
    if (ctx.run.phase === "awaiting_scope_approval") return;
    if (!explorationBudgetAvailable(ctx)) {
      await consumeResearchSteering(ctx, true);
      break;
    }
    if (ctx.run.stopReason) {
      await consumeResearchSteering(ctx, true);
      const isSoftStop = [
        "coverage_satisfied",
        "coverage_sufficient",
        "no_new_sources",
        "no_new_verified_claims",
        "frontier_exhausted",
        "max_depth",
      ].includes(ctx.run.stopReason.code);
      if (
        !isSoftStop ||
        !hasUnattemptedSteeringQuestions(ctx.run, ctx.steeringRecord)
      )
        break;
      ctx.run = { ...ctx.run, stopReason: undefined };
      await reopenResearchSteering(ctx);
    }
    let activeWave = ctx.run.waves.find((wave) =>
      ["queued", "running", "paused"].includes(wave.status),
    );
    if (!activeWave) {
      let next = createNextResearchWave(ctx.run);
      if (!next) {
        // Atomically seal intake, then consider commands that won the close race.
        await consumeResearchSteering(ctx, true);
        next = createNextResearchWave(ctx.run);
        if (!next) break;
        await reopenResearchSteering(ctx);
      }
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
    // executeWave drains its checkpoint queue before integrating the wave.
    await consumeResearchSteering(ctx);
    if (ctx.run.phase === "awaiting_scope_approval") return;
    let stopReason = evaluateExplorationStop(ctx);
    if (stopReason) {
      await consumeResearchSteering(ctx, true);
      stopReason = evaluateExplorationStop(ctx);
      if (!stopReason && explorationBudgetAvailable(ctx)) {
        await reopenResearchSteering(ctx);
        continue;
      }
      if (stopReason) {
        ctx.run = { ...ctx.run, stopReason, updatedAt: Date.now() };
        await persistRun(ctx, ctx.run);
      }
      break;
    }
  }
  await consumeResearchSteering(ctx, true);
}
