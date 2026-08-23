import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import {
  applyWorkspaceEdit,
  getSessionWorkspaceRoot,
  getWorkspaceFileName,
  guessWorkspaceMimeType,
  isTextWorkspaceFile,
  resolveWorkspaceUrl,
  sliceWorkspaceLines,
  toWorkspaceRelativePath,
  WORKSPACE_UPLOADS_DIRECTORY,
  workspaceFailure,
  type WorkspaceResult,
} from "@/lib/agent/workspace";
import {
  deleteFromOPFS,
  deleteOPFSDirectory,
  listOPFSDirectory,
  readTextFromOPFS,
  resolveOPFSBlob,
  statOPFSFileSize,
  writeBlobToOPFS,
  writeToOPFS,
} from "@/utils/opfs";

import {
  invalidateWorkspaceManifest,
  isWorkspaceManifestPath,
  reconcileWorkspaceManifest,
  recordWorkspaceManifestFile,
  removeWorkspaceManifestFile,
  type WorkspaceFileSource,
  type WorkspaceManifestFile,
  type WorkspacePhysicalFile,
} from "./workspaceManifest";

/**
 * Session-scoped file operations for the agent workspace. Every path is resolved
 * through `resolveWorkspaceUrl` first, so nothing here can reach outside
 * `opfs://chat/workspace/<sessionId>/`.
 */

export interface WorkspaceFileEntry {
  path: string;
  url: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  contentHash: string;
  revision: string;
  updatedAt: number;
  source: WorkspaceFileSource;
}

export interface WorkspaceUsage {
  fileCount: number;
  totalBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  trashedFileCount: number;
}

export type WorkspaceWriteMode = "create" | "overwrite" | "append";

export interface WorkspaceMutationOptions {
  expectedRevision?: string;
  source?: WorkspaceFileSource;
}

const workspaceMutationQueues = new Map<string, Promise<void>>();

async function withWorkspaceMutation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = workspaceMutationQueues.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  workspaceMutationQueues.set(sessionId, settled);
  try {
    return await current;
  } finally {
    if (workspaceMutationQueues.get(sessionId) === settled) {
      workspaceMutationQueues.delete(sessionId);
    }
  }
}

function toEntry(
  file: WorkspacePhysicalFile,
  metadata: WorkspaceManifestFile,
): WorkspaceFileEntry {
  return {
    ...file,
    fileName: getWorkspaceFileName(file.path),
    mimeType: guessWorkspaceMimeType(file.path),
    contentHash: metadata.contentHash,
    revision: metadata.revision,
    updatedAt: metadata.updatedAt,
    source: metadata.source,
  };
}

