"use client";
import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { Source } from "@/types";
import {
  getSafeExternalHref,
  getSafeFaviconProxyUrl,
  getSafeWebHref,
} from "@/lib/security/clientUrl";
import { requestKnowledgeSourceNavigation } from "@/lib/knowledge/navigation";
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

export const CitationLink = ({
  href,
  children,
  sources,
  onCitationClick,
  readOnly = false,
}: {
  href: string | undefined;
  children?: React.ReactNode;
  sources: Source[];
  onCitationClick?: (source: Source, index: number) => void;
  readOnly?: boolean;
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
  const canNavigateKnowledge = !readOnly && Boolean(collectionId);
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
