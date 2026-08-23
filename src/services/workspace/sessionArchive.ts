import { zipSync } from "fflate";
import { v7 as uuidv7 } from "uuid";

import { AGENT_ARCHIVE_LIMITS } from "@/config/limits";
import {
  getSessionArchiveRoot,
  getWorkspaceFileName,
  toArchiveFileName,
  workspaceFailure,
  type WorkspaceResult,
} from "@/lib/agent/workspace";
import {
  deleteFromOPFS,
  deleteOPFSDirectory,
  listOPFSDirectory,
  statOPFSFileSize,
  writeBlobToOPFS,
} from "@/utils/opfs";

import { readWorkspaceBlob } from "./sessionWorkspace";

/**
 * Zip archives of workspace files. Archives are written to
 * `opfs://chat/archives/<sessionId>/`, deliberately outside the workspace tree,
 * so they are invisible to `list_workspace_files` and exempt from the workspace
 * quota. They carry their own caps from `AGENT_ARCHIVE_LIMITS` instead.
 */

export interface ArchiveEntry {
  fileName: string;
  url: string;
  bytes: number;
  entryCount: number;
}

const DEFAULT_ARCHIVE_NAME = "workspace.zip";

/**
 * Keeps only the most recent archives, so a long conversation cannot fill
 * storage with superseded bundles.
 */
async function evictOldArchives(root: string, keepUrl: string): Promise<void> {
  const paths = await listOPFSDirectory(root);
  if (paths.length <= AGENT_ARCHIVE_LIMITS.maxArchivesPerSession) return;

  const sized = await Promise.all(
    paths.map(async (path) => ({
      url: `opfs://${path}`,
      bytes: (await statOPFSFileSize(`opfs://${path}`)) ?? 0,
    })),
  );

  // OPFS exposes no mtime here, so eviction falls back to path order, which is
  // stable and keeps the archive just written.
  const removable = sized
    .filter((entry) => entry.url !== keepUrl)
    .sort((a, b) => a.url.localeCompare(b.url));
  const excess = paths.length - AGENT_ARCHIVE_LIMITS.maxArchivesPerSession;

  for (const entry of removable.slice(0, excess)) {
    await deleteFromOPFS(entry.url);
  }
}

export async function createSessionArchive(
  sessionId: string,
  paths: readonly unknown[],
  archiveName?: unknown,
): Promise<WorkspaceResult<ArchiveEntry>> {
  const root = getSessionArchiveRoot(sessionId);
  if (!root) {
    return workspaceFailure(
      "WORKSPACE_UNAVAILABLE",
      "No session workspace is available for this request.",
    );
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      "Provide at least one workspace file path to archive.",
    );
  }
  if (paths.length > AGENT_ARCHIVE_LIMITS.maxEntries) {
    return workspaceFailure(
      "WORKSPACE_FILE_TOO_LARGE",
      `An archive may contain at most ${AGENT_ARCHIVE_LIMITS.maxEntries} files.`,
    );
  }

  // Each path still goes through resolveWorkspaceUrl inside readWorkspaceBlob,
  // so traversal is refused here exactly as it is for every other tool.
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  for (const path of paths) {
    const read = await readWorkspaceBlob(sessionId, path);
    if (!read.ok) return read;

    totalBytes += read.value.entry.bytes;
    if (totalBytes > AGENT_ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
      return workspaceFailure(
        "WORKSPACE_FILE_TOO_LARGE",
        `The selected files exceed the ${AGENT_ARCHIVE_LIMITS.maxTotalUncompressedBytes}-byte archive input limit.`,
      );
    }

    files[read.value.entry.path] = new Uint8Array(
      await read.value.blob.arrayBuffer(),
    );
  }

  const entryCount = Object.keys(files).length;
  if (entryCount === 0) {
    return workspaceFailure(
      "WORKSPACE_FILE_NOT_FOUND",
      "None of the requested files exist in the workspace.",
    );
  }

  let zipped: Uint8Array;
  try {
    zipped = zipSync(files, { level: 6 });
  } catch (error) {
    return workspaceFailure(
      "WORKSPACE_WRITE_FAILED",
      error instanceof Error ? error.message : "Failed to build the archive.",
    );
  }

  if (zipped.byteLength > AGENT_ARCHIVE_LIMITS.maxArchiveBytes) {
    return workspaceFailure(
      "WORKSPACE_FILE_TOO_LARGE",
      `The archive is larger than the ${AGENT_ARCHIVE_LIMITS.maxArchiveBytes}-byte limit. Archive fewer files.`,
    );
  }

  const fileName = toArchiveFileName(archiveName) ?? DEFAULT_ARCHIVE_NAME;
  // Keep the user-facing download name stable while writing every archive to
  // an immutable URL. Reusing a display name must never mutate an older card.
  const url = `opfs://${root}/${uuidv7()}.zip`;

  try {
    await writeBlobToOPFS(url, zipped);
  } catch (error) {
    return workspaceFailure(
      "WORKSPACE_WRITE_FAILED",
      error instanceof Error ? error.message : "Failed to save the archive.",
    );
  }

  await evictOldArchives(root, url);

  return {
    ok: true,
    value: {
      fileName: getWorkspaceFileName(fileName),
      url,
      bytes: zipped.byteLength,
      entryCount,
    },
  };
}

/** Removes every archive for a session. Used when a session is deleted. */
export async function deleteSessionArchives(sessionId: string): Promise<void> {
  const root = getSessionArchiveRoot(sessionId);
  if (!root) return;
  await deleteOPFSDirectory(root);
}
