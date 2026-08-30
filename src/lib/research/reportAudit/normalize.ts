export const REQUIRED_REPORT_SECTIONS = [
  "Executive summary",
  "Key findings",
  "Research plan coverage",
  "Evidence gaps",
  "Sources",
] as const;

const REPORT_SECTION_ALIASES = new Map<string, string>([
  ["executive summary", "Executive summary"],
  ["执行摘要", "Executive summary"],
  ["摘要", "Executive summary"],
  ["エグゼクティブサマリー", "Executive summary"],
  ["要約", "Executive summary"],
  ["key findings", "Key findings"],
  ["关键发现", "Key findings"],
  ["主要发现", "Key findings"],
  ["核心发现", "Key findings"],
  ["主な調査結果", "Key findings"],
  ["主要な調査結果", "Key findings"],
  ["research plan coverage", "Research plan coverage"],
  ["研究计划覆盖", "Research plan coverage"],
  ["研究计划覆盖情况", "Research plan coverage"],
  ["研究计划完成情况", "Research plan coverage"],
  ["調査計画のカバレッジ", "Research plan coverage"],
  ["調査計画の網羅状況", "Research plan coverage"],
  ["evidence gaps", "Evidence gaps"],
  ["证据缺口", "Evidence gaps"],
  ["证据不足", "Evidence gaps"],
  ["エビデンスギャップ", "Evidence gaps"],
  ["証拠の不足", "Evidence gaps"],
  ["sources", "Sources"],
  ["来源", "Sources"],
  ["资料来源", "Sources"],
  ["参考来源", "Sources"],
  ["情報源", "Sources"],
  ["出典", "Sources"],
]);

export function normalizeAuditLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
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
  const titleIndex = normalized.search(/^#\s+\S/m);
  if (titleIndex > 0) normalized = normalized.slice(titleIndex);
  normalized = removeTrailingOrphanFence(normalized);
  return normalized
    .split("\n")
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!heading || heading[1].length === 1) return line;
      const canonical = REPORT_SECTION_ALIASES.get(
        normalizeAuditLabel(heading[2].replace(/[*_`]/g, "")),
      );
      return canonical ? `## ${canonical}` : line;
    })
    .join("\n")
    .trim();
}

export function extractAuditSection(markdown: string, heading: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedHeading = normalizeAuditLabel(heading);
  let collecting = false;
  const section: string[] = [];
  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (collecting) break;
      collecting =
        normalizeAuditLabel(headingMatch[1].replace(/[*_`]/g, "")) ===
        normalizedHeading;
      continue;
    }
    if (collecting) section.push(line);
  }
  return section.join("\n").trim();
}

export function containsExactToken(section: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`,
    "m",
  ).test(section);
}
