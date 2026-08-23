"use client";

import React, { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, LoaderCircle, Brain } from "lucide-react";
import type { ToolCall } from "@/types";
import { Button } from "@/components/ui/primitives";
import { isToolResultEnvelope } from "@/lib/agent/toolResult";

interface MemorySearchBlockProps {
  toolCalls: ToolCall[];
}

interface DisplayMemory {
  id?: string;
  type?: string;
  content: string;
  tags?: string[];
  importance?: number;
}

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const getNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const getStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizeMemories = (value: unknown): DisplayMemory[] => {
  if (!Array.isArray(value)) return [];

  const memories: DisplayMemory[] = [];
  for (const item of value) {
    const record = getRecord(item);
    const content = getString(record.content);
    if (!content) continue;
    memories.push({
      id: getString(record.id) || undefined,
      type: getString(record.type) || undefined,
      content,
      tags: getStringList(record.tags),
      importance: getNumber(record.importance),
    });
  }
  return memories;
};

const unwrapResult = (value: unknown): unknown =>
  isToolResultEnvelope(value) && value.ok ? value.data : value;

const MemorySearchBlock: React.FC<MemorySearchBlockProps> = ({ toolCalls }) => {
  const t = useTranslations("Content");
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();

  const memorySearches = useMemo(
    () => toolCalls.filter((toolCall) => toolCall.name === "memory_search"),
    [toolCalls],
  );
  const isLoading = memorySearches.some(
    (toolCall) =>
      toolCall.status === "pending" ||
      toolCall.status === "running" ||
      toolCall.result === undefined,
  );
  const isError = memorySearches.some(
    (toolCall) => toolCall.status === "error" || toolCall.isError,
  );
  const memories = useMemo(
    () =>
      memorySearches.flatMap((toolCall) =>
        normalizeMemories(getRecord(unwrapResult(toolCall.result)).memories),
      ),
    [memorySearches],
  );

  if (memorySearches.length === 0) return null;

  const title = isLoading
    ? t("memorySearchRunning")
    : isError
      ? t("memorySearchFailed")
      : memories.length > 0
        ? t("memorySearchFound", { count: memories.length })
        : t("memorySearchEmpty");

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/40 transition-colors dark:border-border dark:bg-muted/20">
      <Button
        variant="bare"
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        aria-busy={isLoading || undefined}
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 motion-reduce:transition-none dark:text-muted-foreground dark:hover:bg-accent/30"
      >
        {isLoading ? (
          <LoaderCircle
            size={13}
            className="shrink-0 animate-spin text-blue-500"
            aria-hidden="true"
          />
        ) : (
          <Brain
            size={13}
            className="shrink-0 text-blue-500"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform duration-200 ${
            isExpanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </Button>

      <div
        id={panelId}
        role="region"
        aria-label={t("memorySearchDetails")}
        hidden={!isExpanded}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-gray-200/50 bg-white/40 px-3 py-3 text-xs text-gray-600 dark:border-border dark:bg-card/30 dark:text-foreground/80">
            {memorySearches.map((toolCall) => {
              const args = getRecord(toolCall.args);
              const query = getString(args.query);
              const limit = getNumber(args.limit);

              return (
                <div key={toolCall.id} className="space-y-1.5">
                  {query ? (
                    <div>
                      <span className="text-gray-400 dark:text-muted-foreground">
                        {t("memorySearchQuery")}{" "}
                      </span>
                      <span className="wrap-break-word">{query}</span>
                    </div>
                  ) : null}
                  {limit !== undefined ? (
                    <div>
                      <span className="text-gray-400 dark:text-muted-foreground">
                        {t("memorySearchLimit")}{" "}
                      </span>
                      <span>{limit}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {memories.length > 0 ? (
              <div className="space-y-2">
                {memories.map((memory, index) => (
                  <div
                    key={memory.id || index}
                    className="rounded-md border border-gray-200/70 bg-gray-50/80 p-2 dark:border-border dark:bg-muted/30"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase text-gray-400 dark:text-muted-foreground">
                      {memory.type ? <span>{memory.type}</span> : null}
                      {memory.importance !== undefined ? (
                        <span>
                          {t("memoryImportance", {
                            value: memory.importance,
                          })}
                        </span>
                      ) : null}
                    </div>
                    <div className="whitespace-pre-wrap wrap-break-word leading-relaxed">
                      {memory.content}
                    </div>
                    {memory.tags && memory.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {memory.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-accent/50 dark:text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : !isLoading ? (
              <div className="text-gray-400 dark:text-muted-foreground">
                {isError ? t("memorySearchFailed") : t("memorySearchEmpty")}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemorySearchBlock;
