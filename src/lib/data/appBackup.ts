import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough } from "fflate";
import { v7 as uuidv7 } from "uuid";
import {
  APP_EXPORT_EXCLUSIONS,
  APP_EXPORT_VERSION,
  collectReferencedOpfsUrls,
  createBrowserAppExportPayload,
  isAppExportPayload,
  isAppOwnedOpfsUrl,
  isLegacyAppExportPayload,
  scrubAppExportValue,
  type AppExportPayload,
} from "./appExport";
import {
  APP_RESTORE_JOURNAL_KEY,
  APP_RESTORE_CREDENTIAL_NOTICE_KEY,
  APP_RESTORE_SNAPSHOT_KEY,
  acquireAppRestoreWriteGate,
  ensureInterruptedAppRestoreRecovery,
  releaseAppRestoreWriteGate,
  runWithAppDataSnapshotLock,
  runWithExclusiveAppDataLock,
  writeAppRestoreCredentialNotice,
  type AppRestoreDbEntry,
  type AppRestoreJournal,
  type AppRestoreSnapshot,
} from "./appRestoreJournal";
import {
  appDb,
  STORAGE_KEYS,
  STORAGE_VERSION,
} from "@/store/storage/storageConfig";
import { flushSessionMessageWrites } from "@/store/sessionMessagePersistence";
import {
  deleteFromOPFS,
  getSafeOPFSPath,
  resolveOPFSBlob,
  writeBlobToOPFS,
} from "@/utils/opfs";
import {
  getSessionArtifactRoot,
  getSessionArchiveRoot,
  getSessionWorkspaceRoot,
  normalizeWorkspacePath,
} from "@/lib/agent/workspace";
import { recoverResearchTask, type ResearchTask } from "@/lib/research";
import {
  getResearchTaskRepository,
  parseResearchTaskValue,
} from "@/services/research";

const BACKUP_FORMAT = "neo-chat-backup";
const BACKUP_MIME_TYPE = "application/zip";
const SESSION_MESSAGES_PREFIX = "session_messages_";
const MANIFEST_PATH = "manifest.json";
const DATA_PATH = "data.json";
const MISSING_FILE_ERROR =
  "This backup did not include the referenced local file.";

export const APP_BACKUP_LIMITS = {
  maxArchiveBytes: 128 * 1024 * 1024,
  maxJsonBytes: 32 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxCompressionRatio: 200,
  maxPathChars: 1_024,
} as const;

export type AppBackupProgressPhase =
  "reading" | "hashing" | "packing" | "validating" | "staging" | "applying";

export interface AppBackupProgress {
  phase: AppBackupProgressPhase;
  completed: number;
  total: number;
}

export interface AppBackupOperationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AppBackupProgress) => void;
}

function reportProgress(
  onProgress: AppBackupOperationOptions["onProgress"],
  progress: AppBackupProgress,
): void {
  try {
    onProgress?.(progress);
  } catch {
    // A rendering callback must not change backup transaction semantics.
  }
}

export interface BackupManifestFile {
  originalUrl: string;
  archivePath: string;
  size: number;
  mimeType: string;
  sha256: string;
}

export interface BackupManifestV3 {
  format: typeof BACKUP_FORMAT;
  exportVersion: typeof APP_EXPORT_VERSION;
  storageVersion: number;
  exportedAt: string;
  dataPath: typeof DATA_PATH;
  files: BackupManifestFile[];
  missingReferences: string[];
  excluded: readonly string[];
}

export interface BrowserAppBackup {
  blob: Blob;
  fileName: string;
  manifest: BackupManifestV3;
}

export interface BrowserBackupInspection {
  kind: "zip-v3" | "legacy-json-v2";
  exportedAt: string;
  storageVersion: number;
  fileCount: number;
  totalFileBytes: number;
  missingFileCount: number;
  credentialsIncluded: false;
  skippedLegacyResearchTaskCount: number;
  incomplete: boolean;
}

export interface BrowserRestoreResult extends BrowserBackupInspection {
  restoredFileCount: number;
  requiresReload: true;
}

interface PreparedBackupFile {
  manifest: BackupManifestFile;
  blob: Blob;
}

interface ParsedBackup {
  inspection: BrowserBackupInspection;
  payload: AppExportPayload | ReturnType<typeof legacyPayloadToV3>;
  manifest?: BackupManifestV3;
  archiveEntries: Record<string, Uint8Array>;
}

