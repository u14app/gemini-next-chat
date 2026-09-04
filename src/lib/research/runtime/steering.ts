import {
  supportsResearchExecutionLock,
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";
import { v7 as uuidv7 } from "uuid";

import { getActivePlan, getActiveResearchReportRun } from "@/lib/research";
import {
  appendResearchSteeringCommand,
  canSteerResearchTask,
  projectResearchSteering,
  ResearchSteeringError,
  type ResearchSteeringIntent,
  type ResearchSteeringRecord,
} from "@/lib/research/steering";
import { getResearchExtensionRepository } from "@/services/research/extensionRepository";
import { getResearchTaskRepository } from "@/services/research/runtime";

import { persistRun, type ResearchExecutionContext } from "./executionContext";

export { supportsResearchExecutionLock } from "@/services/research/taskExecutionLock";

/** The existing agent lease remains inside this task-wide execution lease. */
export async function withResearchExecutionLock(
  taskId: string,
  execute: (protectedByLock: boolean) => Promise<void>,
  onConflict: () => void,
  lease?: ResearchTaskExecutionLease,
): Promise<void> {
  const result = await withResearchTaskExecutionLock(
    taskId,
    (owned) => execute(owned.protectedByWebLock),
    lease,
  );
  if (!result.acquired) onConflict();
}

function assertDurableSteering(): void {
  if (
    !supportsResearchExecutionLock() ||
    !getResearchTaskRepository().getStatus().durable ||
    !getResearchExtensionRepository().getStatus().durable
  ) {
    throw new ResearchSteeringError("unavailable");
  }
}

export async function enqueueResearchSteering(
  taskId: string,
  intent: ResearchSteeringIntent,
): Promise<void> {
  assertDurableSteering();
  const task = await getResearchTaskRepository().get(taskId);
  assertDurableSteering();
  if (!task || !canSteerResearchTask(task))
    throw new ResearchSteeringError("closed");
  const run = getActiveResearchReportRun(task);
  const plan = getActivePlan(task);
  if (!run || !plan) throw new ResearchSteeringError("closed");
  const normalizedIntent =
    intent.kind === "add"
      ? { ...intent, question: intent.question.trim() }
      : intent;
  const command = {
    id: uuidv7(),
    taskId,
    runId: run.id,
    intent: normalizedIntent,
    createdAt: Date.now(),
  };
  await getResearchExtensionRepository().update<ResearchSteeringRecord>(
    "steering",
    run.id,
    (current) => {
      if (!current) throw new ResearchSteeringError("unavailable");
      const next = appendResearchSteeringCommand(current, command);
      const projected = projectResearchSteering(run, plan, next);
      const result = projected.commands.find((item) => item.id === command.id);
      if (result?.status === "rejected")
        throw new ResearchSteeringError(result.reason ?? "closed");
      return next;
    },
    { taskId, sessionId: task.sessionId },
  );
}

export async function initializeResearchSteering(
  ctx: ResearchExecutionContext,
): Promise<void> {
  if (!ctx.steeringLockHeld) return;
  // Ordinary research keeps working without durable storage; steering does not.
  if (
    !getResearchTaskRepository().getStatus().durable ||
    !getResearchExtensionRepository().getStatus().durable
  )
    return;
  try {
    if (ctx.resumeAtVerification || ctx.resumeAtSynthesis) {
      ctx.steeringRecord =
        (await getResearchExtensionRepository().get<ResearchSteeringRecord>(
          "steering",
          ctx.run.id,
        )) ?? undefined;
      await rejectPendingResearchSteering(ctx);
      return;
    }
    ctx.steeringRecord =
      (await getResearchExtensionRepository().update<ResearchSteeringRecord>(
        "steering",
        ctx.run.id,
        (record) => ({
          ...(record ?? {
            taskId: ctx.taskId,
            runId: ctx.run.id,
            nextSequence: 1,
            commands: [],
          }),
          closed: false,
        }),
        { taskId: ctx.taskId, sessionId: ctx.task.sessionId },
      )) ?? undefined;
  } catch (error) {
    // Opening a new optional store must not prevent a fresh research run.
    // A resumed run may already contain durable steering intent: fail closed.
    if (ctx.run.waves.length > 0) throw error;
    ctx.steeringRecord = undefined;
    ctx.onNotice?.(ctx.t("runtime.error.persistence"));
  }
}

/** Only call between complete waves, after the checkpoint queue has drained. */
export async function consumeResearchSteering(
  ctx: ResearchExecutionContext,
  close = false,
): Promise<void> {
  if (!ctx.steeringLockHeld || !ctx.steeringRecord) return;
  assertDurableSteering();
  const repository = getResearchExtensionRepository();
  const record = close
    ? await repository.update<ResearchSteeringRecord>(
        "steering",
        ctx.run.id,
        (current) => (current ? { ...current, closed: true } : null),
      )
    : await repository.get<ResearchSteeringRecord>("steering", ctx.run.id);
  if (!record) throw new ResearchSteeringError("unavailable");
  ctx.controller.signal.throwIfAborted();
  const projected = projectResearchSteering(ctx.run, ctx.plan, record);
  const resolved = new Map(
    projected.commands.map((command) => [command.id, command]),
  );
  // Save even when replay found an existing node: the prior save may have failed.
  if (
    projected.run !== ctx.run ||
    record.commands.some((command) => command.status === "pending")
  ) {
    await persistRun(ctx, projected.run, ctx.evidence, ctx.task.checkpoint);
    assertDurableSteering();
    ctx.controller.signal.throwIfAborted();
    ctx.steeringRecord =
      (await repository.update<ResearchSteeringRecord>(
        "steering",
        ctx.run.id,
        (current) =>
          current
            ? {
                ...current,
                commands: current.commands.map(
                  (command) => resolved.get(command.id) ?? command,
                ),
              }
            : null,
      )) ?? undefined;
  } else {
    ctx.steeringRecord = record;
  }
}

export async function reopenResearchSteering(
  ctx: ResearchExecutionContext,
): Promise<void> {
  if (!ctx.steeringRecord) return;
  ctx.steeringRecord =
    (await getResearchExtensionRepository().update<ResearchSteeringRecord>(
      "steering",
      ctx.run.id,
      (record) => (record ? { ...record, closed: false } : null),
    )) ?? undefined;
}

export async function rejectPendingResearchSteering(
  ctx: ResearchExecutionContext,
): Promise<void> {
  if (!ctx.steeringRecord) return;
  ctx.steeringRecord =
    (await getResearchExtensionRepository().update<ResearchSteeringRecord>(
      "steering",
      ctx.run.id,
      (record) =>
        record
          ? {
              ...record,
              closed: true,
              commands: record.commands.map((command) =>
                command.status === "pending"
                  ? {
                      ...command,
                      status: "rejected",
                      reason: "closed",
                      resolvedAt: Date.now(),
                    }
                  : command,
              ),
            }
          : null,
    )) ?? undefined;
}
