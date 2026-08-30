import type { ResearchReportVersionView } from "../types";
import type { ResearchTask } from "@/lib/research";
import { resolveOPFSBlob } from "@/utils/opfs";

import type { ResearchViewModelText } from "./text";

function getMarkdownTitle(markdown: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || fallback;
}

export async function loadReports(
  task: ResearchTask,
  text: ResearchViewModelText,
): Promise<ResearchReportVersionView[]> {
  return Promise.all(
    task.reportVersions.map(async (report) => {
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
      };
    }),
  );
}