interface ParsedResearchTaskBatch {
  tasks: ResearchTask[];
  skippedLegacyResearchTaskCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseResearchTaskBatch(value: unknown): ParsedResearchTaskBatch {
  if (value === undefined || value === null) {
    return { tasks: [], skippedLegacyResearchTaskCount: 0 };
  }
  if (!Array.isArray(value)) {
    return { tasks: [], skippedLegacyResearchTaskCount: 1 };
  }
  const tasks: ResearchTask[] = [];
  let skippedLegacyResearchTaskCount = 0;
  for (const item of value) {
    const task = parseResearchTaskValue(item);
    if (task) tasks.push(task);
    else skippedLegacyResearchTaskCount += 1;
  }
  return { tasks, skippedLegacyResearchTaskCount };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Backup cancelled", "AbortError");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is required to verify backups.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readBlobBytes(
  blob: Blob,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const output = new Uint8Array(blob.size);
  const reader = blob.stream().getReader();
  let offset = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > output.byteLength) {
        throw new Error("The selected backup changed while it was being read.");
      }
      output.set(value, offset);
      offset += value.byteLength;
    }
    throwIfAborted(signal);
    if (offset !== output.byteLength) {
      throw new Error("The selected backup could not be read completely.");
    }
    return output;
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function sha256Blob(blob: Blob, signal?: AbortSignal): Promise<string> {
  const digest = await sha256Bytes(await readBlobBytes(blob, signal));
  throwIfAborted(signal);
  return digest;
}

function safeArchivePath(path: string): boolean {
  if (
    !path ||
    path.length > APP_BACKUP_LIMITS.maxPathChars ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

function archiveFilePath(index: number): string {
  return `files/${String(index).padStart(6, "0")}`;
}

async function addBlobToZip(
  zip: Zip,
  path: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const entry = new ZipPassThrough(path);
  zip.add(entry);
  const reader = blob.stream().getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      entry.push(value, false);
    }
    entry.push(new Uint8Array(), true);
  } finally {
    reader.releaseLock();
  }
}

async function createZipBlob(options: {
  manifest: BackupManifestV3;
  payload: AppExportPayload;
  files: PreparedBackupFile[];
  signal?: AbortSignal;
  onProgress?: (progress: AppBackupProgress) => void;
}): Promise<Blob> {
  const { manifest, payload, files, signal, onProgress } = options;
  throwIfAborted(signal);
  const chunks: BlobPart[] = [];
  let resolveZip: (() => void) | undefined;
  let rejectZip: ((error: Error) => void) | undefined;
  const completed = new Promise<void>((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      rejectZip?.(error);
      return;
    }
    if (chunk.length > 0) chunks.push(toArrayBuffer(chunk));
    if (final) resolveZip?.();
  });

  try {
    const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
    const dataBytes = strToU8(JSON.stringify(payload));
    if (
      manifestBytes.byteLength > APP_BACKUP_LIMITS.maxJsonBytes ||
      dataBytes.byteLength > APP_BACKUP_LIMITS.maxJsonBytes
    ) {
      throw new Error("The backup metadata exceeds the JSON size limit.");
    }
    if (
      manifestBytes.byteLength +
        dataBytes.byteLength +
        files.reduce((total, file) => total + file.blob.size, 0) >
      APP_BACKUP_LIMITS.maxTotalUncompressedBytes
    ) {
      throw new Error("The backup exceeds the uncompressed size limit.");
    }
    if (files.length + 2 > APP_BACKUP_LIMITS.maxEntries) {
      throw new Error("The backup contains too many files.");
    }
    const metadataEntries = [
      [MANIFEST_PATH, manifestBytes],
      [DATA_PATH, dataBytes],
    ] as const;
    for (const [path, content] of metadataEntries) {
      const entry = new ZipPassThrough(path);
      zip.add(entry);
      entry.push(content, true);
    }
    throwIfAborted(signal);

    for (let index = 0; index < files.length; index += 1) {
      await addBlobToZip(
        zip,
        files[index].manifest.archivePath,
        files[index].blob,
        signal,
      );
      reportProgress(onProgress, {
        phase: "packing",
        completed: index + 1,
        total: files.length,
      });
    }
    throwIfAborted(signal);
    zip.end();
    await completed;
    throwIfAborted(signal);
    return new Blob(chunks, { type: BACKUP_MIME_TYPE });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

export async function createBrowserAppBackup(
  options: AppBackupOperationOptions = {},
): Promise<BrowserAppBackup> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  reportProgress(onProgress, { phase: "reading", completed: 0, total: 1 });
  await flushSessionMessageWrites();
  const captured = await runWithAppDataSnapshotLock(async () => {
    throwIfAborted(signal);
    const payload = await createBrowserAppExportPayload({
      flushMessageWrites: false,
    });
    const allReferencedUrls = [
      ...collectReferencedOpfsUrls({ data: payload.data }),
    ].sort();
    const referencedUrls = allReferencedUrls.filter(isAppOwnedOpfsUrl);
    const missingReferences = allReferencedUrls.filter(
      (url) => !isAppOwnedOpfsUrl(url),
    );
    const files: Array<{ originalUrl: string; blob: Blob }> = [];
    let totalBytes = 0;

    for (const originalUrl of referencedUrls) {
      throwIfAborted(signal);
      const blob = await resolveOPFSBlob(originalUrl);
      if (!blob) {
        missingReferences.push(originalUrl);
        continue;
      }
      if (blob.size > APP_BACKUP_LIMITS.maxEntryBytes) {
        throw new Error(
          `A referenced file is too large to back up: ${originalUrl}`,
        );
      }
      totalBytes += blob.size;
      if (totalBytes > APP_BACKUP_LIMITS.maxTotalUncompressedBytes) {
        throw new Error("The referenced files exceed the backup size limit.");
      }
      files.push({ originalUrl, blob });
    }

    return { payload, files, missingReferences };
  });
  throwIfAborted(signal);

  const prepared: PreparedBackupFile[] = [];
  for (let index = 0; index < captured.files.length; index += 1) {
    const { originalUrl, blob } = captured.files[index];
    reportProgress(onProgress, {
      phase: "hashing",
      completed: index,
      total: captured.files.length,
    });
    prepared.push({
      blob,
      manifest: {
        originalUrl,
        archivePath: archiveFilePath(prepared.length),
        size: blob.size,
        mimeType: blob.type || "application/octet-stream",
        sha256: await sha256Blob(blob, signal),
      },
    });
  }

  const manifest: BackupManifestV3 = {
    format: BACKUP_FORMAT,
    exportVersion: APP_EXPORT_VERSION,
    storageVersion: STORAGE_VERSION,
    exportedAt: captured.payload.exportedAt,
    dataPath: DATA_PATH,
    files: prepared.map((item) => item.manifest),
    missingReferences: captured.missingReferences,
    excluded: APP_EXPORT_EXCLUSIONS,
  };
  const blob = await createZipBlob({
    manifest,
    payload: captured.payload,
    files: prepared,
    signal,
    onProgress,
  });
  throwIfAborted(signal);
  if (blob.size > APP_BACKUP_LIMITS.maxArchiveBytes) {
    throw new Error("The generated backup exceeds the archive size limit.");
  }

  return {
    blob,
    manifest,
    fileName: `neo-chat-backup-${captured.payload.exportedAt.slice(0, 10)}.zip`,
  };
}

