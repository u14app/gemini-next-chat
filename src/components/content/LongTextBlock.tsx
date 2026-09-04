"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Maximize2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { LongTextPresentation } from "@/types";
import { getLongTextPreview } from "@/lib/chat/longText";
import { IconButton } from "@/components/ui/primitives";
import MarkdownRenderer from "./MarkdownRenderer";

interface LongTextBlockProps {
  content: string;
  presentation: LongTextPresentation;
  isStreaming?: boolean;
  isInterrupted?: boolean;
  forceExpanded?: boolean;
  onOpen?: () => void;
}

const downloadDocument = (
  presentation: LongTextPresentation,
  content: string,
) => {
  const blob = new Blob([content], {
    type: presentation.document.mimeType,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = presentation.document.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const LongTextBlock = React.memo(function LongTextBlock({
  content,
  presentation,
  isStreaming = false,
  isInterrupted = false,
  forceExpanded = false,
  onOpen,
}: LongTextBlockProps) {
  const t = useTranslations("Message");
  const rootRef = useRef<HTMLElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(forceExpanded);
  const preview = useMemo(
    () =>
      forceExpanded
        ? { content, truncated: false }
        : getLongTextPreview(content),
    [content, forceExpanded],
  );

  useEffect(() => {
    if (forceExpanded) {
      setIsNearViewport(true);
      return;
    }
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const scrollRoot = element.closest<HTMLElement>(
      "[data-chat-scroll-container]",
    );
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(entry?.isIntersecting === true);
      },
      { root: scrollRoot, rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [forceExpanded]);

  const controlsDisabled = isStreaming || !content;
  const canOpen = Boolean(onOpen && content && !isStreaming && !forceExpanded);
  const suppressOpenRef = useRef(false);

  const isNestedInteractiveTarget = (
    target: EventTarget | null,
    container?: EventTarget | null,
  ) => {
    if (!(target instanceof Element)) return false;
    const interactive = target.closest(
      'a, button, input, textarea, select, summary, [role="button"], [tabindex]:not([tabindex="-1"])',
    );
    return Boolean(interactive && interactive !== container);
  };

  const hasSelection = () => {
    if (typeof window === "undefined") return false;
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed);
  };

  const openFromContent = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpen || event.defaultPrevented) return;
    if (suppressOpenRef.current) {
      suppressOpenRef.current = false;
      return;
    }
    if (
      isNestedInteractiveTarget(event.target, event.currentTarget) ||
      hasSelection()
    )
      return;
    onOpen?.();
  };

  const markPointerTarget = (event: React.PointerEvent<HTMLDivElement>) => {
    suppressOpenRef.current = isNestedInteractiveTarget(
      event.target,
      event.currentTarget,
    );
  };
  const formatLabel =
    presentation.format === "markdown"
      ? t("longTextMarkdown")
      : t("longTextPlainText");
  const statusLabel = isStreaming
    ? t("longTextGenerating")
    : isInterrupted
      ? t("longTextIncomplete")
      : null;

  return (
    <section
      ref={rootRef}
      className="long-text-block my-4 w-full overflow-hidden rounded-xl border border-border bg-card/70"
      aria-label={t("longTextDocumentAria", { title: presentation.title })}
      aria-busy={isStreaming || undefined}
    >
      <header className="flex min-h-13 items-center justify-between gap-3 border-b border-border/80 bg-muted/30 px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200/70 bg-blue-50 text-blue-600 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300">
            <FileText size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {canOpen ? (
              <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
                <button
                  type="button"
                  onClick={() => onOpen?.()}
                  className="block max-w-full truncate text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {presentation.title}
                </button>
              </h3>
            ) : (
              <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
                {presentation.title}
              </h3>
            )}
            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              <span>{formatLabel}</span>
              {statusLabel ? (
                <span className="inline-flex items-center gap-1 normal-case tracking-normal text-amber-700 dark:text-amber-300">
                  {isStreaming ? (
                    <Loader2
                      size={11}
                      className="motion-safe:animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {statusLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {!forceExpanded ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              size="sm"
              disabled={controlsDisabled}
              label={t("longTextDownloadAria", {
                title: presentation.title,
              })}
              icon={<Download size={16} aria-hidden="true" />}
              onClick={() => downloadDocument(presentation, content)}
            />
            <IconButton
              size="sm"
              disabled={controlsDisabled || !onOpen}
              label={t("longTextOpenAria", { title: presentation.title })}
              icon={<Maximize2 size={16} aria-hidden="true" />}
              onClick={onOpen}
            />
          </div>
        ) : null}
      </header>

      <div
        className={
          forceExpanded
            ? "px-4 py-5 md:px-7 md:py-7"
            : `relative h-60 overflow-hidden px-4 py-4 md:h-80 md:px-7 md:py-6 ${canOpen ? "cursor-pointer" : ""}`
        }
        onPointerDown={canOpen ? markPointerTarget : undefined}
        onClick={canOpen ? openFromContent : undefined}
      >
        {isNearViewport ? (
          presentation.format === "markdown" ? (
            <MarkdownRenderer
              content={preview.content}
              isStreaming={isStreaming}
              forceExpandCodeBlocks={forceExpanded}
            />
          ) : (
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-6 text-foreground/90">
              {preview.content}
            </pre>
          )
        ) : (
          <div
            className="space-y-3 motion-safe:animate-pulse"
            role="status"
            aria-label={t("longTextPreviewLoading")}
          >
            <div className="h-5 w-3/5 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted/80" />
            <div className="h-3 w-11/12 rounded bg-muted/80" />
            <div className="h-3 w-4/5 rounded bg-muted/80" />
            <div className="pt-3">
              <div className="h-3 w-full rounded bg-muted/60" />
              <div className="mt-3 h-3 w-5/6 rounded bg-muted/60" />
            </div>
          </div>
        )}

        {!forceExpanded ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent via-card/85 to-card"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {presentation.document.localFileError ? (
        <div
          className="flex items-start gap-2 border-t border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200 md:px-4"
          role="status"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{t("longTextLocalSaveFailed")}</span>
        </div>
      ) : null}
    </section>
  );
});

export default LongTextBlock;