async function listEntries(sessionId: string): Promise<WorkspaceFileEntry[]> {
  const root = getSessionWorkspaceRoot(sessionId);
  if (!root) return [];

  const paths = await listOPFSDirectory(root);
  const physicalFiles = await Promise.all(
    paths.map(async (absolutePath) => {
      const path = toWorkspaceRelativePath(sessionId, absolutePath);
      if (!path || isWorkspaceManifestPath(path)) return null;
      const url = `opfs://${absolutePath}`;
      return {
        path,
        url,
        bytes: (await statOPFSFileSize(url)) ?? 0,
      } satisfies WorkspacePhysicalFile;
    }),
  );

  const existing = physicalFiles.filter(
    (entry): entry is WorkspacePhysicalFile => entry !== null,
  );
  const manifest = await reconcileWorkspaceManifest(sessionId, existing);

  return existing
    .map((file) => {
      const metadata = manifest.get(file.path);
      return metadata ? toEntry(file, metadata) : null;
    })
    .filter((entry): entry is WorkspaceFileEntry => entry !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function toUsage(entries: WorkspaceFileEntry[]): WorkspaceUsage {
  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    maxFiles: AGENT_WORKSPACE_LIMITS.maxFiles,
    maxTotalBytes: AGENT_WORKSPACE_LIMITS.maxTotalBytes,
    trashedFileCount: entries.filter((entry) => entry.path.startsWith("trash/"))
      .length,
  };
}

export async function listWorkspace(
  sessionId: string,
  prefix?: string,
): Promise<
  WorkspaceResult<{
    files: WorkspaceFileEntry[];
    usage: WorkspaceUsage;
    truncated: boolean;
  }>
> {
  if (!getSessionWorkspaceRoot(sessionId)) {
    return workspaceFailure(
      "WORKSPACE_UNAVAILABLE",
      "No session workspace is available for this request.",
    );
  }

  const entries = await listEntries(sessionId);
  const usage = toUsage(entries);
  const normalizedPrefix = prefix?.trim().replace(/^\.?\/+|\/+$/g, "");
  const filtered = normalizedPrefix
    ? entries.filter(
        (entry) =>
          entry.path === normalizedPrefix ||
          entry.path.startsWith(`${normalizedPrefix}/`),
      )
    : entries.filter((entry) => !entry.path.startsWith("trash/"));

  return {
    ok: true,
    value: {
      files: filtered.slice(0, AGENT_WORKSPACE_LIMITS.maxListEntries),
      usage,
      truncated: filtered.length > AGENT_WORKSPACE_LIMITS.maxListEntries,
    },
  };
}

export async function readWorkspaceText(
  sessionId: string,
  path: unknown,
  options: { offset?: number; limit?: number } = {},
): Promise<
  WorkspaceResult<{
    path: string;
    mimeType: string;
    contentHash: string;
    revision: string;
    updatedAt: number;
    source: WorkspaceFileSource;
    content: string;
    totalLines: number;
    startLine: number;
    truncated: boolean;
  }>
> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  if (!isTextWorkspaceFile(resolved.value.path)) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      `"${resolved.value.path}" is not a text file. Use run_javascript or share_workspace_file for binary files.`,
    );
  }

  const entries = await listEntries(sessionId);
  const entry = entries.find(
    (candidate) => candidate.path === resolved.value.path,
  );
  if (!entry) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      `"${resolved.value.path}" does not exist in the workspace.`,
    );
  }

  let content: string | null;
  try {
    content = await readTextFromOPFS(resolved.value.url);
  } catch (error) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      error instanceof Error ? error.message : "Failed to read the file.",
    );
  }
  if (content === null) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      `"${resolved.value.path}" does not exist in the workspace.`,
    );
  }

  const slice = sliceWorkspaceLines(content, options.offset, options.limit);
  return {
    ok: true,
    value: {
      path: entry.path,
      mimeType: entry.mimeType,
      contentHash: entry.contentHash,
      revision: entry.revision,
      updatedAt: entry.updatedAt,
      source: entry.source,
      ...slice,
    },
  };
}

/**
 * Checks the quota a write would leave the workspace in. `existingBytes` is the
 * size of the file being replaced, which does not count against the new total.
 */
function checkQuota(
  entries: WorkspaceFileEntry[],
  path: string,
  nextBytes: number,
): WorkspaceResult<true> {
  if (nextBytes > AGENT_WORKSPACE_LIMITS.maxFileBytes) {
    return workspaceFailure(
      "WORKSPACE_FILE_TOO_LARGE",
      `Workspace files must be at most ${AGENT_WORKSPACE_LIMITS.maxFileBytes} bytes.`,
    );
  }

  const existing = entries.find((entry) => entry.path === path);
  if (!existing && entries.length >= AGENT_WORKSPACE_LIMITS.maxFiles) {
    return workspaceFailure(
      "WORKSPACE_QUOTA_EXCEEDED",
      `The workspace already holds the maximum of ${AGENT_WORKSPACE_LIMITS.maxFiles} files. Delete something first.`,
    );
  }

  const totalAfter =
    entries.reduce((total, entry) => total + entry.bytes, 0) -
    (existing?.bytes ?? 0) +
    nextBytes;
  if (totalAfter > AGENT_WORKSPACE_LIMITS.maxTotalBytes) {
    return workspaceFailure(
      "WORKSPACE_QUOTA_EXCEEDED",
      `This write would exceed the ${AGENT_WORKSPACE_LIMITS.maxTotalBytes}-byte workspace quota.`,
    );
  }

  return { ok: true, value: true };
}

