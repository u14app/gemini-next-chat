import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import {
  applyWorkspaceEdit,
  getSessionWorkspaceRoot,
  getWorkspaceFileName,
  getWorkspaceTextBytes,
  guessWorkspaceMimeType,
  isTextWorkspaceFile,
  resolveWorkspaceUrl,
  sliceWorkspaceLines,
  toWorkspaceRelativePath,
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
}

export interface WorkspaceUsage {
  fileCount: number;
  totalBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export type WorkspaceWriteMode = "create" | "overwrite" | "append";

async function listEntries(sessionId: string): Promise<WorkspaceFileEntry[]> {
  const root = getSessionWorkspaceRoot(sessionId);
  if (!root) return [];

  const paths = await listOPFSDirectory(root);
  const entries = await Promise.all(
    paths.map(async (absolutePath) => {
      const path = toWorkspaceRelativePath(sessionId, absolutePath);
      if (!path) return null;
      const url = `opfs://${absolutePath}`;
      return {
        path,
        url,
        fileName: getWorkspaceFileName(path),
        mimeType: guessWorkspaceMimeType(path),
        bytes: (await statOPFSFileSize(url)) ?? 0,
      } satisfies WorkspaceFileEntry;
    }),
  );

  return entries
    .filter((entry): entry is WorkspaceFileEntry => entry !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function toUsage(entries: WorkspaceFileEntry[]): WorkspaceUsage {
  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    maxFiles: AGENT_WORKSPACE_LIMITS.maxFiles,
    maxTotalBytes: AGENT_WORKSPACE_LIMITS.maxTotalBytes,
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
    : entries;

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
      path: resolved.value.path,
      mimeType: guessWorkspaceMimeType(resolved.value.path),
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

function toEntry(path: string, url: string, bytes: number): WorkspaceFileEntry {
  return {
    path,
    url,
    fileName: getWorkspaceFileName(path),
    mimeType: guessWorkspaceMimeType(path),
    bytes,
  };
}

/**
 * Shared quota-then-write sequence for both the text and binary writers, so
 * quota accounting lives in exactly one place.
 */
async function commitWrite(
  sessionId: string,
  path: unknown,
  bytes: number,
  write: (url: string) => Promise<void>,
  entries?: WorkspaceFileEntry[],
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const known = entries ?? (await listEntries(sessionId));
  const quota = checkQuota(known, resolved.value.path, bytes);
  if (!quota.ok) return quota;

  try {
    await write(resolved.value.url);
  } catch (error) {
    return workspaceFailure(
      "WORKSPACE_WRITE_FAILED",
      error instanceof Error ? error.message : "Failed to write the file.",
    );
  }

  return {
    ok: true,
    value: toEntry(resolved.value.path, resolved.value.url, bytes),
  };
}

export async function writeWorkspaceText(
  sessionId: string,
  path: unknown,
  content: string,
  mode: WorkspaceWriteMode = "overwrite",
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const entries = await listEntries(sessionId);
  const existing = entries.find((entry) => entry.path === resolved.value.path);

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

  return commitWrite(
    sessionId,
    resolved.value.path,
    getWorkspaceTextBytes(nextContent),
    (url) => writeToOPFS(url, nextContent),
    entries,
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
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  return commitWrite(sessionId, path, content.size, (url) =>
    writeBlobToOPFS(url, content),
  );
}

/** Reads any workspace file as a Blob, including binary ones. */
export async function readWorkspaceBlob(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<{ entry: WorkspaceFileEntry; blob: Blob }>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const blob = await resolveOPFSBlob(resolved.value.url);
  if (!blob) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      `"${resolved.value.path}" does not exist in the workspace.`,
    );
  }

  return {
    ok: true,
    value: {
      entry: toEntry(resolved.value.path, resolved.value.url, blob.size),
      blob,
    },
  };
}

export async function editWorkspaceFile(
  sessionId: string,
  path: unknown,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<
  WorkspaceResult<{ entry: WorkspaceFileEntry; replacements: number }>
> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  if (!isTextWorkspaceFile(resolved.value.path)) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      `"${resolved.value.path}" is not a text file and cannot be edited.`,
    );
  }

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

  const written = await writeWorkspaceText(
    sessionId,
    resolved.value.path,
    edited.value.content,
    "overwrite",
  );
  if (!written.ok) return written;

  return {
    ok: true,
    value: { entry: written.value, replacements: edited.value.replacements },
  };
}

export async function deleteWorkspaceFile(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<{ path: string }>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const bytes = await statOPFSFileSize(resolved.value.url);
  if (bytes === null) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      `"${resolved.value.path}" does not exist in the workspace.`,
    );
  }

  await deleteFromOPFS(resolved.value.url);
  return { ok: true, value: { path: resolved.value.path } };
}

export async function getWorkspaceFileEntry(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<WorkspaceFileEntry>> {
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok) return resolved;

  const bytes = await statOPFSFileSize(resolved.value.url);
  if (bytes === null) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      `"${resolved.value.path}" does not exist in the workspace.`,
    );
  }

  return {
    ok: true,
    value: toEntry(resolved.value.path, resolved.value.url, bytes),
  };
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
): Promise<WorkspaceResult<{ from: string; entry: WorkspaceFileEntry }>> {
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

  const read = await readWorkspaceBlob(sessionId, source.value.path);
  if (!read.ok) return read;

  if (!overwrite && (await statOPFSFileSize(target.value.url)) !== null) {
    return workspaceFailure(
      "WORKSPACE_FILE_EXISTS",
      `"${target.value.path}" already exists. Set overwrite to true to replace it.`,
    );
  }

  // A move is quota-neutral: exclude the source from the destination write's
  // snapshot while still accounting for an existing overwrite target.
  const entries = (await listEntries(sessionId)).filter(
    (entry) => entry.path !== source.value.path,
  );
  const written = await commitWrite(
    sessionId,
    target.value.path,
    read.value.blob.size,
    (url) => writeBlobToOPFS(url, read.value.blob),
    entries,
  );
  // The source is only removed once the destination is safely on disk, so a
  // failed write never loses the file.
  if (!written.ok) return written;

  await deleteFromOPFS(source.value.url);
  return { ok: true, value: { from: source.value.path, entry: written.value } };
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
  await deleteOPFSDirectory(root);
}
