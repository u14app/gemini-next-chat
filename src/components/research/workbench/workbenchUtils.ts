import type React from "react";

import type { Source } from "@/types";

import type { ResearchEvidenceView } from "../types";

export type WorkbenchTab = "plan" | "evidence" | "report" | "activity";
export type EvidenceStance = NonNullable<ResearchEvidenceView["stance"]>;
export type FollowupMode = "ask" | "continue";

export const WORKBENCH_TABS: WorkbenchTab[] = [
  "plan",
  "evidence",
  "report",
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
      linkedMarkdown = linkedMarkdown.replace(
        new RegExp(`${escapeRegExp(marker)}(?!\\s*\\()`, "gi"),
        `${marker}(#citation-${index})`,
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

export function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
