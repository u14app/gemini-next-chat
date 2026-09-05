"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Copy, FileText, LockKeyhole } from "lucide-react";
import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import SafeImage from "@/components/ui/SafeImage";
import { Button, IconButton } from "@/components/ui/primitives";
import { useUIStore } from "@/store/core/uiStore";
import { getPublicShare } from "@/services/sharing/public";
import {
  getSharedAssetUrl,
  type PublicShare,
  type SharedBlock,
} from "@/lib/sharing/types";
import { getSafeWebHref } from "@/lib/security/clientUrl";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { PRODUCT_NAME } from "@/lib/product";

const ImagePreview = dynamic(() => import("@/components/media/ImagePreview"), {
  ssr: false,
});

export function SharedConversationView({ share }: { share: PublicShare }) {
  const t = useTranslations("Sharing");
  const locale = useLocale();
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const imagePreviewOpen = useUIStore((state) => state.imagePreview.isOpen);
  const imageUrlAliases = useMemo(() => {
    const ids = new Set<string>();
    for (const message of share.snapshot.messages)
      for (const block of message.blocks) {
        if (block.type === "image") ids.add(block.assetId);
        if (block.type === "text" || block.type === "report")
          for (const match of block.content.matchAll(
            /share-asset:([a-f0-9]{64})/g,
          ))
            ids.add(match[1]);
      }
    return Object.fromEntries(
      [...ids].map((id) => [
        `share-asset:${id}`,
        new URL(
          getSharedAssetUrl(share.id, id, share.revision),
          window.location.origin,
        ).toString(),
      ]),
    );
  }, [share]);
  const registeredImageUrls = useMemo(
    () => Object.values(imageUrlAliases),
    [imageUrlAliases],
  );
  const imageSources = useMemo(
    () =>
      share.snapshot.messages.flatMap((message) =>
        message.blocks.flatMap((block) =>
          block.type === "image"
            ? [
                {
                  url: imageUrlAliases[`share-asset:${block.assetId}`],
                  description: block.alt,
                  ...(block.sourceUrl ? { sourceUrl: block.sourceUrl } : {}),
                },
              ]
            : [],
        ),
      ),
    [share, imageUrlAliases],
  );
  const renderBlock = (block: SharedBlock, index: number) => {
    if (block.type === "text" || block.type === "report")
      return (
        <section key={index} className="min-w-0 space-y-3">
          {block.type === "report" && (
            <h3 className="text-lg font-semibold">{block.title}</h3>
          )}
          <MarkdownRenderer
            content={block.content}
            readOnly
            registeredImageUrls={registeredImageUrls}
            imageUrlAliases={imageUrlAliases}
            imageSources={imageSources}
          />
        </section>
      );
    if (block.type === "attachment")
      return (
        <div
          key={index}
          className="flex min-w-0 items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground"
        >
          <FileText size={16} className="shrink-0" />
          <span className="truncate">{block.fileName}</span>
          <span className="ml-auto shrink-0 text-xs">
            {t("attachmentOnly")}
          </span>
        </div>
      );
    if (block.type === "sources")
      return (
        <ul key={index} className="space-y-1 text-sm">
          {block.sources.map((source, sourceIndex) => {
            const href = getSafeWebHref(source.url);
            return (
              <li key={sourceIndex}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-words text-blue-600 underline dark:text-blue-400 underline-offset-4"
                  >
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}
              </li>
            );
          })}
        </ul>
      );
    const src = getSharedAssetUrl(share.id, block.assetId, share.revision);
    const sourceHref = getSafeWebHref(block.sourceUrl);
    return (
      <figure key={index} className="space-y-2">
        <Button
          variant="bare"
          className="block max-w-full cursor-zoom-in overflow-hidden rounded-lg"
          onClick={() =>
            useUIStore.getState().openImagePreview(
              [
                {
                  url: imageUrlAliases[`share-asset:${block.assetId}`],
                  alt: block.alt,
                  description: block.alt,
                },
              ],
              0,
              registeredImageUrls,
            )
          }
          aria-label={block.alt || t("previewImage")}
        >
          <SafeImage
            src={src}
            alt={block.alt}
            className="max-h-[70vh] max-w-full object-contain"
            fallback={
              <span className="block rounded-md bg-muted p-6 text-sm text-muted-foreground">
                {t("imageUnavailable")}
              </span>
            }
          />
        </Button>
        {(block.alt || sourceHref) && (
          <figcaption className="text-xs leading-relaxed text-muted-foreground">
            {block.alt}
            {sourceHref && (
              <>
                {" "}
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline dark:text-blue-400"
                >
                  {t("imageSource")}
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  };
  return (
    <>
      {imagePreviewOpen && <ImagePreview />}
      <header className="border-b border-border pb-6">
        <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
          {share.snapshot.title}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <LockKeyhole size={14} aria-hidden="true" />
          {t("readOnly")}
          {share.expiresAt && (
            <span>
              {t("expiresOn", {
                date: new Date(share.expiresAt).toLocaleString(locale),
              })}
            </span>
          )}
        </p>
      </header>
      <div className="divide-y divide-border">
        {share.snapshot.messages.map((message) => (
          <article key={message.id} className="space-y-4 py-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {message.role === "user" ? t("you") : t("assistant")}
              </h2>
              <IconButton
                label={t("copyMessage")}
                icon={<Copy size={14} />}
                size="sm"
                onClick={() => {
                  const text = message.blocks
                    .filter(
                      (block) =>
                        block.type === "text" || block.type === "report",
                    )
                    .map((block) => block.content)
                    .join("\n\n");
                  void copyTextToClipboard(text).then((ok) =>
                    setCopyStatus(ok ? t("copied") : t("copyFailed")),
                  );
                }}
              />
            </div>
            {message.blocks.map(renderBlock)}
          </article>
        ))}
      </div>
      <p role="status" className="sr-only">
        {copyStatus}
      </p>
    </>
  );
}

export default function SharedConversationPage({
  shareId,
}: {
  shareId: string;
}) {
  const t = useTranslations("Sharing");
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState<"unavailable" | "failed" | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void getPublicShare(shareId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setShare(result);
        setError(null);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setShare(null);
        setError(
          failure?.status === 404 || failure?.status === 410
            ? "unavailable"
            : "failed",
        );
      });
    return () => controller.abort();
  }, [shareId, revision]);
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [refresh]);
  useEffect(() => {
    if (!share?.expiresAt) return;
    const timer = setTimeout(
      () => {
        setShare(null);
        refresh();
      },
      Math.max(0, Math.min(2_147_483_647, share.expiresAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [share, refresh]);
  return (
    <main className="min-h-dvh bg-background px-4 text-foreground sm:px-6">
      <nav className="mx-auto flex h-16 max-w-3xl items-center">
        <Link
          href="/"
          prefetch={false}
          className="rounded text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PRODUCT_NAME}
        </Link>
      </nav>
      <div className="mx-auto max-w-3xl pb-16 pt-5">
        {share ? (
          <SharedConversationView share={share} />
        ) : error ? (
          <div className="space-y-4 py-12">
            <h1 className="text-xl font-semibold">
              {error === "unavailable" ? t("unavailable") : t("loadFailed")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {error === "unavailable"
                ? t("unavailableDescription")
                : t("retryDescription")}
            </p>
            {error === "failed" && (
              <Button onClick={refresh}>{t("retry")}</Button>
            )}
          </div>
        ) : (
          <div role="status" className="space-y-6">
            <span className="sr-only">{t("loading")}</span>
            <div className="h-8 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-24 rounded bg-muted/60 motion-safe:animate-pulse" />
            <div className="h-40 rounded bg-muted/60 motion-safe:animate-pulse" />
          </div>
        )}
      </div>
    </main>
  );
}
