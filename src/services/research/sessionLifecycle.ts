import { v7 as uuidv7 } from "uuid";

import type { ResearchImageSource, ResearchTask } from "@/lib/research";
import type { MessageOutputBlock, SessionMessageTree } from "@/types";
import { useResearchStore } from "@/store/core/researchStore";

import { getResearchTaskRepository } from "./runtime";
import { cloneResearchExtensions } from "./extensionLifecycle";

export interface PreparedResearchTaskSnapshots {
  tasks: ResearchTask[];
  artifactUrls: string[];
  referencedTaskIds: string[];
}

export function getReferencedResearchTaskIds(
  messageTree: SessionMessageTree,
): string[] {
  const taskIds = new Set<string>();
  for (const node of Object.values(messageTree.nodesById)) {
    for (const block of node.message.outputBlocks || []) {
      if (block.type === "research_task") taskIds.add(block.taskId);
    }
  }
  return [...taskIds];
}

function cloneResearchImageSources(
  images: readonly ResearchImageSource[] | undefined,
  reportRunIdMap: ReadonlyMap<string, string>,
): ResearchImageSource[] | undefined {
  if (!images) return undefined;
  return images.map((image) => ({
    ...image,
    researchRunId:
      reportRunIdMap.get(image.researchRunId) || image.researchRunId,
  }));
}

export async function prepareResearchTaskSnapshots(
  sessionId: string,
  messageTree: SessionMessageTree,
): Promise<PreparedResearchTaskSnapshots> {
  const referencedTaskIds = getReferencedResearchTaskIds(messageTree);
  const tasks = (
    await Promise.all(
      referencedTaskIds.map((taskId) =>
        getResearchTaskRepository().get(taskId),
      ),
    )
  ).filter((task): task is ResearchTask =>
    Boolean(
      task &&
      task.sessionId === sessionId &&
      (task.status === "completed" || task.status === "partial_completed"),
    ),
  );
  return {
    tasks,
    artifactUrls: Array.from(
      new Set(
        tasks.flatMap((task) =>
          task.reportVersions.map((report) => report.artifactId),
        ),
      ),
    ),
    referencedTaskIds,
  };
}

