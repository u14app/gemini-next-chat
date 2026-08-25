"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Download,
  Eye,
  EyeOff,
  FileClock,
  FileDiff,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { formatBytes } from "@/config/limits";
import { Button, IconButton } from "@/components/ui/primitives";
import { isTextWorkspaceMimeType } from "@/lib/agent/workspace";
import {
  listSessionArtifacts,
  publishWorkspaceArtifact,
  type SessionArtifactEntry,
} from "@/services/workspace/sessionArtifact";
import {
  listWorkspace,
  type WorkspaceFileEntry,
  type WorkspaceUsage,
} from "@/services/workspace/sessionWorkspace";
import {
  restoreWorkspaceFile,
  trashWorkspaceFile,
} from "@/services/workspace/workspaceTrash";
import { resolveOPFSBlob } from "@/utils/opfs";
import MarkdownRenderer from "@/components/content/MarkdownRenderer";

interface AgentArtifactWorkspaceProps {
  active: boolean;
  sessionId?: string | null;
}

interface WorkspaceData {
  scratch: WorkspaceFileEntry[];
  trash: WorkspaceFileEntry[];
  artifacts: SessionArtifactEntry[];
  usage?: WorkspaceUsage;
}

interface PreviewTarget {
  key: string;
  title: string;
  url: string;
  revision: string;
  mimeType: string;
}

type WorkspaceTab = "scratch" | "artifacts" | "trash";

const WORKSPACE_TABS: WorkspaceTab[] = ["scratch", "artifacts", "trash"];
const PREVIEW_MAX_CHARS = 2_400;

function handleWorkspaceTabKeyDown({
  event,
  index,
  select,
}: {
  event: React.KeyboardEvent<HTMLButtonElement>;
  index: number;
  select: (tab: WorkspaceTab) => void;
}) {
  let nextIndex = index;
  if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % WORKSPACE_TABS.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = WORKSPACE_TABS.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  select(WORKSPACE_TABS[nextIndex]);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLElement>('[role="tab"]')
    [nextIndex]?.focus();
}

function shortRevision(revision: string): string {
  return revision.replace(/^sha256:/, "").slice(0, 12);
}

function restoredFileName(path: string): string {
  return path.replace(/^trash\/[0-9a-f-]{36}-/i, "") || "restored-file";
}

function compactLineDiff(before: string, after: string): string {
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = left.slice(prefix, left.length - suffix);
  const added = right.slice(prefix, right.length - suffix);
  return [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ]
    .slice(0, 160)
    .join("\n");
}

function InlineFilePreview({ target }: { target: PreviewTarget }) {
  const t = useTranslations("Content");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; content: string; truncated: boolean }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const blob = await resolveOPFSBlob(target.url);
        if (cancelled) return;
        if (!blob) {
          setState({ status: "error" });
          return;
        }
        const content = await blob.text();
        if (cancelled) return;
        setState({
          status: "ready",
          content: content.slice(0, PREVIEW_MAX_CHARS),
          truncated: content.length > PREVIEW_MAX_CHARS,
        });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target.revision, target.url]);

  if (state.status === "loading") {
    return (
      <div
        className="flex items-center gap-2 border-t border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground"
        role="status"
      >
        <Loader2
          size={13}
          className="motion-safe:animate-spin"
          aria-hidden="true"
        />
        {t("artifactDrawerPreviewLoading")}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="flex items-start gap-2 border-t border-amber-200 bg-amber-50/70 px-3 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200"
        role="status"
      >
        <AlertTriangle
          size={14}
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        {t("artifactDrawerPreviewUnavailable")}
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-muted/15 px-3 py-4">
      {target.mimeType === "text/markdown" ? (
        <div className="max-h-72 overflow-auto pr-1 custom-scrollbar">
          <MarkdownRenderer content={state.content} />
        </div>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-foreground/90 custom-scrollbar">
          {state.content}
        </pre>
      )}
      {state.truncated ? (
        <p className="mt-3 text-[10px] font-medium text-muted-foreground">
          {t("artifactDrawerPreviewTruncated")}
        </p>
      ) : null}
    </div>
  );
}

