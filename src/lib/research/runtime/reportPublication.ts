import type { ReportSectionLabels } from "@/lib/research/reportSections";
import { v7 as uuidv7 } from "uuid";

import {
  finalizeResearchReportRun,
  getCoveredResearchStepIds,
  getReportVersion,
  normalizeResearchReportMarkdown,
  prepareResearchReportForPublication,
  summarizeResearchReport,
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchEvidence,
  type ResearchImageSource,
  type ResearchPlanVersion,
  type ResearchReportAuditSnapshot,
  type ResearchReportRun,
  type ResearchReportVersion,
  type ResearchTask,
} from "@/lib/research";
import { logDevError } from "@/lib/utils/devLogger";
import { useResearchStore } from "@/store/core/researchStore";
import {
  getResearchTaskRepository,
  publishResearchReportArtifact,
} from "@/services/research";
import {
  deleteWorkspaceFile,
  writeWorkspaceText,
} from "@/services/workspace/sessionWorkspace";
import { resolveOPFSBlob } from "@/utils/opfs";
import { createResearchEvidenceSnapshot } from "@/lib/research/evidenceConversations";
import { saveEvidenceSnapshot } from "@/services/research/evidenceConversations";
import { getResearchExtensionRepository } from "@/services/research/extensionRepository";

import { aggregateTaskUsage } from "./usage";
import { createAbortError, isAbortError } from "./operations";

async function verifyPublishedVersion(
  taskId: string,
  report: ResearchReportVersion,
  persistenceError: string,
  expectedMarkdown?: string,
) {
  const repository = getResearchTaskRepository();
  const persisted = await repository.get(taskId);
  if (
    !repository.getStatus().durable ||
    !persisted?.reportVersions.some(
      (version) =>
        version.id === report.id &&
        version.version === report.version &&
        version.researchRunId === report.researchRunId &&
        version.artifactId === report.artifactId,
    )
  ) {
    throw new Error(persistenceError);
  }
  const artifact = await resolveOPFSBlob(report.artifactId);
  const markdown = artifact ? await artifact.text() : "";
  if (
    !markdown ||
    (expectedMarkdown !== undefined && markdown !== expectedMarkdown)
  ) {
    throw new Error(persistenceError);
  }
}

export async function readReportMarkdown(
  task: ResearchTask,
  versionId?: string,
): Promise<string> {
  const report = getReportVersion(task, versionId);
  if (!report) return "";
  const blob = await resolveOPFSBlob(report.artifactId);
  return blob ? blob.text() : "";
}

