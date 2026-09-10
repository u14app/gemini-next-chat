"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  Check,
  Copy,
  ImageDown,
  Maximize2,
  RotateCcw,
  SquareCode,
  X,
} from "lucide-react";
import {
  ChartRendererRegistry,
  parseMarkdownChartEnvelope,
  type ChartHandle,
  type ChartMountContext,
  type ChartParseContext,
  type MarkdownChartLabelOverrides,
  type JsonValue,
} from "@datafe-open/markdown-chart";
import {
  applyEChartsDefaultStyle,
  createEChartsRenderer,
  type EChartsInstance,
  type ParsedEChartsSpec,
} from "@datafe-open/markdown-chart-echarts";
import {
  MarkdownChartBlock,
  MarkdownChartProvider,
} from "@datafe-open/markdown-chart-react";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import Tooltip from "@/components/ui/Tooltip";
import { Button } from "@/components/ui/primitives";
import {
  trapModalFocus,
  useModalLifecycle,
} from "@/components/ui/useModalLifecycle";

import type { DiagramTheme } from "./types";
import "./chart.css";

export interface ChartBlockProps {
  source: string;
  incomplete: boolean;
  forcedTheme?: DiagramTheme;
}

type ReadyState = "false" | "true" | "error";
type CopyState = "idle" | "copied" | "error";
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface CopyActionLabels {
  copied: string;
  copyFailed: string;
  copy: string;
  copiedAria: string;
  copyAria: string;
}

interface ChartActionLabels extends CopyActionLabels {
  fullscreen: string;
  fullscreenAria: string;
  download: string;
  downloadAria: string;
}

interface CapturedEChartsInstance extends EChartsInstance {
  getDataURL?: (options?: {
    type?: string;
    pixelRatio?: number;
    backgroundColor?: string;
  }) => string;
}

interface EChartsRuntimeLike {
  init(
    container: HTMLElement,
    theme?: string | Record<string, unknown> | null,
  ): CapturedEChartsInstance;
}

const LIGHT_PALETTE = [
  "#06b6d4",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#f43f5e",
] as const;

const DARK_PALETTE = [
  "#22d3ee",
  "#34d399",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
] as const;

const LIGHT_CHART_BACKGROUND = "#ffffff";
const DARK_CHART_BACKGROUND = "#0b1220";

let echartsImportPromise: Promise<unknown> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEChartsRuntime(value: unknown): value is EChartsRuntimeLike {
  return isRecord(value) && typeof value.init === "function";
}

function resolveEChartsRuntime(value: unknown): EChartsRuntimeLike {
  if (isEChartsRuntime(value)) return value;
  if (isRecord(value) && isEChartsRuntime(value.default)) {
    return value.default;
  }
  throw new Error("The ECharts runtime did not expose init().");
}

function loadEChartsModule(): Promise<unknown> {
  if (!echartsImportPromise) {
    echartsImportPromise = import("echarts").catch((error: unknown) => {
      echartsImportPromise = null;
      throw error;
    });
  }
  return echartsImportPromise;
}

function createEChartsLoader(
  onInstanceMount?: (instance: CapturedEChartsInstance) => void,
  onInstanceDispose?: (instance: CapturedEChartsInstance) => void,
) {
  return async (): Promise<EChartsRuntimeLike> => {
    const runtime = resolveEChartsRuntime(await loadEChartsModule());
    return {
      init(container, theme) {
        const instance = runtime.init(container, theme);
        let disposed = false;
        const captured: CapturedEChartsInstance = {
          setOption: (option, options) => instance.setOption(option, options),
          resize: () => instance.resize(),
          dispose: () => {
            if (disposed) return;
            disposed = true;
            try {
              instance.dispose();
            } finally {
              onInstanceDispose?.(captured);
            }
          },
        };
        if (instance.getDataURL) {
          captured.getDataURL = (options) =>
            instance.getDataURL?.(options) || "";
        }
        onInstanceMount?.(captured);
        return captured;
      },
    };
  };
}

function useResolvedTheme(forcedTheme?: DiagramTheme): DiagramTheme {
  const [resolvedTheme, setResolvedTheme] = useState<DiagramTheme>(
    forcedTheme || "light",
  );

  useEffect(() => {
    if (forcedTheme) {
      setResolvedTheme(forcedTheme);
      return;
    }

    const root = document.documentElement;
    const updateTheme = () => {
      setResolvedTheme(root.classList.contains("dark") ? "dark" : "light");
    };

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [forcedTheme]);

  return forcedTheme || resolvedTheme;
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
    } else {
      media.addListener?.(update);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", update);
      } else {
        media.removeListener?.(update);
      }
    };
  }, []);

  return reducedMotion;
}

