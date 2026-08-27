"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Folder,
  LoaderCircle,
  LibraryBig,
  MessageSquare,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  buildGlobalSearchIndex,
  createGlobalSearchSourceRevisions,
  DEFAULT_GLOBAL_SEARCH_ADVANCED_OPTIONS,
  getGlobalSearchHighlightSegments,
  getGlobalSearchAdvancedOptionCount,
  getGlobalSearchViewState,
  GlobalSearchCancelledError,
  loadPersistedSessionTree,
  readPersistedKnowledgeContent,
  searchGlobalIndex,
  updateGlobalSearchViewState,
  GLOBAL_SEARCH_SOURCES,
  type GlobalSearchBuildProgress,
  type GlobalSearchDateFilter,
  type GlobalSearchIndex,
  type GlobalSearchNavigationTarget,
  type GlobalSearchRole,
  type GlobalSearchRoleFilter,
  type GlobalSearchSource,
  type GlobalSearchSourceFilter,
  type GlobalSearchViewState,
} from "@/lib/global-search";
import { GLOBAL_SEARCH_LIMITS } from "@/config/limits";
import { useChatStore } from "@/store/core/chatStore";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { useMemoryStore } from "@/store/core/memoryStore";
import { GlobalSearchModalFrame } from "./GlobalSearchModalFrame";
import { CustomSelect } from "@/components/ui/controls";
import { Button } from "@/components/ui/primitives";

export interface GlobalSearchCenterProps {
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onNavigate: (
    target: GlobalSearchNavigationTarget,
  ) => boolean | void | Promise<boolean | void>;
}

function HighlightedText({ value, query }: { value: string; query: string }) {
  return getGlobalSearchHighlightSegments(value, query).map((segment, index) =>
    segment.highlighted ? (
      <mark
        key={`${index}:${segment.text}`}
        className="rounded-sm bg-brand-soft px-0.5 text-inherit ring-1 ring-brand/10"
      >
        {segment.text}
      </mark>
    ) : (
      <React.Fragment key={`${index}:${segment.text}`}>
        {segment.text}
      </React.Fragment>
    ),
  );
}

function SourceIcon({ source }: { source: GlobalSearchSource }) {
  const props = { size: 16, "aria-hidden": true as const };
  if (source === "knowledge") return <LibraryBig {...props} />;
  if (source === "workspace") return <Folder {...props} />;
  if (source === "memory") return <Brain {...props} />;
  return <MessageSquare {...props} />;
}

function dateCutoff(filter: GlobalSearchDateFilter): number | undefined {
  if (filter === "all") return undefined;
  return Date.now() - Number(filter) * 24 * 60 * 60 * 1_000;
}