export default function AgentArtifactWorkspace({
  active,
  sessionId,
}: AgentArtifactWorkspaceProps) {
  const t = useTranslations("Content");
  const locale = useLocale();
  const tabsId = useId();
  const [data, setData] = useState<WorkspaceData>({
    scratch: [],
    trash: [],
    artifacts: [],
  });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ title: string; content: string } | null>(
    null,
  );
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("scratch");

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [locale],
  );

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    setPreviewTarget(null);
    setDiff(null);
    try {
      const [workspace, trash, artifacts] = await Promise.all([
        listWorkspace(sessionId),
        listWorkspace(sessionId, "trash"),
        listSessionArtifacts(sessionId),
      ]);
      if (!workspace.ok) throw new Error(workspace.error.message);
      if (!trash.ok) throw new Error(trash.error.message);
      if (!artifacts.ok) throw new Error(artifacts.error.message);
      setData({
        scratch: workspace.value.files,
        trash: trash.value.files,
        artifacts: artifacts.value,
        usage: workspace.value.usage,
      });
      setHasLoaded(true);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : t("artifactDrawerLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    if (active && !hasLoaded) void refresh();
  }, [active, hasLoaded, refresh]);

  const usagePercent = useMemo(() => {
    if (!data.usage?.maxTotalBytes) return 0;
    return Math.min(
      100,
      (data.usage.totalBytes / data.usage.maxTotalBytes) * 100,
    );
  }, [data.usage]);

  const runAction = async (path: string, action: () => Promise<void>) => {
    setBusyPath(path);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t("artifactDrawerActionFailed"),
      );
    } finally {
      setBusyPath(null);
    }
  };

  const download = async (entry: { url: string; fileName: string }) => {
    const blob = await resolveOPFSBlob(entry.url);
    if (!blob) throw new Error(t("artifactDrawerFileUnavailable"));
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entry.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const showDiff = async (
    artifact: SessionArtifactEntry,
    scratch: WorkspaceFileEntry,
  ) => {
    if (
      !isTextWorkspaceMimeType(artifact.mimeType) ||
      !isTextWorkspaceMimeType(scratch.mimeType)
    ) {
      throw new Error(t("artifactDrawerBinaryDiffUnavailable"));
    }
    const [publishedBlob, scratchBlob] = await Promise.all([
      resolveOPFSBlob(artifact.url),
      resolveOPFSBlob(scratch.url),
    ]);
    if (!publishedBlob || !scratchBlob) {
      throw new Error(t("artifactDrawerFileUnavailable"));
    }
    setDiff({
      title: `${artifact.fileName} → ${scratch.path}`,
      content: compactLineDiff(
        await publishedBlob.text(),
        await scratchBlob.text(),
      ),
    });
  };

  const togglePreview = (target: PreviewTarget) => {
    setPreviewTarget((current) =>
      current?.key === target.key ? null : target,
    );
  };

  const selectTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setPreviewTarget(null);
    if (tab !== "artifacts") setDiff(null);
  };

  const sourceLabel = (source: WorkspaceFileEntry["source"]) =>
    t(`artifactDrawerSource_${source}`);

  if (!sessionId) {
    return (
      <p className="px-4 py-8 text-sm text-muted-foreground" role="status">
        {t("artifactDrawerWorkspaceUnavailable")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-border px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t("artifactDrawerScratchCount", { count: data.scratch.length })}
            </span>
            <span aria-hidden="true">/</span>
            <span>
              {t("artifactDrawerPublishedCount", {
                count: data.artifacts.length,
              })}
            </span>
            <span aria-hidden="true">/</span>
            <span>{formatBytes(data.usage?.totalBytes || 0)}</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            aria-label={t("artifactDrawerUsageAria", {
              percent: Math.round(usagePercent),
            })}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usagePercent)}
          >
            <div
              className="h-full bg-blue-500 transition-[width] motion-reduce:transition-none"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>
        <IconButton
          size="sm"
          label={t("artifactDrawerRefresh")}
          icon={
            <RefreshCw
              size={16}
              className={loading ? "motion-safe:animate-spin" : ""}
              aria-hidden="true"
            />
          }
          onClick={() => void refresh()}
          disabled={loading}
        />
      </div>

      <div
        className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5 sm:px-3"
        role="tablist"
        aria-label={t("artifactDrawerTabsAria")}
      >
        {WORKSPACE_TABS.map((tab, index) => {
          const count =
            tab === "scratch"
              ? data.scratch.length
              : tab === "artifacts"
                ? data.artifacts.length
                : data.trash.length;
          const label =
            tab === "scratch"
              ? t("artifactDrawerScratch")
              : tab === "artifacts"
                ? t("artifactDrawerPublished")
                : t("artifactDrawerTrashSection");
          return (
            <Button
              key={tab}
              variant="bare"
              type="button"
              id={`${tabsId}-${tab}-tab`}
              role="tab"
              tabIndex={activeTab === tab ? 0 : -1}
              aria-selected={activeTab === tab}
              aria-controls={`${tabsId}-${tab}-panel`}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) =>
                handleWorkspaceTabKeyDown({ event, index, select: selectTab })
              }
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                activeTab === tab
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {tab === "scratch" ? (
                <FileClock size={14} aria-hidden="true" />
              ) : tab === "artifacts" ? (
                <Archive size={14} aria-hidden="true" />
              ) : (
                <Trash2 size={14} aria-hidden="true" />
              )}
              <span>{label}</span>
              <span className="min-w-4 rounded bg-background/80 px-1 text-center font-mono text-[10px] leading-4 text-current ring-1 ring-border/70">
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        {loading && !hasLoaded ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2
              size={16}
              className="motion-safe:animate-spin"
              aria-hidden="true"
            />
            {t("artifactDrawerLoading")}
          </div>
        ) : (
          <div>
            <section
              id={`${tabsId}-scratch-panel`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-scratch-tab`}
              hidden={activeTab !== "scratch"}
              className="min-w-0"
            >
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                {data.scratch.length ? (
                  data.scratch.map((file) => {
                    const previewKey = `scratch:${file.path}:${file.revision}`;
                    const previewOpen = previewTarget?.key === previewKey;
                    return (
                      <article key={file.path}>
                        <div className="flex min-h-12 items-center gap-2 px-2.5 py-1.5">
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-xs font-semibold text-foreground"
                              title={file.path}
                            >
                              {file.path}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                              <span>{formatBytes(file.bytes)}</span>
                              <span>r:{shortRevision(file.revision)}</span>
                              <span>{sourceLabel(file.source)}</span>
                              <span>
                                {dateFormatter.format(file.updatedAt)}
                              </span>
                            </div>
                          </div>
                          {busyPath === file.path ? (
                            <Loader2
                              size={15}
                              className="motion-safe:animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <div className="flex items-center gap-0.5">
                              {isTextWorkspaceMimeType(file.mimeType) ? (
                                <IconButton
                                  size="sm"
                                  aria-expanded={previewOpen}
                                  label={t(
                                    previewOpen
                                      ? "artifactDrawerClosePreview"
                                      : "artifactDrawerPreview",
                                    { name: file.fileName },
                                  )}
                                  icon={
                                    previewOpen ? (
                                      <EyeOff size={15} aria-hidden="true" />
                                    ) : (
                                      <Eye size={15} aria-hidden="true" />
                                    )
                                  }
                                  onClick={() =>
                                    togglePreview({
                                      key: previewKey,
                                      title: file.path,
                                      url: file.url,
                                      revision: file.revision,
                                      mimeType: file.mimeType,
                                    })
                                  }
                                />
                              ) : null}
                              <IconButton
                                size="sm"
                                label={t("artifactDrawerDownload", {
                                  name: file.fileName,
                                })}
                                icon={<Download size={15} aria-hidden="true" />}
                                onClick={() =>
                                  void runAction(file.path, () =>
                                    download(file),
                                  )
                                }
                              />
                              <IconButton
                                size="sm"
                                label={t("artifactDrawerPublish", {
                                  name: file.fileName,
                                })}
                                icon={
                                  <PackageCheck size={15} aria-hidden="true" />
                                }
                                onClick={() =>
                                  void runAction(file.path, async () => {
                                    const result =
                                      await publishWorkspaceArtifact(
                                        sessionId,
                                        file.path,
                                      );
                                    if (!result.ok) {
                                      throw new Error(result.error.message);
                                    }
                                  })
                                }
                              />
                              <IconButton
                                size="sm"
                                label={t("artifactDrawerTrash", {
                                  name: file.fileName,
                                })}
                                icon={<Trash2 size={15} aria-hidden="true" />}
                                onClick={() =>
                                  void runAction(file.path, async () => {
                                    const result = await trashWorkspaceFile(
                                      sessionId,
                                      file.path,
                                      file.revision,
                                    );
                                    if (!result.ok) {
                                      throw new Error(result.error.message);
                                    }
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                        {previewOpen && previewTarget ? (
                          <InlineFilePreview
                            key={previewTarget.key}
                            target={previewTarget}
                          />
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <p className="px-3 py-5 text-xs text-muted-foreground">
                    {t("artifactDrawerEmptyScratch")}
                  </p>
                )}
              </div>
            </section>

            <>
              <section
                id={`${tabsId}-artifacts-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-artifacts-tab`}
                hidden={activeTab !== "artifacts"}
                className="min-w-0"
              >
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                  {data.artifacts.length ? (
                    data.artifacts.map((artifact) => {
                      const scratchMatches = data.scratch.filter(
                        (file) => file.fileName === artifact.fileName,
                      );
                      const scratch =
                        scratchMatches.length === 1
                          ? scratchMatches[0]
                          : undefined;
                      const ambiguous = scratchMatches.length > 1;
                      const previewKey = `artifact:${artifact.url}`;
                      const previewOpen = previewTarget?.key === previewKey;
                      return (
                        <article key={artifact.url}>
                          <div className="flex min-h-12 items-center gap-2 px-2.5 py-1.5">
                            <div className="min-w-0 flex-1">
                              <div
                                className="truncate text-xs font-semibold text-foreground"
                                title={artifact.fileName}
                              >
                                {artifact.fileName}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                                <span>{formatBytes(artifact.bytes)}</span>
                                <span>
                                  sha:{shortRevision(artifact.revision)}
                                </span>
                                <span>{t("artifactDrawerImmutable")}</span>
                              </div>
                              {ambiguous ? (
                                <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                                  {t("artifactDrawerDiffAmbiguous")}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-0.5">
                              {isTextWorkspaceMimeType(artifact.mimeType) ? (
                                <IconButton
                                  size="sm"
                                  aria-expanded={previewOpen}
                                  label={t(
                                    previewOpen
                                      ? "artifactDrawerClosePreview"
                                      : "artifactDrawerPreview",
                                    { name: artifact.fileName },
                                  )}
                                  icon={
                                    previewOpen ? (
                                      <EyeOff size={15} aria-hidden="true" />
                                    ) : (
                                      <Eye size={15} aria-hidden="true" />
                                    )
                                  }
                                  onClick={() =>
                                    togglePreview({
                                      key: previewKey,
                                      title: artifact.fileName,
                                      url: artifact.url,
                                      revision: artifact.revision,
                                      mimeType: artifact.mimeType,
                                    })
                                  }
                                />
                              ) : null}
                              {scratch ? (
                                <IconButton
                                  size="sm"
                                  label={t("artifactDrawerDiff", {
                                    name: artifact.fileName,
                                  })}
                                  icon={
                                    <FileDiff size={15} aria-hidden="true" />
                                  }
                                  onClick={() =>
                                    void runAction(artifact.url, () =>
                                      showDiff(artifact, scratch),
                                    )
                                  }
                                />
                              ) : null}
                              <IconButton
                                size="sm"
                                label={t("artifactDrawerDownload", {
                                  name: artifact.fileName,
                                })}
                                icon={<Download size={15} aria-hidden="true" />}
                                onClick={() =>
                                  void runAction(artifact.url, () =>
                                    download(artifact),
                                  )
                                }
                              />
                            </div>
                          </div>
                          {previewOpen && previewTarget ? (
                            <InlineFilePreview
                              key={previewTarget.key}
                              target={previewTarget}
                            />
                          ) : null}
                        </article>
                      );
                    })
                  ) : (
                    <p className="px-3 py-5 text-xs text-muted-foreground">
                      {t("artifactDrawerEmptyPublished")}
                    </p>
                  )}
                </div>
              </section>

              <section
                id={`${tabsId}-trash-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-trash-tab`}
                hidden={activeTab !== "trash"}
                className="min-w-0"
              >
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                  {data.trash.length ? (
                    data.trash.map((file) => (
                      <article
                        key={file.path}
                        className="flex min-h-12 items-center gap-2 px-2.5 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-xs font-medium text-foreground"
                            title={restoredFileName(file.path)}
                          >
                            {restoredFileName(file.path)}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-muted-foreground">
                            <span>{formatBytes(file.bytes)}</span>
                            <span>r:{shortRevision(file.revision)}</span>
                            <span>{dateFormatter.format(file.updatedAt)}</span>
                          </div>
                        </div>
                        <IconButton
                          size="sm"
                          label={t("artifactDrawerRestore", {
                            name: file.fileName,
                          })}
                          icon={<RotateCcw size={15} aria-hidden="true" />}
                          disabled={busyPath === file.path}
                          onClick={() =>
                            void runAction(file.path, async () => {
                              const result = await restoreWorkspaceFile(
                                sessionId,
                                file.path,
                                restoredFileName(file.path),
                                file.revision,
                              );
                              if (!result.ok) {
                                throw new Error(result.error.message);
                              }
                            })
                          }
                        />
                      </article>
                    ))
                  ) : (
                    <p className="px-3 py-5 text-xs text-muted-foreground">
                      {t("artifactDrawerEmptyTrash")}
                    </p>
                  )}
                </div>
              </section>
            </>
          </div>
        )}

        {diff && activeTab === "artifacts" ? (
          <section className="mt-3 overflow-hidden rounded-lg border border-border bg-zinc-950 text-zinc-100">
            <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <h3 className="truncate font-mono text-xs">{diff.title}</h3>
              <IconButton
                size="sm"
                label={t("artifactDrawerCloseDiff")}
                icon={<X size={15} aria-hidden="true" />}
                onClick={() => setDiff(null)}
                className="text-zinc-300 hover:bg-white/10 hover:text-white"
              />
            </header>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-5 custom-scrollbar">
              {diff.content}
            </pre>
          </section>
        ) : null}
      </div>
    </div>
  );
}
