"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  Check,
  Copy,
  Maximize2,
  RotateCcw,
  SquareCode,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import {
  getRenderableDiagram,
  type MarkdownDiagramBlock,
} from "@/lib/utils/markdownDiagrams";
import {
  normalizeMermaidSvg,
  normalizeMindMapSvg,
} from "@/lib/utils/diagramSvg";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import type { ExportMindMapToSVGOptions } from "@xiangfa/mindmap";
import Tooltip from "@/components/ui/Tooltip";
import { Button } from "@/components/ui/primitives";

import type { DiagramTheme } from "./types";
import "./diagram.css";
export type { DiagramTheme } from "./types";

type DiagramDisplayMode = "inline" | "fullscreen";
type ExportMindMapToSVG = (options: ExportMindMapToSVGOptions) => string;
type TimeoutHandle = ReturnType<typeof setTimeout>;

const getSafeReactId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

function clearTimeoutRef(ref: React.MutableRefObject<TimeoutHandle | null>) {
  if (!ref.current) return;
  clearTimeout(ref.current);
  ref.current = null;
}

function useResolvedDiagramTheme(): DiagramTheme {
  const [theme, setTheme] = useState<DiagramTheme>("light");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const updateTheme = () => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    };

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function buildMermaidThemeVariables(theme: DiagramTheme, enhanced: boolean) {
  const dark = theme === "dark";
  if (!enhanced) {
    return {
      background: "transparent",
      primaryColor: dark ? "#27272a" : "#f8fafc",
      primaryTextColor: dark ? "#f4f4f5" : "#18181b",
      primaryBorderColor: dark ? "#52525b" : "#d4d4d8",
      lineColor: dark ? "#a1a1aa" : "#71717a",
      secondaryColor: dark ? "#18181b" : "#ffffff",
      tertiaryColor: "transparent",
      textColor: dark ? "#f4f4f5" : "#18181b",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    };
  }

  return {
    background: "transparent",
    primaryColor: dark ? "#0f2a37" : "#ecfeff",
    primaryTextColor: dark ? "#cffafe" : "#155e75",
    primaryBorderColor: dark ? "#22d3ee" : "#67e8f9",
    lineColor: dark ? "#34d399" : "#10b981",
    secondaryColor: dark ? "#102b24" : "#ecfdf5",
    tertiaryColor: dark ? "#221a3a" : "#f5f3ff",
    textColor: dark ? "#f4f8ff" : "#0b1324",
    nodeBorder: dark ? "#22d3ee" : "#06b6d4",
    mainBkg: dark ? "#0f2a37" : "#ecfeff",
    clusterBkg: dark ? "#0b1220" : "#f8fbff",
    clusterBorder: dark ? "#2a4763" : "#a5f3fc",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  };
}

const DiagramStatus = ({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "error";
}) => (
  <div
    role={tone === "error" ? "alert" : "status"}
    aria-live={tone === "error" ? "assertive" : "polite"}
    className={`markdown-diagram-status ${
      tone === "error" ? "markdown-diagram-status-error" : ""
    }`}
  >
    {label}
  </div>
);