function cloneResearchTask(
  source: ResearchTask,
  targetSessionId: string,
  artifactUrls: ReadonlyMap<string, string>,
): ResearchTask {
  if (source.status !== "completed" && source.status !== "partial_completed") {
    throw new Error("Only completed research snapshots can be duplicated.");
  }
  const now = Date.now();
  const clonedTaskId = uuidv7();
  const reportRunIdMap = new Map(
    source.reportRuns.map((run) => [run.id, uuidv7()] as const),
  );
  const evidenceIdMap = new Map<string, string>();
  const cloneImages = (images: readonly ResearchImageSource[] | undefined) =>
    cloneResearchImageSources(images, reportRunIdMap);
  const evidence = source.evidence.map((item) => {
    const id = uuidv7();
    evidenceIdMap.set(item.id, id);
    return {
      ...item,
      id,
      agentRunId: undefined,
      toolCallId: undefined,
      claimIds: [...item.claimIds],
      ...(item.aliasSourceIds
        ? { aliasSourceIds: [...item.aliasSourceIds] }
        : {}),
      ...(item.aliasLocators ? { aliasLocators: [...item.aliasLocators] } : {}),
      ...(item.relations
        ? {
            relations: item.relations.map((relation) => ({
              ...relation,
              researchRunId:
                reportRunIdMap.get(relation.researchRunId) ||
                relation.researchRunId,
              claimIds: [...relation.claimIds],
            })),
          }
        : {}),
    };
  });
  const reportRuns = source.reportRuns.map((run) => ({
    ...run,
    id: reportRunIdMap.get(run.id)!,
    taskId: clonedTaskId,
    strategy: { ...run.strategy },
    waves: run.waves.map((wave) => ({
      ...wave,
      nodeIds: [...wave.nodeIds],
    })),
    nodes: run.nodes.map((node) => ({
      ...node,
      sourceIds: [...node.sourceIds],
      evidenceIds: node.evidenceIds.flatMap((id) => {
        const mapped = evidenceIdMap.get(id);
        return mapped ? [mapped] : [];
      }),
      claimIds: [...node.claimIds],
    })),
    learningPackets: run.learningPackets.map((packet) => ({
      ...packet,
      learnings: packet.learnings.map((learning) => ({
        ...learning,
        sourceIds: [...learning.sourceIds],
        evidenceIds: learning.evidenceIds.flatMap((id) => {
          const mapped = evidenceIdMap.get(id);
          return mapped ? [mapped] : [];
        }),
      })),
      sourceAssessments: packet.sourceAssessments.map((assessment) => ({
        ...assessment,
      })),
      followUps: packet.followUps.map((followUp) => ({
        ...followUp,
        requiredSourceTypes: [...followUp.requiredSourceTypes],
      })),
    })),
    claims: run.claims.map((claim) => ({
      ...claim,
      nodeIds: [...claim.nodeIds],
      supportingEvidenceIds: claim.supportingEvidenceIds.flatMap((id) => {
        const mapped = evidenceIdMap.get(id);
        return mapped ? [mapped] : [];
      }),
      contradictingEvidenceIds: claim.contradictingEvidenceIds.flatMap((id) => {
        const mapped = evidenceIdMap.get(id);
        return mapped ? [mapped] : [];
      }),
    })),
    ...(cloneImages(run.imageSources)
      ? {
          imageSources: cloneImages(run.imageSources),
        }
      : {}),
    executedQueries: [...run.executedQueries],
    frontierNodeIds: [...run.frontierNodeIds],
    coverage: { ...run.coverage },
    usage: { ...run.usage },
    checkpoint: undefined,
  }));
  return {
    ...source,
    id: clonedTaskId,
    sessionId: targetSessionId,
    userMessageId: undefined,
    cardMessageId: undefined,
    updatedAt: now,
    endedAt: now,
    budget: { ...source.budget },
    usage: { ...source.usage },
    ...(cloneImages(source.imageSources)
      ? {
          imageSources: cloneImages(source.imageSources),
        }
      : {}),
    sourceSnapshot: source.sourceSnapshot
      ? {
          ...source.sourceSnapshot,
          toolIds: [...source.sourceSnapshot.toolIds],
          pluginIds: [...source.sourceSnapshot.pluginIds],
          skillIds: [...source.sourceSnapshot.skillIds],
          knowledgeCollectionIds: [
            ...source.sourceSnapshot.knowledgeCollectionIds,
          ],
          attachmentIds: [...source.sourceSnapshot.attachmentIds],
          workspaceFileIds: [...source.sourceSnapshot.workspaceFileIds],
          ...(source.sourceSnapshot.workspaceSources
            ? {
                workspaceSources: source.sourceSnapshot.workspaceSources.map(
                  (workspaceSource) => ({ ...workspaceSource }),
                ),
              }
            : {}),
          memoryScopes: [...source.sourceSnapshot.memoryScopes],
          memoryScopeIds: { ...source.sourceSnapshot.memoryScopeIds },
        }
      : undefined,
    planVersions: source.planVersions.map((plan) => ({
      ...plan,
      id: uuidv7(),
      scope: {
        ...plan.scope,
        timeRange: plan.scope.timeRange
          ? { ...plan.scope.timeRange }
          : undefined,
        includes: [...plan.scope.includes],
        excludes: [...plan.scope.excludes],
        ...(plan.scope.preferredDomains
          ? { preferredDomains: [...plan.scope.preferredDomains] }
          : {}),
        ...(plan.scope.excludedDomains
          ? { excludedDomains: [...plan.scope.excludedDomains] }
          : {}),
        allowedSourceTypes: [...plan.scope.allowedSourceTypes],
      },
      assumptions: [...plan.assumptions],
      deliverable: {
        ...plan.deliverable,
        requiredSections: [...plan.deliverable.requiredSections],
      },
      strategy: { ...plan.strategy },
      recon: {
        ...plan.recon,
        usage: { ...plan.recon.usage },
        queries: plan.recon.queries.map((query) => ({
          ...query,
          domains: [...query.domains],
        })),
      },
      steps: plan.steps.map((step) => ({
        ...step,
        questions: [...step.questions],
        queryTopics: [...step.queryTopics],
        sourcePriorities: step.sourcePriorities.map((priority) => ({
          ...priority,
        })),
        evidenceCriteria: [...step.evidenceCriteria],
      })),
      completionCriteria: [...plan.completionCriteria],
    })),
    evidence,
    reportRuns,
    activeReportRunId: source.activeReportRunId
      ? reportRunIdMap.get(source.activeReportRunId)
      : undefined,
    reportVersions: source.reportVersions.map((report) => ({
      ...report,
      id: uuidv7(),
      researchRunId:
        reportRunIdMap.get(report.researchRunId) || report.researchRunId,
      artifactId: artifactUrls.get(report.artifactId) || report.artifactId,
      agentRunId: undefined,
      keyFindings: [...report.keyFindings],
      gaps: [...report.gaps],
      ...(report.coveredStepIds
        ? { coveredStepIds: [...report.coveredStepIds] }
        : {}),
      ...(report.evidenceIds
        ? {
            evidenceIds: report.evidenceIds.flatMap((id) => {
              const mapped = evidenceIdMap.get(id);
              return mapped ? [mapped] : [];
            }),
          }
        : {}),
      ...(cloneImages(report.imageSources)
        ? {
            imageSources: cloneImages(report.imageSources),
          }
        : {}),
      ...(report.diff
        ? {
            diff: {
              addedEvidenceIds: report.diff.addedEvidenceIds.flatMap((id) => {
                const mapped = evidenceIdMap.get(id);
                return mapped ? [mapped] : [];
              }),
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
    agentRunIds: [],
    executionRunIds: [],
    checkpoint: undefined,
    error: undefined,
  };
}

export async function duplicateResearchTaskSnapshots({
  targetSessionId,
  tasks,
  artifactUrls,
}: {
  targetSessionId: string;
  tasks: ResearchTask[];
  artifactUrls: ReadonlyMap<string, string>;
}): Promise<{ taskIdMap: Map<string, string>; createdTaskIds: string[] }> {
  const taskIdMap = new Map<string, string>();
  const createdTaskIds: string[] = [];
  try {
    for (const task of tasks) {
      const cloned = cloneResearchTask(task, targetSessionId, artifactUrls);
      await useResearchStore.getState().upsertTask(cloned);
      taskIdMap.set(task.id, cloned.id);
      createdTaskIds.push(cloned.id);
      await cloneResearchExtensions(task, cloned);
    }
    return { taskIdMap, createdTaskIds };
  } catch (error) {
    await removeResearchTaskSnapshots(createdTaskIds);
    throw error;
  }
}

export function remapResearchTaskBlocks(
  messageTree: SessionMessageTree,
  taskIdMap: ReadonlyMap<string, string>,
): SessionMessageTree {
  return {
    ...messageTree,
    nodesById: Object.fromEntries(
      Object.entries(messageTree.nodesById).map(([nodeId, node]) => {
        const outputBlocks = node.message.outputBlocks?.flatMap(
          (block): MessageOutputBlock[] => {
            if (block.type !== "research_task") return [block];
            const taskId = taskIdMap.get(block.taskId);
            return taskId ? [{ ...block, taskId }] : [];
          },
        );
        return [
          nodeId,
          {
            ...node,
            message: outputBlocks
              ? { ...node.message, outputBlocks }
              : node.message,
          },
        ];
      }),
    ),
  };
}

export async function removeResearchTaskSnapshots(
  taskIds: Iterable<string>,
): Promise<void> {
  await Promise.all(
    [...taskIds].map((taskId) =>
      useResearchStore.getState().removeTask(taskId),
    ),
  );
}
