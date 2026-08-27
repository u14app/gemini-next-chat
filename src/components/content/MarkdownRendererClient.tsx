"use client";
import React, { useMemo, useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import {
  Copy,
  Check,
  Terminal,
  FileText,
  Maximize2,
  Minimize2,
  ChevronDown,
  SquareCode,
  X,
  SquareTerminal,
  Loader2,
} from "lucide-react";
import { Source } from "@/types";
import { useUIStore } from "@/store/core/uiStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { useChatStore } from "@/store/core/chatStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { executeCode } from "@/services/api/chatService";
import { runInSandbox } from "@/utils/sandbox";
import {
  isAnthropicProviderType,
  isGoogleProviderType,
  isOpenAIProviderType,
} from "@/lib/providers/providerTypes";
import { resolveOPFSUrl, isOPFSUrl } from "@/utils/opfs";
import {
  getSafeExternalHref,
  getSafeFaviconProxyUrl,
  getSafeMarkdownImageSrc,
  getSafeWebHref,
} from "@/lib/security/clientUrl";
import { createSandboxedHtmlPreviewSrcDoc } from "@/lib/utils/htmlPreview";
import {
  sanitizeHtmlStyle,
  sanitizeHtmlTableContainerStyle,
} from "@/lib/utils/htmlStyle";
import { normalizeHtmlVisualMarkdown } from "@/lib/utils/htmlVisualMarkdown";
import {
  parseMarkdownFileBlocks,
  type MarkdownGeneratedFile,
} from "@/lib/utils/markdownFiles";
import { parseMarkdownDiagramBlocks } from "@/lib/utils/markdownDiagrams";
import {
  collectMarkdownImageGallery,
  getMarkdownImageGalleryIndex,
} from "@/lib/utils/markdownImages";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { linkifyCitationReferences } from "@/lib/utils/citations";
import { requestKnowledgeSourceNavigation } from "@/lib/knowledge/navigation";
import { resolveObjectUrlWithLifecycle } from "@/lib/utils/objectUrlLifecycle";
import { parseModelString } from "@/lib/utils/model";
import type { PreviewImageInput } from "@/lib/utils/imagePreview";
import Tooltip from "../ui/Tooltip";
import { DiagramBlock, type DiagramTheme } from "./markdown/DiagramBlock";

import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/primitives";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  searchSources?: Source[];
  ragSources?: Source[];
  onCitationClick?: (source: Source, index: number) => void;
  onFileClick?: (file: MarkdownGeneratedFile) => void;
  isStreaming?: boolean;
  forcedTheme?: DiagramTheme;
  forceExpandCodeBlocks?: boolean;
}

const extractHtmlTitle = (html: string) => {
  const match = html.match(/<title>(.*?)<\/title>/i);
  return match ? match[1].trim() : "HTML Preview";
};

const UNSAFE_HTML_TAGS = new Set([
  "embed",
  "form",
  "iframe",
  "input",
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
  attributes: {
    ...Object.fromEntries(HTML_STYLE_TAGS.map((tag) => [tag, ["style"]])),
    a: ["href", "title"],
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
    src: ["http", "https", "data"],
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

const markdownRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, htmlSanitizeSchema],
  rehypeSanitizeInlineStyles,
  rehypeKatex,
  rehypeHighlight,
] as any;

const streamingMarkdownRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, htmlSanitizeSchema],
  rehypeSanitizeInlineStyles,
] as any;

const COLLAPSED_CODE_MAX_HEIGHT = "40vh";
interface CodeBlockRenderOptions {
  forceExpandCodeBlocks?: boolean;
  isStreaming?: boolean;
}

const CodeBlockRenderOptionsContext =
  React.createContext<CodeBlockRenderOptions>({});

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

type TimeoutHandle = ReturnType<typeof setTimeout>;

function clearTimeoutRef(ref: React.MutableRefObject<TimeoutHandle | null>) {
  if (!ref.current) return;
  clearTimeout(ref.current);
  ref.current = null;
}

function clearFrameRef(ref: React.MutableRefObject<number | null>) {
  if (ref.current === null) return;
  cancelAnimationFrame(ref.current);
  ref.current = null;
}