/**
 * Shared quota-then-write sequence for both the text and binary writers, so
 * quota accounting lives in exactly one place.
 */
async function commitWrite(
  sessionId: string,
  path: unknown,
  content: Blob,
  write: (url: string) => Promise<void>,
  entries?: WorkspaceFileEntry[],
  source: WorkspaceFileSource = "agent",
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const known = entries ?? (await listEntries(sessionId));
  const quota = checkQuota(known, resolved.value.path, content.size);
  if (!quota.ok) return quota;

  try {
    await write(resolved.value.url);
  } catch (error) {
    return workspaceFailure(
      "WORKSPACE_WRITE_FAILED",
      error instanceof Error ? error.message : "Failed to write the file.",
    );
  }

  let metadata: WorkspaceManifestFile;
  try {
    metadata = await recordWorkspaceManifestFile(
      sessionId,
      {
        path: resolved.value.path,
        url: resolved.value.url,
        bytes: content.size,
      },
      content,
      source,
    );
  } catch (error) {
    await invalidateWorkspaceManifest(sessionId).catch(() => undefined);
    return workspaceFailure(
      "WORKSPACE_WRITE_FAILED",
      error instanceof Error
        ? error.message
        : "The file was written, but its workspace revision could not be recorded.",
    );
  }

  return {
    ok: true,
    value: toEntry(
      {
        path: resolved.value.path,
        url: resolved.value.url,
        bytes: content.size,
      },
      metadata,
    ),
  };
}

function checkExpectedRevision(
  path: string,
  entry: WorkspaceFileEntry | undefined,
  expectedRevision: string | undefined,
): WorkspaceResult<true> {
  if (expectedRevision === undefined) return { ok: true, value: true };
  if (entry?.revision === expectedRevision) return { ok: true, value: true };

  return workspaceFailure(
    "WORKSPACE_REVISION_CONFLICT",
    `"${path}" changed since it was last read. List or read the file again before retrying.`,
  );
}

async function writeWorkspaceTextUnlocked(
  sessionId: string,
  path: unknown,
  content: string,
  mode: WorkspaceWriteMode,
  options: WorkspaceMutationOptions,
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const entries = await listEntries(sessionId);
  const existing = entries.find((entry) => entry.path === resolved.value.path);
  const revision = checkExpectedRevision(
    resolved.value.path,
    existing,
    options.expectedRevision,
  );
  if (!revision.ok) return revision;

  if (mode === "create" && existing) {
    return workspaceFailure(
      "WORKSPACE_FILE_EXISTS",
      `"${resolved.value.path}" already exists. Use mode "overwrite" or edit_workspace_file.`,
    );
  }

  let nextContent = content;
  if (mode === "append" && existing) {
    const current = await readTextFromOPFS(resolved.value.url);
    nextContent = (current ?? "") + content;
  }

  const blob = new Blob([nextContent], {
    type: guessWorkspaceMimeType(resolved.value.path),
  });
  return commitWrite(
    sessionId,
    resolved.value.path,
    blob,
    (url) => writeToOPFS(url, nextContent),
    entries,
    options.source ??
      (resolved.value.path.startsWith(`${WORKSPACE_UPLOADS_DIRECTORY}/`)
        ? "attachment"
        : "agent"),
  );
}

export async function writeWorkspaceText(
  sessionId: string,
  path: unknown,
  content: string,
  mode: WorkspaceWriteMode = "overwrite",
  options: WorkspaceMutationOptions = {},
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  return withWorkspaceMutation(sessionId, () =>
    writeWorkspaceTextUnlocked(sessionId, path, content, mode, options),
  );
}

/**
 * Writes binary content to the workspace. Binary files cannot be read or edited
 * as text, but they count against the same quota and can be listed, moved,
 * archived, and shared.
 */
