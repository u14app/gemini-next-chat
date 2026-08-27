"use client";
import React, { useEffect, useState } from "react";
import { AlertTriangle, FileText, LibraryBig } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Attachment } from "@/types";
import { isOPFSUrl, resolveOPFSUrl } from "@/utils/opfs";
import { resolveObjectUrlWithLifecycle } from "@/lib/utils/objectUrlLifecycle";
import { useAttachmentDisplayUrl } from "@/lib/utils/useAttachmentDisplayUrl";
import AudioPlayer from "./AudioPlayer";
import {
  isKnowledgeCollectionAttachment,
  isKnowledgeFileAttachment,
} from "@/lib/utils/knowledgeAttachments";
import { isTextDocumentMimeType } from "@/lib/utils/documentAttachments";
import { Button } from "@/components/ui/primitives";

interface MessageAttachmentViewProps {
  attachment: Attachment;
  onImageClick: () => void;
  onDocumentClick?: (attachment: Attachment) => void;
  onAttachmentCached?: (attachment: Attachment) => void;
}

const actionButtonFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background";

const documentCardClass =
  "group/attachment markdown-file-card inline-flex min-w-50 max-w-full select-none items-center gap-3 rounded-xl p-3 text-left transition-[border-color,background-color,box-shadow] md:w-72";

const MessageAttachmentView: React.FC<MessageAttachmentViewProps> = ({
  attachment,
  onImageClick,
  onDocumentClick,
  onAttachmentCached,
}) => {
  const t = useTranslations("Message");
  const fallbackUrl =
    attachment.url ||
    (attachment.data
      ? `data:${attachment.mimeType};base64,${attachment.data}`
      : "");
  const [resolvedOpfsUrl, setResolvedOpfsUrl] = useState<{
    source: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (attachment.mimeType.startsWith("image/")) return;
    if (!isOPFSUrl(attachment.url)) return;

    const source = attachment.url!;
    const resolution = resolveObjectUrlWithLifecycle({
      source,
      resolveObjectUrl: resolveOPFSUrl,
      onResolved: (url) => {
        setResolvedOpfsUrl(url ? { source, url } : null);
      },
      onError: () => setResolvedOpfsUrl(null),
    });
    return () => resolution.cancel();
  }, [attachment.mimeType, attachment.url]);

  const resolvedUrl =
    attachment.url && isOPFSUrl(attachment.url)
      ? resolvedOpfsUrl?.source === attachment.url
        ? resolvedOpfsUrl.url
        : ""
      : fallbackUrl;
  const imageDisplayUrl = useAttachmentDisplayUrl(attachment, {
    enableCacheBackfill: true,
    onCacheReady: onAttachmentCached,
  });

  if (attachment.localFileMissing) {
    return (
      <div
        role="status"
        aria-label={t("localFileMissingAria", {
          fileName: attachment.fileName,
        })}
        className={`${documentCardClass} cursor-default border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20`}
      >
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <AlertTriangle size={18} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {attachment.fileName}
          </span>
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {t("localFileMissing")}
          </span>
        </div>
      </div>
    );
  }

  if (
    isKnowledgeCollectionAttachment(attachment) ||
    isKnowledgeFileAttachment(attachment)
  ) {
    const isFile = isKnowledgeFileAttachment(attachment);
    return (
      <div className="group/attachment relative flex h-20 w-32 select-none flex-col justify-between overflow-hidden rounded-xl border border-purple-100 bg-purple-50/50 p-2.5 transition-colors hover:bg-purple-50 dark:border-purple-900/50 dark:bg-purple-900/20 dark:hover:bg-purple-900/30">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-purple-100 p-1.5 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300">
            {isFile ? (
              <FileText size={14} aria-hidden="true" />
            ) : (
              <LibraryBig size={14} aria-hidden="true" />
            )}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400 dark:text-purple-500">
            {isFile ? t("knowledgeFile") : t("knowledgeBase")}
          </span>
        </div>
        <span className="truncate text-xs font-semibold text-purple-900 dark:text-purple-100">
          {attachment.fileName}
        </span>
      </div>
    );
  }

  if (attachment.mimeType.startsWith("audio/")) {
    return (
      <div className="w-full max-w-sm">
        <AudioPlayer src={resolvedUrl} fileName={attachment.fileName} />
      </div>
    );
  }

  if (attachment.mimeType.startsWith("video/")) {
    return (
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm dark:border-border dark:bg-muted">
        <video
          src={resolvedUrl}
          controls
          preload="metadata"
          className="max-h-72 w-full bg-black"
          aria-label={t("videoAttachmentAria", {
            fileName: attachment.fileName,
          })}
        />
        <div className="truncate px-3 py-2 text-xs font-medium text-gray-600 dark:text-muted-foreground">
          {attachment.fileName}
        </div>
      </div>
    );
  }

  if (attachment.mimeType.startsWith("image/")) {
    return (
      <Button
        variant="bare"
        type="button"
        className={`group/attachment relative cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm transition-shadow hover:shadow-md dark:border-border dark:bg-muted ${actionButtonFocusClass}`}
        onClick={onImageClick}
        aria-label={t("previewImageAria", {
          fileName: attachment.fileName,
        })}
      >
        <img
          src={imageDisplayUrl || resolvedUrl}
          alt={attachment.fileName}
          width={256}
          height={128}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-32 w-auto rounded-lg object-cover transition-transform duration-300 group-hover/attachment:scale-110"
        />
      </Button>
    );
  }

  const isReadableDocument =
    Boolean(attachment.data) && isTextDocumentMimeType(attachment.mimeType);
  const documentCardBody = (
    <>
      <div className="markdown-file-card-icon">
        <FileText size={20} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="markdown-strong-text truncate text-sm font-medium">
          {attachment.fileName}
        </span>
        <div className="markdown-file-card-meta flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="markdown-file-card-action">
            {isReadableDocument
              ? t("openDocumentAttachment")
              : t("documentAttachment")}
          </span>
        </div>
      </div>
    </>
  );

  if (isReadableDocument && onDocumentClick) {
    return (
      <Button
        variant="bare"
        type="button"
        aria-label={t("openDocumentAttachmentAria", {
          fileName: attachment.fileName,
        })}
        onClick={() => onDocumentClick(attachment)}
        className={`${documentCardClass} markdown-file-card-interactive markdown-focus-ring cursor-pointer`}
      >
        {documentCardBody}
      </Button>
    );
  }

  return (
    <div
      aria-label={attachment.fileName}
      className={`${documentCardClass} cursor-default`}
    >
      {documentCardBody}
    </div>
  );
};

export default MessageAttachmentView;
