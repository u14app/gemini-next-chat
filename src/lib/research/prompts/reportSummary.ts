import type { ResearchReportVersion, ResearchTask } from "../types";

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(?:^|\\n)##[ \\t]+${escaped}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]+|$)`,
    "i",
  ).exec(markdown.replace(/\r\n/g, "\n"));
  return match?.[1]?.trim() || "";
}

const clampText = (value: string, max: number) => value.trim().slice(0, max);

function sectionBullets(section: string, max: number): string[] {
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, "").trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, max);
}

export function summarizeResearchReport(markdown: string): {
  summary: string;
  keyFindings: string[];
  gaps: string[];
} {
  const executive = extractSection(markdown, "Executive summary");
  const firstParagraph = markdown
    .replace(/^#.+$/gm, "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean);
  const gapSection = extractSection(markdown, "Evidence gaps");
  const normalizedGap = gapSection.toLowerCase().trim();
  const noMaterialGaps =
    !normalizedGap ||
    /^(?:none|no gaps?|n\/?a|not applicable|无|没有|暂无|なし|特になし)[.!。\s]*$/i.test(
      normalizedGap,
    ) ||
    /(?:no|without) material (?:evidence )?gaps|无重大.*缺口|重大な.*なし/.test(
      normalizedGap,
    );
  return {
    summary: clampText(executive || firstParagraph || markdown, 8_000),
    keyFindings: sectionBullets(extractSection(markdown, "Key findings"), 12),
    gaps: noMaterialGaps ? [] : sectionBullets(gapSection, 20),
  };
}

export function parseResearchStepCoverage(
  markdown: string,
  allowedStepIds: readonly string[],
): string[] {
  const coverage = extractSection(markdown, "Research plan coverage");
  const allowed = new Set(allowedStepIds);
  const completed = new Set<string>();
  for (const line of coverage.split("\n")) {
    const match =
      /^\s*[-*+]\s+([A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*answered\b/i.exec(line);
    if (match && allowed.has(match[1])) completed.add(match[1]);
  }
  return allowedStepIds.filter((stepId) => completed.has(stepId));
}

/** Legacy report parser retained for already-rendered v1 Markdown only. */
export function parseResearchQuestionCoverage(
  markdown: string,
  questionCount: number,
): number[] {
  const coverage = extractSection(markdown, "Research question coverage");
  const completed = new Set<number>();
  for (const line of coverage.split("\n")) {
    const match = /^\s*[-*+]\s+Q(\d+)\s*:\s*answered\b/i.exec(line);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10) - 1;
    if (index >= 0 && index < questionCount) completed.add(index);
  }
  return [...completed].sort((left, right) => left - right);
}

export function getReportVersion(
  task: ResearchTask,
  versionId?: string,
): ResearchReportVersion | undefined {
  return versionId
    ? task.reportVersions.find((report) => report.id === versionId)
    : (task.reportVersions.find(
        (report) => report.version === task.activeReportVersion,
      ) ?? task.reportVersions.at(-1));
}