export async function publishResearchReportVersion({
  taskId,
  plan,
  run,
  markdown,
  evidence,
  imageSources,
  extraGaps,
  audit,
  agentRunId,
  noEvidenceGap,
  noKeyFindingsGap,
  incompleteQuestionsGap,
  singleSourceNote,
  publicationNotice,
  noEvidenceNotice,
  auditWarning,
  snapshotUnavailableWarning,
  signal,
  persistenceError,
  sectionLabels,
}: {
  taskId: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  markdown: string;
  evidence: ResearchEvidence[];
  imageSources?: readonly ResearchImageSource[];
  extraGaps: string[];
  audit?: ResearchReportAuditSnapshot;
  agentRunId?: string;
  noEvidenceGap: string;
  noKeyFindingsGap: string;
  incompleteQuestionsGap: (count: number) => string;
  singleSourceNote: (count: number, total: number) => string;
  publicationNotice?: string;
  noEvidenceNotice?: string;
  auditWarning?: (count: number) => string;
  snapshotUnavailableWarning?: string;
  signal?: AbortSignal;
  persistenceError: string;
  sectionLabels?: ReportSectionLabels;
}): Promise<string[]> {
  const store = useResearchStore.getState();
  const assertRunning = () => {
    signal?.throwIfAborted();
    const task = useResearchStore.getState().tasksById[taskId];
    if (!task || task.status === "cancelled" || task.status === "paused") {
      throw createAbortError();
    }
  };
  assertRunning();
  const existing = store.tasksById[taskId]?.reportVersions.find(
    (report) => report.researchRunId === run.id,
  );
  if (existing) {
    await verifyPublishedVersion(taskId, existing, persistenceError);
    return [...existing.gaps];
  }
  const normalizedMarkdown = normalizeResearchReportMarkdown(markdown);
  if (!normalizedMarkdown) {
    throw new Error("The model returned an empty report.");
  }
  const reportImageSources =
    imageSources ??
    run.imageSources ??
    store.tasksById[taskId]?.imageSources ??
    [];
  const auditMetadata = summarizeResearchReport(normalizedMarkdown);
  const runEvidenceIds = new Set([
    ...run.nodes.flatMap((node) => node.evidenceIds),
    ...run.claims.flatMap((claim) => [
      ...claim.supportingEvidenceIds,
      ...claim.contradictingEvidenceIds,
    ]),
  ]);
  const reportEvidence = evidence.filter(
    (item) =>
      runEvidenceIds.has(item.id) ||
      normalizedMarkdown.includes(item.locator) ||
      item.aliasLocators?.some((locator) =>
        normalizedMarkdown.includes(locator),
      ) ||
      normalizedMarkdown.includes(`[${item.sourceId}]`) ||
      item.aliasSourceIds?.some((sourceId) =>
        normalizedMarkdown.includes(`[${sourceId}]`),
      ),
  );
  const gaps = [...auditMetadata.gaps, ...extraGaps];
  const auditIssueCount =
    (audit?.blocking.length ?? 0) + (audit?.advisory.length ?? 0);
  if (auditIssueCount > 0) {
    gaps.push(
      auditWarning?.(auditIssueCount) ||
        `${auditIssueCount} source or completeness issues remain. Treat unverified content as provisional.`,
    );
  }
  if (reportEvidence.length === 0) {
    gaps.push(noEvidenceGap);
  }
  if (auditMetadata.keyFindings.length === 0) {
    gaps.push(noKeyFindingsGap);
  }
  const coveredStepIds = getCoveredResearchStepIds(plan, run, evidence);
  if (coveredStepIds.length < plan.steps.length) {
    gaps.push(
      incompleteQuestionsGap(plan.steps.length - coveredStepIds.length),
    );
  }
  const uniqueGaps = Array.from(new Set(gaps.map((gap) => gap.trim()))).filter(
    Boolean,
  );
  const publicationMarkdown = prepareResearchReportForPublication({
    markdown: normalizedMarkdown,
    plan,
    run,
    evidence,
    singleSourceNote,
    sectionLabels,
    gaps: uniqueGaps,
    qualityNotice:
      reportEvidence.length === 0 ? noEvidenceNotice : publicationNotice,
  });
  const publicationMetadata = summarizeResearchReport(publicationMarkdown);

  await store.updateTask(taskId, (current) => ({
    ...(current.status === "researching"
      ? transitionResearchTask(
          transitionResearchTask(current, "verifying"),
          "synthesizing",
        )
      : current.status === "verifying"
        ? transitionResearchTask(current, "synthesizing")
        : current),
    evidence,
    ...(reportImageSources.length
      ? { imageSources: reportImageSources.map((image) => ({ ...image })) }
      : {}),
    usage: aggregateTaskUsage(current),
  }));
  assertRunning();
  if (!getResearchTaskRepository().getStatus().durable) {
    throw new Error(persistenceError);
  }
  const task = useResearchStore.getState().tasksById[taskId];
  if (!task) throw new Error("Research task was not found.");
  const previousReport = task.reportVersions.at(-1);
  const previousEvidenceIds = new Set(previousReport?.evidenceIds || []);
  const previousEvidence = previousReport?.evidenceIds
    ? task.evidence.filter((item) => previousEvidenceIds.has(item.id))
    : [];
  const addedEvidenceIds = reportEvidence
    .filter((item) => !previousEvidenceIds.has(item.id))
    .map((item) => item.id);
  const changedSourceIds = Array.from(
    new Set(
      reportEvidence
        .filter(
          (item) =>
            addedEvidenceIds.includes(item.id) &&
            previousEvidence.some(
              (previous) =>
                (previous.sourceId === item.sourceId ||
                  previous.locator === item.locator) &&
                previous.contentHash !== item.contentHash,
            ),
        )
        .map((item) => item.sourceId),
    ),
  );
  const changedSources = new Set(changedSourceIds);
  const unchangedSourceIds = Array.from(
    new Set(
      previousEvidence
        .filter(
          (previous) =>
            !changedSources.has(previous.sourceId) &&
            reportEvidence.some(
              (item) =>
                item.sourceId === previous.sourceId &&
                item.contentHash === previous.contentHash,
            ),
        )
        .map((item) => item.sourceId),
    ),
  );
  const version = task.reportVersions.length + 1;
  const reportPath = `research/${task.id}/report-v${version}.md`;
  const written = await writeWorkspaceText(
    task.sessionId,
    reportPath,
    publicationMarkdown,
    "overwrite",
  );
  if (!written.ok) throw new Error(written.error.message);
  assertRunning();
  const published = await publishResearchReportArtifact(
    task.sessionId,
    reportPath,
  );
  if (!published.ok) throw new Error(published.error.message);
  assertRunning();
  const artifact = await resolveOPFSBlob(published.value.url);
  if (!artifact || (await artifact.text()) !== publicationMarkdown) {
    throw new Error(persistenceError);
  }
  assertRunning();
  const report: ResearchReportVersion = {
    id: uuidv7(),
    version,
    artifactId: published.value.url,
    planVersion: plan.version,
    createdAt: Date.now(),
    summary: publicationMetadata.summary,
    keyFindings: publicationMetadata.keyFindings,
    gaps: uniqueGaps,
    researchRunId: run.id,
    coveredStepIds,
    evidenceIds: reportEvidence.map((item) => item.id),
    evidenceSnapshotStatus: "available",
    ...(reportImageSources.length
      ? { imageSources: reportImageSources.map((image) => ({ ...image })) }
      : {}),
    diff: {
      addedEvidenceIds,
      changedSourceIds,
      unchangedSourceIds,
    },
    ...(audit
      ? {
          audit: {
            ...audit,
            blocking: [...audit.blocking],
            advisory: [...audit.advisory],
          },
        }
      : {}),
    ...(agentRunId ? { agentRunId } : {}),
    kind: task.pendingReportKind,
  };
  try {
    try {
      await saveEvidenceSnapshot(
        createResearchEvidenceSnapshot({
          task: {
            ...task,
            evidence,
            reportRuns: [
              ...task.reportRuns.filter((item) => item.id !== run.id),
              run,
            ],
          },
          report,
          markdown: publicationMarkdown,
        }),
      );
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      report.evidenceSnapshotStatus = "unavailable";
      if (snapshotUnavailableWarning) {
        // This is a Q&A availability notice; the immutable report body is unchanged.
        report.gaps = [...report.gaps, snapshotUnavailableWarning];
      }
      logDevError("Research report saved without an evidence snapshot", error);
    }
    assertRunning();
    await store.updateTask(taskId, (current) => {
      assertRunning();
      if (
        current.reportVersions.some(
          (version) => version.researchRunId === run.id,
        )
      ) {
        throw new Error("This research run already has a published report.");
      }
      const finishedAt = Date.now();
      const status = report.gaps.length > 0 ? "partial_completed" : "completed";
      const completedRun = finalizeResearchReportRun(run, status, finishedAt);
      const withReport = {
        ...upsertResearchReportRun(current, completedRun),
        evidence,
        reportVersions: [...current.reportVersions, report],
        activeReportVersion: version,
        usage: aggregateTaskUsage(current),
        checkpoint: undefined,
      };
      return transitionResearchTask(withReport, status, { now: finishedAt });
    });
    await verifyPublishedVersion(
      taskId,
      report,
      persistenceError,
      publicationMarkdown,
    );
  } catch (error) {
    // The snapshot precedes the core report pointer. Remove only a proven
    // unpublished snapshot; a failed read must never erase a published version.
    try {
      const repository = getResearchTaskRepository();
      const persisted = await repository.get(taskId);
      if (
        repository.getStatus().durable &&
        !persisted?.reportVersions.some((item) => item.id === report.id)
      ) {
        await getResearchExtensionRepository().remove(
          "evidence_snapshot",
          report.id,
        );
      }
    } catch (cleanupError) {
      logDevError(
        "Failed to remove unpublished evidence snapshot",
        cleanupError,
      );
    }
    throw error;
  }
  await deleteWorkspaceFile(task.sessionId, reportPath).catch((error) => {
    logDevError(
      "Failed to remove published research report scratch file",
      error,
    );
  });
  return [...report.gaps];
}
