import {
  guessWorkspaceMimeType,
  workspaceFailure,
  type WorkspaceResult,
} from "@/lib/agent/workspace";
import type { ResearchTask } from "@/lib/research";
import {
  deleteWorkspaceFile,
  readWorkspaceBlob,
} from "@/services/workspace/sessionWorkspace";
import { hashWorkspaceBlob } from "@/services/workspace/workspaceManifest";
import {
  deleteFromOPFS,
  listOPFSDirectory,
  resolveOPFSBlob,
  statOPFSFileSize,
  writeBlobToOPFS,
} from "@/utils/opfs";

const RESEARCH_ARTIFACT_ROOT = "chat/research-artifacts";
const publishQueue = new Map<string, Promise<void>>();

async function blobsMatch(left: Blob, right: Blob): Promise<boolean> {
  if (left.size !== right.size) return false;
  const [leftBytes, rightBytes] = await Promise.all([
    left.arrayBuffer().then((value) => new Uint8Array(value)),
    right.arrayBuffer().then((value) => new Uint8Array(value)),
  ]);
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}

export interface PublishedResearchReportArtifact {
  url: string;
  contentHash: string;
  bytes: number;
  mimeType: string;
}

export interface ResolvedResearchReportArtifact {
  artifactId: string;
  markdown: string;
  bytes: number;
  mimeType: string;
}

/** Resolves an immutable report Artifact without exposing OPFS primitives. */
export async function readResearchReportArtifact(
  artifactId: string,
): Promise<ResolvedResearchReportArtifact | null> {
  const blob = await resolveOPFSBlob(artifactId);
  if (!blob) return null;
  return {
    artifactId,
    markdown: await blob.text(),
    bytes: blob.size,
    mimeType: blob.type || "text/markdown",
  };
}

async function withPublishLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = publishQueue.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  publishQueue.set(key, settled);
  try {
    return await current;
  } finally {
    if (publishQueue.get(key) === settled) publishQueue.delete(key);
  }
}

/**
 * Publishes report bytes into a global content-addressed namespace. Multiple
 * copied chats can therefore share one immutable report URL safely.
 */
export async function publishResearchReportArtifact(
  sessionId: string,
  path: string,
): Promise<WorkspaceResult<PublishedResearchReportArtifact>> {
  const read = await readWorkspaceBlob(sessionId, path);
  if (!read.ok) return read;
  const contentHash = await hashWorkspaceBlob(read.value.blob);
  const hashSegment = contentHash.replace(/^[^:]+:/, "").toLowerCase();
  const url = `opfs://${RESEARCH_ARTIFACT_ROOT}/${hashSegment}.md`;

  return withPublishLock(url, async () => {
    const existingBytes = await statOPFSFileSize(url);
    if (existingBytes === null) {
      try {
        await writeBlobToOPFS(url, read.value.blob);
      } catch (error) {
        return workspaceFailure(
          "WORKSPACE_WRITE_FAILED",
          error instanceof Error
            ? error.message
            : "Failed to publish the research report Artifact.",
        );
      }
    } else {
      const existing = await resolveOPFSBlob(url);
      if (
        existingBytes !== read.value.blob.size ||
        !existing ||
        !(await blobsMatch(existing, read.value.blob))
      ) {
        return workspaceFailure(
          "WORKSPACE_WRITE_FAILED",
          "A research report Artifact hash collision was detected.",
        );
      }
    }

    return {
      ok: true,
      value: {
        url,
        contentHash,
        bytes: read.value.blob.size,
        mimeType: guessWorkspaceMimeType(path),
      },
    };
  });
}

export async function deleteResearchReportArtifact(url: string): Promise<void> {
  if (!url.startsWith(`opfs://${RESEARCH_ARTIFACT_ROOT}/`)) return;
  await deleteFromOPFS(url);
}

/** Removes v1/orphaned Research-only files without touching chat or user data. */
export async function pruneUnreferencedResearchStorage(
  tasks: readonly ResearchTask[],
): Promise<void> {
  const retainedArtifacts = new Set(
    tasks.flatMap((task) =>
      task.reportVersions.map((report) => report.artifactId),
    ),
  );
  const artifactPaths = await listOPFSDirectory(RESEARCH_ARTIFACT_ROOT);
  await Promise.all(
    artifactPaths
      .map((path) => `opfs://${path}`)
      .filter((url) => !retainedArtifacts.has(url))
      .map((url) => deleteResearchReportArtifact(url)),
  );

  const retainedCheckpoints = new Set(
    tasks.flatMap((task) => {
      const path = task.checkpoint?.historyPath;
      return path
        ? [`chat/workspace/${task.sessionId}/${path.replace(/^\/+/, "")}`]
        : [];
    }),
  );
  const workspacePaths = await listOPFSDirectory("chat/workspace");
  const orphanedCheckpoints = workspacePaths.filter(
    (path) =>
      /\/research\/checkpoints\//.test(path) && !retainedCheckpoints.has(path),
  );
  await Promise.all(
    orphanedCheckpoints.map(async (path) => {
      const match = /^chat\/workspace\/([^/]+)\/(.+)$/.exec(path);
      if (!match) return;
      await deleteWorkspaceFile(match[1], match[2]);
    }),
  );
}
