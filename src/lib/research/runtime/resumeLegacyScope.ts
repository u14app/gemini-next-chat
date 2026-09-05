import {
  isResearchTaskExecutionLease,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";
import { v7 as uuidv7 } from "uuid";

import {
  expandResearchFrontier,
  getActivePlan,
  getActiveResearchReportRun,
  getResearchSourceSnapshotTypes,
  mergeResearchSourceSnapshotForExpansion,
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchCheckpoint,
  type ResearchReportRun,
  type ResearchTask,
} from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";

import {
  captureApprovedWorkspaceSources,
  createSourceSnapshot,
} from "./sourceSnapshot";

/**
 * Resumes a task paused by the removed scope-approval gate. The stored learning
 * packets already describe the requested expansion, so the frontier is expanded
 * from them directly instead of replanning.
 */
export async function resumeLegacyScopeApproval({
  task,
  lease,
  checkpointUnavailableText,
  claimActiveSlot,
  onNotice,
}: {
  task: ResearchTask;
  lease: ResearchTaskExecutionLease;
  checkpointUnavailableText: string;
  claimActiveSlot: (sessionId: string, taskId: string) => Promise<boolean>;
  onNotice?: (message: string) => void;
}) {
  if (!isResearchTaskExecutionLease(lease, task.id))
    throw new Error(
      "Research scope recovery requires the task execution lease.",
    );
  const store = useResearchStore.getState();
  const taskId = task.id;
  const plan = getActivePlan(task);
  const activeRun = getActiveResearchReportRun(task);
  const approvedSnapshot = task.sourceSnapshot;
  if (!plan || !activeRun || !approvedSnapshot?.model) {
    await store.updateTask(taskId, (current) => ({
      ...current,
      error: {
        code: "RESEARCH_CHECKPOINT_UNAVAILABLE",
        message: checkpointUnavailableText,
        recoverable: true,
      },
    }));
    onNotice?.(checkpointUnavailableText);
    return false;
  }
  if (!(await claimActiveSlot(task.sessionId, taskId))) return false;
  const processedFollowUpIds = new Set(
    (activeRun.scopeExpansionEvents ?? []).flatMap((event) => [
      ...event.scheduledFollowUpIds,
      ...event.unavailableSourceFollowUpIds,
      ...event.duplicateFollowUpIds,
      ...event.breadthLimitedFollowUpIds,
      ...event.depthLimitedFollowUpIds,
    ]),
  );
  const pendingPackets = activeRun.learningPackets.flatMap((packet) => {
    const followUps = packet.followUps.filter(
      (followUp) =>
        followUp.scopeImpact !== "within" &&
        !processedFollowUpIds.has(followUp.id),
    );
    return followUps.length > 0 ? [{ ...packet, followUps }] : [];
  });
  const requiredSourceTypes = Array.from(
    new Set(
      pendingPackets.flatMap((packet) =>
        packet.followUps.flatMap((followUp) => followUp.requiredSourceTypes),
      ),
    ),
  );
  const configuredSnapshot = await createSourceSnapshot(
    task,
    approvedSnapshot.model,
  );
  let sourceSnapshot = mergeResearchSourceSnapshotForExpansion({
    approved: approvedSnapshot,
    configured: configuredSnapshot,
    requiredSourceTypes,
  });
  if (requiredSourceTypes.includes("workspace")) {
    sourceSnapshot = {
      ...sourceSnapshot,
      workspaceSources: await captureApprovedWorkspaceSources(
        task.sessionId,
        sourceSnapshot.toolIds,
      ),
    };
  }
  const previousSourceTypes = new Set(
    getResearchSourceSnapshotTypes(approvedSnapshot),
  );
  const allowedSourceTypes = getResearchSourceSnapshotTypes(sourceSnapshot);
  const addedSourceTypes = allowedSourceTypes.filter(
    (sourceType) => !previousSourceTypes.has(sourceType),
  );
  const expansion = {
    packetIds: pendingPackets.map((packet) => packet.id),
    scheduledFollowUpIds: [] as string[],
    unavailableSourceFollowUpIds: [] as string[],
    duplicateFollowUpIds: [] as string[],
    breadthLimitedFollowUpIds: [] as string[],
    depthLimitedFollowUpIds: [] as string[],
  };
  let resumedRun: ResearchReportRun = {
    ...activeRun,
    phase: "exploring",
    stopReason: undefined,
    updatedAt: Date.now(),
  };
  for (const packet of pendingPackets) {
    const result = expandResearchFrontier(resumedRun, packet, Date.now(), {
      autoExpandScope: true,
      allowedSourceTypes,
      recordPacket: false,
    });
    resumedRun = result.run;
    expansion.scheduledFollowUpIds.push(...result.scheduledFollowUpIds);
    expansion.unavailableSourceFollowUpIds.push(
      ...result.unavailableSourceFollowUpIds,
    );
    expansion.duplicateFollowUpIds.push(...result.duplicateFollowUpIds);
    expansion.breadthLimitedFollowUpIds.push(
      ...result.breadthLimitedFollowUpIds,
    );
    expansion.depthLimitedFollowUpIds.push(...result.depthLimitedFollowUpIds);
  }
  if (pendingPackets.length > 0) {
    resumedRun = {
      ...resumedRun,
      scopeExpansionEvents: [
        ...(resumedRun.scopeExpansionEvents ?? []),
        {
          id: `${resumedRun.id}-legacy-scope-expansion-${uuidv7()}`,
          at: Date.now(),
          sourceSnapshotCapturedAt: sourceSnapshot.capturedAt,
          addedSourceTypes,
          ...expansion,
        },
      ],
    };
  }
  const checkpoint: ResearchCheckpoint = {
    createdAt: Date.now(),
    resumeStatus: "researching",
    committedEvidenceIds:
      task.checkpoint?.committedEvidenceIds ??
      task.evidence.map((item) => item.id),
    committedToolExecutionIds: task.checkpoint?.committedToolExecutionIds ?? [],
    ...(task.checkpoint?.committedImageSourceIds
      ? {
          committedImageSourceIds: [...task.checkpoint.committedImageSourceIds],
        }
      : {}),
    researchRunId: resumedRun.id,
  };
  await store.updateTask(taskId, (current) => {
    const withRun = upsertResearchReportRun(current, resumedRun);
    return {
      ...transitionResearchTask(withRun, "researching", { checkpoint }),
      sourceSnapshot,
      checkpoint,
      error: undefined,
    };
  });
  store.setActiveTask(taskId);
  return true;
}