export async function writeWorkspaceBlob(
  sessionId: string,
  path: unknown,
  content: Blob,
  options: WorkspaceMutationOptions = {},
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  return withWorkspaceMutation(sessionId, async () => {
    const resolved = resolveWorkspaceUrl(sessionId, path);
    if (!resolved.ok) return resolved;
    const entries = await listEntries(sessionId);
    const existing = entries.find(
      (entry) => entry.path === resolved.value.path,
    );
    const revision = checkExpectedRevision(
      resolved.value.path,
      existing,
      options.expectedRevision,
    );
    if (!revision.ok) return revision;

    return commitWrite(
      sessionId,
      resolved.value.path,
      content,
      (url) => writeBlobToOPFS(url, content),
      entries,
      options.source ??
        (resolved.value.path.startsWith(`${WORKSPACE_UPLOADS_DIRECTORY}/`)
          ? "attachment"
          : "agent"),
    );
  });
}

/** Reads any workspace file as a Blob, including binary ones. */
export async function readWorkspaceBlob(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<{ entry: WorkspaceFileEntry; blob: Blob }>> {
  return withWorkspaceMutation(sessionId, async () => {
    const resolved = resolveWorkspaceUrl(sessionId, path);
    if (!resolved.ok) return resolved;

    const entries = await listEntries(sessionId);
    const entry = entries.find(
      (candidate) => candidate.path === resolved.value.path,
    );
    if (!entry) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }

    const blob = await resolveOPFSBlob(resolved.value.url);
    if (!blob) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }

    return {
      ok: true,
      value: { entry, blob },
    };
  });
}

export async function editWorkspaceFile(
  sessionId: string,
  path: unknown,
  oldString: string,
  newString: string,
  replaceAll = false,
  expectedRevision?: string,
): Promise<
  WorkspaceResult<{ entry: WorkspaceFileEntry; replacements: number }>
> {
  return withWorkspaceMutation(sessionId, async () => {
    const resolved = resolveWorkspaceUrl(sessionId, path);
    if (!resolved.ok) return resolved;

    if (!isTextWorkspaceFile(resolved.value.path)) {
      return workspaceFailure(
        "WORKSPACE_READ_FAILED",
        `"${resolved.value.path}" is not a text file and cannot be edited.`,
      );
    }

    const entries = await listEntries(sessionId);
    const existing = entries.find(
      (entry) => entry.path === resolved.value.path,
    );
    if (!existing) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }
    const revision = checkExpectedRevision(
      resolved.value.path,
      existing,
      expectedRevision,
    );
    if (!revision.ok) return revision;

    // The edit applies to the whole file, never to a truncated read window.
    const full = await readTextFromOPFS(resolved.value.url);
    if (full === null) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }

    const edited = applyWorkspaceEdit(full, oldString, newString, replaceAll);
    if (!edited.ok) return edited;

    const nextContent = edited.value.content;
    const written = await commitWrite(
      sessionId,
      resolved.value.path,
      new Blob([nextContent], { type: existing.mimeType }),
      (url) => writeToOPFS(url, nextContent),
      entries,
      "agent",
    );
    if (!written.ok) return written;

    return {
      ok: true,
      value: { entry: written.value, replacements: edited.value.replacements },
    };
  });
}

