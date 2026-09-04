import type { ResearchActivityStatus, ResearchActivityView } from "../types";
import type { AgentRun } from "@/lib/agent";
import type { ResearchTask } from "@/lib/research";

import type { ResearchViewModelText } from "./text";

const RUNNING_TASK_STATUSES = new Set<ResearchTask["status"]>([
  "clarifying",
  "researching",
  "verifying",
  "synthesizing",
]);
const LIVE_RUN_STATUSES = new Set<AgentRun["status"]>([
  "running",
  "awaiting_input",
  "awaiting_approval",
]);

function getToolActivityStatus(
  status: "prepared" | "running" | "committed" | "failed" | "effect_unknown",
  taskStatus: ResearchTask["status"],
  runStatus: AgentRun["status"],
): ResearchActivityStatus {
  // A persisted prepared/running record is not proof that work is still live.
  // Once the task is paused, cancelled, failed, or completed, show the
  // interruption explicitly so the timeline cannot imply a live operation.
  if (
    (status === "prepared" || status === "running") &&
    (!RUNNING_TASK_STATUSES.has(taskStatus) ||
      !LIVE_RUN_STATUSES.has(runStatus))
  ) {
    return "interrupted";
  }
  return status;
}

function getTaskActivityStatus(
  status: ResearchTask["status"],
): ResearchActivityStatus {
  if (status === "failed") return "failed";
  if (status === "paused" || status === "cancelled") return "interrupted";
  if (RUNNING_TASK_STATUSES.has(status)) return "info";
  return "completed";
}

export function buildActivities(
  task: ResearchTask,
  text: ResearchViewModelText,
  runsById: Record<string, AgentRun>,
): ResearchActivityView[] {
  const toolActivities = task.executionRunIds.flatMap((runId) => {
    const run = runsById[runId];
    if (!run) return [];
    return run.toolExecutions.map((execution): ResearchActivityView => {
      const source = run.evidence.find(
        (item) => item.toolCallId === execution.callId,
      );
      const status = getToolActivityStatus(
        execution.status,
        task.status,
        run.status,
      );
      return {
        id: execution.id,
        createdAt:
          execution.endedAt || execution.startedAt || execution.preparedAt,
        phase: "researching",
        status,
        title:
          status === "committed"
            ? text.toolCommittedTitle(execution.toolName)
            : status === "failed"
              ? text.toolFailedTitle(execution.toolName)
              : status === "effect_unknown"
                ? text.toolEffectUnknownTitle(execution.toolName)
                : status === "interrupted"
                  ? text.toolInterruptedTitle(execution.toolName)
                  : text.toolRunningTitle(execution.toolName),
        detail: source
          ? text.toolSourceDetail(
              source.url.startsWith("workspace:///tool-results/")
                ? text.internalToolResultSource
                : source.title || source.sourceId,
            )
          : text.toolSafeDetail,
      };
    });
  });
  const degradedWaveActivities = (task.reportRuns ?? []).flatMap((run) =>
    run.waves.flatMap((wave): ResearchActivityView[] => {
      const degradedNodeIds = wave.degradedNodeIds ?? [];
      if (wave.packetStatus !== "degraded" && degradedNodeIds.length === 0) {
        return [];
      }
      return [
        {
          id: `${wave.id}-degraded-packets`,
          createdAt:
            wave.completedAt ?? wave.startedAt ?? run.endedAt ?? run.startedAt,
          phase: "researching",
          status: "completed",
          title: text.degradedWaveTitle(wave.index),
          detail: text.degradedWaveDetail(degradedNodeIds.length),
          tone: "warning",
        },
      ];
    }),
  );
  const scopeExpansionActivities = (task.reportRuns ?? []).flatMap((run) =>
    (run.scopeExpansionEvents ?? []).map((event): ResearchActivityView => ({
      id: event.id,
      createdAt: event.at,
      phase: "researching",
      status: "completed",
      title: text.scopeExpansionTitle,
      detail: [
        event.scheduledFollowUpIds.length > 0
          ? text.scopeExpansionDetail(event.scheduledFollowUpIds.length)
          : null,
        event.unavailableSourceFollowUpIds.length > 0
          ? text.scopeExpansionLimitedDetail(
              event.unavailableSourceFollowUpIds.length,
            )
          : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
      ...(event.unavailableSourceFollowUpIds.length > 0
        ? { tone: "warning" as const }
        : {}),
    })),
  );
  const activities: ResearchActivityView[] = [
    {
      id: `${task.id}-created`,
      createdAt: task.createdAt,
      phase: "draft",
      status: "completed",
      title: text.taskCreatedTitle,
      detail: text.taskCreatedDetail,
    },
    ...task.planVersions.map((plan) => ({
      id: plan.id,
      createdAt: plan.createdAt,
      phase: "plan_ready" as const,
      status: "completed" as const,
      title: text.planPreparedTitle(plan.version),
      detail: plan.adjustment
        ? text.planAdjustedDetail
        : text.planApprovalDetail,
    })),
    ...toolActivities,
    ...degradedWaveActivities,
    ...scopeExpansionActivities,
    ...task.reportVersions.map((report) => ({
      id: report.id,
      createdAt: report.createdAt,
      phase: task.status,
      status: "completed" as const,
      title: text.reportPublishedTitle(report.version),
      detail: text.reportKind[report.kind],
    })),
  ];
  const latest = activities.at(-1);
  if (
    !latest ||
    latest.phase !== task.status ||
    latest.createdAt !== task.updatedAt
  ) {
    activities.push({
      id: `${task.id}-${task.status}-${task.updatedAt}`,
      createdAt: task.updatedAt,
      phase: task.status,
      status: getTaskActivityStatus(task.status),
      title: task.error?.message || text.statusTitle(task.status),
    });
  }
  return activities.sort((left, right) => left.createdAt - right.createdAt);
}
