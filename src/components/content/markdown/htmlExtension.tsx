import React from "react";
import { normalizeHtmlVisualFragment } from "@/lib/utils/htmlVisualMarkdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import "./html.css";
import "./table.css";
import {
  sanitizeHtmlStyle,
  sanitizeHtmlTableContainerStyle,
} from "@/lib/utils/htmlStyle";
const UNSAFE_HTML_TAGS = new Set([
  "embed",
  "form",
  "iframe",
  "object",
  "script",
  "style",
  "textarea",
]);

const SAFE_INLINE_HTML_TAGS = [
  "article",
  "aside",
  "caption",
  "col",
  "colgroup",
  "details",
  "div",
  "figcaption",
  "figure",
  "main",
  "section",
  "span",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "input",
];

const HTML_STYLE_TAGS = [
  "article",
  "aside",
  "blockquote",
  "div",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "main",
  "ol",
  "p",
  "section",
  "span",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
];

const htmlSanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([...(defaultSchema.tagNames || []), ...SAFE_INLINE_HTML_TAGS]),
  ).filter((tag) => !UNSAFE_HTML_TAGS.has(tag)),
  strip: Array.from(
    new Set([...(defaultSchema.strip || []), ...UNSAFE_HTML_TAGS]),
  ),
  // IDs are restricted to our document namespace, so adding a second clobber
  // prefix would only break generated footnote hrefs and their backlinks.
  clobber: [],
  required: {
    ...defaultSchema.required,
    input: { type: "checkbox", disabled: true },
  },
  attributes: {
    "*": [["id", /^md-[A-Za-z0-9_-]+-(?:fn(?:ref)?-|footnote-label$)/]],
    input: [["type", "checkbox"], "checked", "disabled"],
    ...Object.fromEntries(HTML_STYLE_TAGS.map((tag) => [tag, ["style"]])),
    a: [
      "href",
      "title",
      "dataFootnoteRef",
      "dataFootnoteBackref",
      "ariaDescribedBy",
      "ariaLabel",
    ],
    blockquote: ["cite", "style"],
    code: [["className", /^language-./]],
    details: ["open"],
    img: ["alt", "height", "src", "title", "width"],
    ol: ["start", "style"],
    table: ["style"],
    td: ["align", "colSpan", "rowSpan", "style"],
    th: ["align", "colSpan", "rowSpan", "scope", "style"],
    ul: ["style"],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    cite: ["http", "https"],
    src: ["http", "https", "data", "share-asset"],
  },
};

function rehypeSanitizeInlineStyles() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "element" && node.properties?.style) {
        const safeStyle = sanitizeHtmlStyle(node.properties.style);
        if (safeStyle) {
          node.properties.style = safeStyle;
        } else {
          delete node.properties.style;
        }
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(visit);
      }
    };

    visit(tree);
  };
}

const mergeClassName = (...classNames: Array<string | undefined>) =>
  classNames.filter(Boolean).join(" ") || undefined;

const isHighlightClassName = (className: unknown) =>
  typeof className === "string" &&
  className
    .split(/\s+/)
    .some((name) => name === "hljs" || name.startsWith("hljs-"));

const nodeContainsTable = (node: any): boolean => {
  if (!node || typeof node !== "object") return false;
  if (node.tagName === "table") return true;
  if (!Array.isArray(node.children)) return false;
  return node.children.some(nodeContainsTable);
};

const getSafeHtmlProps = (
  { style, className, ...props }: any,
  sanitizeStyle = sanitizeHtmlStyle,
) => {
  delete props.node;
  return {
    ...props,
    className,
    style: sanitizeStyle(style),
  };
};

const getSafeVisualHtmlProps = ({ className, node, ...props }: any) => {
  const sanitizeStyle = nodeContainsTable(node)
    ? sanitizeHtmlTableContainerStyle
    : sanitizeHtmlStyle;
  return {
    ...getSafeHtmlProps({ ...props, node }, sanitizeStyle),
    className: mergeClassName("markdown-html-visual", className),
  };
};

const HtmlDiv = (props: any) => <div {...getSafeVisualHtmlProps(props)} />;

const HtmlSection = (props: any) => (
  <section {...getSafeVisualHtmlProps(props)} />
);

const HtmlArticle = (props: any) => (
  <article {...getSafeVisualHtmlProps(props)} />
);

const HtmlAside = (props: any) => <aside {...getSafeVisualHtmlProps(props)} />;

const HtmlMain = (props: any) => <main {...getSafeVisualHtmlProps(props)} />;

const HtmlSpan = (props: any) => {
  if (isHighlightClassName(props.className)) {
    return <span {...getSafeHtmlProps(props)} />;
  }

  return <span {...getSafeVisualHtmlProps(props)} />;
};

const HtmlHeading = ({
  as: Tag,
  ...props
}: any & { as: keyof React.JSX.IntrinsicElements }) =>
  React.createElement(Tag, getSafeHtmlProps(props));

function normalizeRawHtml() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "raw")
        node.value = normalizeHtmlVisualFragment(node.value);
      if (node.children) node.children.forEach(visit);
    };
    visit(tree);
  };
}
// A share marker is inert data, never a fetchable URL. Keep only the exact
// digest shape until the image adapter applies its manifest and origin checks.
function filterShareImageMarkers() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "element" && node.tagName === "img") {
        const src = String(node.properties?.src || "");
        if (
          /^share-asset:/i.test(src) &&
          !/^share-asset:[a-f0-9]{64}$/.test(src)
        )
          delete node.properties.src;
      }
      if (node.children) node.children.forEach(visit);
    };
    visit(tree);
  };
}
export const plugins: PluggableList = [
  normalizeRawHtml,
  rehypeRaw,
  filterShareImageMarkers,
  [rehypeSanitize, htmlSanitizeSchema],
  rehypeSanitizeInlineStyles,
];
export const components = {
  div: HtmlDiv,
  section: HtmlSection,
  article: HtmlArticle,
  aside: HtmlAside,
  main: HtmlMain,
  span: HtmlSpan,
  details: (props: any) => <details {...getSafeVisualHtmlProps(props)} />,
  summary: (props: any) => <summary {...getSafeVisualHtmlProps(props)} />,
  h1: (props: any) => <HtmlHeading as="h1" {...props} />,
  h2: (props: any) => <HtmlHeading as="h2" {...props} />,
  h3: (props: any) => <HtmlHeading as="h3" {...props} />,
  h4: (props: any) => <HtmlHeading as="h4" {...props} />,
  h5: (props: any) => <HtmlHeading as="h5" {...props} />,
  h6: (props: any) => <HtmlHeading as="h6" {...props} />,
};
export { getSafeHtmlProps };