export interface WorkspaceTextPatch {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

/** Applies a bounded patch set atomically against one expected revision. */
export async function applyWorkspacePatches(
  sessionId: string,
  path: unknown,
  patches: readonly WorkspaceTextPatch[],
  expectedRevision?: string,
): Promise<
  WorkspaceResult<{ entry: WorkspaceFileEntry; replacements: number }>
> {
  return withWorkspaceMutation(sessionId, async () => {
    const resolved = resolveWorkspaceUrl(sessionId, path);
    if (!resolved.ok) return resolved;
    if (!isTextWorkspaceFile(resolved.value.path)) {
      return workspaceFailure(
        "WORKSPACE_READ_FAILED",
        `"${resolved.value.path}" is not a text file and cannot be patched.`,
      );
    }
    if (patches.length < 1 || patches.length > 50) {
      return workspaceFailure(
        "WORKSPACE_WRITE_FAILED",
        "A patch must contain between 1 and 50 replacements.",
      );
    }

    const entries = await listEntries(sessionId);
    const existing = entries.find(
      (entry) => entry.path === resolved.value.path,
    );
    if (!existing) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }
    const revision = checkExpectedRevision(
      resolved.value.path,
      existing,
      expectedRevision,
    );
    if (!revision.ok) return revision;

    const full = await readTextFromOPFS(resolved.value.url);
    if (full === null) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }
    let content = full;
    let replacements = 0;
    for (const patch of patches) {
      if (!patch.oldString) {
        return workspaceFailure(
          "WORKSPACE_WRITE_FAILED",
          "Every patch oldString must be non-empty.",
        );
      }
      const edited = applyWorkspaceEdit(
        content,
        patch.oldString,
        patch.newString,
        patch.replaceAll === true,
      );
      if (!edited.ok) return edited;
      content = edited.value.content;
      replacements += edited.value.replacements;
    }

    const written = await commitWrite(
      sessionId,
      resolved.value.path,
      new Blob([content], { type: existing.mimeType }),
      (url) => writeToOPFS(url, content),
      entries,
      "agent",
    );
    if (!written.ok) return written;
    return { ok: true, value: { entry: written.value, replacements } };
  });
}

export async function deleteWorkspaceFile(
  sessionId: string,
  path: unknown,
  expectedRevision?: string,
): Promise<WorkspaceResult<{ path: string }>> {
  return withWorkspaceMutation(sessionId, async () => {
    const resolved = resolveWorkspaceUrl(sessionId, path);
    if (!resolved.ok) return resolved;

    const entries = await listEntries(sessionId);
    const existing = entries.find(
      (entry) => entry.path === resolved.value.path,
    );
    if (!existing) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${resolved.value.path}" does not exist in the workspace.`,
      );
    }
    const revision = checkExpectedRevision(
      resolved.value.path,
      existing,
      expectedRevision,
    );
    if (!revision.ok) return revision;

    try {
      await removeWorkspaceManifestFile(sessionId, resolved.value.path);
      await deleteFromOPFS(resolved.value.url);
    } catch (error) {
      await invalidateWorkspaceManifest(sessionId).catch(() => undefined);
      return workspaceFailure(
        "WORKSPACE_WRITE_FAILED",
        error instanceof Error ? error.message : "Failed to delete the file.",
      );
    }
    return { ok: true, value: { path: resolved.value.path } };
  });
}

export async function getWorkspaceFileEntry(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const entries = await listEntries(sessionId);
  const entry = entries.find(
    (candidate) => candidate.path === resolved.value.path,
  );
  if (!entry) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      `"${resolved.value.path}" does not exist in the workspace.`,
    );
  }

  return { ok: true, value: entry };
}

/**
 * Moves a file within the workspace. Works for binary files too, and is
 * quota-neutral, so only the destination needs a size check.
 */
