import type { ResearchClaimView, ResearchReportVersionView } from "../types";
import type { ClaimRecord, ResearchTask } from "@/lib/research";
import { resolveOPFSBlob } from "@/utils/opfs";

import type { ResearchViewModelText } from "./text";

function getMarkdownTitle(markdown: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || fallback;
}

export function buildClaimViews(
  claims: readonly ClaimRecord[],
): ResearchClaimView[] {
  return claims.map((claim) => ({
    id: claim.id,
    text: claim.text,
    importance: claim.importance,
    verificationStatus: claim.verificationStatus,
    independentPublisherCount: claim.independentPublisherCount,
    supportingEvidenceIds: [...claim.supportingEvidenceIds],
    contradictingEvidenceIds: [...claim.contradictingEvidenceIds],
    stepId: claim.stepId,
  }));
}

export async function loadReports(
  task: ResearchTask,
  text: ResearchViewModelText,
): Promise<ResearchReportVersionView[]> {
  return Promise.all(
    task.reportVersions.map(async (report) => {
      const plan = task.planVersions.find(
        (candidate) => candidate.version === report.planVersion,
      );
      const run = task.reportRuns.find(
        (candidate) => candidate.id === report.researchRunId,
      );
      const blob = await resolveOPFSBlob(report.artifactId);
      const markdown = blob
        ? await blob.text()
        : `_${text.artifactUnavailable}_`;
      return {
        id: report.id,
        version: report.version,
        planVersion: report.planVersion,
        researchRunId: report.researchRunId,
        createdAt: report.createdAt,
        title: getMarkdownTitle(
          markdown,
          text.fallbackReportTitle(report.version),
        ),
        markdown,
        kind: report.kind,
        gaps: [...report.gaps],
        coveredStepIds: [...(report.coveredStepIds ?? [])],
        planStepCount: plan?.steps.length ?? 0,
        ...(run?.stopReason ? { stopReason: { ...run.stopReason } } : {}),
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
        claims: buildClaimViews(run?.claims ?? []),
      };
    }),
  );
}
