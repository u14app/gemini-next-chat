import type { ResearchActivityView } from "../types";
import type { AgentRun } from "@/lib/agent";
import type { ResearchTask } from "@/lib/research";

import type { ResearchViewModelText } from "./text";

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
      const failed =
        execution.status === "failed" || execution.status === "effect_unknown";
      const committed = execution.status === "committed";
      return {
        id: execution.id,
        createdAt:
          execution.endedAt || execution.startedAt || execution.preparedAt,
        phase: "researching",
        title: failed
          ? text.toolFailedTitle(execution.toolName)
          : committed
            ? text.toolCommittedTitle(execution.toolName)
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
      title: text.taskCreatedTitle,
      detail: text.taskCreatedDetail,
    },
    ...task.planVersions.map((plan) => ({
      id: plan.id,
      createdAt: plan.createdAt,
      phase: "plan_ready" as const,
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
      title: task.error?.message || text.statusTitle(task.status),
    });
  }
  return activities.sort((left, right) => left.createdAt - right.createdAt);
}
