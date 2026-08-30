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
  type ResearchPlanVersion,
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

import { aggregateTaskUsage } from "./usage";

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
  extraGaps,
  agentRunId,
  noEvidenceGap,
  noKeyFindingsGap,
  incompleteQuestionsGap,
  singleSourceNote,
  signal,
  persistenceError,
}: {
  taskId: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  markdown: string;
  evidence: ResearchEvidence[];
  extraGaps: string[];
  agentRunId?: string;
  noEvidenceGap: string;
  noKeyFindingsGap: string;
  incompleteQuestionsGap: (count: number) => string;
  singleSourceNote: (count: number, total: number) => string;
  signal?: AbortSignal;
  persistenceError: string;
}): Promise<string[]> {
  const store = useResearchStore.getState();
  const normalizedMarkdown = normalizeResearchReportMarkdown(markdown);
  if (!normalizedMarkdown) {
    throw new Error("The model returned an empty report.");
  }
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
    usage: aggregateTaskUsage(current),
  }));
  signal?.throwIfAborted();
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
  signal?.throwIfAborted();
  const published = await publishResearchReportArtifact(
    task.sessionId,
    reportPath,
  );
  if (!published.ok) throw new Error(published.error.message);
  signal?.throwIfAborted();
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
    diff: {
      addedEvidenceIds,
      changedSourceIds,
      unchangedSourceIds,
    },
    ...(agentRunId ? { agentRunId } : {}),
    kind: task.pendingReportKind,
  };
  await store.updateTask(taskId, (current) => {
    const finishedAt = Date.now();
    const status = uniqueGaps.length > 0 ? "partial_completed" : "completed";
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
  if (!getResearchTaskRepository().getStatus().durable) {
    throw new Error(persistenceError);
  }
  await deleteWorkspaceFile(task.sessionId, reportPath).catch((error) => {
    logDevError(
      "Failed to remove published research report scratch file",
      error,
    );
  });
  return uniqueGaps;
}
