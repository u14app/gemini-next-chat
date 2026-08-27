"use client";
import React, { useEffect, useState } from "react";
import {
  FileAudio,
  FileText,
  FileVideo,
  LibraryBig,
  Link,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { Attachment } from "@/types";
import { isOPFSUrl, resolveOPFSUrl } from "@/utils/opfs";
import { resolveObjectUrlWithLifecycle } from "@/lib/utils/objectUrlLifecycle";
import { useAttachmentDisplayUrl } from "@/lib/utils/useAttachmentDisplayUrl";
import {
  isKnowledgeCollectionAttachment,
  isKnowledgeFileAttachment,
} from "@/lib/utils/knowledgeAttachments";
import { Button } from "@/components/ui/primitives";

interface MessageInputAttachmentTrayProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  ariaLabel: string;
}

const iconButtonFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background";

const AttachmentPreviewCard: React.FC<{
  attachment: Attachment;
  onRemove: (id: string) => void;
}> = ({ attachment, onRemove }) => {
  const t = useTranslations("MessageInput");
  const tMessage = useTranslations("Message");
  const fallbackSrc =
    attachment.url ||
    (attachment.data
      ? `data:${attachment.mimeType};base64,${attachment.data}`
      : "");
  const [resolvedOpfsSrc, setResolvedOpfsSrc] = useState<{
    source: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (attachment.mimeType.startsWith("image/")) return;
    if (!attachment.url || !isOPFSUrl(attachment.url)) return;

    const source = attachment.url;
    const resolution = resolveObjectUrlWithLifecycle({
      source,
      resolveObjectUrl: resolveOPFSUrl,
      onResolved: (url) => {
        setResolvedOpfsSrc(url ? { source, url } : null);
      },
      onError: () => setResolvedOpfsSrc(null),
    });
    return () => resolution.cancel();
  }, [attachment.mimeType, attachment.url]);

  const resolvedSrc =
    attachment.url && isOPFSUrl(attachment.url)
      ? resolvedOpfsSrc?.source === attachment.url
        ? resolvedOpfsSrc.url
        : ""
      : fallbackSrc;
  const imageDisplaySrc = useAttachmentDisplayUrl(attachment);
  const isKnowledgeCollection = isKnowledgeCollectionAttachment(attachment);
  const isKnowledgeFile = isKnowledgeFileAttachment(attachment);
  const isImage = attachment.mimeType.startsWith("image/");
  const isAudio = attachment.mimeType.startsWith("audio/");
  const isVideo = attachment.mimeType.startsWith("video/");
  const isRemote = Boolean(attachment.url && !isOPFSUrl(attachment.url));

  const renderIcon = () => {
    if (isKnowledgeCollection) {
      return (
        <LibraryBig size={20} className="text-purple-500" aria-hidden="true" />
      );
    }

    if (isKnowledgeFile) {
      return (
        <FileText size={20} className="text-purple-500" aria-hidden="true" />
      );
    }

    if (isImage && (imageDisplaySrc || resolvedSrc)) {
      return (
        <img
          src={imageDisplaySrc || resolvedSrc}
          alt={attachment.fileName}
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      );
    }

    if (isAudio) {
      return <FileAudio size={20} aria-hidden="true" />;
    }
    if (isVideo) {
      return <FileVideo size={20} aria-hidden="true" />;
    }
    if (isRemote) {
      return <Link size={20} aria-hidden="true" />;
    }
    return <FileText size={20} aria-hidden="true" />;
  };

  const actionText = isKnowledgeCollection
    ? tMessage("knowledgeBase")
    : isKnowledgeFile
      ? tMessage("knowledgeFile")
      : isRemote
        ? t("remoteFile")
        : isAudio
          ? tMessage("audioAttachment")
          : isVideo
            ? tMessage("videoAttachment")
            : isImage
              ? tMessage("previewImageAria", { fileName: attachment.fileName })
              : tMessage("documentAttachment");

  return (
    <li className="group/attachment markdown-file-card relative inline-flex w-56 max-w-[75vw] shrink-0 select-none items-center gap-3 rounded-xl p-2.5 pr-8 text-left transition-[border-color,background-color,box-shadow]">
      <div className="markdown-file-card-icon overflow-hidden">
        {renderIcon()}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="markdown-strong-text truncate text-sm font-medium">
          {attachment.fileName}
        </span>
        <div className="markdown-file-card-meta flex min-w-0 items-center gap-1.5 text-xs">
          <span className="markdown-file-card-action truncate">
            {actionText}
          </span>
          {isRemote && !isImage ? (
            <Link size={11} className="shrink-0" aria-hidden="true" />
          ) : null}
        </div>
      </div>
      <Button
        variant="bare"
        type="button"
        aria-label={t("removeAttachment", {
          fileName: attachment.fileName,
        })}
        onClick={() => onRemove(attachment.id)}
        className={`absolute right-2 top-2 z-10 rounded-full bg-black/50 p-0.5 text-white opacity-100 transition-[background-color,opacity] hover:bg-red-500 md:opacity-0 md:group-hover/attachment:opacity-100 ${iconButtonFocusClass}`}
      >
        <X size={10} aria-hidden="true" />
      </Button>
    </li>
  );
};

const MessageInputAttachmentTray: React.FC<MessageInputAttachmentTrayProps> = ({
  attachments,
  onRemove,
  ariaLabel,
}) => {
  if (attachments.length === 0) return null;

  return (
    <ul
      className="custom-scrollbar flex gap-2 overflow-x-auto border-b border-white/30 p-3 dark:border-border"
      aria-label={ariaLabel}
    >
      {attachments.map((attachment) => (
        <AttachmentPreviewCard
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
};

export default MessageInputAttachmentTray;