const DiagramSvgView = ({
  svg,
  kind,
  mode,
}: {
  svg: string;
  kind: MarkdownDiagramBlock["type"];
  mode: DiagramDisplayMode;
}) => {
  const tMedia = useTranslations("Media");

  if (mode === "fullscreen") {
    return (
      <TransformWrapper
        initialScale={1}
        minScale={0.25}
        maxScale={8}
        centerOnInit={true}
        wheel={{ step: 0.16 }}
        doubleClick={{ step: 0.75 }}
        centerZoomedOut={true}
        limitToBounds={false}
        panning={{ velocityDisabled: true }}
        onInit={(ref) => {
          const center = () => ref.centerView(1, 0);
          if (typeof window === "undefined") {
            center();
            return;
          }
          window.requestAnimationFrame(center);
        }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <div className="markdown-diagram-viewport">
            <div className="markdown-diagram-zoom-controls">
              <Button
                variant="bare"
                type="button"
                onClick={() => zoomOut()}
                aria-label={tMedia("zoomOut")}
                title={tMedia("zoomOut")}
              >
                <ZoomOut size={16} aria-hidden="true" />
              </Button>
              <Button
                variant="bare"
                type="button"
                onClick={() => resetTransform()}
                aria-label={tMedia("resetZoom")}
                title={tMedia("resetZoom")}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </Button>
              <Button
                variant="bare"
                type="button"
                onClick={() => zoomIn()}
                aria-label={tMedia("zoomIn")}
                title={tMedia("zoomIn")}
              >
                <ZoomIn size={16} aria-hidden="true" />
              </Button>
            </div>
            <TransformComponent
              wrapperClass="markdown-diagram-transform-wrapper"
              contentClass="markdown-diagram-transform-content"
            >
              <div
                className="markdown-diagram-svg markdown-diagram-svg-interactive"
                data-diagram-svg-kind={kind}
                data-diagram-display-mode={mode}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </TransformComponent>
          </div>
        )}
      </TransformWrapper>
    );
  }

  return (
    <div
      className="markdown-diagram-svg markdown-diagram-svg-static"
      data-diagram-svg-kind={kind}
      data-diagram-display-mode={mode}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

const mermaidSvgCache = new Map<string, string>();
let mermaidImportPromise: Promise<typeof import("mermaid")> | null = null;

let mermaidRenderQueue: Promise<unknown> = Promise.resolve();
let mindMapImportPromise: Promise<typeof import("./mindmapExtension")> | null =
  null;
const getMindMapModule = () =>
  (mindMapImportPromise ??= import("./mindmapExtension"));

const getMermaidModule = () => {
  mermaidImportPromise ??= import("mermaid");
  return mermaidImportPromise;
};

const hashDiagramKey = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

const MermaidDiagram = ({
  source,
  incomplete,
  theme,
  enhanced,
  mode,
}: {
  source: string;
  incomplete: boolean;
  theme: DiagramTheme;
  enhanced: boolean;
  mode: DiagramDisplayMode;
}) => {
  const t = useTranslations("Content");
  const reactId = React.useId();
  const renderId = React.useMemo(
    () => `neo-mermaid-${getSafeReactId(reactId) || "diagram"}`,
    [reactId],
  );
  const [state, setState] = React.useState<{
    status: "idle" | "loading" | "ready" | "error";
    svg: string;
    error: string;
  }>({ status: "idle", svg: "", error: "" });
  const mermaidRenderHostRef = useRef<HTMLDivElement | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const trimmedSource = source.trim();
  const cacheKey = React.useMemo(
    () =>
      JSON.stringify({
        source: trimmedSource,
        theme,
        enhanced,
        mode,
      }),
    [enhanced, mode, theme, trimmedSource],
  );

  useEffect(() => {
    if (!trimmedSource) {
      return;
    }
    if (incomplete) {
      return;
    }

    const mermaidRenderHost = mermaidRenderHostRef.current;
    const cachedSvg = mermaidSvgCache.get(cacheKey);
    if (cachedSvg) {
      const cacheTimer = window.setTimeout(() => {
        setState((current) =>
          current.status === "ready" && current.svg === cachedSvg
            ? current
            : { status: "ready", svg: cachedSvg, error: "" },
        );
      }, 0);
      return () => window.clearTimeout(cacheTimer);
    }

    let cancelled = false;
    const renderTimer = window.setTimeout(() => {
      setState((current) =>
        current.svg
          ? { ...current, error: "" }
          : { ...current, status: "loading", error: "" },
      );

      void getMermaidModule()
        .then((module) => {
          const task = mermaidRenderQueue
            .catch(() => {})
            .then(async () => {
              if (cancelled) return;
              const mermaid = module.default;
              mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                suppressErrorRendering: true,
                theme: "base",
                flowchart: { htmlLabels: false },
                sequence: { useMaxWidth: true },
                themeVariables: buildMermaidThemeVariables(theme, enhanced),
              });
              const result = await mermaid.render(
                `${renderId}-${hashDiagramKey(cacheKey)}`,
                trimmedSource,
                mermaidRenderHost ?? undefined,
              );
              if (!cancelled) {
                const svg = normalizeMermaidSvg(result.svg);
                if (mermaidRenderHost) {
                  mermaidRenderHost.innerHTML = "";
                }
                mermaidSvgCache.set(cacheKey, svg);
                setState({
                  status: "ready",
                  svg,
                  error: "",
                });
              }
            });
          mermaidRenderQueue = task;
          return task;
        })
        .catch((error) => {
          if (!cancelled) {
            if (mermaidRenderHost) {
              mermaidRenderHost.innerHTML = "";
            }
            setState({
              status: "error",
              svg: "",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      if (mermaidRenderHost) {
        mermaidRenderHost.innerHTML = "";
      }
      window.clearTimeout(renderTimer);
    };
  }, [
    cacheKey,
    enhanced,
    incomplete,
    renderId,
    theme,
    trimmedSource,
    retryVersion,
  ]);

  const renderHost = (
    <div
      ref={mermaidRenderHostRef}
      aria-hidden="true"
      data-mermaid-render-host=""
      style={{
        position: "fixed",
        left: -10000,
        top: -10000,
        width: 1000,
        height: 1000,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
    />
  );

  if (!trimmedSource) {
    return (
      <>
        {renderHost}
        <DiagramStatus label={t("diagramEmpty")} />
      </>
    );
  }

  if (state.status === "ready") {
    return (
      <>
        {renderHost}
        <DiagramSvgView svg={state.svg} kind="mermaid" mode={mode} />
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {renderHost}
        <button
          type="button"
          className="markdown-link-text text-xs underline"
          onClick={() => {
            mermaidImportPromise = null;
            setRetryVersion((version) => version + 1);
          }}
        >
          {t("renderRetry")}
        </button>
        <pre className="whitespace-pre-wrap font-mono text-sm">{source}</pre>
        <DiagramStatus
          tone={incomplete ? "muted" : "error"}
          label={incomplete ? t("diagramStreaming") : t("diagramRenderFailed")}
        />
      </>
    );
  }

  return (
    <>
      {renderHost}
      <pre className="whitespace-pre-wrap font-mono text-sm">{source}</pre>
    </>
  );
};

const MindMapDiagram = ({
  source,
  incomplete,
  theme,
  mode,
}: {
  source: string;
  incomplete: boolean;
  theme: DiagramTheme;
  mode: DiagramDisplayMode;
}) => {
  const t = useTranslations("Content");
  const [exportSvg, setExportSvg] = React.useState<ExportMindMapToSVG | null>(
    null,
  );
  const [state, setState] = React.useState<{
    status: "idle" | "loading" | "ready" | "error";
    svg: string;
  }>({ status: "idle", svg: "" });
  const [retryVersion, setRetryVersion] = useState(0);
  const trimmedSource = source.trim();

  useEffect(() => {
    let cancelled = false;
    void getMindMapModule()
      .then((module) => {
        if (!cancelled) {
          setExportSvg(() => module.exportMindMapToSVG as ExportMindMapToSVG);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExportSvg(null);
          setState({ status: "error", svg: "" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryVersion]);

  useEffect(() => {
    if (!trimmedSource) {
      setState({ status: "idle", svg: "" });
      return;
    }

    if (!exportSvg) {
      setState((current) => ({ ...current, status: "loading" }));
      return;
    }

    let cancelled = false;
    setState((current) => ({ ...current, status: "loading" }));

    try {
      const exportedSvg = exportSvg({
        markdown: trimmedSource,
        defaultDirection: "both",
        theme,
        readonly: true,
        padding: 40,
        background: "transparent",
      });
      if (!cancelled) {
        setState({
          status: "ready",
          svg: normalizeMindMapSvg(exportedSvg),
        });
      }
    } catch {
      if (!cancelled) {
        setState({ status: "error", svg: "" });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [exportSvg, theme, trimmedSource, retryVersion]);

  if (!trimmedSource) {
    return <DiagramStatus label={t("diagramEmpty")} />;
  }

  return (
    <>
      {state.status === "error" ? (
        <button
          type="button"
          className="markdown-link-text text-xs underline"
          onClick={() => {
            mindMapImportPromise = null;
            setRetryVersion((version) => version + 1);
          }}
        >
          {t("renderRetry")}
        </button>
      ) : null}
      {state.status !== "ready" ? (
        <pre className="whitespace-pre-wrap font-mono text-sm">{source}</pre>
      ) : null}
      {state.status === "ready" ? (
        <DiagramSvgView svg={state.svg} kind="mindmap" mode={mode} />
      ) : state.status === "error" ? (
        <DiagramStatus
          tone={incomplete ? "muted" : "error"}
          label={incomplete ? t("diagramStreaming") : t("diagramRenderFailed")}
        />
      ) : (
        <DiagramStatus
          label={incomplete ? t("diagramStreaming") : t("diagramLoading")}
        />
      )}
    </>
  );
};

const DiagramRenderer = ({
  diagram,
  theme,
  enhanced,
  mode,
}: {
  diagram: MarkdownDiagramBlock;
  theme: DiagramTheme;
  enhanced: boolean;
  mode: DiagramDisplayMode;
}) => {
  if (diagram.incomplete)
    return (
      <pre className="whitespace-pre-wrap font-mono text-sm">
        {diagram.content}
      </pre>
    );
  if (diagram.type === "mermaid") {
    return (
      <MermaidDiagram
        source={diagram.content}
        incomplete={diagram.incomplete}
        theme={theme}
        enhanced={enhanced}
        mode={mode}
      />
    );
  }

  return (
    <MindMapDiagram
      source={diagram.content}
      incomplete={diagram.incomplete}
      theme={theme}
      mode={mode}
    />
  );
};

export const DiagramBlock = ({
  diagram,
  forcedTheme,
}: {
  diagram: MarkdownDiagramBlock;
  forcedTheme?: DiagramTheme;
}) => {
  const t = useTranslations("Content");
  const resolvedTheme = useResolvedDiagramTheme();
  const theme = forcedTheme || resolvedTheme;
  const enhanced = true;
  const [loadError, setLoadError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const promise =
      diagram.type === "mermaid" ? getMermaidModule() : getMindMapModule();
    void promise.catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [diagram.type, reloadVersion]);
  const [copyStatus, setCopyStatus] = React.useState<
    "idle" | "copied" | "error"
  >("idle");
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const diagramBodyRef = React.useRef<HTMLDivElement>(null);
  const copyResetTimerRef = React.useRef<TimeoutHandle | null>(null);
  const [lastRenderedDiagram, setLastRenderedDiagram] =
    React.useState<MarkdownDiagramBlock | null>(() =>
      diagram.incomplete ? null : diagram,
    );
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousDialogFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const label =
    diagram.type === "mermaid" ? t("diagramMermaid") : t("diagramMindmap");

  React.useEffect(() => {
    return () => clearTimeoutRef(copyResetTimerRef);
  }, []);

  const renderableDiagram = getRenderableDiagram(diagram, lastRenderedDiagram);

  React.useEffect(() => {
    if (!diagram.incomplete && diagram.content.trim()) {
      const updateTimer = window.setTimeout(() => {
        setLastRenderedDiagram(diagram);
      }, 0);
      return () => window.clearTimeout(updateTimer);
    }
  }, [diagram]);

  React.useEffect(() => {
    if (!isFullscreen) return;
    previousDialogFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previousDialogFocusRef.current?.isConnected) {
        previousDialogFocusRef.current.focus({ preventScroll: true });
      }
      previousDialogFocusRef.current = null;
    };
  }, [isFullscreen]);

  const scheduleCopyReset = () => {
    clearTimeoutRef(copyResetTimerRef);
    copyResetTimerRef.current = setTimeout(() => {
      setCopyStatus("idle");
      copyResetTimerRef.current = null;
    }, 2000);
  };

  const handleCopy = async () => {
    const didCopy = await copyTextToClipboard(diagram.content);
    setCopyStatus(didCopy ? "copied" : "error");
    scheduleCopyReset();
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsFullscreen(false);
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const controls = (
    <div className="flex items-center gap-1.5">
      {diagram.incomplete ? (
        <span className="markdown-status-badge rounded-full px-2 py-0.5 text-[10px] font-medium">
          {t("diagramStreaming")}
        </span>
      ) : null}
      <Tooltip
        content={
          copyStatus === "copied"
            ? t("copied")
            : copyStatus === "error"
              ? t("copyFailed")
              : t("copyDiagramSource")
        }
        position="bottom"
      >
        <Button
          variant="bare"
          type="button"
          onClick={handleCopy}
          aria-label={
            copyStatus === "copied"
              ? t("diagramSourceCopiedAria")
              : t("copyDiagramSourceAria")
          }
          className="markdown-icon-button markdown-focus-ring flex items-center justify-center rounded p-1.5"
        >
          {copyStatus === "copied" ? (
            <Check
              size={14}
              className="markdown-icon-success"
              aria-hidden="true"
            />
          ) : copyStatus === "error" ? (
            <X size={14} className="markdown-icon-danger" aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
        </Button>
      </Tooltip>
      <Tooltip content={t("fullscreenDiagram")} position="bottom">
        <Button
          variant="bare"
          type="button"
          onClick={() => setIsFullscreen(true)}
          aria-label={t("fullscreenDiagramAria", { type: label })}
          className="markdown-icon-button markdown-focus-ring flex items-center justify-center rounded p-1.5"
        >
          <Maximize2 size={14} aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );

  const fullscreenView =
    isFullscreen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="markdown-preview-dialog fixed inset-0 z-2000 flex flex-col motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
          >
            <div className="markdown-preview-header flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <h2
                id={titleId}
                className="markdown-strong-text min-w-0 truncate text-sm font-semibold"
              >
                {t("diagramFullscreenTitle", { type: label })}
              </h2>
              <Button
                variant="bare"
                ref={closeButtonRef}
                type="button"
                onClick={() => setIsFullscreen(false)}
                aria-label={t("closeDiagramFullscreenAria")}
                className="markdown-icon-button markdown-focus-ring rounded-lg p-1.5"
              >
                <X size={20} aria-hidden="true" />
              </Button>
            </div>
            <div className="markdown-diagram-fullscreen flex-1 overflow-auto p-4">
              <DiagramRenderer
                key={reloadVersion}
                diagram={renderableDiagram}
                theme={theme}
                enhanced={enhanced}
                mode="fullscreen"
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        className={`markdown-diagram ${enhanced ? "markdown-diagram-enhanced" : ""}`}
        data-markdown-diagram={diagram.type}
      >
        <div className="markdown-diagram-header">
          <div className="flex min-w-0 items-center gap-2">
            <SquareCode size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </div>
          {controls}
        </div>
        {loadError ? (
          <button
            type="button"
            className="markdown-link-text text-xs underline"
            onClick={() => {
              mermaidImportPromise = null;
              mindMapImportPromise = null;
              setLoadError(false);
              setReloadVersion((version) => version + 1);
              const request =
                diagram.type === "mermaid"
                  ? getMermaidModule()
                  : getMindMapModule();
              void request.catch(() => setLoadError(true));
            }}
          >
            {t("renderRetry")}
          </button>
        ) : null}
        <div ref={diagramBodyRef} className="markdown-diagram-body">
          <DiagramRenderer
            key={reloadVersion}
            diagram={renderableDiagram}
            theme={theme}
            enhanced={enhanced}
            mode="inline"
          />
        </div>
      </div>
      {fullscreenView}
    </>
  );
};
