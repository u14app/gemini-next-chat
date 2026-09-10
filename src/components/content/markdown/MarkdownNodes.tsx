"use client";

import React, { Fragment, memo, useMemo, useSyncExternalStore } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { urlAttributes } from "html-url-attributes";
import { defaultUrlTransform } from "react-markdown";
import type { Root, Element, RootContent } from "hast";
import { useTranslations } from "next-intl";
import {
  getSafeExternalHref,
  getSafeMarkdownImageSrc,
  getSafeWebHref,
} from "@/lib/security/clientUrl";
import { getRegisteredShareImageSrc } from "@/lib/security/shareImageUrl";
import { parseMarkdownFileBlocks } from "@/lib/utils/markdownFiles";
import type { PreviewImageInput } from "@/lib/utils/imagePreview";
import type { MarkdownRendererProps } from "./types";
import type {
  MarkdownBlockSnapshot,
  RenderElement,
  SpecialContent,
} from "./markdownDocument";
import {
  artifactResource,
  chartResource,
  readOnlyCodeResource,
  citationResource,
  diagramResource,
  fileResource,
  gfmResource,
  highlightResource,
  htmlResource,
  imageResource,
  mathRenderResource,
  mathSyntaxResource,
  useExtension,
} from "./extensionResources";

type HtmlModule = typeof import("./htmlExtension");
export interface RenderOptions extends Omit<
  MarkdownRendererProps,
  "content" | "className" | "isStreaming"
> {
  html: HtmlModule | null;
  getGallery: () => PreviewImageInput[];
}

export function RawFallback({
  source,
  inline = false,
  error,
  retry,
}: {
  source: string;
  inline?: boolean;
  error?: unknown;
  retry?: () => void;
}) {
  const t = useTranslations("Content");
  const text = inline ? (
    <span className="whitespace-pre-wrap">{source}</span>
  ) : (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm">
      {source}
    </pre>
  );
  if (!error) return text;
  return (
    <span className={inline ? "" : "block"}>
      {text}
      <span className="markdown-muted-text text-xs" role="status">
        {t("renderFailed")}
      </span>{" "}
      <button
        type="button"
        className="markdown-link-text text-xs underline"
        onClick={retry}
      >
        {t("renderRetry")}
      </button>
    </span>
  );
}

function plainProps(input: Record<string, unknown>) {
  const props = { ...input };
  delete props.node;
  return props;
}
function classes(...values: unknown[]) {
  return values.filter(Boolean).join(" ");
}

function safeTree(node: RootContent): RootContent {
  if (node.type === "raw") return { type: "text", value: node.value };
  if (node.type !== "element") return node;
  const properties = { ...node.properties };
  for (const [attribute, tags] of Object.entries(urlAttributes)) {
    // The image adapter resolves manifest aliases before enforcing the image URL policy.
    if (node.tagName === "img" && attribute === "src") continue;
    if (
      Object.hasOwn(properties, attribute) &&
      (tags === null || tags.includes(node.tagName))
    ) {
      properties[attribute] = defaultUrlTransform(
        String(properties[attribute] || ""),
      );
    }
  }
  return {
    ...node,
    properties,
    children: node.children.map(safeTree) as Element["children"],
  };
}

function renderHast(
  node: RootContent | Root,
  options?: RenderOptions,
  components?: ReturnType<typeof makeComponents>,
): React.ReactNode {
  const root: Root =
    node.type === "root" ? node : { type: "root", children: [node] };
  const tree: Root = { ...root, children: root.children.map(safeTree) };
  return toJsxRuntime(tree, {
    jsx,
    jsxs,
    Fragment,
    passNode: true,
    passKeys: true,
    ignoreInvalidStyle: true,
    components: components || (options ? makeComponents(options) : undefined),
  });
}

function MathNode({
  value,
  options,
}: {
  value: Extract<SpecialContent, { kind: "math" }>;
  options: RenderOptions;
}) {
  const state = useExtension(mathRenderResource);
  const rendered = useMemo(() => {
    if (!state.value || value.incomplete) return null;
    try {
      return {
        tree: state.value.renderMath(value.value, value.inline),
        error: null,
      };
    } catch (error) {
      return { tree: null, error };
    }
  }, [state.value, value.value, value.inline, value.incomplete]);
  if (!rendered?.tree)
    return (
      <RawFallback
        source={value.source}
        inline={value.inline}
        error={state.error || rendered?.error}
        retry={mathRenderResource.retry}
      />
    );
  return renderHast(rendered.tree, options);
}

