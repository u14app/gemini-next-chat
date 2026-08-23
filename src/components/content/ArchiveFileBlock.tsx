"use client";

import React from "react";
import { AlertTriangle, Download, FileArchive } from "lucide-react";
import { useTranslations } from "next-intl";

import { formatBytes } from "@/config/limits";
import type { ArchivePresentation } from "@/types";
import { IconButton } from "@/components/ui/primitives";

import { useOpfsDownload } from "./useOpfsDownload";

interface ArchiveFileBlockProps {
  archive: ArchivePresentation;
}

/**
 * A zip bundle the agent produced. Archives are download-only by design: there
 * is nothing useful to preview, so the card stays compact.
 */
const ArchiveFileBlock = React.memo(function ArchiveFileBlock({
  archive,
}: ArchiveFileBlockProps) {
  const t = useTranslations("Message");
  const { download, failed } = useOpfsDownload(archive.url, archive.fileName);
  const title = archive.title || archive.fileName;

  return (
    <section
      className="workspace-archive-block my-4 w-full overflow-hidden rounded-xl border border-border bg-card/70 shadow-sm"
      aria-label={t("archiveAria", { title })}
    >
      <div className="flex min-h-13 items-center justify-between gap-3 px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-200/70 bg-violet-50 text-violet-600 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300">
            <FileArchive size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              <span>
                {t("archiveEntryCount", { count: archive.entryCount })}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(archive.bytes)}</span>
            </div>
          </div>
        </div>
        <IconButton
          size="sm"
          label={t("archiveDownloadAria", { title })}
          icon={<Download size={16} aria-hidden="true" />}
          onClick={() => void download()}
        />
      </div>

      {failed ? (
        <div
          className="flex items-start gap-2 border-t border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200 md:px-4"
          role="status"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{t("archiveMissing")}</span>
        </div>
      ) : null}
    </section>
  );
});

export default ArchiveFileBlock;
