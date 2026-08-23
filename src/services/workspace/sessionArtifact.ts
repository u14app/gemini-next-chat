import {
  getSessionArtifactRoot,
  getSessionWorkspaceRoot,
  getWorkspaceFileName,
  guessWorkspaceMimeType,
  workspaceFailure,
  type WorkspaceResult,
} from "@/lib/agent/workspace";
import {
  deleteOPFSDirectory,
  listOPFSDirectory,
  resolveOPFSBlob,
  statOPFSFileSize,
  writeBlobToOPFS,
} from "@/utils/opfs";

import { readWorkspaceBlob } from "./sessionWorkspace";
import { hashWorkspaceBlob } from "./workspaceManifest";

export { hashWorkspaceBlob } from "./workspaceManifest";

export interface PublishedWorkspaceArtifact {
  sourcePath: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  contentHash: string;
  revision: string;
  url: string;
}

export interface SessionArtifactEntry {
  fileName: string;
  mimeType: string;
  bytes: number;
  contentHash: string;
  revision: string;
  url: string;
}

const artifactQueues = new Map<string, Promise<void>>();

async function withArtifactLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = artifactQueues.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  artifactQueues.set(sessionId, settled);
  try {
    return await current;
  } finally {
    if (artifactQueues.get(sessionId) === settled) {
      artifactQueues.delete(sessionId);
    }
  }
}

function artifactFileSegment(fileName: string): string {
  return (
    fileName
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 100) || "artifact"
  );
}

export async function listSessionArtifacts(
  sessionId: string,
): Promise<WorkspaceResult<SessionArtifactEntry[]>> {
  const root = getSessionArtifactRoot(sessionId);
  if (!root) {
    return workspaceFailure(
      "WORKSPACE_UNAVAILABLE",
      "No session artifact store is available for this request.",
    );
  }

  try {
    const prefix = `${root}/`;
    const paths = await listOPFSDirectory(root);
    const entries = await Promise.all(
      paths.flatMap((absolutePath) => {
        const storedName = absolutePath.startsWith(prefix)
          ? absolutePath.slice(prefix.length)
          : "";
        const match = /^([a-f0-9]{8}|[a-f0-9]{64})-(.+)$/i.exec(storedName);
        if (!match || storedName.includes("/")) return [];
        const [, hash, storedFileName] = match;
        const fileName = storedFileName.replace(
          /^__restore_[a-z0-9]{1,48}_\d{6}__/i,
          "",
        );
        if (!fileName) return [];
        const url = `opfs://${absolutePath}`;
        return [
          (async (): Promise<SessionArtifactEntry | null> => {
            const bytes = await statOPFSFileSize(url);
            if (bytes === null) return null;
            const hashAlgorithm = hash.length === 64 ? "sha256" : "fnv1a";
            const contentHash = `${hashAlgorithm}:${hash.toLowerCase()}`;
            return {
              fileName,
              mimeType: guessWorkspaceMimeType(fileName),
              bytes,
              contentHash,
              revision: contentHash,
              url,
            };
          })(),
        ];
      }),
    );
    return {
      ok: true,
      value: entries
        .filter((entry): entry is SessionArtifactEntry => entry !== null)
        .sort((left, right) => left.fileName.localeCompare(right.fileName)),
    };
  } catch (error) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      error instanceof Error ? error.message : "Failed to list artifacts.",
    );
  }
}

/**
 * Copies a mutable scratch file to a content-addressed immutable URL. Publishing
 * the same bytes again reuses the existing artifact, while later scratch edits
 * cannot change cards already stored in the transcript.
 */
