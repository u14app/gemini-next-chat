import { v7 as uuidv7 } from "uuid";

import {
  countTrailingDegradedWaves,
  getResearchVerificationTargetNodeIds,
  getResearchVerificationQueryAllowance,
  isResearchCoverageSufficient,
  transitionResearchTask,
} from "@/lib/research";

import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { remainingBudget } from "../usage";
import { executeWave } from "../wave";

/**
 * Uses the reserved verification budget in bounded waves. A later wave runs
 * only when the preceding one verified something new.
 */
export async function runVerificationStage(ctx: ResearchExecutionContext) {
  await ctx.store.updateTask(ctx.taskId, (current) =>
    current.status === "researching"
      ? transitionResearchTask(current, "verifying")
      : current,
  );
  ctx.run = {
    ...ctx.run,
    phase: "verifying",
    updatedAt: Date.now(),
  };
  await persistRun(
    ctx,
    ctx.run,
    ctx.evidence,
    ctx.resumeAtVerification
      ? ctx.store.tasksById[ctx.taskId].checkpoint
      : undefined,
  );
  let waveGuard = 0;
  while (
    waveGuard < 64 &&
    ctx.run.stopReason?.code !== "invalid_model_output" &&
    ctx.run.stopReason?.code !== "coverage_satisfied" &&
    ctx.run.stopReason?.code !== "coverage_sufficient"
  ) {
    waveGuard += 1;
    ctx.controller.signal.throwIfAborted();
    const verificationQueryAllowance = getResearchVerificationQueryAllowance(
      ctx.run.strategy,
      ctx.run.usage.queryCount,
    );
    if (
      verificationQueryAllowance <= 0 ||
      !remainingBudget(ctx.store.tasksById[ctx.taskId])
    ) {
      break;
    }
    const resumableWave = ctx.run.waves.find((wave) =>
      ["queued", "running", "paused"].includes(wave.status),
    );
    const targetNodeIds = resumableWave
      ? [...resumableWave.nodeIds]
      : getResearchVerificationTargetNodeIds(ctx.run, ctx.plan);
    if (targetNodeIds.length === 0) break;
    const verificationWaveId = resumableWave?.id || `research-wave-${uuidv7()}`;
    if (!resumableWave) {
      const verificationWave = {
        id: verificationWaveId,
        index: ctx.run.waves.length + 1,
        depth: Math.max(
          1,
          ...ctx.run.nodes
            .filter((node) => targetNodeIds.includes(node.id))
            .map((node) => node.depth),
        ),
        breadth: targetNodeIds.length,
        nodeIds: targetNodeIds,
        status: "queued" as const,
        newEvidenceCount: 0,
        newVerifiedClaimCount: 0,
      };
      ctx.run = {
        ...ctx.run,
        waves: [...ctx.run.waves, verificationWave],
        updatedAt: Date.now(),
      };
    }
    ctx.run = await executeWave(ctx, {
      run: ctx.run,
      waveId: verificationWaveId,
      nodeIds: targetNodeIds,
      phase: "verifying",
      queryAllowance: Math.min(
        verificationQueryAllowance,
        Math.max(1, targetNodeIds.length),
      ),
      expandFrontier: false,
    });
    if (ctx.run.phase === "awaiting_scope_approval") break;
    if (
      ctx.run.coverage.complete ||
      isResearchCoverageSufficient(ctx.run.coverage)
    ) {
      ctx.run = {
        ...ctx.run,
        stopReason: {
          code: ctx.run.coverage.complete
            ? "coverage_satisfied"
            : "coverage_sufficient",
          at: Date.now(),
        },
        updatedAt: Date.now(),
      };
      await persistRun(ctx, ctx.run);
      break;
    }
    if (countTrailingDegradedWaves(ctx.run) >= 2) {
      ctx.run = {
        ...ctx.run,
        stopReason: { code: "invalid_model_output", at: Date.now() },
        updatedAt: Date.now(),
      };
      await persistRun(ctx, ctx.run);
      break;
    }
    const completedWave = ctx.run.waves.find(
      (wave) => wave.id === verificationWaveId,
    );
    if (!completedWave || completedWave.newVerifiedClaimCount <= 0) {
      if (!ctx.run.stopReason) {
        ctx.run = {
          ...ctx.run,
          stopReason: { code: "no_new_verified_claims", at: Date.now() },
          updatedAt: Date.now(),
        };
        await persistRun(ctx, ctx.run);
      }
      break;
    }
  }
}
