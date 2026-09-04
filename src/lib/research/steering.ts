import type {
  ResearchNode,
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchTask,
} from "./types";
import {
  isResearchQueryDuplicate,
  normalizeResearchQuery,
} from "./orchestration/strategy";

export type ResearchSteeringPriority = -1 | 0 | 1;
export type ResearchSteeringRejection =
  | "unavailable"
  | "closed"
  | "invalid_step"
  | "invalid_question"
  | "duplicate"
  | "node_limit"
  | "command_limit"
  | "node_scheduled"
  | "missing_node";

export class ResearchSteeringError extends Error {
  constructor(readonly code: ResearchSteeringRejection) {
    super(`Research steering: ${code}`);
    this.name = "ResearchSteeringError";
  }
}

export type ResearchSteeringIntent =
  | { kind: "priority"; nodeId: string; priority: ResearchSteeringPriority }
  | { kind: "add"; nodeId: string; stepId: string; question: string };

export interface ResearchSteeringCommand {
  id: string;
  taskId: string;
  runId: string;
  sequence: number;
  intent: ResearchSteeringIntent;
  status: "pending" | "applied" | "rejected";
  reason?: ResearchSteeringRejection;
  createdAt: number;
  resolvedAt?: number;
}

/** One atomic record per run serializes commands from every tab. */
export interface ResearchSteeringRecord {
  taskId: string;
  runId: string;
  nextSequence: number;
  closed: boolean;
  commands: ResearchSteeringCommand[];
}

export const RESEARCH_STEERING_MAX_QUESTION_LENGTH = 4_000;
const MAX_NODES = 2_000; // The existing persisted run schema's limit.
const MAX_COMMANDS = 2_000;

export function canSteerResearchTask(task: ResearchTask): boolean {
  const run = task.reportRuns.find(
    (item) => item.id === task.activeReportRunId,
  );
  if (
    !run ||
    !["queued", "exploring", "paused", "awaiting_scope_approval"].includes(
      run.phase,
    )
  )
    return false;
  if (task.status === "paused") {
    return !["verifying", "synthesizing"].includes(
      task.checkpoint?.resumeStatus ?? "",
    );
  }
  return ["researching", "queued", "clarifying"].includes(task.status);
}

export function appendResearchSteeringCommand(
  record: ResearchSteeringRecord,
  command: Omit<ResearchSteeringCommand, "sequence" | "status">,
): ResearchSteeringRecord {
  if (
    record.closed ||
    record.taskId !== command.taskId ||
    record.runId !== command.runId
  ) {
    throw new ResearchSteeringError("closed");
  }
  if (record.commands.some((item) => item.id === command.id)) return record;
  if (record.commands.length >= MAX_COMMANDS)
    throw new ResearchSteeringError("command_limit");
  return {
    ...record,
    nextSequence: record.nextSequence + 1,
    commands: [
      ...record.commands,
      { ...command, sequence: record.nextSequence, status: "pending" },
    ],
  };
}

function rejectionForIntent(
  run: ResearchReportRun,
  plan: ResearchPlanVersion,
  intent: ResearchSteeringIntent,
): ResearchSteeringRejection | undefined {
  if (intent.kind === "priority") {
    const node = run.nodes.find((item) => item.id === intent.nodeId);
    if (!node) return "missing_node";
    if (
      node.status !== "pending" ||
      node.waveId ||
      !run.frontierNodeIds.includes(node.id)
    )
      return "node_scheduled";
    return;
  }
  if (!plan.steps.some((step) => step.id === intent.stepId))
    return "invalid_step";
  if (
    !intent.question.trim() ||
    intent.question.length > RESEARCH_STEERING_MAX_QUESTION_LENGTH
  )
    return "invalid_question";
  if (run.nodes.length >= MAX_NODES) return "node_limit";
  if (
    isResearchQueryDuplicate(
      normalizeResearchQuery(intent.question),
      new Set(run.nodes.map((node) => normalizeResearchQuery(node.query))),
    )
  )
    return "duplicate";
}

/** Absolute intents can be replayed after a core-save/ack crash without resetting nodes. */
export function projectResearchSteering(
  run: ResearchReportRun,
  plan: ResearchPlanVersion,
  record: ResearchSteeringRecord,
  now = Date.now(),
): { run: ResearchReportRun; commands: ResearchSteeringCommand[] } {
  if (record.taskId !== run.taskId || record.runId !== run.id)
    throw new ResearchSteeringError("closed");
  let next = run;
  const priorities = new Map<string, ResearchSteeringPriority>();
  const commands = record.commands.map((command): ResearchSteeringCommand => {
    if (command.status === "rejected") return command;
    const intent = command.intent;
    const existingNode = next.nodes.find((node) => node.id === intent.nodeId);
    // A stable added node already saved before its acknowledgement is a replay.
    const replay =
      intent.kind === "add" &&
      existingNode?.stepId === intent.stepId &&
      existingNode.query === intent.question;
    const reason =
      command.status === "applied" || replay
        ? undefined
        : rejectionForIntent(next, plan, intent);
    if (reason)
      return { ...command, status: "rejected", reason, resolvedAt: now };
    if (intent.kind === "priority") {
      priorities.set(intent.nodeId, intent.priority);
    } else if (!existingNode) {
      const node: ResearchNode = {
        id: intent.nodeId,
        stepId: intent.stepId,
        depth: 1,
        objective: intent.question,
        query: intent.question,
        status: "pending",
        sourceIds: [],
        evidenceIds: [],
        claimIds: [],
        createdAt: command.createdAt,
        updatedAt: now,
      };
      next = {
        ...next,
        nodes: [...next.nodes, node],
        frontierNodeIds: [...next.frontierNodeIds, node.id],
      };
    }
    return command.status === "applied"
      ? command
      : { ...command, status: "applied", resolvedAt: now };
  });
  const nodeIndex = new Map(next.nodes.map((node, index) => [node.id, index]));
  const frontierNodeIds = [...next.frontierNodeIds].sort(
    (left, right) =>
      (priorities.get(left) ?? 0) - (priorities.get(right) ?? 0) ||
      (nodeIndex.get(left) ?? 0) - (nodeIndex.get(right) ?? 0),
  );
  const orderChanged = frontierNodeIds.some(
    (id, index) => id !== next.frontierNodeIds[index],
  );
  if (next !== run || orderChanged)
    next = { ...next, frontierNodeIds, updatedAt: now };
  return { run: next, commands };
}

export function hasUnattemptedSteeringQuestions(
  run: ResearchReportRun,
  record?: ResearchSteeringRecord,
): boolean {
  return (
    record?.commands.some(
      (command) =>
        command.status === "applied" &&
        command.intent.kind === "add" &&
        run.nodes.some(
          (node) =>
            node.id === command.intent.nodeId &&
            ["pending", "queued"].includes(node.status),
        ),
    ) ?? false
  );
}

export function getUnansweredSteeringQuestions(
  run: ResearchReportRun,
  record?: ResearchSteeringRecord,
): string[] {
  return (
    record?.commands.flatMap((command) => {
      if (command.status !== "applied" || command.intent.kind !== "add")
        return [];
      const node = run.nodes.find((item) => item.id === command.intent.nodeId);
      return node && (node.status !== "completed" || !node.claimIds.length)
        ? [command.intent.question]
        : [];
    }) ?? []
  );
}