export async function publishWorkspaceArtifact(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<PublishedWorkspaceArtifact>> {
  const root = getSessionArtifactRoot(sessionId);
  if (!root) {
    return workspaceFailure(
      "WORKSPACE_UNAVAILABLE",
      "No session artifact store is available for this request.",
    );
  }

  return withArtifactLock(sessionId, async () => {
    const read = await readWorkspaceBlob(sessionId, path);
    if (!read.ok) return read;

    const contentHash = await hashWorkspaceBlob(read.value.blob);
    const hashSegment = contentHash.replace(/^[^:]+:/, "");
    const fileName = getWorkspaceFileName(read.value.entry.path);
    const url = `opfs://${root}/${hashSegment}-${artifactFileSegment(fileName)}`;
    const existingBytes = await statOPFSFileSize(url);
    if (existingBytes === null) {
      try {
        await writeBlobToOPFS(url, read.value.blob);
      } catch (error) {
        return workspaceFailure(
          "WORKSPACE_WRITE_FAILED",
          error instanceof Error
            ? error.message
            : "Failed to publish the workspace artifact.",
        );
      }
    } else if (existingBytes !== read.value.entry.bytes) {
      return workspaceFailure(
        "WORKSPACE_WRITE_FAILED",
        "An artifact hash collision was detected; publishing was stopped.",
      );
    }

    return {
      ok: true,
      value: {
        sourcePath: read.value.entry.path,
        fileName,
        mimeType: read.value.entry.mimeType,
        bytes: read.value.entry.bytes,
        contentHash,
        revision: contentHash,
        url,
      },
    };
  });
}

/**
 * Copies files referenced by a duplicated transcript into the new session's
 * artifact root. Legacy mutable workspace cards are published during the copy.
 * The URL map lets the caller rewrite cards before persisting the duplicate, so
 * deleting the source session is safe.
 */
export async function duplicateSessionArtifacts(
  sourceSessionId: string,
  targetSessionId: string,
  referencedUrls: Iterable<string>,
): Promise<Map<string, string>> {
  const sourceRoot = getSessionArtifactRoot(sourceSessionId);
  const targetRoot = getSessionArtifactRoot(targetSessionId);
  const sourceWorkspaceRoot = getSessionWorkspaceRoot(sourceSessionId);
  if (!sourceRoot || !targetRoot || !sourceWorkspaceRoot) {
    throw new Error("No session artifact store is available.");
  }
  if (sourceRoot === targetRoot) return new Map();

  const sourcePrefix = `opfs://${sourceRoot}/`;
  const sourceWorkspacePrefix = `opfs://${sourceWorkspaceRoot}/`;
  const urls = Array.from(new Set(referencedUrls)).filter(
    (url) =>
      url.startsWith(sourcePrefix) || url.startsWith(sourceWorkspacePrefix),
  );
  if (urls.length === 0) return new Map();

  return withArtifactLock(sourceSessionId, () =>
    withArtifactLock(targetSessionId, async () => {
      const copied = new Map<string, string>();
      try {
        for (const sourceUrl of urls) {
          const published = sourceUrl.startsWith(sourcePrefix);
          let blob: Blob;
          let targetFileName: string;
          if (published) {
            const fileName = sourceUrl.slice(sourcePrefix.length);
            if (!fileName || fileName.includes("/")) {
              throw new Error("A published artifact reference is invalid.");
            }
            const resolved = await resolveOPFSBlob(sourceUrl);
            if (!resolved) {
              throw new Error(
                `Published artifact "${fileName}" is no longer available.`,
              );
            }
            blob = resolved;
            targetFileName = fileName;
          } else {
            const sourcePath = sourceUrl.slice(sourceWorkspacePrefix.length);
            const read = await readWorkspaceBlob(sourceSessionId, sourcePath);
            if (!read.ok) {
              throw new Error(read.error.message);
            }
            blob = read.value.blob;
            const contentHash = await hashWorkspaceBlob(blob);
            const hashSegment = contentHash.replace(/^[^:]+:/, "");
            targetFileName = `${hashSegment}-${artifactFileSegment(
              read.value.entry.fileName,
            )}`;
          }

          const targetUrl = `opfs://${targetRoot}/${targetFileName}`;
          const existingBytes = await statOPFSFileSize(targetUrl);
          if (existingBytes === null) {
            await writeBlobToOPFS(targetUrl, blob);
          } else if (existingBytes !== blob.size) {
            throw new Error(
              `Published artifact "${targetFileName}" conflicts with the duplicate.`,
            );
          }
          copied.set(sourceUrl, targetUrl);
        }
        return copied;
      } catch (error) {
        await deleteOPFSDirectory(targetRoot).catch(() => undefined);
        throw error;
      }
    }),
  );
}

export async function deleteSessionArtifacts(sessionId: string): Promise<void> {
  const root = getSessionArtifactRoot(sessionId);
  if (!root) return;
  await withArtifactLock(sessionId, () => deleteOPFSDirectory(root));
}
