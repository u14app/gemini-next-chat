"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Download,
  FileClock,
  FileDiff,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { formatBytes } from "@/config/limits";
import { Dialog, IconButton } from "@/components/ui/primitives";
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

interface AgentArtifactDrawerProps {
  open: boolean;
  sessionId?: string | null;
  onClose: () => void;
}

interface DrawerData {
  scratch: WorkspaceFileEntry[];
  trash: WorkspaceFileEntry[];
  artifacts: SessionArtifactEntry[];
  usage?: WorkspaceUsage;
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

export default function AgentArtifactDrawer({
  open,
  sessionId,
  onClose,
}: AgentArtifactDrawerProps) {
  const t = useTranslations("Content");
  const [data, setData] = useState<DrawerData>({
    scratch: [],
    trash: [],
    artifacts: [],
  });
  const [loading, setLoading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ title: string; content: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
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
    if (open) void refresh();
  }, [open, refresh]);

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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("artifactDrawerTitle")}
      placement="responsive-sheet"
      className="sm:max-w-3xl"
    >
      <div className="flex max-h-[calc(92dvh-3.25rem)] min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {t("artifactDrawerScratchCount", {
                  count: data.scratch.length,
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t("artifactDrawerPublishedCount", {
                  count: data.artifacts.length,
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(data.usage?.totalBytes || 0)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-blue-500 transition-[width] motion-reduce:transition-none"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
          <IconButton
            size="lg"
            className="h-11 w-11"
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
          <IconButton
            size="lg"
            className="h-11 w-11"
            label={t("artifactDrawerClose")}
            icon={<X size={17} aria-hidden="true" />}
            onClick={onClose}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
          {loading && data.scratch.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2
                size={16}
                className="motion-safe:animate-spin"
                aria-hidden="true"
              />
              {t("artifactDrawerLoading")}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="min-w-0">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <FileClock size={14} aria-hidden="true" />
                  {t("artifactDrawerScratch")}
                </h3>
                <div className="overflow-hidden rounded-lg border border-border bg-background">
                  {data.scratch.length ? (
                    data.scratch.map((file) => (
                      <article
                        key={file.path}
                        className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">
                            {file.path}
                          </div>
                          <div className="mt-0.5 flex gap-2 font-mono text-[10px] text-muted-foreground">
                            <span>r:{shortRevision(file.revision)}</span>
                            <span>{formatBytes(file.bytes)}</span>
                          </div>
                        </div>
                        {busyPath === file.path ? (
                          <Loader2
                            size={15}
                            className="motion-safe:animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <div className="flex items-center">
                            <IconButton
                              size="lg"
                              className="h-11 w-11"
                              label={t("artifactDrawerDownload", {
                                name: file.fileName,
                              })}
                              icon={<Download size={15} aria-hidden="true" />}
                              onClick={() =>
                                void runAction(file.path, () => download(file))
                              }
                            />
                            <IconButton
                              size="lg"
                              className="h-11 w-11"
                              label={t("artifactDrawerPublish", {
                                name: file.fileName,
                              })}
                              icon={
                                <PackageCheck size={15} aria-hidden="true" />
                              }
                              onClick={() =>
                                void runAction(file.path, async () => {
                                  if (!sessionId) return;
                                  const result = await publishWorkspaceArtifact(
                                    sessionId,
                                    file.path,
                                  );
                                  if (!result.ok)
                                    throw new Error(result.error.message);
                                })
                              }
                            />
                            <IconButton
                              size="lg"
                              className="h-11 w-11"
                              label={t("artifactDrawerTrash", {
                                name: file.fileName,
                              })}
                              icon={<Trash2 size={15} aria-hidden="true" />}
                              onClick={() =>
                                void runAction(file.path, async () => {
                                  if (!sessionId) return;
                                  const result = await trashWorkspaceFile(
                                    sessionId,
                                    file.path,
                                    file.revision,
                                  );
                                  if (!result.ok)
                                    throw new Error(result.error.message);
                                })
                              }
                            />
                          </div>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="px-3 py-5 text-xs text-muted-foreground">
                      {t("artifactDrawerEmptyScratch")}
                    </p>
                  )}
                </div>
              </section>

              <div className="min-w-0 space-y-5">
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Archive size={14} aria-hidden="true" />
                    {t("artifactDrawerPublished")}
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-border bg-background">
                    {data.artifacts.length ? (
                      data.artifacts.map((artifact) => {
                        const scratch = data.scratch.find(
                          (file) => file.fileName === artifact.fileName,
                        );
                        return (
                          <article
                            key={artifact.url}
                            className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-foreground">
                                {artifact.fileName}
                              </div>
                              <div className="mt-0.5 flex gap-2 font-mono text-[10px] text-muted-foreground">
                                <span>
                                  sha:{shortRevision(artifact.revision)}
                                </span>
                                <span>{formatBytes(artifact.bytes)}</span>
                              </div>
                            </div>
                            <div className="flex items-center">
                              {scratch ? (
                                <IconButton
                                  size="lg"
                                  className="h-11 w-11"
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
                                size="lg"
                                className="h-11 w-11"
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

                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Trash2 size={14} aria-hidden="true" />
                    {t("artifactDrawerTrashSection")}
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-border bg-background">
                    {data.trash.length ? (
                      data.trash.map((file) => (
                        <article
                          key={file.path}
                          className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-foreground">
                              {restoredFileName(file.path)}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                              r:{shortRevision(file.revision)}
                            </div>
                          </div>
                          <IconButton
                            size="lg"
                            className="h-11 w-11"
                            label={t("artifactDrawerRestore", {
                              name: file.fileName,
                            })}
                            icon={<RotateCcw size={15} aria-hidden="true" />}
                            disabled={busyPath === file.path}
                            onClick={() =>
                              void runAction(file.path, async () => {
                                if (!sessionId) return;
                                const result = await restoreWorkspaceFile(
                                  sessionId,
                                  file.path,
                                  restoredFileName(file.path),
                                  file.revision,
                                );
                                if (!result.ok)
                                  throw new Error(result.error.message);
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
              </div>
            </div>
          )}

          {diff ? (
            <section className="mt-5 overflow-hidden rounded-lg border border-border bg-zinc-950 text-zinc-100">
              <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <h3 className="truncate font-mono text-xs">{diff.title}</h3>
                <IconButton
                  size="lg"
                  label={t("artifactDrawerCloseDiff")}
                  icon={<X size={15} aria-hidden="true" />}
                  onClick={() => setDiff(null)}
                  className="h-11 w-11 text-zinc-300 hover:bg-white/10 hover:text-white"
                />
              </header>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-5 custom-scrollbar">
                {diff.content}
              </pre>
            </section>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