function CodeNode({
  value,
  options,
}: {
  value: Extract<SpecialContent, { kind: "code" }>;
  options: RenderOptions;
}) {
  const diagramType =
    value.language === "mermaid" || value.language === "mmd"
      ? "mermaid"
      : value.language === "mindmap"
        ? "mindmap"
        : null;
  const chartType = ["chart", "markdown-chart"].includes(value.language);
  const diagram = useExtension(diagramResource, Boolean(diagramType));
  const chart = useExtension(chartResource, chartType);
  const artifact = useExtension(
    artifactResource,
    !diagramType && !chartType && Boolean(value.language) && !options.readOnly,
  );
  const readOnlyCode = useExtension(
    readOnlyCodeResource,
    !diagramType &&
      !chartType &&
      Boolean(value.language) &&
      Boolean(options.readOnly),
  );
  const highlight = useExtension(
    highlightResource,
    !diagramType && !chartType && Boolean(value.language),
  );
  const rendered = useMemo(() => {
    if (!highlight.value || value.incomplete || diagramType || chartType)
      return null;
    try {
      const tree = highlight.value.highlightCode(value.value, value.language);
      const pre = tree.children[0];
      return {
        tree:
          pre?.type === "element"
            ? { type: "root" as const, children: pre.children }
            : tree,
        error: null,
      };
    } catch (error) {
      return { tree: null, error };
    }
  }, [
    highlight.value,
    value.value,
    value.language,
    value.incomplete,
    diagramType,
    chartType,
  ]);
  if (!value.value.trim()) return null;
  if (!value.language)
    return (
      <pre>
        <code>{value.value}</code>
      </pre>
    );
  if (diagramType) {
    if (!diagram.value)
      return (
        <RawFallback
          source={value.source}
          error={diagram.error}
          retry={diagramResource.retry}
        />
      );
    return (
      <diagram.value.DiagramBlock
        diagram={{
          type: diagramType,
          language: value.language,
          content: value.value,
          incomplete: value.incomplete,
        }}
        forcedTheme={options.forcedTheme}
      />
    );
  }
  if (chartType) {
    if (!chart.value || value.incomplete) {
      return (
        <div data-markdown-chart-ready={chart.error ? "error" : "false"}>
          <RawFallback
            source={value.source}
            error={chart.error}
            retry={chartResource.retry}
          />
        </div>
      );
    }
    return (
      <chart.value.ChartBlock
        source={value.value}
        incomplete={value.incomplete}
        forcedTheme={options.forcedTheme}
      />
    );
  }
  // Keep the same controls mounted while the highlighter upgrades its children.
  const viewer = options.readOnly ? readOnlyCode : artifact;
  if (!viewer.value || value.incomplete)
    return (
      <RawFallback
        source={value.source}
        error={viewer.error}
        retry={
          options.readOnly ? readOnlyCodeResource.retry : artifactResource.retry
        }
      />
    );
  const children = rendered?.tree ? (
    renderHast(rendered.tree)
  ) : (
    <code>{value.value}</code>
  );
  if (options.readOnly && readOnlyCode.value)
    return (
      <readOnlyCode.value.ReadOnlyCodeBlock
        language={value.language}
        rawCode={value.value}
        forceExpandCodeBlocks={options.forceExpandCodeBlocks}
      >
        {children}
        {highlight.error || rendered?.error ? (
          <RawFallback
            source=""
            inline
            error={highlight.error || rendered?.error}
            retry={highlightResource.retry}
          />
        ) : null}
      </readOnlyCode.value.ReadOnlyCodeBlock>
    );
  if (!artifact.value) return <RawFallback source={value.source} />;
  return (
    <artifact.value.ArtifactBlock
      language={value.language}
      rawCode={value.value}
      isStreaming={value.incomplete}
      forceExpandCodeBlocks={options.forceExpandCodeBlocks}
      readOnly={options.readOnly}
    >
      {children}
      {highlight.error || rendered?.error ? (
        <RawFallback
          source=""
          inline
          error={highlight.error || rendered?.error}
          retry={highlightResource.retry}
        />
      ) : null}
    </artifact.value.ArtifactBlock>
  );
}

function FileNode({
  source,
  options,
}: {
  source: string;
  options: RenderOptions;
}) {
  const state = useExtension(fileResource);
  const file = useMemo(
    () =>
      parseMarkdownFileBlocks(source).find(
        (segment) => segment.kind === "file",
      ),
    [source],
  );
  if (!state.value || file?.kind !== "file")
    return (
      <RawFallback
        source={source}
        error={state.error}
        retry={fileResource.retry}
      />
    );
  return (
    <state.value.FileCard
      file={file.file}
      onClick={options.readOnly ? undefined : options.onFileClick}
    />
  );
}

