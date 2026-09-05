import type { ResearchTask } from "@/lib/research/types";

import { RESEARCH_TASK_STORAGE_VERSION } from "./constants";
import {
  clonePlan,
  cloneReportRun,
  sanitizeError,
  sanitizeLocator,
} from "./sanitize";
import { researchTaskSchema, storedRecordSchema } from "./schema/task";
import type { StoredResearchTaskRecord } from "./types";

export function toPersistedResearchTask(task: ResearchTask): ResearchTask {
  return {
    ...task,
    budget: { ...task.budget },
    usage: { ...task.usage },
    ...(task.imageSources
      ? {
          imageSources: task.imageSources.map((image) => ({ ...image })),
        }
      : {}),
    sourceSnapshot: task.sourceSnapshot
      ? {
          ...task.sourceSnapshot,
          toolIds: [...task.sourceSnapshot.toolIds],
          pluginIds: [...task.sourceSnapshot.pluginIds],
          skillIds: [...task.sourceSnapshot.skillIds],
          knowledgeCollectionIds: [
            ...task.sourceSnapshot.knowledgeCollectionIds,
          ],
          attachmentIds: [...task.sourceSnapshot.attachmentIds],
          workspaceFileIds: [...task.sourceSnapshot.workspaceFileIds],
          ...(task.sourceSnapshot.workspaceSources
            ? {
                workspaceSources: task.sourceSnapshot.workspaceSources.map(
                  (source) => ({ ...source }),
                ),
              }
            : {}),
          memoryScopes: [...task.sourceSnapshot.memoryScopes],
          memoryScopeIds: { ...task.sourceSnapshot.memoryScopeIds },
        }
      : undefined,
    planVersions: task.planVersions.map(clonePlan),
    evidence: task.evidence.map((item) => ({
      ...item,
      locator: sanitizeLocator(item.locator),
      ...(item.aliasSourceIds
        ? { aliasSourceIds: [...item.aliasSourceIds] }
        : {}),
      ...(item.aliasLocators
        ? { aliasLocators: item.aliasLocators.map(sanitizeLocator) }
        : {}),
      claimIds: [...item.claimIds],
      ...(item.relations
        ? {
            relations: item.relations.map((relation) => ({
              ...relation,
              claimIds: [...relation.claimIds],
            })),
          }
        : {}),
    })),
    reportRuns: task.reportRuns.map(cloneReportRun),
    reportVersions: task.reportVersions.map((report) => ({
      ...report,
      keyFindings: [...report.keyFindings],
      gaps: [...report.gaps],
      ...(report.coveredStepIds
        ? { coveredStepIds: [...report.coveredStepIds] }
        : {}),
      ...(report.evidenceIds ? { evidenceIds: [...report.evidenceIds] } : {}),
      ...(report.imageSources
        ? {
            imageSources: report.imageSources.map((image) => ({ ...image })),
          }
        : {}),
      ...(report.diff
        ? {
            diff: {
              addedEvidenceIds: [...report.diff.addedEvidenceIds],
              changedSourceIds: [...report.diff.changedSourceIds],
              unchangedSourceIds: [...report.diff.unchangedSourceIds],
            },
          }
        : {}),
      ...(report.audit
        ? {
            audit: {
              ...report.audit,
              blocking: [...report.audit.blocking],
              advisory: [...report.audit.advisory],
            },
          }
        : {}),
    })),
    agentRunIds: [...task.agentRunIds],
    executionRunIds: [...task.executionRunIds],
    checkpoint: task.checkpoint
      ? {
          ...task.checkpoint,
          committedEvidenceIds: [...task.checkpoint.committedEvidenceIds],
          committedToolExecutionIds: [
            ...task.checkpoint.committedToolExecutionIds,
          ],
          ...(task.checkpoint.committedImageSourceIds
            ? {
                committedImageSourceIds: [
                  ...task.checkpoint.committedImageSourceIds,
                ],
              }
            : {}),
        }
      : undefined,
    error: sanitizeError(task.error),
  };
}

export function createStoredRecord(
  task: ResearchTask,
): StoredResearchTaskRecord {
  const persistedTask = toPersistedResearchTask(task);
  const parsed = storedRecordSchema.safeParse({
    storageVersion: RESEARCH_TASK_STORAGE_VERSION,
    taskId: persistedTask.id,
    sessionId: persistedTask.sessionId,
    updatedAt: persistedTask.updatedAt,
    task: persistedTask,
  });
  if (!parsed.success)
    throw new Error("Research task is not valid for local persistence.");
  return parsed.data as StoredResearchTaskRecord;
}

export function parseStoredResearchTask(value: unknown): ResearchTask | null {
  const parsed = storedRecordSchema.safeParse(value);
  return parsed.success ? (parsed.data.task as ResearchTask) : null;
}

export function parseResearchTaskValue(value: unknown): ResearchTask | null {
  const parsed = researchTaskSchema.safeParse(value);
  return parsed.success ? (parsed.data as ResearchTask) : null;
}