export async function moveWorkspaceFile(
  sessionId: string,
  from: unknown,
  to: unknown,
  overwrite = false,
  expectedRevision?: string,
): Promise<WorkspaceResult<{ from: string; entry: WorkspaceFileEntry }>> {
  return withWorkspaceMutation(sessionId, async () => {
    const source = resolveWorkspaceUrl(sessionId, from);
    if (!source.ok) return source;
    const target = resolveWorkspaceUrl(sessionId, to);
    if (!target.ok) return target;

    if (source.value.path === target.value.path) {
      return workspaceFailure(
        "WORKSPACE_INVALID_PATH",
        "The source and destination paths are the same.",
      );
    }

    const allEntries = await listEntries(sessionId);
    const sourceEntry = allEntries.find(
      (entry) => entry.path === source.value.path,
    );
    if (!sourceEntry) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${source.value.path}" does not exist in the workspace.`,
      );
    }
    const revision = checkExpectedRevision(
      source.value.path,
      sourceEntry,
      expectedRevision,
    );
    if (!revision.ok) return revision;

    const targetEntry = allEntries.find(
      (entry) => entry.path === target.value.path,
    );
    if (!overwrite && targetEntry) {
      return workspaceFailure(
        "WORKSPACE_FILE_EXISTS",
        `"${target.value.path}" already exists. Set overwrite to true to replace it.`,
      );
    }

    const blob = await resolveOPFSBlob(source.value.url);
    if (!blob) {
      return workspaceFailure(
        "WORKSPACE_FILE_NOT_FOUND",
        `"${source.value.path}" does not exist in the workspace.`,
      );
    }

    // A move is quota-neutral: exclude the source from the destination write's
    // snapshot while still accounting for an existing overwrite target.
    const entries = allEntries.filter(
      (entry) => entry.path !== source.value.path,
    );
    const written = await commitWrite(
      sessionId,
      target.value.path,
      blob,
      (url) => writeBlobToOPFS(url, blob),
      entries,
      sourceEntry.source,
    );
    // The source is only removed once the destination is safely on disk, so a
    // failed write never loses the file.
    if (!written.ok) return written;

    try {
      await deleteFromOPFS(source.value.url);
      await removeWorkspaceManifestFile(sessionId, source.value.path);
    } catch (error) {
      await invalidateWorkspaceManifest(sessionId).catch(() => undefined);
      return workspaceFailure(
        "WORKSPACE_WRITE_FAILED",
        error instanceof Error ? error.message : "Failed to finish the move.",
      );
    }
    return {
      ok: true,
      value: { from: source.value.path, entry: written.value },
    };
  });
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  text: string;
}

/**
 * Literal-substring search across workspace text files. The query is never
 * treated as a regular expression, so a model-supplied pattern cannot cause
 * catastrophic backtracking.
 */
export async function searchWorkspace(
  sessionId: string,
  query: string,
  options: { path?: string; caseSensitive?: boolean; maxResults?: number } = {},
): Promise<
  WorkspaceResult<{
    matches: WorkspaceSearchMatch[];
    filesSearched: number;
    truncated: boolean;
  }>
> {
  if (!getSessionWorkspaceRoot(sessionId)) {
    return workspaceFailure(
      "WORKSPACE_UNAVAILABLE",
      "No session workspace is available for this request.",
    );
  }
  if (typeof query !== "string" || !query) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      "A non-empty search query is required.",
    );
  }

  const listed = await listWorkspace(sessionId, options.path);
  if (!listed.ok) return listed;

  const limit = Math.min(
    Math.max(
      1,
      Math.floor(options.maxResults ?? AGENT_WORKSPACE_LIMITS.maxSearchMatches),
    ),
    AGENT_WORKSPACE_LIMITS.maxSearchMatches,
  );
  const needle = options.caseSensitive ? query : query.toLowerCase();

  const matches: WorkspaceSearchMatch[] = [];
  let filesSearched = 0;
  let charsScanned = 0;
  let truncated = listed.value.truncated;

  for (const entry of listed.value.files) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    if (!isTextWorkspaceFile(entry.path)) continue;

    const content = await readTextFromOPFS(entry.url);
    if (content === null) continue;

    filesSearched += 1;
    charsScanned += content.length;

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const haystack = options.caseSensitive ? line : line.toLowerCase();
      if (!haystack.includes(needle)) continue;

      matches.push({
        path: entry.path,
        line: index + 1,
        text: line.trim().slice(0, AGENT_WORKSPACE_LIMITS.maxSearchLineChars),
      });
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
    }

    if (charsScanned > AGENT_WORKSPACE_LIMITS.maxSearchScanChars) {
      truncated = true;
      break;
    }
  }

  return { ok: true, value: { matches, filesSearched, truncated } };
}

export async function getWorkspaceUsage(
  sessionId: string,
): Promise<WorkspaceUsage> {
  return toUsage(await listEntries(sessionId));
}

/**
 * Removes the entire workspace for a session. Used when a session is deleted.
 * Archives live in a separate root and are cleared by `deleteSessionArchives`.
 */
export async function deleteSessionWorkspace(sessionId: string): Promise<void> {
  const root = getSessionWorkspaceRoot(sessionId);
  if (!root) return;
  await withWorkspaceMutation(sessionId, () => deleteOPFSDirectory(root));
}
