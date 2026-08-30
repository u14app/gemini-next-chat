import { v7 as uuidv7 } from "uuid";

import {
  getResearchVerificationQueryAllowance,
  transitionResearchTask,
} from "@/lib/research";

import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { remainingBudget } from "../usage";
import { executeWave } from "../wave";

/**
 * The single reserved verification pass: one wave aimed at major claims that
 * exploration left unverified, plus any plan step with no verified claim.
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
  const uncoveredSteps = ctx.plan.steps.filter(
    (step) =>
      !ctx.run.claims.some(
        (claim) =>
          claim.stepId === step.id &&
          claim.importance === "major" &&
          claim.verificationStatus === "verified",
      ),
  );
  const verificationNodeIds = Array.from(
    new Set([
      ...ctx.run.claims
        .filter(
          (claim) =>
            claim.importance === "major" &&
            claim.verificationStatus !== "verified",
        )
        .flatMap((claim) => claim.nodeIds),
      ...uncoveredSteps.flatMap((step) => {
        const node = ctx.run.nodes.find(
          (candidate) => candidate.stepId === step.id,
        );
        return node ? [node.id] : [];
      }),
    ]),
  ).slice(0, Math.max(1, ctx.run.strategy.initialBreadth));
  const verificationQueryAllowance = getResearchVerificationQueryAllowance(
    ctx.run.strategy,
    ctx.run.usage.queryCount,
  );
  if (
    ctx.run.stopReason?.code !== "invalid_model_output" &&
    verificationNodeIds.length > 0 &&
    verificationQueryAllowance > 0 &&
    remainingBudget(ctx.store.tasksById[ctx.taskId])
  ) {
    const resumableWave = ctx.run.waves.find((wave) =>
      ["queued", "running", "paused"].includes(wave.status),
    );
    const verificationWaveId = resumableWave?.id || `research-wave-${uuidv7()}`;
    const targetNodeIds = resumableWave
      ? [...resumableWave.nodeIds]
      : verificationNodeIds;
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
      queryAllowance: verificationQueryAllowance,
      expandFrontier: false,
    });
  }
}
