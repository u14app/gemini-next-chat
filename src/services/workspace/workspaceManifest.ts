import { v7 as uuidv7 } from "uuid";

import { getSessionWorkspaceRoot } from "@/lib/agent/workspace";
import {
  deleteFromOPFS,
  readTextFromOPFS,
  resolveOPFSBlob,
  writeToOPFS,
} from "@/utils/opfs";

export const WORKSPACE_MANIFEST_VERSION = 1 as const;
export const WORKSPACE_MANIFEST_FILE_NAME = ".workspace-manifest.v1.json";

export type WorkspaceFileSource = "agent" | "attachment" | "legacy";

export interface WorkspaceManifestFile {
  contentHash: string;
  revision: string;
  updatedAt: number;
  source: WorkspaceFileSource;
  bytes: number;
}

interface WorkspaceManifest {
  version: typeof WORKSPACE_MANIFEST_VERSION;
  files: Record<string, WorkspaceManifestFile>;
}

export interface WorkspacePhysicalFile {
  path: string;
  url: string;
  bytes: number;
}

const manifestQueues = new Map<string, Promise<void>>();

const createManifestFiles = (): Record<string, WorkspaceManifestFile> =>
  Object.create(null) as Record<string, WorkspaceManifestFile>;

function getManifestUrl(sessionId: string): string | null {
  const root = getSessionWorkspaceRoot(sessionId);
  return root ? `opfs://${root}/${WORKSPACE_MANIFEST_FILE_NAME}` : null;
}

export function isWorkspaceManifestPath(path: string): boolean {
  return path === WORKSPACE_MANIFEST_FILE_NAME;
}

function isManifestFile(value: unknown): value is WorkspaceManifestFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceManifestFile>;
  return (
    typeof candidate.contentHash === "string" &&
    !!candidate.contentHash &&
    typeof candidate.revision === "string" &&
    !!candidate.revision &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt) &&
    (candidate.source === "agent" ||
      candidate.source === "attachment" ||
      candidate.source === "legacy") &&
    typeof candidate.bytes === "number" &&
    Number.isFinite(candidate.bytes) &&
    candidate.bytes >= 0
  );
}

function parseManifest(raw: string | null): WorkspaceManifest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceManifest>;
    if (
      parsed.version !== WORKSPACE_MANIFEST_VERSION ||
      !parsed.files ||
      typeof parsed.files !== "object" ||
      Array.isArray(parsed.files)
    ) {
      return null;
    }

    const files = createManifestFiles();
    for (const [path, value] of Object.entries(parsed.files)) {
      if (!path || !isManifestFile(value)) return null;
      files[path] = value;
    }
    return { version: WORKSPACE_MANIFEST_VERSION, files };
  } catch {
    return null;
  }
}

async function readManifest(sessionId: string): Promise<WorkspaceManifest> {
  const url = getManifestUrl(sessionId);
  if (!url) {
    return {
      version: WORKSPACE_MANIFEST_VERSION,
      files: createManifestFiles(),
    };
  }
  const raw = await readTextFromOPFS(url);
  return (
    parseManifest(typeof raw === "string" ? raw : null) ?? {
      version: WORKSPACE_MANIFEST_VERSION,
      files: createManifestFiles(),
    }
  );
}

async function writeManifest(
  sessionId: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  const url = getManifestUrl(sessionId);
  if (!url) throw new Error("No session workspace is available.");

  const files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeToOPFS(
    url,
    JSON.stringify({ version: WORKSPACE_MANIFEST_VERSION, files }),
  );
}

async function withManifestLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = manifestQueues.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  manifestQueues.set(sessionId, settled);
  try {
    return await current;
  } finally {
    if (manifestQueues.get(sessionId) === settled) {
      manifestQueues.delete(sessionId);
    }
  }
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function hashWorkspaceBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!globalThis.crypto?.subtle) return `fnv1a:${fallbackHash(bytes)}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${toHex(digest)}`;
}

async function metadataForLegacyFile(
  file: WorkspacePhysicalFile,
): Promise<WorkspaceManifestFile> {
  const blob = await resolveOPFSBlob(file.url);
  const contentHash = blob
    ? await hashWorkspaceBlob(blob)
    : `unavailable:${file.bytes}`;
  return {
    contentHash,
    revision: uuidv7(),
    updatedAt: Date.now(),
    source: "legacy",
    bytes: file.bytes,
  };
}

export async function reconcileWorkspaceManifest(
  sessionId: string,
  physicalFiles: WorkspacePhysicalFile[],
): Promise<Map<string, WorkspaceManifestFile>> {
  return withManifestLock(sessionId, async () => {
    const manifest = await readManifest(sessionId);
    const nextFiles = createManifestFiles();
    let changed = Object.keys(manifest.files).length !== physicalFiles.length;

    for (const file of physicalFiles) {
      const current = manifest.files[file.path];
      if (
        current &&
        current.bytes === file.bytes &&
        !current.contentHash.startsWith("unavailable:")
      ) {
        nextFiles[file.path] = current;
        continue;
      }

      nextFiles[file.path] = await metadataForLegacyFile(file);
      changed = true;
    }

    if (changed) {
      await writeManifest(sessionId, {
        version: WORKSPACE_MANIFEST_VERSION,
        files: nextFiles,
      });
    }
    return new Map(Object.entries(nextFiles));
  });
}

export async function recordWorkspaceManifestFile(
  sessionId: string,
  file: WorkspacePhysicalFile,
  blob: Blob,
  source: WorkspaceFileSource,
): Promise<WorkspaceManifestFile> {
  return withManifestLock(sessionId, async () => {
    const manifest = await readManifest(sessionId);
    const metadata: WorkspaceManifestFile = {
      contentHash: await hashWorkspaceBlob(blob),
      revision: uuidv7(),
      updatedAt: Date.now(),
      source,
      bytes: file.bytes,
    };
    manifest.files[file.path] = metadata;
    await writeManifest(sessionId, manifest);
    return metadata;
  });
}

export async function removeWorkspaceManifestFile(
  sessionId: string,
  path: string,
): Promise<void> {
  await withManifestLock(sessionId, async () => {
    const manifest = await readManifest(sessionId);
    if (!(path in manifest.files)) return;
    delete manifest.files[path];
    await writeManifest(sessionId, manifest);
  });
}

export async function invalidateWorkspaceManifest(
  sessionId: string,
): Promise<void> {
  const url = getManifestUrl(sessionId);
  if (url) await deleteFromOPFS(url);
}
