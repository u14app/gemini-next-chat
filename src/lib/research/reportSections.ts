import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export const DEFAULT_REPORT_SECTION_LABELS = {
  executiveSummary: "Executive summary",
  keyFindings: "Key findings",
  planCoverage: "Research plan coverage",
  evidenceGaps: "Evidence gaps",
  sources: "Sources",
  knowledgeSupplement: "Knowledge supplement (not verified in this research)",
  unverifiedMaterial: "Unverified supplied material",
  questionsToVerify: "Questions still to verify",
  questionCoverage: "Research question coverage",
} as const;

export type ReportSectionKey = keyof typeof DEFAULT_REPORT_SECTION_LABELS;
export type ReportSectionLabels = Record<ReportSectionKey, string>;

const aliases: Record<ReportSectionKey, readonly string[]> = {
  executiveSummary: ["执行摘要", "摘要", "エグゼクティブサマリー", "要約"],
  keyFindings: [
    "关键发现",
    "主要发现",
    "核心发现",
    "主な調査結果",
    "主要な調査結果",
  ],
  planCoverage: [
    "研究计划覆盖",
    "研究计划覆盖情况",
    "研究计划完成情况",
    "調査計画のカバレッジ",
    "調査計画の網羅状況",
  ],
  evidenceGaps: ["证据缺口", "证据不足", "エビデンスギャップ", "証拠の不足"],
  sources: ["来源", "资料来源", "参考来源", "情報源", "出典"],
  knowledgeSupplement: [
    "Knowledge supplement",
    "知识补充",
    "模型知识补充",
    "知识补充（本次研究未验证）",
    "知识补充（本次研究未核验）",
    "知識の補足",
    "知識補足",
    "知識の補足（本調査では未検証）",
  ],
  unverifiedMaterial: [
    "未验证的已提供材料",
    "未核验的已提供材料",
    "未验证资料",
    "未検証の提供資料",
  ],
  questionsToVerify: [
    "待验证问题",
    "待核验问题",
    "今後検証すべき問い",
    "未検証の問い",
  ],
  questionCoverage: ["研究问题覆盖", "研究问题覆盖情况", "調査質問の網羅状況"],
};

