import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { PluggableList } from "unified";
import type {
  Root as MarkdownRoot,
  RootContent,
  Nodes as MarkdownNode,
} from "mdast";
import type { Root, RootContent as HtmlNode, Element } from "hast";
import type { Source } from "@/types";
import type { MarkdownContentPolicy } from "./types";
import { MARKDOWN_FILE_LIMITS } from "@/config/limits";

export type SpecialContent =
  | {
      kind: "code";
      source: string;
      value: string;
      language: string;
      incomplete: boolean;
    }
  | {
      kind: "math";
      source: string;
      value: string;
      inline: boolean;
      incomplete: boolean;
    }
  | { kind: "file"; source: string }
  | {
      kind: "pending";
      source: string;
      features: Array<"gfm" | "math" | "html">;
    };
export type RenderElement = Element & {
  data?: Element["data"] & { special?: SpecialContent };
};
export interface SyntaxCandidates {
  gfm: boolean;
  math: boolean;
  html: boolean;
}
interface FileRange {
  start: number;
  end: number;
  source: string;
}
export interface PreparedMarkdown {
  source: string;
  masked: string;
  tree: MarkdownRoot;
  files: FileRange[];
  candidates: SyntaxCandidates;
}
export interface MarkdownBlockSnapshot {
  id: string;
  signature: string;
  node: HtmlNode;
}
const basicParser = unified().use(remarkParse);

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void) {
  callback(node);
  if ("children" in node)
    node.children.forEach((child) => visit(child, callback));
}
function candidateFlags(node: MarkdownNode, source: string): SyntaxCandidates {
  const flags = { gfm: false, math: false, html: false };
  const scan = (child: MarkdownNode, inLink = false) => {
    if (
      child.type === "code" ||
      child.type === "inlineCode" ||
      child.type === "image"
    )
      return;
    if (child.type === "html") {
      flags.html = true;
      return;
    }
    if (child.type === "definition") {
      if (child.identifier.startsWith("^")) flags.gfm = true;
      return;
    }
    if (child.type === "text" || child.type === "linkReference") {
      const value = source.slice(
        child.position?.start.offset,
        child.position?.end.offset,
      );
      if (
        /[|~]|\[[ xX]\]|\[\^/.test(value) ||
        (!inLink &&
          child.type !== "linkReference" &&
          /https?:\/\/|www\.|[^\s]+@[^\s]+\./.test(value))
      )
        flags.gfm = true;
      if (/(^|[^\\])\$(?:\$|[^$]*\$)/.test(value)) flags.math = true;
    }
    if ("children" in child)
      child.children.forEach((nested) =>
        scan(
          nested,
          inLink || child.type === "link" || child.type === "linkReference",
        ),
      );
  };
  scan(node);
  return flags;
}

/** CommonMark establishes the containers before any extension is considered. */
export function prepareMarkdown(
  source: string,
  contentPolicy?: MarkdownContentPolicy,
): PreparedMarkdown {
  const original = basicParser.parse(source);
  if (contentPolicy === "evidence-answer")
    return {
      source,
      masked: source,
      tree: original,
      files: [],
      candidates: { ...candidateFlags(original, source), html: false },
    };
  const files: FileRange[] = [];
  for (const node of original.children) {
    if (node.type !== "html" || !/^<\/?file\b/i.test(node.value)) continue;
    for (const opening of node.value.matchAll(
      /^[ \t]*<file\b[^>\n]*\bname\s*=[^>\n]*>[ \t]*\r?$/gim,
    )) {
      const start =
        (node.position?.start.offset ?? 0) +
        (opening.index ?? 0) +
        opening[0].indexOf("<");
      if (files.some((file) => start < file.end)) continue;
      const closing = /^[ \t]*<\/file>[ \t]*\r?$/gim;
      closing.lastIndex = start;
      const match = closing.exec(source);
      const end = match ? match.index + match[0].length : source.length;
      files.push({ start, end, source: source.slice(start, end) });
    }
  }
  let masked = source;
  for (const file of [...files].reverse()) {
    const placeholder = file.source.replace(/[^\r\n]/g, " ");
    masked =
      masked.slice(0, file.start) +
      "x" +
      placeholder.slice(1) +
      masked.slice(file.end);
  }
  const tree = files.length ? basicParser.parse(masked) : original;
  const candidates = candidateFlags(tree, masked);
  return { source, masked, tree, files, candidates };
}

function pendingGrammarRanges(
  tree: MarkdownRoot,
  source: string,
  enabled: SyntaxCandidates,
) {
  const ranges: Array<{ start: number; end: number; feature: "gfm" | "math" }> =
    [];
  if (!enabled.gfm) {
    tree.children.forEach((node, index) => {
      if (node.type !== "definition" || !node.identifier.startsWith("^"))
        return;
      const start = node.position?.start.offset;
      if (start === undefined) return;
      let end = node.position?.end.offset ?? start;
      for (const next of tree.children.slice(index + 1)) {
        const nextStart = next.position?.start.offset ?? 0;
        const lineStart = source.lastIndexOf("\n", nextStart - 1) + 1;
        if (next.type !== "code" || !/^[ \t]{4}/.test(source.slice(lineStart)))
          break;
        end = next.position?.end.offset ?? end;
      }
      ranges.push({ start, end, feature: "gfm" });
    });
  }
  if (!enabled.math) {
    const literals: Array<{ start: number; end: number }> = [];
    visit(tree, (node) => {
      if (node.type === "code" || node.type === "inlineCode")
        literals.push({
          start: node.position?.start.offset ?? 0,
          end: node.position?.end.offset ?? 0,
        });
    });
    let open: { start: number; end: number } | null = null;
    for (const match of source.matchAll(
      /^[ \t]*(?:(?:>[ \t]*)|(?:[-+*]|\d+[.)])[ \t]+)*(\${2,})[ \t]*$/gm,
    )) {
      const offset = (match.index ?? 0) + match[0].indexOf("$");
      if (
        literals.some(
          (literal) => literal.start <= offset && offset < literal.end,
        )
      )
        continue;
      const owner = tree.children.find(
        (node) =>
          (node.position?.start.offset ?? 0) <= offset &&
          (node.position?.end.offset ?? 0) >= offset,
      );
      if (!owner?.position) continue;
      if (open && offset >= open.end) {
        ranges.push({ ...open, feature: "math" });
        open = null;
      }
      if (open) {
        ranges.push({
          start: open.start,
          end: owner.position.end.offset ?? source.length,
          feature: "math",
        });
        open = null;
      } else {
        open = {
          start: owner.position.start.offset ?? offset,
          end:
            owner.type === "blockquote" || owner.type === "list"
              ? (owner.position.end.offset ?? source.length)
              : source.length,
        };
      }
    }
    if (open) ranges.push({ ...open, feature: "math" });
  }
  return ranges;
}

