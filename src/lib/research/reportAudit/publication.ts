import {
  DEFAULT_REPORT_SECTION_LABELS,
  omitReportSections,
  readReportSections,
  reportSectionIdentity,
  transformReportProse,
  type ReportSectionLabels,
} from "../reportSections";
import { getCitableResearchClaims } from "../orchestration";
import type {
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
} from "../types";
import {
  containsExactToken,
  extractAuditSection,
  normalizeResearchReportMarkdown,
} from "./normalize";

function escapeReportPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\]])/g, "\\$1");
}

function getPublicationCitationLabel(
  evidence: ResearchEvidence,
  index: number,
): string {
  const title = evidence.title?.trim();
  if (title && !/(?:^|\/)tool-results\//i.test(title)) return title;
  try {
    const url = new URL(evidence.locator);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.replace(/^www\./, "");
    }
  } catch {
    // Non-URL evidence receives a stable, human-readable local label below.
  }
  return `Source ${index + 1}`;
}

function removePublicationOnlySections(
  markdown: string,
  replaceGaps = false,
): string {
  return omitReportSections(markdown, [
    "planCoverage",
    "questionCoverage",
    ...(replaceGaps ? ["evidenceGaps" as const] : []),
  ]);
}

function appendToReportSection(
  markdown: string,
  heading: string,
  line: string,
): string {
  const section = readReportSections(markdown).find(
    (item) =>
      item.depth === 2 &&
      reportSectionIdentity(item.title) === reportSectionIdentity(heading),
  );
  if (!section) return markdown;
  return `${markdown.slice(0, section.end).trimEnd()}\n\n${line}\n\n${markdown.slice(section.end)}`;
}

export function prepareResearchReportForPublication({
  markdown,
  plan,
  run,
  evidence,
  singleSourceNote,
  gaps,
  qualityNotice,
  sectionLabels = DEFAULT_REPORT_SECTION_LABELS,
}: {
  markdown: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  singleSourceNote?: (count: number, total: number) => string;
  gaps?: readonly string[];
  qualityNotice?: string;
  sectionLabels?: ReportSectionLabels;
}): string {
  let published = removePublicationOnlySections(
    normalizeResearchReportMarkdown(markdown),
    gaps !== undefined,
  );
  if (qualityNotice?.trim()) {
    const notice = `> ${qualityNotice.trim().replace(/\n/g, " ")}`;
    published = /^#\s+.+(?:\n|$)/.test(published)
      ? published.replace(/^(#\s+.+)(?:\n|$)/, `$1\n\n${notice}\n`)
      : `${notice}\n\n${published}`;
  }
  if (gaps?.length) {
    published += `\n\n## ${sectionLabels.evidenceGaps}\n\n${gaps
      .map((gap) => `- ${gap.trim().replace(/\n/g, " ")}`)
      .join("\n")}`;
  }

  if (singleSourceNote) {
    const citedInFindings = getCitableResearchClaims(run, evidence).filter(
      (citable) =>
        containsExactToken(
          extractAuditSection(published, "Key findings"),
          citable.claim.id,
        ),
    );
    const singleSourceCount = citedInFindings.filter(
      (citable) => citable.confidence === "single_source",
    ).length;
    if (singleSourceCount > 0) {
      published = appendToReportSection(
        published,
        "Key findings",
        `_${singleSourceNote(singleSourceCount, citedInFindings.length)}_`,
      );
    }
  }

  published = transformReportProse(published, (prose) => {
    let published = prose;
    for (const claim of run.claims) {
      const marker = escapeReportPattern(claim.id);
      published = published.replace(new RegExp(`\\[${marker}\\]\\s*`, "g"), "");
    }

    evidence.forEach((item, index) => {
      const label = escapeMarkdownLabel(
        getPublicationCitationLabel(item, index),
      );
      const localLabel = `Source ${index + 1}`;
      const replacement = /^https?:\/\//i.test(item.locator)
        ? `[${label}](${item.locator})`
        : `[${localLabel}]`;
      for (const sourceId of [item.sourceId, ...(item.aliasSourceIds || [])]) {
        const sourcePattern = escapeReportPattern(sourceId);
        const locatorPattern = escapeReportPattern(item.locator);
        published = published.replace(
          new RegExp(
            `\\[${sourcePattern}\\]\\s+(?=\\[[^\\]]+\\]\\(${locatorPattern}\\))`,
            "g",
          ),
          "",
        );
        published = published.replace(
          new RegExp(`\\[${sourcePattern}\\]\\([^\\n)]+\\)`, "g"),
          replacement,
        );
        published = published.replace(
          new RegExp(`\\[${sourcePattern}\\]`, "g"),
          replacement,
        );
      }
    });

    const internalIds = new Set([
      ...plan.steps.map((step) => step.id),
      ...run.nodes.map((node) => node.id),
      ...evidence.map((item) => item.id),
    ]);
    for (const id of internalIds) {
      const marker = escapeReportPattern(id);
      published = published.replace(new RegExp(`\\[${marker}\\]\\s*`, "g"), "");
    }

    published = published
      .split("\n")
      .filter(
        (line) =>
          !/(?:reconstructed deterministically|model-authored report|publication audit|verified claim ledger)/i.test(
            line,
          ),
      )
      .join("\n");
    return published.replace(/\n{3,}/g, "\n\n");
  });
  return published.trim();
}