function withChartDefaults(
  option: Record<string, JsonValue>,
  theme: unknown,
  reducedMotion: boolean,
): Record<string, JsonValue> {
  const dark = theme === "dark";
  const styled = applyEChartsDefaultStyle(option, dark ? "dark" : "light");

  if (!Object.prototype.hasOwnProperty.call(option, "color")) {
    styled.color = [...(dark ? DARK_PALETTE : LIGHT_PALETTE)];
  }
  styled.backgroundColor = "transparent";
  const foreground = dark ? "#e5e7eb" : "#374151";
  const textKeys = new Set([
    "textStyle",
    "subtextStyle",
    "nameTextStyle",
    "axisLabel",
    "label",
    "endLabel",
    "edgeLabel",
    "detail",
    "dayLabel",
    "monthLabel",
    "yearLabel",
    "pageTextStyle",
  ]);
  function correctText(value: JsonValue): void {
    if (Array.isArray(value)) {
      value.forEach(correctText);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        textKeys.has(key) &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        child.color = foreground;
        child.opacity = 1;
        child.backgroundColor = "transparent";
        if (
          child.rich &&
          typeof child.rich === "object" &&
          !Array.isArray(child.rich)
        ) {
          for (const style of Object.values(child.rich)) {
            if (style && typeof style === "object" && !Array.isArray(style)) {
              style.color = foreground;
              style.opacity = 1;
              style.backgroundColor = "transparent";
            }
          }
        }
      }
      correctText(child);
    }
  }
  correctText(styled);
  styled.textStyle = {
    ...(styled.textStyle as Record<string, JsonValue>),
    color: foreground,
  };
  if (
    styled.tooltip &&
    typeof styled.tooltip === "object" &&
    !Array.isArray(styled.tooltip)
  ) {
    styled.tooltip.backgroundColor = dark
      ? DARK_CHART_BACKGROUND
      : LIGHT_CHART_BACKGROUND;
  }
  // Pie and other series labels otherwise inherit the series color.
  const series = Array.isArray(styled.series) ? styled.series : [styled.series];
  for (const entry of series) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      entry.label = {
        ...(entry.label as Record<string, JsonValue>),
        color: foreground,
      };
    }
  }
  if (reducedMotion) {
    styled.animation = false;
  }

  return styled;
}

function createChartRegistry(
  reducedMotion: boolean,
  onInstanceMount?: (instance: CapturedEChartsInstance) => void,
  onInstanceDispose?: (instance: CapturedEChartsInstance) => void,
): ChartRendererRegistry {
  const baseRenderer = createEChartsRenderer({
    loadECharts: createEChartsLoader(onInstanceMount, onInstanceDispose),
    limits: { maxSeries: 12 },
    defaultStyle: false,
  });

  const renderer = {
    ...baseRenderer,
    aliases: [] as const,
    matchLanguage: undefined,
    async parse(spec: JsonValue, context: ChartParseContext) {
      if (context.data?.kind === "ref") {
        throw new Error("Only inline chart data is supported.");
      }
      return baseRenderer.parse(spec, context);
    },
    async mount(
      container: HTMLElement,
      parsed: ParsedEChartsSpec,
      context: ChartMountContext,
    ): Promise<ChartHandle | void> {
      // Adapt the upstream shell before mounting, including fullscreen instances.
      const host = context.hostContainer;
      const title = host?.querySelector<HTMLElement>(".markdown-chart-title");
      if (title) {
        title.className = "markdown-chart-caption";
        title.removeAttribute("style");
        host?.append(title);
      }
      host?.querySelector(".markdown-chart-toolbar")?.remove();
      host?.querySelector(".markdown-chart-data-view")?.remove();
      return baseRenderer.mount(
        container,
        {
          ...parsed,
          option: withChartDefaults(
            parsed.option,
            context.theme,
            reducedMotion,
          ),
        },
        context,
      );
    },
  };

  return new ChartRendererRegistry().register(renderer);
}