function fencedIncomplete(source: string, math = false): boolean {
  const lines = source.split(/\r?\n/);
  const opening = lines[0].match(math ? /^(\${2,})/ : /^(`{3,}|~{3,})/);
  if (!opening) return false;
  if (lines.length < 2) return true;
  const last = lines[lines.length - 1].replace(/^[\s>]+/, "");
  return !new RegExp(
    `^${opening[1][0] === "$" ? "\\$" : opening[1][0]}{${opening[1].length},}[ \\t]*$`,
  ).test(last);
}

function citationTransform(root: MarkdownRoot, web: Source[], rag: Source[]) {
  function link(value: string, index: number): RootContent {
    return {
      type: "link",
      url: `#citation-${index}`,
      children: [{ type: "text", value }],
    };
  }
  const walk = (node: MarkdownNode) => {
    if (!("children" in node) || node.type === "link") return;
    const next: MarkdownNode[] = [];
    for (const child of node.children) {
      if (
        child.type === "footnoteReference" &&
        /^\d+$/.test(child.identifier) &&
        rag[Number(child.identifier) - 1]
      ) {
        const index = web.length + Number(child.identifier) - 1;
        next.push(link(String(index + 1), index));
      } else if (
        child.type === "linkReference" &&
        child.referenceType === "shortcut" &&
        /^(\^)?\d+$/.test(child.identifier)
      ) {
        const knowledge = child.identifier.startsWith("^");
        const number = Number(child.identifier.replace(/^\^/, ""));
        const source = (knowledge ? rag : web)[number - 1];
        if (source) {
          const index = (knowledge ? web.length : 0) + number - 1;
          next.push(link(String(index + 1), index));
        } else next.push(child);
      } else if (child.type === "text") {
        let cursor = 0;
        for (const match of child.value.matchAll(
          /\[(\^)?(\d+)\](?!\s*[:(])/g,
        )) {
          const knowledge = Boolean(match[1]);
          const number = Number(match[2]);
          if (!(knowledge ? rag : web)[number - 1]) continue;
          const offset = match.index ?? 0;
          if (offset > cursor)
            next.push({
              type: "text",
              value: child.value.slice(cursor, offset),
            });
          const index = (knowledge ? web.length : 0) + number - 1;
          next.push(link(String(index + 1), index));
          cursor = offset + match[0].length;
        }
        if (cursor === 0) next.push(child);
        else if (cursor < child.value.length)
          next.push({ type: "text", value: child.value.slice(cursor) });
      } else {
        walk(child);
        next.push(child);
      }
    }
    // All replacements preserve the parent's phrasing/flow category.
    (node as { children: MarkdownNode[] }).children = next;
  };
  walk(root);
}

export function compileMarkdown({
  prepared,
  remarkPlugins = [],
  htmlPlugins = [],
  enabled,
  web = [],
  rag = [],
  documentId,
  contentPolicy,
}: {
  prepared: PreparedMarkdown;
  remarkPlugins?: PluggableList;
  htmlPlugins?: PluggableList;
  enabled: SyntaxCandidates;
  web?: Source[];
  rag?: Source[];
  documentId: string;
  contentPolicy?: MarkdownContentPolicy;
}): Root {
  const restricted = contentPolicy === "evidence-answer";
  const { source } = prepared;
  const masked = restricted ? source : prepared.masked;
  const files = restricted ? [] : prepared.files;
  const tree = unified().use(remarkParse).use(remarkPlugins).parse(masked);
  const special = new Map<number, SpecialContent>();
  for (const [index, file] of files.entries()) {
    special.set(
      file.start,
      index < MARKDOWN_FILE_LIMITS.maxFiles
        ? { kind: "file", source: file.source }
        : {
            kind: "pending",
            source: `[Additional generated files omitted because this message includes more than ${MARKDOWN_FILE_LIMITS.maxFiles} file blocks.]`,
            features: [],
          },
    );
  }
  const pendingRanges = pendingGrammarRanges(tree, masked, enabled);
  for (const range of pendingRanges) {
    if (!special.has(range.start))
      special.set(range.start, {
        kind: "pending",
        source: source.slice(range.start, range.end),
        features: [range.feature],
      });
  }
  for (const node of tree.children) {
    const flags = candidateFlags(node, masked);
    const features = (
      Object.keys(flags) as Array<keyof SyntaxCandidates>
    ).filter(
      (key) => flags[key] && !enabled[key] && (!restricted || key !== "html"),
    );
    const start = node.position?.start.offset;
    if (
      features.length &&
      start !== undefined &&
      !special.has(start) &&
      !pendingRanges.some((range) => range.start <= start && start < range.end)
    ) {
      special.set(start, {
        kind: "pending",
        source: source.slice(start, node.position?.end.offset),
        features,
      });
    }
  }
  visit(tree, (node) => {
    const start = node.position?.start.offset;
    if (
      start === undefined ||
      special.has(start) ||
      pendingRanges.some((range) => range.start <= start && start < range.end)
    )
      return;
    const literal = source.slice(start, node.position?.end.offset);
    if (node.type === "code")
      special.set(start, {
        kind: "code",
        source: literal,
        value: node.value,
        language: node.lang?.toLowerCase().split(/\s/)[0] || "",
        incomplete: fencedIncomplete(literal),
      });
    if (node.type === "math" || node.type === "inlineMath")
      special.set(start, {
        kind: "math",
        source: literal,
        value: node.value,
        inline: node.type === "inlineMath",
        incomplete: node.type === "math" && fencedIncomplete(literal, true),
      });
  });
  citationTransform(tree, web, rag);
  const result = unified()
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: `md-${documentId}-`,
    })
    .use(() => (root: Root) => {
      const namespace = (node: Root | HtmlNode) => {
        if (node.type === "element") {
          if (node.properties.id === "footnote-label")
            node.properties.id = `md-${documentId}-footnote-label`;
          if (Array.isArray(node.properties.ariaDescribedBy))
            node.properties.ariaDescribedBy =
              node.properties.ariaDescribedBy.map((value) =>
                value === "footnote-label"
                  ? `md-${documentId}-footnote-label`
                  : value,
              );
        }
        if ("children" in node) node.children.forEach(namespace);
      };
      namespace(root);
    })
    .use(restricted ? [] : htmlPlugins)
    .runSync(tree) as Root;
  const attach = (parent: Root | Element) => {
    parent.children = parent.children
      .filter((node) => {
        if (
          restricted &&
          (node.type === "raw" ||
            (node.type === "element" && node.tagName === "img"))
        )
          return false;
        const start = node.position?.start.offset;
        return (
          start === undefined ||
          !pendingRanges.some(
            (range) => range.start < start && start < range.end,
          )
        );
      })
      .map((node) => {
        const start = node.position?.start.offset;
        const metadata = start === undefined ? undefined : special.get(start);
        if (metadata && node.type === "element") {
          // The outer pre owns code; the math code/span owns inline math.
          if (metadata.kind !== "code" || node.tagName === "pre") {
            const replacement: RenderElement = {
              type: "element",
              tagName:
                metadata.kind === "math" && metadata.inline ? "span" : "div",
              properties: {},
              children: [],
              position: node.position,
              data: { special: metadata },
            };
            special.delete(start!);
            return replacement;
          }
        }
        if (node.type === "element") attach(node);
        if (node.type === "raw")
          return {
            type: "text" as const,
            value: node.value,
            position: node.position,
          };
        return node;
      });
  };
  attach(result);
  // A pending footnote definition has no HTML output until the GFM parser arrives.
  for (const [start, metadata] of special) {
    if (metadata.kind === "pending")
      result.children.push({
        type: "element",
        tagName: "div",
        properties: {},
        children: [],
        data: { special: metadata },
        position: {
          start: { line: 1, column: 1, offset: start },
          end: { line: 1, column: 1, offset: start },
        },
      } as RenderElement);
  }
  result.children.sort(
    (a, b) =>
      (a.position?.start.offset ?? Infinity) -
      (b.position?.start.offset ?? Infinity),
  );
  return result;
}

/** Reuse unchanged snapshots so capability completion cannot invalidate sibling renderers. */
export function reconcileMarkdownBlocks(
  tree: Root,
  previous: Map<string, MarkdownBlockSnapshot>,
): MarkdownBlockSnapshot[] {
  const occurrences = new Map<string, number>();
  return tree.children
    .filter((node) => node.type !== "text" || node.value.trim())
    .map((node) => {
      const anchor =
        node.position?.start.offset === undefined
          ? "generated"
          : String(node.position.start.offset);
      const occurrence = occurrences.get(anchor) || 0;
      occurrences.set(anchor, occurrence + 1);
      const id = `${anchor}:${occurrence}`;
      const signature = JSON.stringify(node, (key, value) =>
        key === "position" ? undefined : value,
      );
      const old = previous.get(id);
      return old?.signature === signature ? old : { id, signature, node };
    });
}
