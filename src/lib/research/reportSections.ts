import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import {
  reportSectionIdentity,
  reportSectionKey,
  type ReportSectionKey,
  type ReportSectionLabels,
} from "./reportSectionLabels";
export * from "./reportSectionLabels";

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const createParser = () => unified().use(remarkParse).use(remarkGfm);
let parser: ReturnType<typeof createParser> | undefined;
function nodes(markdown: string): MarkdownNode[] {
  parser ??= createParser();
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