function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[*_`]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const sectionKeys = Object.keys(
  DEFAULT_REPORT_SECTION_LABELS,
) as ReportSectionKey[];
const keyByLabel = new Map(
  sectionKeys.flatMap((key) =>
    [key, DEFAULT_REPORT_SECTION_LABELS[key], ...aliases[key]].map(
      (label) => [normalizeLabel(label), key] as const,
    ),
  ),
);

export function reportSectionKey(label: string): ReportSectionKey | undefined {
  return keyByLabel.get(normalizeLabel(label));
}

/** Semantic identity is independent of the language used in the document. */
export function reportSectionIdentity(label: string): string {
  return reportSectionKey(label) ?? normalizeLabel(label);
}

export function createReportSectionLabels(
  translate: (key: `report.sections.${ReportSectionKey}`) => string,
): ReportSectionLabels {
  return Object.fromEntries(
    sectionKeys.map((key) => {
      const translationKey = `report.sections.${key}` as const;
      const label = translate(translationKey);
      return [
        key,
        label === translationKey ? DEFAULT_REPORT_SECTION_LABELS[key] : label,
      ];
    }),
  ) as ReportSectionLabels;
}

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm);
function nodes(markdown: string): MarkdownNode[] {
  return (parser.parse(markdown) as MarkdownNode).children ?? [];
}
function nodeText(node: MarkdownNode): string {
  return node.value ?? node.children?.map(nodeText).join("") ?? "";
}

function hasHeadingLink(node: MarkdownNode): boolean {
  return (
    [
      "link",
      "linkReference",
      "image",
      "imageReference",
      "footnoteReference",
    ].includes(node.type) || Boolean(node.children?.some(hasHeadingLink))
  );
}

export interface ReportSection {
  title: string;
  key?: ReportSectionKey;
  depth: number;
  start: number;
  headingEnd: number;
  end: number;
}

/** Root headings only: code, quotes, nested lists, and subheadings are content. */
export function readReportSections(markdown: string): ReportSection[] {
  const headings = nodes(markdown).filter(
    (node) => node.type === "heading" && (node.depth ?? 0) <= 2,
  );
  return headings.map((node, index) => ({
    title: nodeText(node),
    key:
      node.depth === 2 && !hasHeadingLink(node)
        ? reportSectionKey(nodeText(node))
        : undefined,
    depth: node.depth!,
    start: node.position!.start.offset!,
    headingEnd: node.position!.end.offset!,
    end: headings[index + 1]?.position?.start.offset ?? markdown.length,
  }));
}

/** Keep code and reference syntax intact while editing publication prose. */
export function transformReportProse(
  markdown: string,
  transform: (value: string) => string,
): string {
  const protectedNodes: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    if (
      ["code", "inlineCode", "linkReference", "definition"].includes(node.type)
    )
      protectedNodes.push(node);
    else node.children?.forEach(visit);
  };
  nodes(markdown).forEach(visit);
  let offset = 0;
  const parts: string[] = [];
  for (const node of protectedNodes) {
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    parts.push(
      transform(markdown.slice(offset, start)),
      markdown.slice(start, end),
    );
    offset = end;
  }
  parts.push(transform(markdown.slice(offset)));
  return parts.join("");
}

/** Inspect rendered citations, resolving definitions without citing unused ones. */
export function readReportCitations(
  markdown: string,
  referenceContext = markdown,
): { urls: string[]; sourceIds: string[] } {
  const definitions = new Map<string, string>();
  const footnotes = new Map<string, MarkdownNode>();
  const referenceNodes = nodes(referenceContext);
  const collect = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier, node.url);
    if (node.type === "footnoteDefinition" && node.identifier)
      footnotes.set(node.identifier, node);
    node.children?.forEach(collect);
  };
  referenceNodes.forEach(collect);
  const urls = new Set<string>();
  const sourceIds = new Set<string>();
  const visitedNotes = new Set<string>();
  const visit = (node: MarkdownNode) => {
    if (
      ["code", "inlineCode", "definition", "footnoteDefinition"].includes(
        node.type,
      )
    )
      return;
    if (node.type === "link" && node.url) urls.add(node.url);
    if (node.type === "link" || node.type === "linkReference") {
      const label = nodeText(node);
      if (/^source-[A-Za-z0-9:_-]+$/.test(label)) sourceIds.add(label);
    }
    if (node.type === "linkReference" && node.identifier) {
      const url = definitions.get(node.identifier);
      if (url) urls.add(url);
    }
    if (
      node.type === "footnoteReference" &&
      node.identifier &&
      !visitedNotes.has(node.identifier)
    ) {
      visitedNotes.add(node.identifier);
      footnotes.get(node.identifier)?.children?.forEach(visit);
    }
    if (node.type === "text" && node.value) {
      for (const match of node.value.matchAll(/\[(source-[A-Za-z0-9:_-]+)\]/g))
        sourceIds.add(match[1]);
    }
    node.children?.forEach(visit);
  };
  (markdown === referenceContext ? referenceNodes : nodes(markdown)).forEach(
    visit,
  );
  return { urls: [...urls], sourceIds: [...sourceIds] };
}

export function extractReportSection(
  markdown: string,
  heading: string,
): string {
  const identity = reportSectionIdentity(heading);
  const section = readReportSections(markdown).find(
    (item) =>
      item.depth === 2 && reportSectionIdentity(item.title) === identity,
  );
  return section ? markdown.slice(section.headingEnd, section.end).trim() : "";
}

export function omitReportSections(
  markdown: string,
  omitted: readonly ReportSectionKey[],
): string {
  let result = markdown;
  for (const section of readReportSections(markdown).reverse()) {
    if (section.key && omitted.includes(section.key)) {
      result = result.slice(0, section.start) + result.slice(section.end);
    }
  }
  return retainDefinitions(result, reportDefinitions(markdown));
}

function reportDefinitions(markdown: string): string[] {
  return nodes(markdown)
    .filter(
      (node) =>
        node.type === "definition" || node.type === "footnoteDefinition",
    )
    .map((node) =>
      markdown.slice(node.position!.start.offset!, node.position!.end.offset!),
    );
}

function retainDefinitions(markdown: string, definitions: string[]): string {
  const content = markdown.trim();
  return content
    ? [
        content,
        ...definitions.filter((definition) => !content.includes(definition)),
      ].join("\n\n")
    : "";
}

const SUPPLEMENT_SECTIONS = new Set<ReportSectionKey>([
  "sources",
  "knowledgeSupplement",
  "evidenceGaps",
  "unverifiedMaterial",
  "questionsToVerify",
  "planCoverage",
  "questionCoverage",
]);

/** A read-only projection; saved versions and their evidence snapshots stay fixed. */
export function projectResearchReport(
  markdown: string,
  labels: ReportSectionLabels,
) {
  let localized = markdown;
  for (const section of readReportSections(markdown).reverse()) {
    if (section.key) {
      localized =
        localized.slice(0, section.start) +
        `## ${labels[section.key]}` +
        localized.slice(section.headingEnd);
    }
  }
  // Use the original section identities: callers may provide any translated label.
  const original = readReportSections(markdown);
  const sections = readReportSections(localized);
  const body: string[] = [
    localized.slice(0, sections[0]?.start ?? localized.length),
  ];
  const supplements: string[] = [];
  sections.forEach((section, index) => {
    const key = original[index]?.key;
    const target = key && SUPPLEMENT_SECTIONS.has(key) ? supplements : body;
    target.push(localized.slice(section.start, section.end));
  });
  const definitions = reportDefinitions(localized);
  return {
    markdown: localized,
    bodyMarkdown: retainDefinitions(body.join(""), definitions),
    supplementsMarkdown: retainDefinitions(supplements.join(""), definitions),
  };
}