function PendingNode({
  value,
}: {
  value: Extract<SpecialContent, { kind: "pending" }>;
}) {
  const gfm = useExtension(gfmResource, value.features.includes("gfm"));
  const math = useExtension(
    mathSyntaxResource,
    value.features.includes("math"),
  );
  const html = useExtension(htmlResource, value.features.includes("html"));
  return (
    <RawFallback
      source={value.source}
      error={gfm.error || math.error || html.error}
      retry={() => {
        if (gfm.error) gfmResource.retry();
        if (math.error) mathSyntaxResource.retry();
        if (html.error) htmlResource.retry();
      }}
    />
  );
}

function EvidenceCodeNode({
  value,
}: {
  value: Extract<SpecialContent, { kind: "code" }>;
}) {
  const highlight = useExtension(
    highlightResource,
    Boolean(value.language) &&
      !["mermaid", "mmd", "mindmap"].includes(value.language),
  );
  const rendered = useMemo(() => {
    if (!highlight.value || value.incomplete) return null;
    try {
      return {
        tree: highlight.value.highlightCode(value.value, value.language),
        error: null,
      };
    } catch (error) {
      return { tree: null, error };
    }
  }, [highlight.value, value.value, value.language, value.incomplete]);
  return (
    <>
      {rendered?.tree ? (
        renderHast(rendered.tree)
      ) : (
        <pre>
          <code>{value.value}</code>
        </pre>
      )}
      {highlight.error || rendered?.error ? (
        <RawFallback
          source=""
          inline
          error={highlight.error || rendered?.error}
          retry={highlightResource.retry}
        />
      ) : null}
    </>
  );
}

function SpecialNode({
  value,
  options,
}: {
  value: SpecialContent;
  options: RenderOptions;
}) {
  if (value.kind === "code")
    return options.contentPolicy === "evidence-answer" ? (
      <EvidenceCodeNode value={value} />
    ) : (
      <CodeNode value={value} options={options} />
    );
  if (value.kind === "math")
    return <MathNode value={value} options={options} />;
  if (value.kind === "file")
    return <FileNode source={value.source} options={options} />;
  return <PendingNode value={value} />;
}

function MarkdownLink({
  href,
  children,
  options,
  ...props
}: {
  href?: string;
  children?: React.ReactNode;
  options: RenderOptions;
}) {
  const citation =
    options.contentPolicy !== "evidence-answer" &&
    Boolean(href?.startsWith("#citation-"));
  const state = useExtension(citationResource, citation);
  const sources = useMemo(
    () => [...(options.searchSources || []), ...(options.ragSources || [])],
    [options.searchSources, options.ragSources],
  );
  if (citation && state.value)
    return (
      <state.value.CitationLink
        href={href}
        sources={sources}
        onCitationClick={options.readOnly ? undefined : options.onCitationClick}
        readOnly={options.readOnly}
      >
        {children}
      </state.value.CitationLink>
    );
  const safeHref = getSafeExternalHref(href);
  if (!safeHref) return <span>{children}</span>;
  return (
    <a
      {...plainProps(props)}
      href={safeHref}
      target={
        options.contentPolicy === "evidence-answer"
          ? "_blank"
          : safeHref.startsWith("#")
            ? undefined
            : "_blank"
      }
      rel="noopener noreferrer"
      className={
        options.contentPolicy === "evidence-answer"
          ? "text-research-accent underline underline-offset-2"
          : "markdown-link-text hover:underline break-all"
      }
    >
      {children}
    </a>
  );
}

const subscribeToOrigin = () => () => {};
const browserOrigin = () =>
  typeof window === "undefined" ? "" : window.location.origin;
export function isRegisteredShareImageUrl(
  url: string,
  registered: readonly string[] | undefined,
  origin: string,
): boolean {
  return Boolean(getRegisteredShareImageSrc(url, registered, origin));
}

