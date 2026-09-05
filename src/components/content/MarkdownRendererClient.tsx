"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PluggableList } from "unified";
import { collectMarkdownImageGallery } from "@/lib/utils/markdownImages";
import {
  compileMarkdown,
  prepareMarkdown,
  reconcileMarkdownBlocks,
  type MarkdownBlockSnapshot,
} from "./markdown/markdownDocument";
import {
  gfmResource,
  htmlResource,
  mathSyntaxResource,
  useExtension,
} from "./markdown/extensionResources";
import { MarkdownBlock, type RenderOptions } from "./markdown/MarkdownNodes";
import type { MarkdownRendererProps } from "./markdown/types";
export type {
  MarkdownRendererProps,
  MarkdownImageSource,
} from "./markdown/types";

/** CommonMark is synchronous; syntax imports never gate the whole message. */
export default function MarkdownRenderer({
  content,
  className,
  searchSources,
  ragSources,
  onCitationClick,
  onFileClick,
  forcedTheme,
  forceExpandCodeBlocks,
  readOnly,
  contentPolicy,
  imageSources,
  registeredImageUrls,
  imageUrlAliases,
}: MarkdownRendererProps) {
  const documentId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const prepared = useMemo(
    () => prepareMarkdown(content, contentPolicy),
    [content, contentPolicy],
  );
  const gfm = useExtension(gfmResource, prepared.candidates.gfm);
  const math = useExtension(mathSyntaxResource, prepared.candidates.math);
  const html = useExtension(htmlResource, prepared.candidates.html);
  const tree = useMemo(() => {
    const remarkPlugins: PluggableList = [];
    if (gfm.value) remarkPlugins.push(gfm.value.default);
    if (math.value) remarkPlugins.push(math.value.default);
    return compileMarkdown({
      prepared,
      remarkPlugins,
      htmlPlugins: html.value?.plugins,
      enabled: {
        gfm: Boolean(gfm.value),
        math: Boolean(math.value),
        html: Boolean(html.value),
      },
      web: searchSources,
      rag: ragSources,
      documentId,
      contentPolicy,
    });
  }, [
    prepared,
    gfm.value,
    math.value,
    html.value,
    searchSources,
    ragSources,
    documentId,
    contentPolicy,
  ]);
  const [snapshot, setSnapshot] = useState(() => ({
    tree,
    blocks: reconcileMarkdownBlocks(
      tree,
      new Map<string, MarkdownBlockSnapshot>(),
    ),
  }));
  if (snapshot.tree !== tree) {
    setSnapshot({
      tree,
      blocks: reconcileMarkdownBlocks(
        tree,
        new Map(snapshot.blocks.map((block) => [block.id, block])),
      ),
    });
  }
  const gallery = useRef<ReturnType<typeof collectMarkdownImageGallery>>([]);
  useEffect(() => {
    gallery.current = collectMarkdownImageGallery(content);
  }, [content]);
  const getGallery = useCallback(() => gallery.current, []);
  const options = useMemo<RenderOptions>(
    () => ({
      searchSources,
      ragSources,
      onCitationClick,
      onFileClick,
      forcedTheme,
      forceExpandCodeBlocks,
      readOnly,
      contentPolicy,
      imageSources,
      registeredImageUrls,
      imageUrlAliases,
      getGallery,
      html: null,
    }),
    [
      searchSources,
      ragSources,
      onCitationClick,
      onFileClick,
      forcedTheme,
      forceExpandCodeBlocks,
      readOnly,
      contentPolicy,
      imageSources,
      registeredImageUrls,
      imageUrlAliases,
      getGallery,
    ],
  );
  return (
    <div
      className={`markdown-body ${contentPolicy === "evidence-answer" ? "text-sm leading-7" : "text-(length:--neo-font-size-base) leading-relaxed"} wrap-break-word w-full overflow-hidden ${className || "markdown-body-default"}`}
    >
      {snapshot.blocks.map((snapshot) => (
        <MarkdownBlock
          key={snapshot.id}
          snapshot={snapshot}
          options={options}
        />
      ))}
    </div>
  );
}