const CitationHoverCard = ({
  source,
  position,
}: {
  source: Source;
  position: { x: number; y: number };
}) => {
  const safeSourceUrl = getSafeWebHref(source.url);
  const faviconUrl = getSafeFaviconProxyUrl(safeSourceUrl || undefined);

  return createPortal(
    <div
      className="fixed z-9999 pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{ left: position.x, top: position.y }}
    >
      <div className="markdown-citation-card">
        <div className="flex items-center gap-2">
          <div className="markdown-citation-favicon">
            {faviconUrl && (
              <img
                src={faviconUrl}
                className="w-full h-full object-cover"
                alt=""
                width={16}
                height={16}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(e) =>
                  ((e.target as HTMLImageElement).style.opacity = "0")
                }
              />
            )}
          </div>
          <span className="markdown-citation-title truncate">
            {source.title}
          </span>
        </div>
        {safeSourceUrl && (
          <div className="markdown-citation-url truncate">{safeSourceUrl}</div>
        )}
        {source.content && (
          <div className="markdown-citation-content line-clamp-3">
            {source.content}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

const CitationLink = ({
  href,
  children,
  sources,
  onCitationClick,
}: {
  href: string | undefined;
  children?: React.ReactNode;
  sources: Source[];
  onCitationClick?: (source: Source, index: number) => void;
}) => {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const ref = useRef<HTMLSpanElement>(null);
  const safeHref = getSafeExternalHref(href);

  if (!href || !href.includes("#citation-")) {
    if (!safeHref) {
      return <span className="markdown-muted-text break-all">{children}</span>;
    }

    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className="markdown-link-text hover:underline break-all"
      >
        {children}
      </a>
    );
  }

  const match = href.match(/#citation-(\d+)$/);
  const index = match ? parseInt(match[1], 10) : -1;
  const source = sources[index];

  if (!source) {
    // Fallback if source not found but format matches
    if (!safeHref) {
      return <span className="markdown-link-text">{children}</span>;
    }

    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className="markdown-link-text"
      >
        {children}
      </a>
    );
  }

  const showPreview = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
  };
  const hidePreview = () => setHoverPos(null);

  const safeSourceUrl = getSafeWebHref(source.url);
  const collectionId =
    typeof source.metadata?.collectionId === "string"
      ? source.metadata.collectionId
      : "";
  const fileId =
    typeof source.metadata?.localFileId === "string"
      ? source.metadata.localFileId
      : typeof source.metadata?.fileId === "string"
        ? source.metadata.fileId
        : undefined;
  const chunkIndex =
    typeof source.metadata?.chunkIndex === "number"
      ? source.metadata.chunkIndex
      : undefined;
  const canNavigateKnowledge = Boolean(collectionId);
  const canHandleCitation = Boolean(onCitationClick);

  return (
    <span
      ref={ref}
      className="relative inline-block align-top ml-0.5 select-none"
      onMouseEnter={showPreview}
      onMouseLeave={hidePreview}
      onTouchStart={showPreview}
    >
      <a
        href={
          safeSourceUrl ||
          (canNavigateKnowledge || canHandleCitation ? "#" : undefined)
        }
        target={safeSourceUrl && !canHandleCitation ? "_blank" : undefined}
        rel={
          safeSourceUrl && !canHandleCitation
            ? "noopener noreferrer"
            : undefined
        }
        aria-disabled={
          !safeSourceUrl && !canNavigateKnowledge && !canHandleCitation
        }
        onFocus={showPreview}
        onBlur={hidePreview}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            hidePreview();
          }
        }}
        onClick={(event) => {
          if (onCitationClick) {
            event.preventDefault();
            onCitationClick(source, index);
          } else if (canNavigateKnowledge) {
            event.preventDefault();
            requestKnowledgeSourceNavigation({
              collectionId,
              fileId,
              chunkIndex,
              excerpt: source.content,
            });
          } else if (!safeSourceUrl) {
            event.preventDefault();
          }
        }}
        className={`markdown-citation-badge ${
          safeSourceUrl || canNavigateKnowledge || canHandleCitation
            ? "cursor-pointer"
            : "markdown-citation-badge-disabled"
        }`}
      >
        {children}
      </a>

      {/* Portal Hover Card */}
      {hoverPos && <CitationHoverCard source={source} position={hoverPos} />}
    </span>
  );
};

