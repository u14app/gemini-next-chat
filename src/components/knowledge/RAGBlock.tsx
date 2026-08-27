"use client";

import React, { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Source } from "@/types";
import { LibraryBig, ChevronDown, BookText } from "lucide-react";
import { requestKnowledgeSourceNavigation } from "@/lib/knowledge/navigation";
import { Button } from "@/components/ui/primitives";

interface RAGBlockProps {
  sources: Source[];
  error?: string;
}

const RAGBlock: React.FC<RAGBlockProps> = ({ sources, error }) => {
  const t = useTranslations("Knowledge");
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();
  const buttonId = useId();
  const hasSources = sources.length > 0;
  const groupedSources = useMemo(() => {
    const groups = new Map<string, Source[]>();
    for (const source of sources) {
      const key = String(
        source.metadata?.fileId || source.metadata?.localFileId || source.title,
      );
      groups.set(key, [...(groups.get(key) || []), source]);
    }
    return [...groups.values()];
  }, [sources]);

  if (!hasSources && !error) return null;

  if (error && !hasSources) {
    return (
      <div
        role="alert"
        className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-purple-200 bg-purple-50/50 transition-colors duration-300 dark:border-purple-800/60 dark:bg-purple-900/10">
      <Button
        variant="bare"
        id={buttonId}
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full select-none items-center gap-2 px-3 py-2 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:text-purple-300 dark:hover:bg-purple-900/20"
      >
        <LibraryBig
          size={14}
          className="text-purple-600 dark:text-purple-400"
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-left">
          {t("sourcesHeading", { count: sources.length })}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        />
      </Button>

      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          {isExpanded ? (
            <div className="border-t border-purple-200/50 bg-white/40 px-3 py-3 dark:border-purple-800/50 dark:bg-card/40">
              {error ? (
                <div
                  role="status"
                  className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  {error}
                </div>
              ) : null}
              <div className="space-y-3">
                {groupedSources.map((group, groupIndex) => (
                  <div
                    key={`${group[0]?.title}-${groupIndex}`}
                    className="space-y-2"
                  >
                    {group.length > 1 ? (
                      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-purple-700/70 dark:text-purple-300/70">
                        {String(
                          group[0]?.metadata?.fileName || group[0]?.title,
                        )}
                      </div>
                    ) : null}
                    {group.map((source, index) => {
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
                      const retrieval = source.metadata?.retrieval;
                      const chunkIndex =
                        typeof source.metadata?.chunkIndex === "number"
                          ? source.metadata.chunkIndex
                          : undefined;
                      const card = (
                        <div className="block rounded-lg border border-purple-100 bg-white/60 p-3 dark:border-purple-900/30 dark:bg-muted/60">
                          <div className="mb-1.5 flex items-center gap-2">
                            <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                              <BookText size={10} aria-hidden="true" />
                            </div>
                            <div className="line-clamp-1 text-xs font-bold text-gray-800 dark:text-foreground">
                              {source.title}
                            </div>
                            {typeof retrieval === "string" ? (
                              <span className="ml-auto shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                                {t(`retrieval.${retrieval}`)}
                              </span>
                            ) : null}
                          </div>
                          {source.content ? (
                            <div className="line-clamp-3 font-mono text-[11px] leading-relaxed text-gray-600 opacity-90 dark:text-foreground/85">
                              {source.content}
                            </div>
                          ) : null}
                        </div>
                      );

                      return collectionId ? (
                        <Button
                          variant="bare"
                          key={`${source.title}-${index}`}
                          type="button"
                          className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
                          onClick={() =>
                            requestKnowledgeSourceNavigation({
                              collectionId,
                              fileId,
                              chunkIndex,
                              excerpt: source.content,
                            })
                          }
                        >
                          {card}
                        </Button>
                      ) : (
                        <React.Fragment key={`${source.title}-${index}`}>
                          {card}
                        </React.Fragment>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default RAGBlock;