function parseJsonEntry(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength > APP_BACKUP_LIMITS.maxJsonBytes) {
    throw new Error(`${label} exceeds the JSON size limit.`);
  }
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validateManifest(value: unknown): BackupManifestV3 {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    throw new Error("This is not a neo-chat backup.");
  }
  if (
    value.exportVersion !== APP_EXPORT_VERSION ||
    typeof value.storageVersion !== "number" ||
    value.storageVersion > STORAGE_VERSION ||
    typeof value.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    value.dataPath !== DATA_PATH ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.missingReferences)
  ) {
    throw new Error("The backup manifest version is not supported.");
  }

  const files: BackupManifestFile[] = [];
  const originalUrls = new Set<string>();
  const archivePaths = new Set<string>();
  for (const rawFile of value.files) {
    if (!isRecord(rawFile)) throw new Error("The backup file list is invalid.");
    const { originalUrl, archivePath, size, mimeType, sha256 } = rawFile;
    if (
      typeof originalUrl !== "string" ||
      originalUrl.length > 4_096 ||
      !isAppOwnedOpfsUrl(originalUrl) ||
      typeof archivePath !== "string" ||
      !archivePath.startsWith("files/") ||
      !safeArchivePath(archivePath) ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > APP_BACKUP_LIMITS.maxEntryBytes ||
      typeof mimeType !== "string" ||
      mimeType.length > 200 ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      originalUrls.has(originalUrl) ||
      archivePaths.has(archivePath)
    ) {
      throw new Error("The backup file list contains an invalid entry.");
    }
    originalUrls.add(originalUrl);
    archivePaths.add(archivePath);
    files.push({ originalUrl, archivePath, size, mimeType, sha256 });
  }

  if (
    value.missingReferences.some(
      (url) =>
        typeof url !== "string" ||
        !url.startsWith("opfs://") ||
        url.length > 4_096,
    )
  ) {
    throw new Error("The backup missing-file list is invalid.");
  }
  const missingReferences = value.missingReferences as string[];
  const missingUrls = new Set<string>();
  for (const url of missingReferences) {
    if (missingUrls.has(url) || originalUrls.has(url)) {
      throw new Error("The backup missing-file list contains a duplicate.");
    }
    missingUrls.add(url);
  }
  return {
    format: BACKUP_FORMAT,
    exportVersion: APP_EXPORT_VERSION,
    storageVersion: value.storageVersion,
    exportedAt: value.exportedAt,
    dataPath: DATA_PATH,
    files,
    missingReferences,
    excluded: APP_EXPORT_EXCLUSIONS,
  };
}

function legacyPayloadToV3(
  legacy: ReturnType<typeof asLegacyPayload>,
): AppExportPayload {
  return {
    exportVersion: APP_EXPORT_VERSION,
    storageVersion: legacy.storageVersion,
    exportedAt: legacy.exportedAt,
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: {
        credentialsIncluded: false,
        excluded: APP_EXPORT_EXCLUSIONS,
      },
    },
    data: scrubAppExportValue(legacy.data) as AppExportPayload["data"],
  };
}

function asLegacyPayload(value: unknown) {
  if (!isLegacyAppExportPayload(value)) {
    throw new Error("This JSON file is not a supported legacy backup.");
  }
  if (value.storageVersion > STORAGE_VERSION) {
    throw new Error("This backup was created by a newer app version.");
  }
  if (!Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error("The legacy backup has an invalid export date.");
  }
  return value;
}

