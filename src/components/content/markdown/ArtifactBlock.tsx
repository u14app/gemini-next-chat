"use client";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  Copy,
  Check,
  Terminal,
  Maximize2,
  Minimize2,
  ChevronDown,
  SquareCode,
  X,
  SquareTerminal,
  Loader2,
} from "lucide-react";
import { useSettingsStore } from "@/store/core/settingsStore";
import { useChatStore } from "@/store/core/chatStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import {
  isAnthropicProviderType,
  isGoogleProviderType,
  isOpenAIProviderType,
} from "@/lib/providers/providerTypes";
import { createSandboxedHtmlPreviewSrcDoc } from "@/lib/utils/htmlPreview";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { parseModelString } from "@/lib/utils/model";
import Tooltip from "@/components/ui/Tooltip";
import { Button } from "@/components/ui/primitives";
const COLLAPSED_CODE_MAX_HEIGHT = "40vh";
const extractHtmlTitle = (html: string) => {
  const match = html.match(/<title>(.*?)<\/title>/i);
  return match ? match[1].trim() : "HTML Preview";
};

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

export const ArtifactBlock = ({
  language,
  rawCode,
  children,
  isStreaming,
  forceExpandCodeBlocks,
  readOnly = false,
}: {
  language: string;
  rawCode: string;
  children: React.ReactNode;
  isStreaming?: boolean;
  forceExpandCodeBlocks?: boolean;
  readOnly?: boolean;
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
    if (readOnly) return;
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
        const { executeCode } = await import("@/services/api/chatService");
        output = await executeCode(selectedModel, rawCode);
      } else if (isJS) {
        const { runInSandbox } = await import("@/utils/sandbox");
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
        {!readOnly && isHtml && !isFullscreenMode && (
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
        {!readOnly && (isPython || isJS) && !isFullscreenMode && (
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
  const previewView =
    isPreviewOpen && !readOnly
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
                sandbox={readOnly ? "" : "allow-scripts"}
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
