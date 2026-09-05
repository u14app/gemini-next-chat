"use client";
import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useUIStore } from "@/store/core/uiStore";
import { resolveOPFSUrl, isOPFSUrl } from "@/utils/opfs";
import { getSafeMarkdownImageSrc } from "@/lib/security/clientUrl";
import { getMarkdownImageGalleryIndex } from "@/lib/utils/markdownImages";
import { resolveObjectUrlWithLifecycle } from "@/lib/utils/objectUrlLifecycle";
import type { PreviewImageInput } from "@/lib/utils/imagePreview";
import { Button } from "@/components/ui/primitives";
export const MarkdownImage = ({
  src,
  alt,
  gallery = [],
  getGallery,
  width,
  height,
  style,
  registered = false,
  registeredImageUrls,
  ...props
}: any & { gallery?: PreviewImageInput[] }) => {
  const t = useTranslations("Content");
  const { openImagePreview } = useUIStore();
  const safeSrc = registered ? src : getSafeMarkdownImageSrc(src);
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
        ? resolvedOpfsSrc?.url
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
        const currentGallery: PreviewImageInput[] = getGallery?.() || gallery;
        openImagePreview(
          currentGallery.length > 0
            ? currentGallery
            : [{ url: previewSrc, alt, description: alt }],
          getMarkdownImageGalleryIndex(currentGallery, previewSrc),
          registeredImageUrls,
        );
      }}
    >
      {image}
    </Button>
  );
};
