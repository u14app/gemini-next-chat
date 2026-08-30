import {
  isCommittedCheckpointToolCall,
  redactCheckpointText,
  sanitizeCheckpointToolCall,
  upsertResearchReportRun,
  type SavedResearchCheckpoint,
} from "@/lib/research";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";

import type { ResearchWaveContext } from "./waveContext";

/**
 * Queues a checkpoint write so overlapping tool batches never interleave their
 * workspace writes. Returns the queue tail so callers can await the flush.
 */
export function persistWaveCheckpoint(wave: ResearchWaveContext) {
  const { ctx } = wave;
  const payload: SavedResearchCheckpoint = {
    version: 1,
    taskId: ctx.task.id,
    savedAt: Date.now(),
    prompt: redactCheckpointText(wave.wavePrompt),
    partialContent: redactCheckpointText(wave.latestContent),
    toolCalls: wave.latestToolCalls
      .filter(isCommittedCheckpointToolCall)
      .map(sanitizeCheckpointToolCall),
    outputBlocks: [],
  };
  wave.checkpointQueue = wave.checkpointQueue
    .catch(() => undefined)
    .then(async () => {
      const written = await writeWorkspaceText(
        ctx.task.sessionId,
        wave.checkpointPath,
        JSON.stringify(payload),
        "overwrite",
      );
      if (!written.ok) throw new Error(written.error.message);
      const agentRun = useAgentRunStore.getState().runsById[wave.agentRunId];
      const runCheckpoint = {
        createdAt: Date.now(),
        waveIndex:
          wave.activeRun.waves.find((item) => item.id === wave.waveId)?.index ||
          0,
        frontierNodeIds: [...wave.activeRun.frontierNodeIds],
        committedEvidenceIds: ctx.evidence.map((item) => item.id),
        committedToolExecutionIds:
          agentRun?.toolExecutions
            .filter((execution) => execution.status === "committed")
            .map((execution) => execution.id) || [],
      };
      wave.activeRun = { ...wave.activeRun, checkpoint: runCheckpoint };
      await ctx.store.updateTask(ctx.taskId, (current) => ({
        ...upsertResearchReportRun(current, wave.activeRun),
        checkpoint: {
          createdAt: runCheckpoint.createdAt,
          resumeStatus:
            wave.phase === "verifying" ? "verifying" : "researching",
          committedEvidenceIds: runCheckpoint.committedEvidenceIds,
          committedToolExecutionIds: runCheckpoint.committedToolExecutionIds,
          researchRunId: wave.activeRun.id,
          historyPath: wave.checkpointPath,
        },
      }));
    });
  return wave.checkpointQueue;
}
