import { getCitableResearchClaims } from "../orchestration";
import type {
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
} from "../types";
import {
  containsExactToken,
  extractAuditSection,
  normalizeAuditLabel,
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

function removePublicationOnlySections(markdown: string): string {
  const hiddenHeadings = new Set([
    normalizeAuditLabel("Research plan coverage"),
    normalizeAuditLabel("Evidence gaps"),
  ]);
  const kept: string[] = [];
  let hidden = false;
  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1].length <= 2) hidden = false;
    if (
      heading?.[1].length === 2 &&
      hiddenHeadings.has(normalizeAuditLabel(heading[2].replace(/[*_`]/g, "")))
    ) {
      hidden = true;
      continue;
    }
    if (!hidden) kept.push(line);
  }
  return kept.join("\n");
}

function appendToReportSection(
  markdown: string,
  heading: string,
  line: string,
): string {
  const normalizedHeading = normalizeAuditLabel(heading);
  const lines = markdown.split("\n");
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    if (start >= 0 && match[1].length <= 2) {
      return [...lines.slice(0, index), line, "", ...lines.slice(index)].join(
        "\n",
      );
    }
    if (
      start < 0 &&
      normalizeAuditLabel(match[2].replace(/[*_`]/g, "")) === normalizedHeading
    ) {
      start = index;
    }
  }
  if (start < 0) return markdown;
  return [...lines, "", line].join("\n");
}

export function prepareResearchReportForPublication({
  markdown,
  plan,
  run,
  evidence,
  singleSourceNote,
}: {
  markdown: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  singleSourceNote?: (count: number, total: number) => string;
}): string {
  let published = removePublicationOnlySections(
    normalizeResearchReportMarkdown(markdown),
  );

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

  for (const claim of run.claims) {
    const marker = escapeReportPattern(claim.id);
    published = published.replace(new RegExp(`\\[${marker}\\]\\s*`, "g"), "");
  }

  evidence.forEach((item, index) => {
    const label = escapeMarkdownLabel(getPublicationCitationLabel(item, index));
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
  return published.replace(/\n{3,}/g, "\n\n").trim();
}