function chartMarkdownTable(source: string): string | null {
  const { data } = parseMarkdownChartEnvelope(source);
  if (data?.kind !== "inline") return null;
  const columns = data.dimensions?.length
    ? [...data.dimensions]
    : [
        ...new Set(
          data.source.flatMap((row) =>
            Array.isArray(row)
              ? row.map((_, index) => String(index + 1))
              : Object.keys(row),
          ),
        ),
      ];
  if (!columns.length) return null;
  const cell = (value: unknown): string =>
    (value === "" ? '""' : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/([`*_~])/g, "\\$1")
      .replace(/\r\n|\r|\n/g, "<br>");
  const line = (values: unknown[]) => `| ${values.map(cell).join(" | ")} |`;
  return [
    line(columns),
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...data.source.map((row) =>
      line(
        columns.map((column, index) =>
          Array.isArray(row) ? row[index] : row[column],
        ),
      ),
    ),
  ].join("\n");
}

function CopyChartAction({
  copyState,
  onCopy,
  labels,
}: {
  copyState: CopyState;
  onCopy: () => void;
  labels: CopyActionLabels;
}) {
  let label = labels.copy;
  let ariaLabel = labels.copyAria;
  let icon = <Copy size={14} aria-hidden="true" />;
  if (copyState === "copied") {
    label = labels.copied;
    ariaLabel = labels.copiedAria;
    icon = <Check size={14} aria-hidden="true" />;
  } else if (copyState === "error") {
    label = labels.copyFailed;
    icon = <X size={14} aria-hidden="true" />;
  }

  return (
    <Tooltip content={label} position="bottom" portal>
      <Button
        variant="bare"
        type="button"
        onClick={onCopy}
        aria-label={ariaLabel}
        className="markdown-chart-action markdown-focus-ring rounded p-1.5"
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

function ChartActions({
  copyState,
  onCopy,
  onFullscreen,
  onDownload,
  downloadDisabled,
  fullscreenButtonRef,
  labels,
}: {
  copyState: CopyState;
  onCopy: () => void;
  onFullscreen?: () => void;
  onDownload?: () => void;
  downloadDisabled?: boolean;
  fullscreenButtonRef?: React.RefObject<HTMLButtonElement | null>;
  labels: ChartActionLabels;
}) {
  return (
    <div className="markdown-chart-actions">
      <CopyChartAction copyState={copyState} onCopy={onCopy} labels={labels} />
      {onDownload ? (
        <Tooltip content={labels.download} position="bottom" portal>
          <Button
            variant="bare"
            type="button"
            onClick={onDownload}
            aria-label={labels.downloadAria}
            disabled={downloadDisabled}
            className="markdown-chart-action markdown-focus-ring rounded p-1.5"
          >
            <ImageDown size={14} aria-hidden="true" />
          </Button>
        </Tooltip>
      ) : null}
      {onFullscreen ? (
        <Tooltip content={labels.fullscreen} position="bottom" portal>
          <Button
            variant="bare"
            ref={fullscreenButtonRef}
            type="button"
            onClick={onFullscreen}
            aria-label={labels.fullscreenAria}
            className="markdown-chart-action markdown-focus-ring rounded p-1.5"
          >
            <Maximize2 size={14} aria-hidden="true" />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function ChartErrorFallback({
  source,
  onCopy,
  copyState,
  onRetry,
  labels,
}: {
  source: string;
  onCopy: () => void;
  copyState: CopyState;
  onRetry: () => void;
  labels: CopyActionLabels & {
    renderFailed: string;
    retry: string;
    source: string;
  };
}) {
  return (
    <div className="markdown-chart-error" role="alert">
      <div className="markdown-chart-error-header">
        <span>{labels.renderFailed}</span>
        <CopyChartAction
          copyState={copyState}
          onCopy={onCopy}
          labels={labels}
        />
      </div>
      <Button variant="secondary" size="sm" type="button" onClick={onRetry}>
        <RotateCcw size={14} aria-hidden="true" />
        {labels.retry}
      </Button>
      <details className="markdown-chart-source-details">
        <summary>{labels.source}</summary>
        <pre>{source}</pre>
      </details>
    </div>
  );
}

function FullscreenChart({
  source,
  theme,
  registry,
  labels,
  onError,
}: {
  source: string;
  theme: DiagramTheme;
  registry: ChartRendererRegistry;
  labels: MarkdownChartLabelOverrides;
  onError: (error: unknown) => void;
}) {
  return (
    <div className="markdown-chart markdown-chart-fullscreen-shell">
      <MarkdownChartProvider
        registry={registry}
        theme={theme}
        labels={labels}
        onError={onError}
      >
        <MarkdownChartBlock
          language="markdown-chart"
          source={source}
          className="markdown-chart-fullscreen-block"
        />
      </MarkdownChartProvider>
    </div>
  );
}

export function ChartBlock({
  source,
  incomplete,
  forcedTheme,
}: ChartBlockProps) {
  const t = useTranslations("Content");
  const theme = useResolvedTheme(forcedTheme);
  const reducedMotion = usePrefersReducedMotion();
  const [readyState, setReadyState] = useState<ReadyState>("false");
  const [renderError, setRenderError] = useState<unknown | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [downloadError, setDownloadError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<unknown | null>(null);
  const [inlineInstance, setInlineInstance] =
    useState<CapturedEChartsInstance | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<TimeoutHandle | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const handleInlineInstanceDispose = useCallback(
    (disposedInstance: CapturedEChartsInstance) => {
      setInlineInstance((current) =>
        current === disposedInstance ? null : current,
      );
    },
    [],
  );
  const registry = useMemo(
    () =>
      createChartRegistry(
        reducedMotion,
        setInlineInstance,
        handleInlineInstanceDispose,
      ),
    [handleInlineInstanceDispose, reducedMotion],
  );
  const fullscreenRegistry = useMemo(
    () => createChartRegistry(reducedMotion),
    [reducedMotion],
  );

  const labels = useMemo(
    () => ({
      chartUnavailable: t("chartRenderFailed"),
      viewMode: t("chartViewMode"),
      chart: t("chart"),
      data: t("chartData"),
      showChart: t("showChart"),
      showData: t("showChartData"),
      noData: t("chartNoData"),
      tableNotice: ({
        visibleRows,
        totalRows,
        visibleColumns,
        totalColumns,
      }: {
        visibleRows: number;
        totalRows: number;
        visibleColumns: number;
        totalColumns: number;
      }) =>
        t("chartTableNotice", {
          visibleRows,
          totalRows,
          visibleColumns,
          totalColumns,
        }),
    }),
    [t],
  );

  const actionLabels = useMemo(
    () => ({
      copied: t("copied"),
      copyFailed: t("copyFailed"),
      copy: t("copyChartTable"),
      copiedAria: t("chartTableCopiedAria"),
      copyAria: t("copyChartTableAria"),
      fullscreen: t("fullscreenChart"),
      fullscreenAria: t("fullscreenChartAria"),
      download: t("saveImage"),
      downloadAria: t("saveChartImage"),
    }),
    [t],
  );

  const errorLabels = useMemo(
    () => ({
      renderFailed: t("chartRenderFailed"),
      retry: t("chartRetry"),
      source: t("chartSource"),
      ...actionLabels,
    }),
    [actionLabels, t],
  );

  useModalLifecycle({
    open: isFullscreen,
    dialogRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef: fullscreenButtonRef,
  });

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen) setFullscreenError(null);
  }, [isFullscreen]);

  const handleRenderError = useCallback((error: unknown) => {
    setRenderError(error);
    setReadyState("error");
  }, []);

  useEffect(() => {
    if (incomplete || renderError) return;
    const root = rootRef.current;
    if (!root) return;

    const syncChartState = () => {
      const errorElement = root.querySelector(".markdown-chart-error");
      const chartElement = root.querySelector(".markdown-chart-chart-view");
      const loadingElement = root.querySelector(
        '[data-markdown-chart-loading="true"]',
      );
      if (errorElement) {
        setReadyState("error");
        setRenderError(
          (current: unknown | null) =>
            current ?? new Error("Chart unavailable"),
        );
      } else {
        setReadyState(chartElement && !loadingElement ? "true" : "false");
      }
    };

    syncChartState();
    const observer = new MutationObserver(syncChartState);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "hidden",
        "aria-busy",
        "data-markdown-chart-loading",
      ],
    });
    return () => observer.disconnect();
  }, [incomplete, renderError, retryVersion]);

  const scheduleCopyReset = useCallback(() => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => {
      setCopyState("idle");
      copyResetTimerRef.current = null;
    }, 2000);
  }, []);

  const handleCopy = useCallback(async () => {
    let didCopy = false;
    try {
      const table = chartMarkdownTable(source);
      didCopy = table !== null && (await copyTextToClipboard(table));
    } catch {
      didCopy = false;
    }
    setCopyState(didCopy ? "copied" : "error");
    scheduleCopyReset();
  }, [scheduleCopyReset, source]);

  const handleDownload = useCallback(() => {
    const instance = inlineInstance;
    if (!instance?.getDataURL) {
      setDownloadError(true);
      return;
    }

    try {
      const image = instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor:
          theme === "dark" ? DARK_CHART_BACKGROUND : LIGHT_CHART_BACKGROUND,
      });
      if (!image) throw new Error("ECharts returned an empty image.");
      const link = document.createElement("a");
      link.href = image;
      link.download = "chart.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadError(false);
    } catch {
      setDownloadError(true);
    }
  }, [inlineInstance, theme]);

  const handleRetry = useCallback(() => {
    setRenderError(null);
    setReadyState("false");
    setDownloadError(false);
    setRetryVersion((version) => version + 1);
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsFullscreen(false);
      return;
    }
    trapModalFocus(event, dialogRef.current);
  };

  const chartContent =
    renderError || incomplete ? null : (
      <MarkdownChartProvider
        key={retryVersion}
        registry={registry}
        theme={theme}
        loadingLabel={t("chartLoading")}
        labels={labels}
        onError={handleRenderError}
      >
        <MarkdownChartBlock
          language="markdown-chart"
          source={source}
          className="markdown-chart-inline-block"
        />
      </MarkdownChartProvider>
    );

  const actions =
    !renderError && !incomplete ? (
      <ChartActions
        copyState={copyState}
        onCopy={() => {
          void handleCopy();
        }}
        onFullscreen={() => setIsFullscreen(true)}
        onDownload={handleDownload}
        downloadDisabled={!inlineInstance?.getDataURL}
        fullscreenButtonRef={fullscreenButtonRef}
        labels={actionLabels}
      />
    ) : null;

  const fullscreenView =
    isFullscreen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={dialogRef}
            className="markdown-chart-dialog fixed inset-0 z-2000 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <div className="markdown-chart-dialog-header flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <h2
                id={titleId}
                className="min-w-0 truncate text-sm font-semibold"
              >
                <span className="flex items-center gap-2">
                  <SquareCode size={14} aria-hidden="true" />
                  Chart
                </span>
              </h2>
              <Button
                variant="bare"
                ref={closeButtonRef}
                type="button"
                onClick={() => setIsFullscreen(false)}
                aria-label={t("closeChartFullscreenAria")}
                className="markdown-focus-ring rounded-lg p-1.5"
              >
                <X size={20} aria-hidden="true" />
              </Button>
            </div>
            <div className="markdown-chart-dialog-body flex-1 overflow-auto p-4">
              {fullscreenError ? (
                <ChartErrorFallback
                  source={source}
                  onCopy={() => {
                    void handleCopy();
                  }}
                  copyState={copyState}
                  onRetry={() => setFullscreenError(null)}
                  labels={errorLabels}
                />
              ) : (
                <FullscreenChart
                  source={source}
                  theme={theme}
                  registry={fullscreenRegistry}
                  labels={labels}
                  onError={setFullscreenError}
                />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  let chartBody = chartContent;
  if (incomplete) {
    chartBody = (
      <pre className="whitespace-pre-wrap break-words font-mono text-sm">
        {source}
      </pre>
    );
  } else if (renderError) {
    chartBody = (
      <ChartErrorFallback
        source={source}
        onCopy={() => {
          void handleCopy();
        }}
        copyState={copyState}
        onRetry={handleRetry}
        labels={errorLabels}
      />
    );
  }

  let exportedReadyState: ReadyState = "false";
  if (renderError) {
    exportedReadyState = "error";
  } else if (!incomplete && readyState === "true" && inlineInstance) {
    exportedReadyState = "true";
  }

  return (
    <>
      <div
        ref={rootRef}
        className="markdown-chart"
        data-markdown-chart-ready={exportedReadyState}
      >
        <div className="markdown-chart-header">
          <span className="flex min-w-0 items-center gap-2">
            <SquareCode size={14} className="shrink-0" aria-hidden="true" />
            <span>Chart</span>
          </span>
          {actions}
        </div>
        {chartBody}
        {downloadError ? (
          <span
            className="markdown-chart-action-status"
            role="status"
            aria-live="polite"
          >
            {t("chartDownloadFailed")}
          </span>
        ) : null}
      </div>
      {fullscreenView}
    </>
  );
}
