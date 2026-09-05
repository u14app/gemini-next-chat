import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Nodes } from "mdast";

const parser = unified().use(remarkParse);
const HTML_TAG_RE = /<\/?[A-Za-z][^>\n]*>/g;

/** Repair attribute quoting only in an already identified HTML fragment. */
export function normalizeHtmlVisualFragment(source: string): string {
  return source.replace(HTML_TAG_RE, (tag) =>
    tag.replace(/\\"/g, '"').replace(/\\'/g, "'"),
  );
}

/** Code fences are literal, including unlabeled and markdown fences. */
export function normalizeHtmlVisualMarkdown(source: string): string {
  const ranges: Array<{ start: number; end: number; value: string }> = [];
  const visit = (node: Nodes) => {
    if (
      node.type === "html" &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      ranges.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        value: normalizeHtmlVisualFragment(node.value),
      });
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(source));
  let result = source;
  for (const range of ranges.reverse())
    result =
      result.slice(0, range.start) + range.value + result.slice(range.end);
  return result;
}