async function parseBrowserBackup(
  file: Blob,
  signal?: AbortSignal,
): Promise<ParsedBackup> {
  throwIfAborted(signal);
  if (file.size > APP_BACKUP_LIMITS.maxArchiveBytes) {
    throw new Error(
      "The selected backup exceeds the browser-safe 128 MiB archive limit.",
    );
  }
  const bytes = await readBlobBytes(file, signal);
  throwIfAborted(signal);
  const firstNonWhitespace = strFromU8(bytes.subarray(0, 64)).trimStart()[0];
  if (firstNonWhitespace === "{") {
    const legacy = asLegacyPayload(parseJsonEntry(bytes, "Legacy backup"));
    const payload = legacyPayloadToV3(legacy);
    const missing = collectReferencedOpfsUrls({ data: payload.data });
    const { skippedLegacyResearchTaskCount } = parseResearchTaskBatch(
      payload.data.research,
    );
    return {
      payload,
      archiveEntries: {},
      inspection: {
        kind: "legacy-json-v2",
        exportedAt: legacy.exportedAt,
        storageVersion: legacy.storageVersion,
        fileCount: 0,
        totalFileBytes: 0,
        missingFileCount: missing.size,
        credentialsIncluded: false,
        skippedLegacyResearchTaskCount,
        incomplete: true,
      },
    };
  }

  const seen = new Set<string>();
  let totalUncompressed = 0;
  throwIfAborted(signal);
  const archiveEntries = unzipSync(bytes, {
    filter: (entry) => {
      if (
        !safeArchivePath(entry.name) ||
        seen.has(entry.name) ||
        entry.originalSize > APP_BACKUP_LIMITS.maxEntryBytes
      ) {
        throw new Error("The backup contains an unsafe ZIP entry.");
      }
      seen.add(entry.name);
      totalUncompressed += entry.originalSize;
      if (
        totalUncompressed > APP_BACKUP_LIMITS.maxTotalUncompressedBytes ||
        seen.size > APP_BACKUP_LIMITS.maxEntries ||
        (entry.originalSize > 0 &&
          entry.originalSize / Math.max(1, entry.size) >
            APP_BACKUP_LIMITS.maxCompressionRatio)
      ) {
        throw new Error("The backup exceeds safe extraction limits.");
      }
      return true;
    },
  });
  throwIfAborted(signal);
  const manifestBytes = archiveEntries[MANIFEST_PATH];
  const dataBytes = archiveEntries[DATA_PATH];
  if (!manifestBytes || !dataBytes) {
    throw new Error("The backup is missing manifest.json or data.json.");
  }
  const manifest = validateManifest(
    parseJsonEntry(manifestBytes, "Backup manifest"),
  );
  const payloadValue = parseJsonEntry(dataBytes, "Backup data");
  if (!isAppExportPayload(payloadValue)) {
    throw new Error("The backup data version is not supported.");
  }
  if (payloadValue.storageVersion > STORAGE_VERSION) {
    throw new Error("This backup was created by a newer app version.");
  }
  if (
    payloadValue.storageVersion !== manifest.storageVersion ||
    payloadValue.exportedAt !== manifest.exportedAt
  ) {
    throw new Error("The backup manifest does not match its data.");
  }

  const payloadReferences = collectReferencedOpfsUrls({
    data: payloadValue.data,
  });
  const { skippedLegacyResearchTaskCount } = parseResearchTaskBatch(
    payloadValue.data.research,
  );
  const manifestReferences = new Set([
    ...manifest.files.map((fileEntry) => fileEntry.originalUrl),
    ...manifest.missingReferences,
  ]);
  if (
    payloadReferences.size !== manifestReferences.size ||
    [...payloadReferences].some((url) => !manifestReferences.has(url))
  ) {
    throw new Error(
      "The backup manifest does not match its local file references.",
    );
  }

  const expectedEntries = new Set([
    MANIFEST_PATH,
    DATA_PATH,
    ...manifest.files.map((item) => item.archivePath),
  ]);
  if (
    Object.keys(archiveEntries).some((path) => !expectedEntries.has(path)) ||
    expectedEntries.size !== Object.keys(archiveEntries).length
  ) {
    throw new Error("The backup contains unexpected or missing files.");
  }

  let totalFileBytes = 0;
  for (const fileEntry of manifest.files) {
    throwIfAborted(signal);
    const content = archiveEntries[fileEntry.archivePath];
    if (!content || content.byteLength !== fileEntry.size) {
      throw new Error(`Backup file size mismatch: ${fileEntry.originalUrl}`);
    }
    if ((await sha256Bytes(content)) !== fileEntry.sha256) {
      throw new Error(
        `Backup file checksum mismatch: ${fileEntry.originalUrl}`,
      );
    }
    throwIfAborted(signal);
    totalFileBytes += content.byteLength;
  }

  return {
    payload: payloadValue,
    manifest,
    archiveEntries,
    inspection: {
      kind: "zip-v3",
      exportedAt: manifest.exportedAt,
      storageVersion: manifest.storageVersion,
      fileCount: manifest.files.length,
      totalFileBytes,
      missingFileCount: manifest.missingReferences.length,
      credentialsIncluded: false,
      skippedLegacyResearchTaskCount,
      incomplete:
        manifest.missingReferences.length > 0 ||
        skippedLegacyResearchTaskCount > 0,
    },
  };
}

