import {
  getResearchSourceSnapshotTypes,
  mergeResearchSourceSnapshotForExpansion,
  type LearningPacket,
  type ResearchSourceType,
} from "@/lib/research";

import type { ResearchExecutionContext } from "../executionContext";
import {
  buildResearchExecutionSourceContext,
  captureApprovedWorkspaceSources,
  createSourceSnapshot,
} from "../sourceSnapshot";

/**
 * Widens the frozen source snapshot to whatever out-of-scope follow-ups the
 * wave asked for, but only within what the conversation already authorizes.
 */
export async function refreshExpansionSources(
  ctx: ResearchExecutionContext,
  packets: readonly LearningPacket[],
): Promise<{
  allowedSourceTypes: ResearchSourceType[];
  addedSourceTypes: ResearchSourceType[];
}> {
  const requiredSourceTypes = Array.from(
    new Set(
      packets.flatMap((packet) =>
        packet.followUps
          .filter((followUp) => followUp.scopeImpact !== "within")
          .flatMap((followUp) => followUp.requiredSourceTypes),
      ),
    ),
  );
  const previousSourceTypes = getResearchSourceSnapshotTypes(ctx.snapshot);
  if (requiredSourceTypes.length === 0) {
    return {
      allowedSourceTypes: previousSourceTypes,
      addedSourceTypes: [],
    };
  }
  const configuredSnapshot = await createSourceSnapshot(
    ctx.store.tasksById[ctx.taskId],
    ctx.researchModel,
  );
  let nextSnapshot = mergeResearchSourceSnapshotForExpansion({
    approved: ctx.snapshot,
    configured: configuredSnapshot,
    requiredSourceTypes,
  });
  if (requiredSourceTypes.includes("workspace")) {
    nextSnapshot = {
      ...nextSnapshot,
      workspaceSources: await captureApprovedWorkspaceSources(
        ctx.task.sessionId,
        nextSnapshot.toolIds,
      ),
    };
  }
  const allowedSourceTypes = getResearchSourceSnapshotTypes(nextSnapshot);
  const previousSourceTypeSet = new Set(previousSourceTypes);
  const addedSourceTypes = allowedSourceTypes.filter(
    (sourceType) => !previousSourceTypeSet.has(sourceType),
  );
  await ctx.store.updateTask(ctx.taskId, (current) => ({
    ...current,
    sourceSnapshot: nextSnapshot,
    updatedAt: Math.max(current.updatedAt, nextSnapshot.capturedAt),
  }));
  ctx.snapshot = nextSnapshot;
  ctx.sourceContext = buildResearchExecutionSourceContext(
    ctx.snapshot,
    ctx.currentAttachments,
  );
  ctx.task = ctx.store.tasksById[ctx.taskId];
  return { allowedSourceTypes, addedSourceTypes };
}