const FileCard = ({
  file,
  onClick,
}: {
  file: MarkdownGeneratedFile;
  onClick?: (file: MarkdownGeneratedFile) => void;
}) => {
  const t = useTranslations("Content");
  const { name, type, truncated, incomplete } = file;
  const isInteractive = Boolean(onClick);
  const cardBody = (
    <>
      <div className="markdown-file-card-icon">
        <FileText size={20} aria-hidden="true" />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="markdown-strong-text text-sm font-medium truncate">
          {name}
        </span>
        <div className="markdown-file-card-meta flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="markdown-file-card-action">
            {isInteractive ? t("openGeneratedFile") : t("generatedFile")}
          </span>
          {type ? (
            <span className="markdown-file-type-badge max-w-40 truncate rounded px-1.5 py-0.5 font-mono text-[10px]">
              {type}
            </span>
          ) : null}
          {truncated ? (
            <span className="markdown-warning-badge rounded px-1.5 py-0.5 text-[10px] font-medium">
              {t("truncated")}
            </span>
          ) : null}
          {incomplete ? (
            <span className="markdown-muted-badge rounded px-1.5 py-0.5 text-[10px] font-medium">
              {t("incomplete")}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  const className =
    "group markdown-file-card my-2 inline-flex min-w-50 w-full select-none items-center gap-3 rounded-xl p-3 text-left transition-[border-color,background-color,box-shadow] md:w-auto";

  if (!onClick) {
    return (
      <div
        aria-label={t("generatedFileAria", { name })}
        className={`${className} cursor-default`}
      >
        {cardBody}
      </div>
    );
  }

  return (
    <Button
      variant="bare"
      type="button"
      aria-label={t("openGeneratedFileAria", { name })}
      onClick={() => onClick(file)}
      className={`${className} markdown-file-card-interactive markdown-focus-ring cursor-pointer`}
    >
      {cardBody}
    </Button>
  );
};

const ArtifactBlock = ({
  language,
  rawCode,
  children,
  isStreaming,
  forceExpandCodeBlocks,
}: {
  language: string;
  rawCode: string;
  children: React.ReactNode;
  isStreaming?: boolean;
  forceExpandCodeBlocks?: boolean;
}) => {
  const t = useTranslations("Content");
  const [copyStatus, setCopyStatus] = React.useState<
    "idle" | "copied" | "error"
  >("idle");
  const copied = copyStatus === "copied";
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [canCollapse, setCanCollapse] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

  // Execution State
  const [isExecuting, setIsExecuting] = React.useState(false);
  const [consoleOutput, setConsoleOutput] = React.useState<string | null>(null);
  const [executionNotice, setExecutionNotice] = React.useState<string | null>(
    null,
  );

  // Use state for maxHeight to avoid render-loop flickering with 'auto'/'none'
  const [maxHeight, setMaxHeight] = React.useState<string>("none");

  const contentRef = React.useRef<HTMLDivElement>(null);
  const consoleRef = React.useRef<HTMLDivElement>(null);
  const fullscreenDialogRef = React.useRef<HTMLDivElement>(null);
  const previewDialogRef = React.useRef<HTMLDivElement>(null);
  const previewCloseButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousDialogFocusRef = React.useRef<HTMLElement | null>(null);
  const hasCheckedHeight = React.useRef(false);
  const isMountedRef = React.useRef(true);
  const copyResetTimerRef = React.useRef<TimeoutHandle | null>(null);
  const scrollTimerRef = React.useRef<TimeoutHandle | null>(null);
  const collapseTimerRef = React.useRef<TimeoutHandle | null>(null);
  const collapseFrameRef = React.useRef<number | null>(null);

  const { system } = useSettingsStore();
  const { selectedModel } = useChatStore();
  const { providers } = useCoreSettingsStore();
  const artifactId = React.useId();
  const codeContentId = `${artifactId}-code-content`;
  const consoleOutputId = `${artifactId}-console-output`;
  const fullscreenTitleId = `${artifactId}-fullscreen-title`;
  const previewTitleId = `${artifactId}-preview-title`;

  const shouldAutoCollapse =
    !forceExpandCodeBlocks && (system.enableCodeCollapse ?? true);
  const isHtml =
    language?.toLowerCase() === "html" || language?.toLowerCase() === "xml";
  const isPython =
    language?.toLowerCase() === "python" || language?.toLowerCase() === "py";
  const isJS = ["javascript", "js"].includes(language?.toLowerCase());
  const previewSrcDoc = React.useMemo(
    () => (isHtml ? createSandboxedHtmlPreviewSrcDoc(rawCode) : ""),
    [isHtml, rawCode],
  );
  const previewTitle = React.useMemo(
    () => extractHtmlTitle(rawCode),
    [rawCode],
  );
  const selectedProvider = React.useMemo(() => {
    const { providerId } = parseModelString(selectedModel);
    return providerId
      ? providers.find((provider) => provider.id === providerId)
      : providers.find((provider) => provider.enabled);
  }, [providers, selectedModel]);
  const executionModeLabel = React.useMemo(() => {
    if (isJS) return t("jsSandboxExecution");
    if (!isPython) return t("codeExecution");
    if (
      isOpenAIProviderType(selectedProvider?.type) ||
      isAnthropicProviderType(selectedProvider?.type)
    ) {
      return t("pythonSimulation");
    }
    if (isGoogleProviderType(selectedProvider?.type)) {
      return t("geminiCodeExecution");
    }
    return t("modelCodeExecution");
  }, [isJS, isPython, selectedProvider?.type, t]);
  const executionNoticeText = React.useMemo(() => {
    if (isJS) return t("jsSandboxNotice");
    if (!isPython) return null;
    if (
      isOpenAIProviderType(selectedProvider?.type) ||
      isAnthropicProviderType(selectedProvider?.type)
    ) {
      return t("pythonSimulationNotice");
    }
    if (isGoogleProviderType(selectedProvider?.type)) {
      return t("geminiCodeExecutionNotice");
    }
    return t("modelCodeExecutionNotice");
  }, [isJS, isPython, selectedProvider?.type, t]);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimeoutRef(copyResetTimerRef);
      clearTimeoutRef(scrollTimerRef);
      clearTimeoutRef(collapseTimerRef);
      clearFrameRef(collapseFrameRef);
    };
  }, []);

  const scheduleCopyReset = () => {
    clearTimeoutRef(copyResetTimerRef);
    copyResetTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setCopyStatus("idle");
      }
      copyResetTimerRef.current = null;
    }, 2000);
  };

  const scheduleConsoleScroll = () => {
    clearTimeoutRef(scrollTimerRef);
    scrollTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        const reduceMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        consoleRef.current?.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center",
        });
      }
      scrollTimerRef.current = null;
    }, 100);
  };

  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    dialogRef: React.RefObject<HTMLDivElement | null>,
    onClose: () => void,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), iframe, [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus({ preventScroll: true });
    }
  };

  const clearCollapseSchedule = () => {
    clearTimeoutRef(collapseTimerRef);
    clearFrameRef(collapseFrameRef);
  };

  const handleCopy = async () => {
    const didCopy = await copyTextToClipboard(String(rawCode));
    if (!isMountedRef.current) return;
    setCopyStatus(didCopy ? "copied" : "error");
    scheduleCopyReset();
  };

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  const handleExecute = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setConsoleOutput(null); // Reset output
    setExecutionNotice(executionNoticeText);

    try {
      // If the block is collapsed, expand it to show the console at bottom
      if (isCollapsed) {
        toggleCollapse();
      }

      let output = "";
      if (isPython) {
        output = await executeCode(selectedModel, rawCode);
      } else if (isJS) {
        output = (await runInSandbox(rawCode)).output;
      }
      if (!isMountedRef.current) return;
      setConsoleOutput(output);
      scheduleConsoleScroll();
    } catch (e) {
      if (!isMountedRef.current) return;
      setConsoleOutput(`Error: ${e instanceof Error ? e.message : String(e)}`);
      scheduleConsoleScroll();
    } finally {
      if (isMountedRef.current) {
        setIsExecuting(false);
      }
    }
  };

  const toggleCollapse = () => {
    clearCollapseSchedule();

    if (isCollapsed) {
      // EXPAND
      if (contentRef.current) {
        setMaxHeight(`${contentRef.current.scrollHeight}px`);
        setIsCollapsed(false);
      }
    } else {
      // COLLAPSE
      if (contentRef.current) {
        // 1. Set current height explicitly to enable transition
        setMaxHeight(`${contentRef.current.scrollHeight}px`);
        setIsCollapsed(true);

        // 2. Next tick, set to target height
        collapseFrameRef.current = requestAnimationFrame(() => {
          collapseFrameRef.current = null;
          collapseTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              setMaxHeight(COLLAPSED_CODE_MAX_HEIGHT);
            }
            collapseTimerRef.current = null;
          }, 10);
        });
      }
    }
  };

  React.useEffect(() => {
    if (!isFullscreen && !isPreviewOpen) return;

    previousDialogFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (isPreviewOpen) {
      previewCloseButtonRef.current?.focus({ preventScroll: true });
    } else if (isFullscreen) {
      fullscreenDialogRef.current?.focus({ preventScroll: true });
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previousDialogFocusRef.current?.isConnected) {
        previousDialogFocusRef.current.focus({ preventScroll: true });
      }
      previousDialogFocusRef.current = null;
    };
  }, [isFullscreen, isPreviewOpen]);

  // Initial Check & Streaming Updates
  useEffect(() => {
    if (forceExpandCodeBlocks) {
      clearCollapseSchedule();
      setCanCollapse(false);
      setIsCollapsed(false);
      setMaxHeight("none");
      hasCheckedHeight.current = true;
      return;
    }

    if (isStreaming) return; // Do not calculate during streaming

    if (contentRef.current) {
      const height = contentRef.current.scrollHeight;
      const vh50 = window.innerHeight * 0.5;

      // Only run the auto-collapse logic ONCE per block instance after streaming is done
      if (!hasCheckedHeight.current) {
        if (height > vh50) {
          setCanCollapse(true);
          if (shouldAutoCollapse) {
            setIsCollapsed(true);
            setMaxHeight(COLLAPSED_CODE_MAX_HEIGHT);
          }
        }
        hasCheckedHeight.current = true;
      } else {
        // Update collapse eligibility if content grows significantly later (e.g. edit)
        if (height > vh50 && !canCollapse) {
          setCanCollapse(true);
        }
      }
    }
  }, [
    rawCode,
    canCollapse,
    isStreaming,
    shouldAutoCollapse,
    forceExpandCodeBlocks,
  ]);

  // Common Header Logic
  const Header = ({ isFullscreenMode = false }) => (
    <div className="markdown-codeblock-header flex items-center justify-between pl-4 pr-2 py-1 select-none transition-colors">
      {/* Left Side: Language */}
      <div className="flex items-center gap-3">
        <div className="markdown-codeblock-label flex items-center space-x-2 text-xs uppercase font-semibold">
          <Terminal size={14} aria-hidden="true" />
          <span>{language || "code"}</span>
        </div>
      </div>

      {/* Right Side: Fullscreen + Copy + Collapse */}
      <div className="flex items-center gap-2">
        {/* Preview Toggle for HTML */}
        {isHtml && !isFullscreenMode && (
          <Tooltip content={t("preview")} position="bottom">
            <Button
              variant="bare"
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              aria-label={t("previewHtml")}
              className="markdown-icon-button markdown-focus-ring flex items-center justify-center rounded p-1.5"
            >
              <SquareCode size={14} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}

        {/* Run Button for Python OR JS */}
        {(isPython || isJS) && !isFullscreenMode && (
          <Tooltip
            content={t("runCodeWithMode", { mode: executionModeLabel })}
            position="bottom"
          >
            <Button
              variant="bare"
              type="button"
              onClick={handleExecute}
              disabled={isExecuting}
              aria-busy={isExecuting}
              aria-describedby={
                consoleOutput !== null || isExecuting
                  ? consoleOutputId
                  : undefined
              }
              aria-label={isExecuting ? t("runningCodeAria") : t("runCodeAria")}
              className={`markdown-focus-ring flex items-center justify-center rounded p-1.5 transition-colors ${isExecuting ? "markdown-icon-button-info" : "markdown-icon-button"}`}
            >
              {isExecuting ? (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <SquareTerminal size={14} aria-hidden="true" />
              )}
            </Button>
          </Tooltip>
        )}

        {/* Copy Button */}
        <Tooltip
          content={
            copied
              ? t("copied")
              : copyStatus === "error"
                ? t("copyFailed")
                : t("copyCode")
          }
          position="bottom"
        >
          <Button
            variant="bare"
            type="button"
            onClick={handleCopy}
            aria-label={
              copied
                ? t("codeCopiedAria")
                : copyStatus === "error"
                  ? t("copyFailed")
                  : t("copyCodeAria")
            }
            className="markdown-icon-button markdown-focus-ring flex items-center justify-center rounded p-1.5"
          >
            {copied ? (
              <Check
                size={14}
                className="markdown-icon-success"
                aria-hidden="true"
              />
            ) : copyStatus === "error" ? (
              <X
                size={14}
                className="markdown-icon-danger"
                aria-hidden="true"
              />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
            <span className="sr-only" aria-live="polite">
              {copied
                ? t("codeCopiedAria")
                : copyStatus === "error"
                  ? t("copyFailed")
                  : t("copyCodeAria")}
            </span>
          </Button>
        </Tooltip>

        {/* Fullscreen Toggle */}
        <Tooltip
          content={isFullscreenMode ? t("exitFullscreen") : t("fullscreen")}
          position="bottom"
        >
          <Button
            variant="bare"
            type="button"
            onClick={toggleFullscreen}
            aria-label={
              isFullscreenMode ? t("exitFullscreenAria") : t("fullscreenAria")
            }
            aria-pressed={isFullscreen}
            className="markdown-icon-button markdown-focus-ring flex items-center justify-center rounded p-1.5"
          >
            {isFullscreenMode ? (
              <Minimize2 size={14} aria-hidden="true" />
            ) : (
              <Maximize2 size={14} aria-hidden="true" />
            )}
          </Button>
        </Tooltip>

        {/* Expand/Collapse */}
        {!isFullscreenMode && canCollapse && (
          <Tooltip
            content={isCollapsed ? t("expand") : t("collapse")}
            position="bottom"
          >
            <Button
              variant="bare"
              type="button"
              onClick={toggleCollapse}
              aria-controls={codeContentId}
              aria-expanded={!isCollapsed}
              aria-label={
                isCollapsed ? t("expandCodeAria") : t("collapseCodeAria")
              }
              className="markdown-icon-button markdown-focus-ring flex items-center justify-center rounded p-1.5"
            >
              <ChevronDown
                size={14}
                className={`transition-transform duration-300 ${!isCollapsed ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );

  // Fullscreen Portal
  const fullscreenView = isFullscreen
    ? createPortal(
        <div
          ref={fullscreenDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={fullscreenTitleId}
          tabIndex={-1}
          onKeyDown={(event) =>
            handleDialogKeyDown(event, fullscreenDialogRef, () =>
              setIsFullscreen(false),
            )
          }
          className="markdown-preview-dialog fixed inset-0 z-1000 flex flex-col motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        >
          <h2 id={fullscreenTitleId} className="sr-only">
            {t("fullscreenCodeView")}
          </h2>
          <div className="container mx-auto h-full flex flex-col p-4">
            <div className="markdown-codeblock w-full h-full flex flex-col overflow-hidden rounded-lg">
              <Header isFullscreenMode={true} />
              <div className="markdown-codeblock-content flex-1 overflow-auto p-4 text-sm font-mono leading-relaxed custom-scrollbar">
                <pre>{children}</pre>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  // HTML Preview Portal
  const previewView = isPreviewOpen
    ? createPortal(
        <div
          ref={previewDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={previewTitleId}
          tabIndex={-1}
          onKeyDown={(event) =>
            handleDialogKeyDown(event, previewDialogRef, () =>
              setIsPreviewOpen(false),
            )
          }
          className="markdown-preview-dialog fixed inset-0 z-2000 flex flex-col motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        >
          <div className="markdown-preview-header flex items-center justify-between px-4 py-3">
            <h2
              id={previewTitleId}
              className="markdown-strong-text flex min-w-0 items-center gap-2 font-semibold"
            >
              <SquareCode
                size={18}
                className="markdown-preview-title-icon shrink-0"
                aria-hidden="true"
              />
              <span className="markdown-strong-text font-semibold">
                {previewTitle}
              </span>
            </h2>
            <Button
              variant="bare"
              ref={previewCloseButtonRef}
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              aria-label={t("closePreview")}
              className="markdown-icon-button markdown-focus-ring rounded-lg p-1.5"
            >
              <X size={20} aria-hidden="true" />
            </Button>
          </div>
          <div className="markdown-preview-canvas flex-1 relative">
            <iframe
              srcDoc={previewSrcDoc}
              className="w-full h-full border-none"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={t("previewTitleSuffix", { title: previewTitle })}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="group/codeblock my-4">
        <div className="markdown-codeblock w-full rounded-lg transition-[border-color,background-color,box-shadow] duration-300 flex flex-col overflow-hidden">
          <Header />
          <div
            id={codeContentId}
            ref={contentRef}
            className={`
                        markdown-codeblock-content w-full overflow-auto custom-scrollbar text-sm font-mono leading-relaxed
                        transition-[max-height] duration-500 ease-in-out relative
                    `}
            style={{ maxHeight: maxHeight }}
          >
            <div className="p-4 min-w-0">
              <pre>{children}</pre>
              {/* Gradient Overlay */}
              {canCollapse && (
                <div
                  className={`markdown-codeblock-fade absolute w-full bottom-0 left-0 h-16 pointer-events-none transition-opacity duration-500 ${isCollapsed ? "opacity-100" : "opacity-0"}`}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>

          {/* Console Panel */}
          {(consoleOutput !== null || isExecuting) && (
            <div
              ref={consoleRef}
              id={consoleOutputId}
              role="status"
              aria-live="polite"
              className="markdown-console p-3 font-mono text-xs overflow-x-auto"
            >
              <div className="markdown-console-header flex items-center gap-2 mb-2 font-bold uppercase tracking-wider select-none">
                <SquareTerminal size={12} aria-hidden="true" />
                <span>{t("consoleOutput")}</span>
                <span className="markdown-console-mode normal-case tracking-normal">
                  {executionModeLabel}
                </span>
                {isExecuting && (
                  <Loader2
                    size={10}
                    className="animate-spin ml-1"
                    aria-hidden="true"
                  />
                )}
              </div>
              {executionNotice && (
                <div className="markdown-console-notice mb-2 rounded px-2 py-1 text-[11px] font-sans">
                  {executionNotice}
                </div>
              )}
              <pre
                className={`whitespace-pre-wrap break-all ${consoleOutput?.startsWith("Error:") ? "markdown-console-error" : "markdown-console-success"}`}
              >
                {consoleOutput || (isExecuting ? t("executing") : "")}
              </pre>
            </div>
          )}
        </div>
      </div>
      {fullscreenView}
      {previewView}
    </>
  );
};

function getMarkdownNodeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  return Array.isArray(node.children)
    ? node.children.map(getMarkdownNodeText).join("")
    : "";
}

const MarkdownCode = ({ node, className = "", children, ...props }: any) => {
  const { forceExpandCodeBlocks, isStreaming } = React.useContext(
    CodeBlockRenderOptionsContext,
  );
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const isBlockCode = node?.position?.start?.line !== node?.position?.end?.line;

  const rawCode = getMarkdownNodeText(node);

  if (match) {
    return (
      <ArtifactBlock
        language={language}
        rawCode={rawCode}
        isStreaming={isStreaming}
        forceExpandCodeBlocks={forceExpandCodeBlocks}
      >
        {children}
      </ArtifactBlock>
    );
  }

  return (
    <code
      className={mergeClassName(
        isBlockCode
          ? "font-mono text-sm"
          : "markdown-inline-code rounded px-1 py-0.5 text-sm break-all font-mono",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
};

const MarkdownImage = ({
  src,
  alt,
  gallery = [],
  width,
  height,
  style,
  ...props
}: any & { gallery?: PreviewImageInput[] }) => {
  const t = useTranslations("Content");
  const { openImagePreview } = useUIStore();
  const safeSrc = getSafeMarkdownImageSrc(src);
  const [resolvedOpfsSrc, setResolvedOpfsSrc] = useState<{
    source: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!safeSrc || !isOPFSUrl(safeSrc)) return;

    const resolution = resolveObjectUrlWithLifecycle({
      source: safeSrc,
      resolveObjectUrl: resolveOPFSUrl,
      onResolved: (url) => {
        setResolvedOpfsSrc(url ? { source: safeSrc, url } : null);
      },
      onError: () => setResolvedOpfsSrc(null),
    });

    return () => resolution.cancel();
  }, [safeSrc]);

  const resolvedSrc =
    safeSrc && isOPFSUrl(safeSrc)
      ? resolvedOpfsSrc?.source === safeSrc
        ? resolvedOpfsSrc.url
        : null
      : safeSrc;
  const previewSrc = safeSrc && isOPFSUrl(safeSrc) ? safeSrc : resolvedSrc;
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const hasExplicitAspectRatio =
    Number.isFinite(numericWidth) &&
    numericWidth > 0 &&
    Number.isFinite(numericHeight) &&
    numericHeight > 0;
  const inputStyle =
    style && typeof style === "object"
      ? (style as React.CSSProperties)
      : undefined;
  const imageStyle: React.CSSProperties = {
    ...(inputStyle || {}),
    aspectRatio:
      inputStyle?.aspectRatio ||
      (hasExplicitAspectRatio
        ? `${numericWidth} / ${numericHeight}`
        : "auto 16 / 9"),
  };

  if (!resolvedSrc) {
    return (
      <span className="markdown-image-blocked my-2 px-3 py-2 text-xs">
        {t("imageBlocked")}
      </span>
    );
  }

  const image = (
    <img
      className="markdown-image block min-h-20 max-h-[40vh] max-w-full rounded-lg bg-muted/20 object-contain"
      src={resolvedSrc}
      alt={alt || ""}
      width={hasExplicitAspectRatio ? numericWidth : undefined}
      height={hasExplicitAspectRatio ? numericHeight : undefined}
      style={imageStyle}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      {...props}
    />
  );

  if (!previewSrc) {
    return <span className="my-2 mx-auto block max-w-full">{image}</span>;
  }

  return (
    <Button
      variant="bare"
      type="button"
      aria-label={alt ? t("previewImageWithAlt", { alt }) : t("previewImage")}
      className="markdown-image-button my-2 mx-auto block max-w-full cursor-zoom-in rounded-lg"
      onClick={() => {
        openImagePreview(
          gallery.length > 0
            ? gallery
            : [{ url: previewSrc, alt, description: alt }],
          getMarkdownImageGalleryIndex(gallery, previewSrc),
        );
      }}
    >
      {image}
    </Button>
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  searchSources,
  ragSources,
  onCitationClick,
  onFileClick,
  isStreaming,
  forcedTheme,
  forceExpandCodeBlocks,
}) => {
  // If className is provided, we assume the caller handles text color, otherwise default to gray.
  const defaultTextColors = "markdown-body-default";
  const finalClass = className ? className : defaultTextColors;
  const t = useTranslations("Content");
  const rendererRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const imageGallery = useMemo(
    () => collectMarkdownImageGallery(content),
    [content],
  );
  const citationSources = useMemo(
    () => [...(searchSources || []), ...(ragSources || [])],
    [ragSources, searchSources],
  );
  const codeBlockRenderOptions = useMemo<CodeBlockRenderOptions>(
    () => ({ forceExpandCodeBlocks, isStreaming }),
    [forceExpandCodeBlocks, isStreaming],
  );
  const shouldUseHeavyMarkdown =
    !isStreaming && (forceExpandCodeBlocks || isNearViewport);

  useEffect(() => {
    const element = rendererRef.current;
    if (!element || isNearViewport || forceExpandCodeBlocks) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const scrollRoot = element.closest<HTMLElement>(
      "[data-chat-scroll-container]",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [forceExpandCodeBlocks, isNearViewport]);

  // Define components for ReactMarkdown
  const markdownComponents: any = useMemo(
    () => ({
      pre({ children, node, ...props }: any) {
        if (!getMarkdownNodeText(node).trim()) return null;
        const onlyChild = React.Children.toArray(children)[0];
        const childClassName = React.isValidElement<{ className?: string }>(
          onlyChild,
        )
          ? onlyChild.props.className
          : undefined;

        if (childClassName && /language-\w+/.test(childClassName)) {
          return <>{children}</>;
        }

        return <pre {...props}>{children}</pre>;
      },
      code: MarkdownCode,
      a: ({ href, children }: any) => {
        return (
          <CitationLink
            href={href}
            sources={citationSources}
            onCitationClick={onCitationClick}
          >
            {children}
          </CitationLink>
        );
      },
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
      ul: (props: any) => <ul {...getSafeHtmlProps(props)} />,
      ol: (props: any) => <ol {...getSafeHtmlProps(props)} />,
      li: (props: any) => <li {...getSafeHtmlProps(props)} />,
      p: (props: any) => {
        const safeProps = getSafeHtmlProps(props);
        return (
          <p
            {...safeProps}
            className={mergeClassName(
              "markdown-paragraph",
              safeProps.className,
            )}
          />
        );
      },
      img: (props: any) => <MarkdownImage {...props} gallery={imageGallery} />,
      blockquote: (props: any) => {
        const safeProps = getSafeHtmlProps(props);
        return (
          <blockquote
            {...safeProps}
            className={mergeClassName(
              "markdown-blockquote",
              safeProps.className,
            )}
          />
        );
      },
      table: (props: any) => {
        const safeProps = getSafeHtmlProps(props);
        return (
          <div
            className="markdown-table-wrap"
            tabIndex={0}
            aria-label={t("tableScrollRegion")}
          >
            <table
              {...safeProps}
              className={mergeClassName("markdown-table", safeProps.className)}
            />
          </div>
        );
      },
      thead: (props: any) => <thead {...getSafeHtmlProps(props)} />,
      tbody: (props: any) => <tbody {...getSafeHtmlProps(props)} />,
      tfoot: (props: any) => <tfoot {...getSafeHtmlProps(props)} />,
      tr: (props: any) => <tr {...getSafeHtmlProps(props)} />,
      th: (props: any) => {
        const safeProps = getSafeHtmlProps(props);
        return (
          <th
            {...safeProps}
            className={mergeClassName(
              "markdown-table-head",
              safeProps.className,
            )}
          />
        );
      },
      td: (props: any) => {
        const safeProps = getSafeHtmlProps(props);
        return (
          <td
            {...safeProps}
            className={mergeClassName(
              "markdown-table-cell",
              safeProps.className,
            )}
          />
        );
      },
    }),
    [citationSources, imageGallery, onCitationClick, t],
  );

  // Process content line by line for <file> tags
  const renderContent = useMemo(() => {
    const normalizedContent = normalizeHtmlVisualMarkdown(content);
    // 1. Handle Citations Globally First
    const textWithCitations = linkifyCitationReferences(
      normalizedContent,
      searchSources,
      ragSources,
    );

    // 2. Split bounded model-generated file blocks from normal Markdown.
    return parseMarkdownFileBlocks(textWithCitations).map((segment, index) => {
      if (segment.kind === "markdown") {
        return parseMarkdownDiagramBlocks(segment.content).map(
          (diagramSegment, segmentIndex) => {
            if (diagramSegment.kind === "diagram") {
              return (
                <DiagramBlock
                  key={`diagram-${index}-${segmentIndex}`}
                  diagram={diagramSegment.diagram}
                  forcedTheme={forcedTheme}
                />
              );
            }

            return (
              <ReactMarkdown
                key={`md-chunk-${index}-${segmentIndex}`}
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={
                  shouldUseHeavyMarkdown
                    ? markdownRehypePlugins
                    : streamingMarkdownRehypePlugins
                }
                components={markdownComponents}
              >
                {diagramSegment.content}
              </ReactMarkdown>
            );
          },
        );
      }

      return (
        <div key={`file-card-${index}`} className="block my-2">
          <FileCard file={segment.file} onClick={onFileClick} />
        </div>
      );
    });
  }, [
    content,
    searchSources,
    ragSources,
    onFileClick,
    markdownComponents,
    forcedTheme,
    shouldUseHeavyMarkdown,
  ]);

  return (
    <CodeBlockRenderOptionsContext.Provider value={codeBlockRenderOptions}>
      <div
        ref={rendererRef}
        className={`markdown-body text-(length:--neo-font-size-base) leading-relaxed wrap-break-word w-full overflow-hidden ${finalClass}`}
      >
        {renderContent}
      </div>
    </CodeBlockRenderOptionsContext.Provider>
  );
};

export default MarkdownRenderer;