function ImageNode({
  src,
  options,
  ...props
}: {
  src?: string;
  options: RenderOptions;
  alt?: string;
  width?: number;
  height?: number;
  title?: string;
}) {
  const t = useTranslations("Content");
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    browserOrigin,
    () => "",
  );
  const alias = src ? options.imageUrlAliases?.[src] : undefined;
  const registeredAlias =
    alias &&
    isRegisteredShareImageUrl(alias, options.registeredImageUrls, origin)
      ? alias
      : null;
  const resolved = alias ? registeredAlias : src;
  const registered = Boolean(
    resolved &&
    isRegisteredShareImageUrl(resolved, options.registeredImageUrls, origin),
  );
  const safeSrc = registered
    ? resolved
    : getSafeMarkdownImageSrc(resolved || undefined);
  const state = useExtension(imageResource, Boolean(safeSrc));
  const metadata = options.imageSources?.find(
    (image) => image.url === src || image.url === safeSrc,
  );
  const sourceHref = metadata?.sourceUrl
    ? getSafeWebHref(metadata.sourceUrl)
    : null;
  if (!safeSrc)
    return (
      <span className="markdown-image-blocked my-2 px-3 py-2 text-xs">
        {t("imageBlocked")}
      </span>
    );
  const image = state.value ? (
    <state.value.MarkdownImage
      {...props}
      src={safeSrc}
      registered={registered}
      registeredImageUrls={options.registeredImageUrls}
      getGallery={() => {
        const gallery = options.getGallery();
        return gallery.some((image) => image.url === safeSrc)
          ? gallery
          : [
              ...gallery,
              {
                url: safeSrc,
                alt: props.alt,
                description:
                  metadata?.description || metadata?.title || props.alt,
              },
            ];
      }}
    />
  ) : (
    <img
      {...props}
      src={safeSrc}
      alt={props.alt || ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="markdown-image block max-h-[40vh] max-w-full rounded-lg object-contain"
    />
  );
  return (
    <span className="my-2 block">
      {image}
      {metadata?.description || metadata?.title || sourceHref ? (
        <span className="markdown-muted-text mt-1 block text-center text-xs">
          {metadata?.description || metadata?.title}
          {sourceHref ? (
            <>
              {" "}
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                className="markdown-link-text underline"
              >
                {t("imageSource")}
              </a>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function makeComponents(options: RenderOptions) {
  const specialOrHtml = (tag: "div" | "span") =>
    function RenderContainer(props: {
      node?: RenderElement;
      children?: React.ReactNode;
    }) {
      const special = props.node?.data?.special;
      if (special) return <SpecialNode value={special} options={options} />;
      const Component = options.html?.components[tag];
      return Component ? (
        <Component {...props} />
      ) : (
        React.createElement(tag, plainProps(props as Record<string, unknown>))
      );
    };
  const table = (props: Record<string, unknown>) => <TableNode {...props} />;
  return {
    ...options.html?.components,
    div: specialOrHtml("div"),
    span: specialOrHtml("span"),
    p: (props: Record<string, unknown>) => (
      <p
        {...plainProps(props)}
        className={classes("markdown-paragraph", props.className)}
      />
    ),
    blockquote: (props: Record<string, unknown>) => (
      <blockquote
        {...plainProps(props)}
        className={classes("markdown-blockquote", props.className)}
      />
    ),
    code: (props: Record<string, unknown>) => (
      <code
        {...plainProps(props)}
        className={classes(
          "markdown-inline-code rounded px-1 py-0.5 text-sm break-all font-mono",
          props.className,
        )}
      />
    ),
    a: (props: Record<string, unknown>) => (
      <MarkdownLink {...props} options={options} />
    ),
    img: (props: Record<string, unknown>) =>
      options.contentPolicy === "evidence-answer" ? null : (
        <ImageNode {...plainProps(props)} options={options} />
      ),
    table,
    th: (props: Record<string, unknown>) => (
      <th
        {...plainProps(props)}
        className={classes("markdown-table-head", props.className)}
      />
    ),
    td: (props: Record<string, unknown>) => (
      <td
        {...plainProps(props)}
        className={classes("markdown-table-cell", props.className)}
      />
    ),
  };
}
function TableNode(props: Record<string, unknown>) {
  const t = useTranslations("Content");
  return (
    <div
      className="markdown-table-wrap"
      tabIndex={0}
      aria-label={t("tableScrollRegion")}
    >
      <table
        {...plainProps(props)}
        className={classes("markdown-table", props.className)}
      />
    </div>
  );
}

function needsHtml(node: RootContent): boolean {
  if (node.type !== "element" || (node as RenderElement).data?.special)
    return false;
  if (node.properties.dataFootnotes) return node.children.some(needsHtml);
  return (
    [
      "div",
      "section",
      "article",
      "aside",
      "main",
      "span",
      "details",
      "summary",
    ].includes(node.tagName) ||
    Boolean(node.properties.style) ||
    node.children.some(needsHtml)
  );
}
export const MarkdownBlock = memo(function MarkdownBlock({
  snapshot,
  options,
}: {
  snapshot: MarkdownBlockSnapshot;
  options: RenderOptions;
}) {
  const html = useExtension(
    htmlResource,
    options.contentPolicy !== "evidence-answer" && needsHtml(snapshot.node),
  );
  const localOptions = useMemo(
    () => ({ ...options, html: html.value }),
    [options, html.value],
  );
  const components = useMemo(
    () => makeComponents(localOptions),
    [localOptions],
  );
  return renderHast(snapshot.node, localOptions, components);
});
