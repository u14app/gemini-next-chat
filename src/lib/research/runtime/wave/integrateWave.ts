import {
  finalizeResearchWavePackets,
  getCurrentResearchReportRunIds,
  integrateLearningPackets,
  type ResearchReportRun,
  type ResearchScopeExpansionEvent,
} from "@/lib/research";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { deleteWorkspaceFile } from "@/services/workspace/sessionWorkspace";

import { persistRun } from "../executionContext";
import { aggregateExecutionUsage } from "../usage";
import { refreshExpansionSources } from "./refreshExpansionSources";
import type { ResearchWaveContext, ResearchWaveEvidence } from "./waveContext";

/**
 * Folds the wave's packets back into the run graph, records any scope
 * expansion, and commits the wave's terminal checkpoint.
 */
export async function integrateWave(
  wave: ResearchWaveContext,
  collected: ResearchWaveEvidence,
  finalizedPackets: ReturnType<typeof finalizeResearchWavePackets>,
): Promise<ResearchReportRun> {
  const { ctx } = wave;
  const { waveId, phase, expandFrontier, activeRun } = wave;
  const {
    packets: wavePackets,
    repairedNodeIds,
    degradedNodeIds,
  } = finalizedPackets;
  const executionUsage = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(ctx.store.tasksById[ctx.taskId]),
  );
  const baseUsage = {
    ...activeRun.usage,
    queryCount: activeRun.usage.queryCount + wave.executedQueries.length,
    sourceBodyCount: Math.min(
      ctx.sourceBodyLimit,
      Math.max(
        activeRun.usage.sourceBodyCount + wave.readLocators.length,
        activeRun.usage.sourceBodyCount + collected.newEvidenceIds.length,
      ),
    ),
    ...executionUsage,
  };
  const expansionSources = await refreshExpansionSources(ctx, wavePackets);
  const integrated = integrateLearningPackets({
    run: activeRun,
    plan: ctx.plan,
    evidence: collected.evidence,
    packets: wavePackets,
    waveId,
    newEvidenceCount: collected.newEvidenceIds.length,
    expandFrontier,
    allowedSourceTypes: expansionSources.allowedSourceTypes,
  });
  const scopeExpansionEvent: ResearchScopeExpansionEvent | undefined =
    integrated.scopeExpansion
      ? {
          id: `${waveId}-scope-expansion`,
          at: Date.now(),
          sourceSnapshotCapturedAt: ctx.snapshot.capturedAt,
          packetIds: integrated.scopeExpansion.packetIds,
          addedSourceTypes: expansionSources.addedSourceTypes,
          scheduledFollowUpIds: integrated.scopeExpansion.scheduledFollowUpIds,
          unavailableSourceFollowUpIds:
            integrated.scopeExpansion.unavailableSourceFollowUpIds,
          duplicateFollowUpIds: integrated.scopeExpansion.duplicateFollowUpIds,
          breadthLimitedFollowUpIds:
            integrated.scopeExpansion.breadthLimitedFollowUpIds,
          depthLimitedFollowUpIds:
            integrated.scopeExpansion.depthLimitedFollowUpIds,
        }
      : undefined;
  const completedRun: ResearchReportRun = {
    ...integrated.run,
    ...(ctx.imageSources?.length
      ? { imageSources: ctx.imageSources.map((image) => ({ ...image })) }
      : {}),
    phase,
    usage: baseUsage,
    executedQueries: [
      ...integrated.run.executedQueries,
      ...wave.executedQueries,
    ],
    waves: integrated.run.waves.map((item) =>
      item.id === waveId
        ? {
            ...item,
            packetStatus:
              degradedNodeIds.length > 0
                ? ("degraded" as const)
                : repairedNodeIds.length > 0
                  ? ("repaired" as const)
                  : ("valid" as const),
            ...(degradedNodeIds.length > 0 ? { degradedNodeIds } : {}),
          }
        : item,
    ),
    ...(scopeExpansionEvent
      ? {
          scopeExpansionEvents: [
            ...(integrated.run.scopeExpansionEvents ?? []),
            scopeExpansionEvent,
          ],
        }
      : {}),
    checkpoint: {
      createdAt: Date.now(),
      waveIndex:
        integrated.run.waves.find((item) => item.id === waveId)?.index || 0,
      frontierNodeIds: [...integrated.run.frontierNodeIds],
      committedEvidenceIds: integrated.evidence.map((item) => item.id),
      committedToolExecutionIds:
        useAgentRunStore
          .getState()
          .runsById[wave.agentRunId]?.toolExecutions.filter(
            (execution) => execution.status === "committed",
          )
          .map((execution) => execution.id) || [],
      ...(ctx.imageSources?.length
        ? { committedImageSourceIds: ctx.imageSources.map((image) => image.id) }
        : {}),
    },
    updatedAt: Date.now(),
  };
  const completedCheckpoint = completedRun.checkpoint!;
  await persistRun(ctx, completedRun, integrated.evidence, {
    createdAt: completedCheckpoint.createdAt,
    resumeStatus: phase === "verifying" ? "verifying" : "researching",
    committedEvidenceIds: completedCheckpoint.committedEvidenceIds,
    committedToolExecutionIds: completedCheckpoint.committedToolExecutionIds,
    researchRunId: completedRun.id,
  });
  await deleteWorkspaceFile(ctx.task.sessionId, wave.checkpointPath).catch(
    () => undefined,
  );
  return completedRun;
}