export async function inspectBrowserAppBackup(
  file: Blob,
): Promise<BrowserBackupInspection> {
  return (await parseBrowserBackup(file)).inspection;
}

function rewriteOpfsUrls(
  value: unknown,
  mapping: Map<string, string>,
  missingUrls: Set<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteOpfsUrls(item, mapping, missingUrls));
  }
  if (!isRecord(value)) return value;

  const isAttachment =
    typeof value.fileName === "string" && typeof value.mimeType === "string";
  const isWorkspaceFile =
    isAttachment &&
    typeof value.path === "string" &&
    typeof value.url === "string" &&
    value.url.startsWith("opfs://chat/workspace/");
  const isWorkspaceArchive =
    typeof value.fileName === "string" &&
    typeof value.entryCount === "number" &&
    typeof value.bytes === "number";
  const isKnowledgeFile =
    typeof value.name === "string" &&
    ("sourcePath" in value ||
      "contentPath" in value ||
      ("path" in value &&
        ("status" in value ||
          "uploadedAt" in value ||
          "contentKind" in value)));
  const referenceKeys = new Set<string>();
  if (isAttachment) referenceKeys.add("url");
  if (isWorkspaceArchive) referenceKeys.add("url");
  if (isKnowledgeFile) {
    referenceKeys.add("sourcePath");
    referenceKeys.add("contentPath");
    referenceKeys.add("path");
  }
  if (typeof value.artifactId === "string") {
    referenceKeys.add("artifactId");
  }

  let missingAttachmentUrl = false;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "displayCache") continue;
    if (
      referenceKeys.has(key) &&
      typeof nested === "string" &&
      nested.startsWith("opfs://")
    ) {
      const replacement = mapping.get(nested);
      if (replacement) {
        output[key] = replacement;
      } else if (missingUrls.has(nested)) {
        if (isAttachment && key === "url") missingAttachmentUrl = true;
        if (key === "artifactId") output[key] = nested;
      } else {
        output[key] = nested;
      }
      continue;
    }
    output[key] = rewriteOpfsUrls(nested, mapping, missingUrls);
  }
  if (isAttachment && missingAttachmentUrl && typeof output.data !== "string") {
    output.localFileMissing = true;
    output.localFileError = MISSING_FILE_ERROR;
  }
  if (isWorkspaceFile && typeof value.url === "string") {
    const restoredUrl = mapping.get(value.url);
    const restoredPath = restoredUrl
      ? workspaceRelativePathFromUrl(restoredUrl)
      : null;
    if (restoredPath) output.path = restoredPath;
  }
  return output;
}

async function replaceResearchTasks(
  value: unknown,
): Promise<ParsedResearchTaskBatch> {
  const repository = getResearchTaskRepository();
  const parsed = parseResearchTaskBatch(value);
  await repository.clear();
  await Promise.all(
    parsed.tasks.map((task) => repository.save(recoverResearchTask(task))),
  );
  return parsed;
}

function workspaceRelativePathFromUrl(url: string): string | null {
  const safePath = getSafeOPFSPath(url);
  if (!safePath) return null;
  const segments = safePath.split("/");
  if (
    segments.length < 4 ||
    segments[0] !== "chat" ||
    segments[1] !== "workspace"
  ) {
    return null;
  }

  const root = getSessionWorkspaceRoot(segments[2]);
  if (!root || safePath.slice(0, root.length + 1) !== `${root}/`) return null;
  const relativePath = segments.slice(3).join("/");
  const normalized = normalizeWorkspacePath(relativePath);
  return normalized.ok ? normalized.value : null;
}

