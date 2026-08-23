"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Paperclip,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { formatBytes } from "@/config/limits";
import { isTextWorkspaceMimeType } from "@/lib/agent/workspace";
import type { WorkspaceFilePresentation } from "@/types";
import { resolveOPFSBlob } from "@/utils/opfs";
import { useOpfsDownload } from "./useOpfsDownload";
import { IconButton } from "@/components/ui/primitives";
import MarkdownRenderer from "./MarkdownRenderer";

interface WorkspaceFileBlockProps {
  file: WorkspaceFilePresentation;
  forceExpanded?: boolean;
  onOpen?: (file: WorkspaceFilePresentation) => void;
}

interface LoadedPreview {
  revision: string;
  content: string;
  complete: boolean;
}

const PREVIEW_MAX_CHARS = 2_400;

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType === "text/csv" || mimeType === "text/tab-separated-values") {
    return FileSpreadsheet;
  }
  if (
    mimeType === "application/json" ||
    mimeType === "application/x-ndjson" ||
    mimeType === "text/javascript" ||
    mimeType === "text/x-python" ||
    mimeType === "application/sql" ||
    mimeType === "application/xml"
  ) {
    return FileCode2;
  }
  if (isTextWorkspaceMimeType(mimeType)) return FileText;
  return Paperclip;
};

const WorkspaceFileBlock = React.memo(function WorkspaceFileBlock({
  file,
  forceExpanded = false,
  onOpen,
}: WorkspaceFileBlockProps) {
  const t = useTranslations("Message");
  const rootRef = useRef<HTMLElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(forceExpanded);
  const [loadedPreview, setLoadedPreview] = useState<LoadedPreview | null>(
    null,
  );
  const [failedPreviewRevision, setFailedPreviewRevision] = useState<
    string | null
  >(null);
  const {
    download,
    failed: downloadFailed,
    setFailed: setDownloadFailed,
  } = useOpfsDownload(file.url, file.fileName);

  const isText = isTextWorkspaceMimeType(file.mimeType);
  const isMarkdown = file.mimeType === "text/markdown";
  const Icon = getFileIcon(file.mimeType);
  const title = file.title || file.fileName;
  const currentPreview =
    loadedPreview?.revision === file.revision ? loadedPreview : null;
  const preview =
    currentPreview && (!forceExpanded || currentPreview.complete)
      ? currentPreview.content
      : null;
  const previewFailed = failedPreviewRevision === file.revision;
  const loadFailed = previewFailed || downloadFailed;

  useEffect(() => {
    setDownloadFailed(false);
  }, [file.revision, setDownloadFailed]);

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
      ([entry]) => setIsNearViewport(entry?.isIntersecting === true),
      { root: scrollRoot, rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [forceExpanded]);

  // File bytes are read on demand and never held in message state.
  useEffect(() => {
    if (
      !isText ||
      !isNearViewport ||
      (currentPreview && (!forceExpanded || currentPreview.complete))
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const blob = await resolveOPFSBlob(file.url);
        if (cancelled) return;
        if (!blob) {
          setFailedPreviewRevision(file.revision);
          return;
        }
        const text = await blob.text();
        if (cancelled) return;
        setFailedPreviewRevision((failedRevision) =>
          failedRevision === file.revision ? null : failedRevision,
        );
        setLoadedPreview({
          revision: file.revision,
          content: forceExpanded ? text : text.slice(0, PREVIEW_MAX_CHARS),
          complete: forceExpanded || text.length <= PREVIEW_MAX_CHARS,
        });
      } catch {
        if (!cancelled) setFailedPreviewRevision(file.revision);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentPreview,
    file.revision,
    file.url,
    forceExpanded,
    isNearViewport,
    isText,
  ]);

  return (
    <section
      ref={rootRef}
      className="workspace-file-block my-4 w-full overflow-hidden rounded-xl border border-border bg-card/70 shadow-sm"
      aria-label={t("workspaceFileAria", { title })}
    >
      <header className="flex min-h-13 items-center justify-between gap-3 border-b border-border/80 bg-muted/30 px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200/70 bg-emerald-50 text-emerald-600 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Icon size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              <span className="truncate">{file.path}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(file.bytes)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            size="sm"
            label={t("workspaceFileDownloadAria", { title })}
            icon={<Download size={16} aria-hidden="true" />}
            onClick={() => void download()}
          />
          {!forceExpanded && isText && onOpen ? (
            <IconButton
              size="sm"
              label={t("workspaceFileOpenAria", { title })}
              icon={<Maximize2 size={16} aria-hidden="true" />}
              onClick={() => onOpen(file)}
            />
          ) : null}
        </div>
      </header>

      {isText ? (
        <div
          className={
            forceExpanded
              ? "px-4 py-5 md:px-7 md:py-7"
              : "relative max-h-[15rem] overflow-hidden px-4 py-4 md:max-h-[20rem] md:px-7 md:py-6"
          }
        >
          {preview === null && !loadFailed ? (
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <Loader2
                size={13}
                className="motion-safe:animate-spin"
                aria-hidden="true"
              />
              {t("workspaceFilePreviewLoading")}
            </div>
          ) : isMarkdown && preview ? (
            <MarkdownRenderer
              content={preview}
              forceExpandCodeBlocks={forceExpanded}
            />
          ) : preview ? (
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-6 text-foreground/90">
              {preview}
            </pre>
          ) : null}

          {!forceExpanded && preview && currentPreview?.complete === false ? (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent via-card/85 to-card"
              aria-hidden="true"
            />
          ) : null}
        </div>
      ) : null}

      {loadFailed ? (
        <div
          className="flex items-start gap-2 border-t border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200 md:px-4"
          role="status"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{t("workspaceFileMissing")}</span>
        </div>
      ) : null}
    </section>
  );
});

export default WorkspaceFileBlock;
