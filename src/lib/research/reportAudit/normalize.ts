import {
  extractReportSection,
  readReportSections,
  reportSectionIdentity,
} from "../reportSections";

export const REQUIRED_REPORT_SECTIONS = [
  "Executive summary",
  "Key findings",
  "Research plan coverage",
  "Evidence gaps",
  "Sources",
] as const;

export function normalizeAuditLabel(value: string): string {
  return reportSectionIdentity(value);
}

function unwrapOuterMarkdownFence(value: string): string {
  const lines = value.trim().replace(/\r\n/g, "\n").split("\n");
  const openingIndex = lines.findIndex((line) =>
    /^(```|~~~)(?:markdown|md)\s*$/i.test(line.trim()),
  );
  if (openingIndex < 0) return lines.join("\n").trim();
  if (
    lines
      .slice(0, openingIndex)
      .some((line) => /^#{1,6}\s+\S/.test(line.trim()))
  ) {
    return lines.join("\n").trim();
  }
  const opening = /^(```|~~~)/.exec(lines[openingIndex].trim())?.[1];
  let closingIndex = lines.length - 1;
  while (closingIndex > openingIndex && !lines[closingIndex].trim()) {
    closingIndex -= 1;
  }
  if (
    !opening ||
    lines[closingIndex].trim() !== opening ||
    !lines
      .slice(openingIndex + 1, closingIndex)
      .some((line) => /^#\s+\S/.test(line))
  ) {
    return lines.join("\n").trim();
  }
  return lines
    .slice(openingIndex + 1, closingIndex)
    .join("\n")
    .trim();
}

function removeTrailingOrphanFence(value: string): string {
  const lines = value.split("\n");
  let openFence: "```" | "~~~" | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(```|~~~)(.*)$/.exec(lines[index]);
    if (!match) continue;
    const fence = match[1] as "```" | "~~~";
    if (!openFence) {
      openFence = fence;
      continue;
    }
    if (openFence === fence && !match[2].trim()) openFence = undefined;
  }
  if (!openFence || lines.at(-1)?.trim() !== openFence) return value.trim();
  return lines.slice(0, -1).join("\n").trim();
}

export function normalizeResearchReportMarkdown(value: string): string {
  let normalized = unwrapOuterMarkdownFence(value);
  const titleIndex =
    readReportSections(normalized).find((section) => section.depth === 1)
      ?.start ?? -1;
  if (titleIndex > 0) normalized = normalized.slice(titleIndex);
  return removeTrailingOrphanFence(normalized);
}

export const extractAuditSection = extractReportSection;

export function containsExactToken(section: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`,
    "m",
  ).test(section);
}