function formatDate(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const SOURCE_LABEL_KEYS: Record<GlobalSearchSource, string> = {
  session: "sourceSession",
  knowledge: "sourceKnowledge",
  workspace: "sourceWorkspace",
  memory: "sourceMemory",
};

const SOURCE_FILTER_OPTIONS = ["all", ...GLOBAL_SEARCH_SOURCES] as const;

const SOURCE_FILTER_LABEL_KEYS: Record<GlobalSearchSourceFilter, string> = {
  all: "allSources",
  ...SOURCE_LABEL_KEYS,
};

const ROLE_LABEL_KEYS: Record<GlobalSearchRole, string> = {
  user: "roleUser",
  model: "roleModel",
};

const sourceIndexCache = new Map<
  GlobalSearchSource,
  { revision: string; index: GlobalSearchIndex }
>();

function clearGlobalSearchIndexCache() {
  sourceIndexCache.clear();
}

function mergeSourceIndexes(indexes: GlobalSearchIndex[]): GlobalSearchIndex {
  let remainingContentChars = GLOBAL_SEARCH_LIMITS.maxTotalContentChars;
  let fullContentDocuments = 0;
  let partial = indexes.some((index) => index.partial);
  const documents = indexes
    .flatMap((index) => index.documents)
    .slice(0, GLOBAL_SEARCH_LIMITS.maxMetadataDocuments)
    .map((document) => {
      const allowed =
        fullContentDocuments < GLOBAL_SEARCH_LIMITS.maxDocuments
          ? Math.min(
              document.content.length,
              GLOBAL_SEARCH_LIMITS.maxSingleContentChars,
              remainingContentChars,
            )
          : 0;
      const content = document.content.slice(0, allowed);
      if (content.length < document.content.length) partial = true;
      if (fullContentDocuments < GLOBAL_SEARCH_LIMITS.maxDocuments) {
        fullContentDocuments += 1;
      }
      remainingContentChars -= content.length;
      return { ...document, content };
    });

  if (
    indexes.reduce((total, index) => total + index.documents.length, 0) >
    documents.length
  ) {
    partial = true;
  }

  return {
    documents,
    builtAt: Math.max(0, ...indexes.map((index) => index.builtAt)),
    partial,
    errors: indexes.flatMap((index) => index.errors),
    stats: {
      documents: documents.length,
      sessions: indexes.reduce(
        (total, index) => total + index.stats.sessions,
        0,
      ),
      messages: indexes.reduce(
        (total, index) => total + index.stats.messages,
        0,
      ),
      knowledgeFiles: indexes.reduce(
        (total, index) => total + index.stats.knowledgeFiles,
        0,
      ),
      workspaces: indexes.reduce(
        (total, index) => total + index.stats.workspaces,
        0,
      ),
      memories: indexes.reduce(
        (total, index) => total + index.stats.memories,
        0,
      ),
      indexedContentChars: documents.reduce(
        (total, document) => total + document.content.length,
        0,
      ),
    },
  };
}

const GlobalSearchCenter = ({
  onClose,
  returnFocusRef,
  onNavigate,
}: GlobalSearchCenterProps) => {
  const t = useTranslations("GlobalSearch");
  const locale = useLocale();
  const sessions = useChatStore((state) => state.sessions);
  const workspaces = useChatStore((state) => state.workspaces);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const activeMessageTree = useChatStore((state) => state.activeMessageTree);
  const collections = useKnowledgeStore((state) => state.collections);
  const memories = useMemoryStore((state) => state.memories);
  const sourceRevisions = useMemo(
    () =>
      createGlobalSearchSourceRevisions({
        sessions,
        workspaces,
        knowledgeCollections: collections,
        memories,
        currentSessionId,
        activeMessageTree,
      }),
    [
      activeMessageTree,
      collections,
      currentSessionId,
      memories,
      sessions,
      workspaces,
    ],
  );
  const revision = Object.values(sourceRevisions).join(":");

  const [viewState, setViewState] = useState<GlobalSearchViewState>(() =>
    getGlobalSearchViewState(),
  );
  const { query, source, workspaceId, role, date, sort } = viewState;
  const advancedOptionCount = getGlobalSearchAdvancedOptionCount(viewState);
  const [filtersOpen, setFiltersOpen] = useState(() => advancedOptionCount > 0);
  const [index, setIndex] = useState<GlobalSearchIndex | null>(null);
  const [indexing, setIndexing] = useState(true);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [staleTarget, setStaleTarget] = useState(false);
  const [progress, setProgress] = useState<GlobalSearchBuildProgress | null>(
    null,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const abortRef = useRef<AbortController | null>(null);

  const updateViewState = useCallback(
    (updates: Partial<GlobalSearchViewState>) => {
      setViewState(updateGlobalSearchViewState(updates));
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setIndexError(null);

    const cachedIndexes = GLOBAL_SEARCH_SOURCES.map((source) => {
      const cached = sourceIndexCache.get(source);
      return cached?.revision === sourceRevisions[source] ? cached.index : null;
    });
    if (cachedIndexes.every((cached) => cached !== null)) {
      setIndex(mergeSourceIndexes(cachedIndexes));
      setIndexing(false);
      setProgress(null);
      return () => controller.abort();
    }

    setIndexing(true);
    const timer = window.setTimeout(() => {
      const build = async () => {
        const chat = useChatStore.getState();
        const knowledge = useKnowledgeStore.getState();
        const memory = useMemoryStore.getState();
        const nextIndexes: GlobalSearchIndex[] = [];

        for (const source of GLOBAL_SEARCH_SOURCES) {
          const cached = sourceIndexCache.get(source);
          if (cached?.revision === sourceRevisions[source]) {
            nextIndexes.push(cached.index);
            continue;
          }

          const sourceIndex = await buildGlobalSearchIndex({
            sessions: chat.sessions,
            workspaces: chat.workspaces,
            knowledgeCollections: knowledge.collections,
            memories: memory.memories,
            sources: [source],
            signal: controller.signal,
            loadSessionTree: async (session, signal) => {
              const latestChat = useChatStore.getState();
              if (
                latestChat.currentSessionId === session.id &&
                !latestChat.isActiveSessionLoading
              ) {
                return latestChat.activeMessageTree;
              }
              return loadPersistedSessionTree(session.id, signal);
            },
            readKnowledgeContent: readPersistedKnowledgeContent,
            onProgress: setProgress,
          });
          sourceIndexCache.set(source, {
            revision: sourceRevisions[source],
            index: sourceIndex,
          });
          nextIndexes.push(sourceIndex);
        }

        return mergeSourceIndexes(nextIndexes);
      };

      void build()
        .then((nextIndex) => {
          if (controller.signal.aborted) return;
          setIndex(nextIndex);
          setIndexing(false);
          setProgress(null);
          setStaleTarget(false);
        })
        .catch((error) => {
          if (
            controller.signal.aborted ||
            error instanceof GlobalSearchCancelledError
          ) {
            return;
          }
          setIndexError(
            error instanceof Error ? error.message : t("indexError"),
          );
          setIndexing(false);
          setProgress(null);
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [refreshKey, revision, sourceRevisions, t]);

  const results = useMemo(() => {
    if (!index) return [];
    return searchGlobalIndex(index, query, {
      sort,
      filters: {
        ...(source === "all" ? {} : { sources: [source] }),
        ...(workspaceId === "all" ? {} : { workspaceId }),
        ...(role === "all" ? {} : { roles: [role] }),
        dateFrom: dateCutoff(date),
      },
    });
  }, [date, index, query, role, sort, source, workspaceId]);

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(0, results.length - 1)),
    );
    resultRefs.current.length = results.length;
  }, [results.length]);

  useEffect(() => {
    resultRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectResult = (resultIndex: number) => {
    const result = results[resultIndex];
    if (!result) return;
    void Promise.resolve(onNavigate(result.document.target)).then(
      (navigated) => {
        if (navigated !== false) return;
        setStaleTarget(true);
        clearGlobalSearchIndexCache();
        setRefreshKey((value) => value + 1);
      },
      () => {
        setStaleTarget(true);
        clearGlobalSearchIndexCache();
        setRefreshKey((value) => value + 1);
      },
    );
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length > 0 ? Math.min(results.length - 1, current + 1) : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length > 0 ? Math.max(0, current - 1) : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectResult(selectedIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const phaseLabel = progress ? t(SOURCE_LABEL_KEYS[progress.phase]) : "";

  return (
    <GlobalSearchModalFrame
      labelledBy="global-search-title"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 id="global-search-title" className="text-lg font-semibold">
              {t("title")}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <Button
            variant="bare"
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both px-3 py-5 md:px-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="relative">
            <Search
              size={19}
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              role="combobox"
              value={query}
              onChange={(event) => {
                updateViewState({ query: event.target.value });
                setSelectedIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              aria-label={t("inputLabel")}
              aria-autocomplete="list"
              aria-expanded={query.trim().length > 0}
              aria-busy={indexing}
              aria-controls="global-search-results"
              aria-activedescendant={
                results[selectedIndex]
                  ? `global-search-result-${selectedIndex}`
                  : undefined
              }
              placeholder={t("placeholder")}
              className="h-[52px] w-full rounded-xl border border-border bg-card pl-11 pr-24 text-sm shadow-sm outline-none transition-[border-color,box-shadow,background-color] focus:border-brand/55 focus:ring-4 focus:ring-brand/10 motion-reduce:transition-none"
            />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {indexing && (
                <span
                  role="status"
                  aria-label={t("indexing")}
                  className="rounded-md p-1.5 text-muted-foreground"
                >
                  <LoaderCircle
                    size={17}
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                </span>
              )}
              {query && (
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("clearQuery")}
                  onClick={() => {
                    updateViewState({ query: "" });
                    setSelectedIndex(0);
                    inputRef.current?.focus({ preventScroll: true });
                  }}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45"
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 custom-scrollbar">
              <div
                role="group"
                aria-label={t("filterSource")}
                className="inline-flex min-w-max items-center gap-1 rounded-xl border border-border bg-muted/45 p-1"
              >
                {SOURCE_FILTER_OPTIONS.map((sourceOption) => {
                  const selected = source === sourceOption;
                  return (
                    <Button
                      variant="bare"
                      key={sourceOption}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        updateViewState({ source: sourceOption });
                        setSelectedIndex(0);
                      }}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] motion-reduce:transition-none ${
                        selected
                          ? "bg-card text-brand shadow-sm ring-1 ring-brand/15"
                          : "text-muted-foreground hover:bg-card/65 hover:text-foreground"
                      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45`}
                    >
                      {sourceOption === "all" ? (
                        <Search size={14} aria-hidden="true" />
                      ) : (
                        <SourceIcon source={sourceOption} />
                      )}
                      <span>{t(SOURCE_FILTER_LABEL_KEYS[sourceOption])}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <Button
              variant="bare"
              type="button"
              aria-label={
                advancedOptionCount > 0
                  ? `${t("filtersAndSort")}, ${t("activeOptions", {
                      count: advancedOptionCount,
                    })}`
                  : t("filtersAndSort")
              }
              aria-expanded={filtersOpen}
              aria-controls="global-search-advanced-options"
              onClick={() => setFiltersOpen((open) => !open)}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-[border-color,background-color,color] motion-reduce:transition-none ${
                filtersOpen || advancedOptionCount > 0
                  ? "border-brand/30 bg-brand-soft text-brand"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45`}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span aria-hidden="true" className="hidden sm:inline">
                {t("filtersAndSort")}
              </span>
              {advancedOptionCount > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] leading-none text-brand-foreground"
                  >
                    {advancedOptionCount}
                  </span>
                </>
              )}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`transition-transform duration-150 motion-reduce:transition-none ${filtersOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </div>

          {filtersOpen && (
            <div
              id="global-search-advanced-options"
              className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/70 p-3 shadow-sm animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none md:grid-cols-4"
            >
              <div className="col-span-2 flex items-center justify-between gap-3 md:col-span-4">
                <p className="text-xs font-medium text-foreground">
                  {t("filtersAndSort")}
                </p>
                {advancedOptionCount > 0 && (
                  <Button
                    variant="bare"
                    type="button"
                    onClick={() => {
                      updateViewState(DEFAULT_GLOBAL_SEARCH_ADVANCED_OPTIONS);
                      setSelectedIndex(0);
                    }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45"
                  >
                    {t("restoreDefaults")}
                  </Button>
                )}
              </div>

              <label
                htmlFor="global-search-workspace-filter"
                className="min-w-0 space-y-1 text-xs text-muted-foreground"
              >
                <span>{t("filterWorkspace")}</span>
                <CustomSelect
                  id="global-search-workspace-filter"
                  value={workspaceId}
                  onChange={(value) => {
                    updateViewState({ workspaceId: value });
                    setSelectedIndex(0);
                  }}
                  options={[
                    { value: "all", label: t("allWorkspaces") },
                    ...workspaces.map((workspace) => ({
                      value: workspace.id,
                      label: workspace.name,
                    })),
                  ]}
                  ariaLabel={t("filterWorkspace")}
                  selectButtonClassName="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
                />
              </label>
              <label
                htmlFor="global-search-role-filter"
                className="min-w-0 space-y-1 text-xs text-muted-foreground"
              >
                <span>{t("filterRole")}</span>
                <CustomSelect
                  id="global-search-role-filter"
                  value={role}
                  onChange={(value) => {
                    updateViewState({
                      role: value as GlobalSearchRoleFilter,
                    });
                    setSelectedIndex(0);
                  }}
                  options={[
                    { value: "all", label: t("allRoles") },
                    { value: "user", label: t("roleUser") },
                    { value: "model", label: t("roleModel") },
                  ]}
                  ariaLabel={t("filterRole")}
                  selectButtonClassName="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
                />
              </label>
              <label
                htmlFor="global-search-date-filter"
                className="min-w-0 space-y-1 text-xs text-muted-foreground"
              >
                <span>{t("filterDate")}</span>
                <CustomSelect
                  id="global-search-date-filter"
                  value={date}
                  onChange={(value) => {
                    updateViewState({
                      date: value as GlobalSearchDateFilter,
                    });
                    setSelectedIndex(0);
                  }}
                  options={[
                    { value: "all", label: t("anyDate") },
                    { value: "7", label: t("last7Days") },
                    { value: "30", label: t("last30Days") },
                    { value: "90", label: t("last90Days") },
                  ]}
                  ariaLabel={t("filterDate")}
                  selectButtonClassName="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
                />
              </label>
              <label
                htmlFor="global-search-sort"
                className="min-w-0 space-y-1 text-xs text-muted-foreground"
              >
                <span>{t("sort")}</span>
                <CustomSelect
                  id="global-search-sort"
                  value={sort}
                  onChange={(value) => {
                    updateViewState({
                      sort: value as GlobalSearchViewState["sort"],
                    });
                    setSelectedIndex(0);
                  }}
                  options={[
                    { value: "relevance", label: t("sortRelevance") },
                    { value: "newest", label: t("sortNewest") },
                    { value: "oldest", label: t("sortOldest") },
                  ]}
                  ariaLabel={t("sort")}
                  selectButtonClassName="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
                />
              </label>
            </div>
          )}

          {indexing && progress && (
            <div
              role="status"
              className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <span>{t("indexingPhase", { phase: phaseLabel })}</span>
              <span>
                {progress.processed}/{progress.total}
              </span>
            </div>
          )}

          {index?.partial && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5" />
              <span>{t("partial", { count: index.errors.length })}</span>
            </div>
          )}

          {staleTarget && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5" />
              <span>{t("staleResult")}</span>
            </div>
          )}

          {indexError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-100"
            >
              <span>{indexError}</span>
              <Button
                variant="bare"
                type="button"
                onClick={() => {
                  clearGlobalSearchIndexCache();
                  setRefreshKey((value) => value + 1);
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                <RefreshCw size={14} aria-hidden="true" />
                {t("retry")}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {query.trim()
                ? t("resultCount", { count: results.length })
                : t("searchHint")}
            </span>
            {indexing && (
              <Button
                variant="bare"
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  setIndexing(false);
                  setProgress(null);
                }}
                className="rounded-md px-2 py-1 font-medium hover:bg-accent hover:text-accent-foreground"
              >
                {t("cancel")}
              </Button>
            )}
          </div>

          <div
            id="global-search-results"
            role="listbox"
            aria-label={t("resultsLabel")}
            aria-busy={indexing}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            {indexing && !indexError && (
              <div aria-hidden="true" className="divide-y divide-border">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 px-4 py-3.5 animate-pulse motion-reduce:animate-none"
                  >
                    <span className="h-8 w-8 shrink-0 rounded-lg bg-muted" />
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block h-3 w-2/5 rounded bg-muted" />
                      <span className="block h-2.5 w-4/5 rounded bg-muted/75" />
                      <span className="block h-2.5 w-1/4 rounded bg-muted/60" />
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!query.trim() && !indexing && !indexError && (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center">
                <span className="mb-3 rounded-xl bg-muted p-2.5 text-muted-foreground">
                  <Search size={22} aria-hidden="true" />
                </span>
                <p className="text-sm font-medium text-foreground">
                  {t("emptyTitle")}
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {t("localOnly")}
                </p>
              </div>
            )}

            {query.trim() &&
              !indexing &&
              results.length === 0 &&
              !indexError && (
                <div className="flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
                  <span className="mb-3 rounded-xl bg-muted p-2.5 text-muted-foreground">
                    <Search size={22} aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium text-foreground">
                    {t("noResults")}
                  </p>
                </div>
              )}

            {!indexing && results.length > 0 && (
              <div className="divide-y divide-border">
                {results.map((result, resultIndex) => {
                  const selected = selectedIndex === resultIndex;
                  return (
                    <Button
                      variant="bare"
                      key={result.document.id}
                      ref={(node) => {
                        resultRefs.current[resultIndex] = node;
                      }}
                      id={`global-search-result-${resultIndex}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                      onMouseEnter={() => setSelectedIndex(resultIndex)}
                      onClick={() => selectResult(resultIndex)}
                      className={`block w-full px-4 py-3.5 text-left transition-[background-color,color] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/45 ${
                        selected
                          ? "bg-brand-soft"
                          : "bg-card hover:bg-accent/55"
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 rounded-lg p-2 transition-colors ${
                            selected
                              ? "bg-brand/10 text-brand"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <SourceIcon source={result.document.source} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-3">
                            <span className="truncate text-sm font-medium">
                              <HighlightedText
                                value={result.document.title}
                                query={query}
                              />
                            </span>
                            <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                              {formatDate(result.document.updatedAt, locale)}
                            </span>
                          </span>
                          {result.snippet && (
                            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                              <HighlightedText
                                value={result.snippet}
                                query={query}
                              />
                            </span>
                          )}
                          <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {t(SOURCE_LABEL_KEYS[result.document.source])}
                            </span>
                            {result.document.role && (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="h-3 w-px bg-border"
                                />
                                <span>
                                  {t(ROLE_LABEL_KEYS[result.document.role])}
                                </span>
                              </>
                            )}
                            <span
                              aria-hidden="true"
                              className="h-3 w-px bg-border sm:hidden"
                            />
                            <span className="sm:hidden">
                              {formatDate(result.document.updatedAt, locale)}
                            </span>
                          </span>
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="hidden items-center justify-end gap-4 text-[11px] text-muted-foreground md:flex">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans">
                ↑
              </kbd>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans">
                ↓
              </kbd>
              {t("keyboardMove")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans">
                Enter
              </kbd>
              {t("keyboardOpen")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans">
                Esc
              </kbd>
              {t("keyboardClose")}
            </span>
          </div>
        </div>
      </div>
    </GlobalSearchModalFrame>
  );
};

export default GlobalSearchCenter;