function resetKnowledgeFileState(
  value: unknown,
  missingUrls: Set<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resetKnowledgeFileState(item, missingUrls));
  }
  if (!isRecord(value)) return value;

  const output = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "ragId" && key !== "ragChunkCount")
      .map(([key, nested]) => [
        key,
        resetKnowledgeFileState(nested, missingUrls),
      ]),
  );
  const isKnowledgeFile =
    typeof value.name === "string" &&
    ("sourcePath" in value ||
      "contentPath" in value ||
      ("path" in value &&
        ("status" in value ||
          "uploadedAt" in value ||
          "contentKind" in value)));
  if (!isKnowledgeFile) return output;

  output.indexStatus = "not_indexed";
  delete output.indexError;

  const contentUrl =
    typeof output.contentPath === "string"
      ? output.contentPath
      : typeof output.path === "string"
        ? output.path
        : undefined;
  const sourceUrl =
    typeof output.sourcePath === "string" ? output.sourcePath : undefined;
  if (sourceUrl && missingUrls.has(sourceUrl)) output.sourceMissing = true;
  if (contentUrl && missingUrls.has(contentUrl)) {
    output.status = "error";
    output.storageStatus = "error";
    output.indexStatus = "not_indexed";
    output.error = MISSING_FILE_ERROR;
    output.storageError = MISSING_FILE_ERROR;
    return output;
  }
  if (!contentUrl && sourceUrl && missingUrls.has(sourceUrl)) {
    output.status = "error";
    output.storageStatus = "error";
    output.indexStatus = "not_indexed";
    output.error = MISSING_FILE_ERROR;
    output.storageError = MISSING_FILE_ERROR;
    return output;
  }

  const storageWasInFlight =
    value.storageStatus === "uploading" || value.storageStatus === "parsing";
  const legacyStatusWasInFlight =
    value.status === "uploading" || value.status === "parsing";
  if (contentUrl) {
    if (
      storageWasInFlight ||
      legacyStatusWasInFlight ||
      output.storageStatus === "uploading" ||
      output.storageStatus === "parsing"
    ) {
      output.storageStatus = "saved";
      delete output.storageError;
    }
    if (
      legacyStatusWasInFlight ||
      output.status === "indexing" ||
      output.status === "indexed" ||
      (value.indexStatus === "error" && output.storageStatus !== "error")
    ) {
      output.status = "saved";
    }
    if (output.storageStatus !== "error") delete output.error;
  } else if (storageWasInFlight || legacyStatusWasInFlight) {
    const interruptedError =
      "The unfinished file processing task was not included in this backup. Retry the file to continue.";
    output.status = "error";
    output.storageStatus = "error";
    output.error = interruptedError;
    output.storageError = interruptedError;
  }
  return output;
}

function restoredOpfsUrl(
  originalUrl: string,
  transactionId: string,
  index: number,
): string {
  const safePath = getSafeOPFSPath(originalUrl);
  if (!safePath) throw new Error("Backup contains an invalid OPFS reference.");
  const segments = safePath.split("/");
  const [root] = segments;
  if (!["knowledge-base", "workspaces", "images", "chat"].includes(root)) {
    throw new Error("Backup contains an unsupported OPFS reference.");
  }

  if (root === "chat" && segments[1] === "workspace") {
    const workspaceRoot = getSessionWorkspaceRoot(segments[2] ?? "");
    const originalName = segments.at(-1) ?? "";
    const normalizedName = normalizeWorkspacePath(originalName);
    if (!workspaceRoot || segments.length < 4 || !normalizedName.ok) {
      throw new Error("Backup contains an invalid workspace reference.");
    }
    return `opfs://${workspaceRoot}/restored-${transactionId}/${String(index).padStart(6, "0")}/${normalizedName.value}`;
  }

  if (root === "chat" && segments[1] === "archives") {
    const archiveRoot = getSessionArchiveRoot(segments[2] ?? "");
    if (!archiveRoot || segments.length !== 4) {
      throw new Error("Backup contains an invalid archive reference.");
    }
    // Retention sorts physical archive names as UUIDv7 creation order. Restore
    // into that same namespace so later cleanup remains chronological.
    return `opfs://${archiveRoot}/${uuidv7()}.zip`;
  }

  if (root === "chat" && segments[1] === "research-artifacts") {
    const storedName = segments[2] ?? "";
    if (
      segments.length !== 3 ||
      !/^[a-f0-9]{8,64}(?:-__restore_[a-z0-9_]+__)?\.md$/i.test(storedName)
    ) {
      throw new Error(
        "Backup contains an invalid research Artifact reference.",
      );
    }
    const contentHash = storedName.replace(/\.md$/i, "").split("-")[0];
    return `opfs://chat/research-artifacts/${contentHash.toLowerCase()}-__restore_${transactionId}_${String(index).padStart(6, "0")}__.md`;
  }

  if (root === "chat" && segments[1] === "artifacts") {
    const artifactRoot = getSessionArtifactRoot(segments[2] ?? "");
    const storedName = segments[3] ?? "";
    const match = /^([a-f0-9]{8}|[a-f0-9]{64})-(.+)$/i.exec(storedName);
    if (!artifactRoot || segments.length !== 4 || !match) {
      throw new Error("Backup contains an invalid Artifact reference.");
    }
    const [, contentHash, fileName] = match;
    return `opfs://${artifactRoot}/${contentHash.toLowerCase()}-__restore_${transactionId}_${String(index).padStart(6, "0")}__${fileName}`;
  }

  const originalName = safePath.split("/").pop() || "";
  const extension = originalName.match(/\.[a-z0-9]{1,16}$/i)?.[0] || "";
  return `opfs://${root}/restored-${transactionId}/${String(index).padStart(6, "0")}${extension}`;
}

function createTransactionId(): string {
  const id =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return id.replace(/[^a-z0-9]/gi, "").slice(0, 48);
}

async function preflightStorage(requiredBytes: number): Promise<void> {
  const estimate = await globalThis.navigator?.storage?.estimate?.();
  if (!estimate?.quota) return;
  const available = estimate.quota - (estimate.usage || 0);
  if (requiredBytes > available) {
    throw new Error(
      "There is not enough browser storage to restore this backup.",
    );
  }
}

function validSessionId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,200}$/.test(value);
}

