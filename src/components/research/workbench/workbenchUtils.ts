import type React from "react";

import type { Source } from "@/types";
import {
  projectResearchReport,
  transformReportProse,
  type ReportSectionLabels,
} from "@/lib/research/reportSections";

import type { ResearchEvidenceView } from "../types";
import { formatResearchTokens } from "../formatters";

export type WorkbenchTab =
  | "plan"
  | "evidence"
  | "claims"
  | "report"
  | "supplements"
  | "questions"
  | "activity";
export type EvidenceStance = NonNullable<ResearchEvidenceView["stance"]>;
export type FollowupMode = "ask" | "continue";

export const WORKBENCH_TABS: WorkbenchTab[] = [
  "plan",
  "evidence",
  "claims",
  "report",
  "supplements",
  "questions",
  "activity",
];
export const EVIDENCE_STANCES: EvidenceStance[] = [
  "supports",
  "contradicts",
  "context",
];

export function handleTabKeyDown({
  event,
  index,
  select,
}: {
  event: React.KeyboardEvent<HTMLButtonElement>;
  index: number;
  select: (tab: WorkbenchTab) => void;
}) {
  let nextIndex = index;
  if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % WORKBENCH_TABS.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + WORKBENCH_TABS.length) % WORKBENCH_TABS.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = WORKBENCH_TABS.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  select(WORKBENCH_TABS[nextIndex]);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLElement>('[role="tab"]')
    [nextIndex]?.focus();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripLeadingMarkdownTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+(?:\r?\n|$)/, "").trimStart();
}

export function createLocalEvidenceCitations(
  markdown: string,
  evidence: ResearchEvidenceView[],
): { markdown: string; sources: Source[] } {
  const localEvidence = evidence.filter((item) => !item.url);
  let linkedMarkdown = markdown;
  const lines = markdown.split(/\r?\n/);
  const sources = localEvidence.map((item, index): Source => {
    const sourceLines = lines.filter(
      (line) =>
        /\[Source\s+\d+\]/i.test(line) &&
        (Boolean(item.locator && line.includes(item.locator)) ||
          (item.title.length >= 8 && line.includes(item.title))),
    );
    const markers = new Set(
      sourceLines.flatMap((line) =>
        Array.from(line.matchAll(/\[Source\s+\d+\]/gi)).map(
          (match) => match[0],
        ),
      ),
    );
    if (markers.size === 0) {
      markers.add(`[Source ${evidence.indexOf(item) + 1}]`);
    }
    for (const marker of markers) {
      linkedMarkdown = transformReportProse(linkedMarkdown, (prose) =>
        prose.replace(
          new RegExp(`${escapeRegExp(marker)}(?!\\s*\\()`, "gi"),
          `${marker}(#citation-${index})`,
        ),
      );
    }
    return {
      title: item.title,
      url: "",
      content: item.excerpt || item.locator || "",
      metadata: { researchEvidenceId: item.id },
    };
  });
  return { markdown: linkedMarkdown, sources };
}

export interface ResearchReportPresentation {
  /** The complete, localized document used for downloads and printing. */
  markdown: string;
  /** The report body shown above the supplementary material tab. */
  bodyMarkdown: string;
  /** Sources, gaps, and other appendices shown in the supplementary tab. */
  supplementsMarkdown: string;
  sources: Source[];
}

/**
 * Localize section headings, link local citations once against the complete
 * document, then split it. Keeping citation indexing at the full-document
 * boundary means each report surface uses the same immutable source list.
 */
export function createReportPresentation(
  markdown: string,
  evidence: ResearchEvidenceView[],
  labels: ReportSectionLabels,
): ResearchReportPresentation {
  const localized = projectResearchReport(markdown, labels);
  const cited = createLocalEvidenceCitations(localized.markdown, evidence);
  const projected = projectResearchReport(cited.markdown, labels);
  return {
    // Offline exports retain stable citation markers, not workbench-only anchors.
    markdown: localized.markdown,
    bodyMarkdown: stripLeadingMarkdownTitle(projected.bodyMarkdown),
    supplementsMarkdown: projected.supplementsMarkdown,
    sources: cited.sources,
  };
}

export function formatTokens(value: number, locale: string): string {
  return formatResearchTokens(value, locale);
}