function serializePersistedState(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readSnapshot(options: {
  transactionId: string;
  targetDbKeys: string[];
  stagedOpfsUrls: string[];
  additionalPreviousOpfsUrls?: string[];
}): Promise<AppRestoreSnapshot> {
  const currentKeys = await appDb.keys();
  const currentManagedKeys = currentKeys.filter(
    (key) =>
      Object.values(STORAGE_KEYS).includes(
        key as (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS],
      ) || key.startsWith(SESSION_MESSAGES_PREFIX),
  );
  const managedDbKeys = [
    ...new Set([...currentManagedKeys, ...options.targetDbKeys]),
  ];
  const dbEntries: AppRestoreDbEntry[] = [];
  for (const key of currentManagedKeys) {
    const value = await appDb.getItem<unknown>(key);
    dbEntries.push({
      key,
      exists: value !== null,
      ...(value !== null ? { value } : {}),
    });
  }
  const coreSettings = window.localStorage.getItem(STORAGE_KEYS.CORE_SETTINGS);
  const credentialNotice = window.localStorage.getItem(
    APP_RESTORE_CREDENTIAL_NOTICE_KEY,
  );
  const previousOpfsUrls = [
    ...collectReferencedOpfsUrls({
      data: [
        parseStoredValue(coreSettings),
        ...dbEntries.map((entry) => parseStoredValue(entry.value)),
      ],
    }),
    ...(options.additionalPreviousOpfsUrls || []),
  ].filter(isAppOwnedOpfsUrl);

  return {
    version: 1,
    transactionId: options.transactionId,
    managedDbKeys,
    dbEntries,
    localStorageEntries: [
      {
        key: STORAGE_KEYS.CORE_SETTINGS,
        exists: coreSettings !== null,
        ...(coreSettings !== null ? { value: coreSettings } : {}),
      },
      {
        key: APP_RESTORE_CREDENTIAL_NOTICE_KEY,
        exists: credentialNotice !== null,
        ...(credentialNotice !== null ? { value: credentialNotice } : {}),
      },
    ],
    stagedOpfsUrls: options.stagedOpfsUrls,
    previousOpfsUrls,
  };
}

async function applyRestoredData(
  data: AppExportPayload["data"],
  snapshot: AppRestoreSnapshot,
): Promise<void> {
  const dbValues = new Map<string, unknown>([
    [STORAGE_KEYS.SETTINGS, data.settings],
    [STORAGE_KEYS.CHAT, data.chat],
    [STORAGE_KEYS.KNOWLEDGE, data.knowledge],
    [STORAGE_KEYS.MEMORY, data.memory],
  ]);
  for (const key of snapshot.managedDbKeys) await appDb.removeItem(key);
  for (const [key, value] of dbValues) {
    const serialized = serializePersistedState(value);
    if (serialized !== undefined) await appDb.setItem(key, serialized);
  }
  for (const [sessionId, tree] of Object.entries(data.sessionMessages)) {
    if (!validSessionId(sessionId)) {
      throw new Error("The backup contains an invalid session identifier.");
    }
    await appDb.setItem(`${SESSION_MESSAGES_PREFIX}${sessionId}`, tree);
  }

  const coreSettings = serializePersistedState(data.coreSettings);
  if (coreSettings === undefined) {
    window.localStorage.removeItem(STORAGE_KEYS.CORE_SETTINGS);
  } else {
    window.localStorage.setItem(STORAGE_KEYS.CORE_SETTINGS, coreSettings);
  }
}

export async function restoreBrowserAppBackup(
  file: Blob,
  options: AppBackupOperationOptions = {},
): Promise<BrowserRestoreResult> {
  if (typeof window === "undefined") {
    throw new Error("Backups can only be restored in a browser.");
  }
  const { signal, onProgress } = options;
  await ensureInterruptedAppRestoreRecovery({
    db: appDb,
    localStorageRef: window.localStorage,
    deleteOpfsUrl: deleteFromOPFS,
  });
  throwIfAborted(signal);
  reportProgress(onProgress, {
    phase: "validating",
    completed: 0,
    total: 1,
  });
  const parsed = await parseBrowserBackup(file, signal);
  throwIfAborted(signal);
  const dataBytes = strToU8(JSON.stringify(parsed.payload)).byteLength;

  // Drain the current queue before requesting the exclusive lock. Waiting on
  // this dynamically growing queue from inside the lock can deadlock with a
  // later shared write that Web Locks has queued behind the restore.
  await flushSessionMessageWrites();

  return runWithExclusiveAppDataLock(async () => {
    await ensureInterruptedAppRestoreRecovery({
      db: appDb,
      localStorageRef: window.localStorage,
      deleteOpfsUrl: deleteFromOPFS,
      exclusiveLockHeld: true,
    });
    throwIfAborted(signal);
    const transactionId = createTransactionId();
    const files = parsed.manifest?.files || [];
    const stagedUrls = files.map((manifestFile, index) =>
      restoredOpfsUrl(manifestFile.originalUrl, transactionId, index),
    );
    const mapping = new Map<string, string>();
    files.forEach((manifestFile, index) => {
      mapping.set(manifestFile.originalUrl, stagedUrls[index]);
    });
    const scrubbedData = scrubAppExportValue(
      parsed.payload.data,
    ) as AppExportPayload["data"];
    const missingUrls = new Set(
      parsed.manifest
        ? parsed.manifest.missingReferences
        : [...collectReferencedOpfsUrls({ data: scrubbedData })],
    );
    const preparedData = {
      ...scrubbedData,
      knowledge: resetKnowledgeFileState(scrubbedData.knowledge, missingUrls),
    } as AppExportPayload["data"];
    const rewrittenData = rewriteOpfsUrls(
      preparedData,
      mapping,
      missingUrls,
    ) as AppExportPayload["data"];
    const sessionIds = Object.keys(rewrittenData.sessionMessages);
    if (sessionIds.some((id) => !validSessionId(id))) {
      throw new Error("The backup contains an invalid session identifier.");
    }
    const targetDbKeys = [
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.CHAT,
      STORAGE_KEYS.KNOWLEDGE,
      STORAGE_KEYS.MEMORY,
      ...sessionIds.map((id) => `${SESSION_MESSAGES_PREFIX}${id}`),
    ];
    let journalWritten = false;
    let writeGateAcquired = false;
    let snapshotWrittenByThisTransaction = false;
    const previousResearchTasks = await getResearchTaskRepository().list();
    const previousResearchArtifactUrls = Array.from(
      new Set(
        previousResearchTasks.flatMap((task) =>
          task.reportVersions.map((report) => report.artifactId),
        ),
      ),
    );

    try {
      acquireAppRestoreWriteGate(window.localStorage, transactionId);
      writeGateAcquired = true;
      const snapshot = await readSnapshot({
        transactionId,
        targetDbKeys,
        stagedOpfsUrls: stagedUrls,
        additionalPreviousOpfsUrls: previousResearchArtifactUrls,
      });
      const snapshotBytes = strToU8(JSON.stringify(snapshot)).byteLength;
      await preflightStorage(
        parsed.inspection.totalFileBytes +
          dataBytes +
          snapshotBytes +
          10 * 1024 * 1024,
      );
      throwIfAborted(signal);
      await appDb.setItem(APP_RESTORE_SNAPSHOT_KEY, snapshot);
      snapshotWrittenByThisTransaction = true;
      const journal: AppRestoreJournal = {
        version: 1,
        transactionId,
        phase: "staging",
      };
      window.localStorage.setItem(
        APP_RESTORE_JOURNAL_KEY,
        JSON.stringify(journal),
      );
      journalWritten = true;

      for (let index = 0; index < files.length; index += 1) {
        throwIfAborted(signal);
        const manifestFile = files[index];
        const content = parsed.archiveEntries[manifestFile.archivePath];
        await writeBlobToOPFS(
          stagedUrls[index],
          new Blob([toArrayBuffer(content)], { type: manifestFile.mimeType }),
        );
        reportProgress(onProgress, {
          phase: "staging",
          completed: index + 1,
          total: files.length,
        });
      }

      throwIfAborted(signal);
      window.localStorage.setItem(
        APP_RESTORE_JOURNAL_KEY,
        JSON.stringify({ ...journal, phase: "applying" }),
      );
      reportProgress(onProgress, {
        phase: "applying",
        completed: 0,
        total: 1,
      });
      await applyRestoredData(rewrittenData, snapshot);
      const restoredResearch = await replaceResearchTasks(
        rewrittenData.research,
      );
      writeAppRestoreCredentialNotice(
        window.localStorage,
        new Date().toISOString(),
      );
      window.localStorage.setItem(
        APP_RESTORE_JOURNAL_KEY,
        JSON.stringify({ ...journal, phase: "applied_pending_boot" }),
      );
      reportProgress(onProgress, {
        phase: "applying",
        completed: 1,
        total: 1,
      });

      return {
        ...parsed.inspection,
        skippedLegacyResearchTaskCount:
          restoredResearch.skippedLegacyResearchTaskCount,
        restoredFileCount: stagedUrls.length,
        requiresReload: true,
      };
    } catch (error) {
      await replaceResearchTasks(previousResearchTasks).catch(() => undefined);
      if (journalWritten) {
        await ensureInterruptedAppRestoreRecovery({
          db: appDb,
          localStorageRef: window.localStorage,
          deleteOpfsUrl: deleteFromOPFS,
          exclusiveLockHeld: true,
        });
      } else {
        if (snapshotWrittenByThisTransaction) {
          const currentSnapshot = await appDb.getItem<unknown>(
            APP_RESTORE_SNAPSHOT_KEY,
          );
          if (
            isRecord(currentSnapshot) &&
            currentSnapshot.transactionId === transactionId
          ) {
            await appDb.removeItem(APP_RESTORE_SNAPSHOT_KEY);
          }
        }
        for (const url of stagedUrls) {
          try {
            await deleteFromOPFS(url);
          } catch {
            // No restored state references an uncommitted staging file.
          }
        }
        if (writeGateAcquired) {
          releaseAppRestoreWriteGate(window.localStorage, transactionId);
        }
      }
      throw error;
    }
  });
}
