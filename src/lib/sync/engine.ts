import { base64UrlToBytes, bytesToBase64Url } from "@/lib/byok/encoding";
import { collectReferencedOpfsUrls } from "@/lib/data/appExport";
import {
  decryptLocalSecret,
  LOCAL_SECRET_CONTEXTS,
} from "@/lib/security/localSecrets";
import { resolveOPFSBlob } from "@/utils/opfs";
import {
  addInitialLocalPayload,
  applyLocalPayload,
  collectSyncConflicts,
  createSyncDocument,
  loadSyncDocument,
  mergeSyncDocuments,
  readSyncDocumentPayload,
  resolveSyncDocumentConflict,
  saveSyncDocument,
  toSyncJson,
} from "./crdt";
import {
  decryptSyncBytes,
  deriveOpaqueObjectName,
  deriveVaultId,
  encryptSyncBytes,
  parseRecoveryCode,
  sha256Base64Url,
  splitSyncChunks,
} from "./crypto";
import { getSyncDeviceId } from "./deviceIdentity";
import { ensureInterruptedBrowserSyncApplyRecovery } from "./applyJournal";
import { createSyncRemoteClient, type SyncRemoteClient } from "./remoteClient";
import {
  applySyncedAppData,
  assembleSyncDocuments,
  captureLocalSyncSnapshot,
  getBlobManifestPayload,
  type LocalSyncPayloadDocument,
} from "./snapshot";
import {
  clearLocalSyncDocuments,
  readLocalSyncDocument,
  writeLocalSyncDocument,
} from "./storage";
import {
  SYNC_FORMAT_VERSION,
  type EncryptedSyncObject,
  type SyncBlobManifestEntry,
  type SyncCrdtDocument,
  type SyncDevice,
  type SyncDocumentDescriptor,
  type SyncDocumentIndex,
  type SyncJsonValue,
  type SyncRunConfiguration,
  type SyncRunResult,
} from "./types";
import type * as Automerge from "@automerge/automerge";

export const ROOT_DOCUMENT_ID = "root-index";
const SYNC_RUN_LOCK = "neo-chat-encrypted-sync";

type SyncDoc = Automerge.Doc<SyncCrdtDocument>;

interface RemoteDocumentState {
  doc?: SyncDoc;
  downloadedBytes: number;
}

interface MergedDocument {
  descriptor: SyncDocumentDescriptor;
  doc: SyncDoc;
  payload: SyncJsonValue;
}

let fallbackRun: Promise<SyncRunResult> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function envelopeBytes(envelope: EncryptedSyncObject): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

function parseEnvelope(bytes: Uint8Array): EncryptedSyncObject {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Remote encrypted sync object is not valid JSON.");
  }
  if (!isRecord(value))
    throw new Error("Remote encrypted sync object is invalid.");
  return value as unknown as EncryptedSyncObject;
}

async function getRootKey(
  configuration: SyncRunConfiguration,
): Promise<Uint8Array> {
  const encoded = await decryptLocalSecret(
    configuration.rootKeySecret,
    LOCAL_SECRET_CONTEXTS.syncRootKey,
  );
  if (!encoded) throw new Error("The sync recovery key is unavailable.");
  const rootKey = base64UrlToBytes(encoded);
  const expectedVaultId = await deriveVaultId(rootKey);
  if (expectedVaultId !== configuration.vaultId) {
    throw new Error("The sync recovery key does not match this vault.");
  }
  return rootKey;
}

async function getVaultBase(
  rootKey: Uint8Array,
  vaultId: string,
): Promise<string> {
  const opaque = await deriveOpaqueObjectName(rootKey, `vault:${vaultId}`);
  return `v1/${opaque}`;
}

async function documentDirectory(
  rootKey: Uint8Array,
  vaultBase: string,
  logicalId: string,
): Promise<string> {
  return `${vaultBase}/docs/${await deriveOpaqueObjectName(
    rootKey,
    `document:${logicalId}`,
  )}`;
}

async function deviceSnapshotPath(
  rootKey: Uint8Array,
  directory: string,
  deviceId: string,
): Promise<string> {
  return `${directory}/${await deriveOpaqueObjectName(
    rootKey,
    `device:${deviceId}`,
  )}.json`;
}

async function downloadRemoteDocument(
  remote: SyncRemoteClient,
  rootKey: Uint8Array,
  vaultBase: string,
  logicalId: string,
  deviceId: string,
  signal?: AbortSignal,
): Promise<RemoteDocumentState> {
  const directory = await documentDirectory(rootKey, vaultBase, logicalId);
  const objects = await remote.list(directory, signal);
  let doc: SyncDoc | undefined;
  let downloadedBytes = 0;
  for (const object of objects.filter((item) => item.path.endsWith(".json"))) {
    const encryptedBytes = await remote.get(object.path, signal);
    downloadedBytes += encryptedBytes.byteLength;
    const plaintext = await decryptSyncBytes(
      rootKey,
      parseEnvelope(encryptedBytes),
      "crdt-document",
      logicalId,
    );
    const candidate = await loadSyncDocument(plaintext, deviceId);
    doc = doc ? await mergeSyncDocuments(doc, candidate) : candidate;
  }
  return { doc, downloadedBytes };
}

async function uploadDocument(
  remote: SyncRemoteClient,
  rootKey: Uint8Array,
  vaultBase: string,
  deviceId: string,
  logicalId: string,
  doc: SyncDoc,
  signal?: AbortSignal,
): Promise<number> {
  const directory = await documentDirectory(rootKey, vaultBase, logicalId);
  const path = await deviceSnapshotPath(rootKey, directory, deviceId);
  const plaintext = await saveSyncDocument(doc);
  const bytes = envelopeBytes(
    await encryptSyncBytes(rootKey, plaintext, "crdt-document", logicalId),
  );
  await remote.put(path, bytes, "application/json", signal);
  return bytes.byteLength;
}

function descriptorMap(
  payload: SyncJsonValue | undefined,
): Record<string, SyncDocumentDescriptor> {
  if (!isRecord(payload) || !isRecord(payload.documents)) return {};
  const output: Record<string, SyncDocumentDescriptor> = {};
  for (const [id, descriptor] of Object.entries(payload.documents)) {
    if (
      isRecord(descriptor) &&
      typeof descriptor.id === "string" &&
      typeof descriptor.kind === "string" &&
      typeof descriptor.updatedAt === "string"
    ) {
      output[id] = descriptor as unknown as SyncDocumentDescriptor;
    }
  }
  return output;
}

export function buildRootSyncIndex(
  previous: SyncJsonValue | undefined,
  currentDocuments: LocalSyncPayloadDocument[],
  vaultId: string,
  device: SyncDevice,
  now: string,
  options: { inferTombstones: boolean },
): SyncDocumentIndex {
  const previousRecord = isRecord(previous) ? previous : {};
  const documents = { ...descriptorMap(previous) };
  const current = new Map(currentDocuments.map((entry) => [entry.id, entry]));
  if (options.inferTombstones) {
    for (const [id, descriptor] of Object.entries(documents)) {
      if (!current.has(id) && !descriptor.deleted) {
        documents[id] = { ...descriptor, deleted: true, updatedAt: now };
      }
    }
  }
  for (const entry of currentDocuments) {
    const previousDescriptor = documents[entry.id];
    documents[entry.id] = {
      id: entry.id,
      kind: entry.kind,
      updatedAt: previousDescriptor?.updatedAt || now,
    };
  }
  const devices: Record<string, SyncDevice> = {};
  if (isRecord(previousRecord.devices)) {
    for (const [id, value] of Object.entries(previousRecord.devices)) {
      if (isRecord(value) && typeof value.id === "string") {
        devices[id] = value as unknown as SyncDevice;
      }
    }
  }
  devices[device.id] = {
    ...device,
    firstSeenAt: devices[device.id]?.firstSeenAt || device.firstSeenAt,
  };
  return {
    formatVersion: SYNC_FORMAT_VERSION,
    vaultId,
    documents,
    devices,
  };
}

async function mergeCapturedDocument({
  entry,
  localBase,
  remote,
  deviceId,
}: {
  entry: LocalSyncPayloadDocument;
  localBase?: SyncDoc;
  remote?: SyncDoc;
  deviceId: string;
}): Promise<SyncDoc> {
  if (localBase) {
    const localChanged = await applyLocalPayload(localBase, entry.payload);
    return remote ? mergeSyncDocuments(localChanged, remote) : localChanged;
  }
  if (remote) return addInitialLocalPayload(remote, entry.payload);
  return createSyncDocument(entry.id, entry.kind, entry.payload, deviceId);
}

async function prepareLocalBlobManifest(
  urls: string[],
  remote: SyncRemoteClient,
  rootKey: Uint8Array,
  vaultBase: string,
  signal?: AbortSignal,
): Promise<{ entries: SyncBlobManifestEntry[]; uploadedBytes: number }> {
  const entries: SyncBlobManifestEntry[] = [];
  let uploadedBytes = 0;
  for (const url of urls) {
    const blob = await resolveOPFSBlob(url);
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fileHash = await sha256Base64Url(bytes);
    const chunks = [] as SyncBlobManifestEntry["chunks"];
    for (const [index, chunk] of splitSyncChunks(bytes).entries()) {
      const chunkHash = await sha256Base64Url(chunk);
      const logicalId = `${url}:${index}:${chunkHash}`;
      const objectName = await deriveOpaqueObjectName(
        rootKey,
        `blob:${logicalId}`,
      );
      const objectPath = `${vaultBase}/blobs/${objectName}.json`;
      const head = await remote.head(objectPath, signal);
      if (!head.exists) {
        const encrypted = envelopeBytes(
          await encryptSyncBytes(rootKey, chunk, "blob-chunk", logicalId),
        );
        await remote.put(objectPath, encrypted, "application/json", signal);
        uploadedBytes += encrypted.byteLength;
      }
      chunks.push({
        index,
        objectPath,
        sha256: chunkHash,
        plaintextBytes: chunk.byteLength,
      });
    }
    entries.push({
      url,
      mimeType: blob.type || "application/octet-stream",
      size: bytes.byteLength,
      sha256: fileHash,
      chunks,
    });
  }
  return { entries, uploadedBytes };
}

function parseBlobManifest(
  payload: SyncJsonValue,
): Record<string, SyncBlobManifestEntry> {
  if (!isRecord(payload) || !isRecord(payload.entries)) return {};
  return payload.entries as unknown as Record<string, SyncBlobManifestEntry>;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function downloadRequiredBlobs(
  data: ReturnType<typeof assembleSyncDocuments>,
  manifestPayload: SyncJsonValue | undefined,
  remote: SyncRemoteClient,
  rootKey: Uint8Array,
  signal?: AbortSignal,
): Promise<{ files: Map<string, Uint8Array>; downloadedBytes: number }> {
  const files = new Map<string, Uint8Array>();
  let downloadedBytes = 0;
  const manifest = manifestPayload ? parseBlobManifest(manifestPayload) : {};
  const referenced = collectReferencedOpfsUrls({ data });
  for (const url of referenced) {
    const entry = manifest[url];
    if (!entry) continue;
    const local = await resolveOPFSBlob(url);
    if (local) {
      const localBytes = new Uint8Array(await local.arrayBuffer());
      if ((await sha256Base64Url(localBytes)) === entry.sha256) continue;
    }
    const chunks: Uint8Array[] = [];
    for (const chunk of [...entry.chunks].sort(
      (left, right) => left.index - right.index,
    )) {
      const encrypted = await remote.get(chunk.objectPath, signal);
      downloadedBytes += encrypted.byteLength;
      const logicalId = `${url}:${chunk.index}:${chunk.sha256}`;
      const plaintext = await decryptSyncBytes(
        rootKey,
        parseEnvelope(encrypted),
        "blob-chunk",
        logicalId,
      );
      if (
        plaintext.byteLength !== chunk.plaintextBytes ||
        (await sha256Base64Url(plaintext)) !== chunk.sha256
      ) {
        throw new Error("A downloaded sync file chunk failed verification.");
      }
      chunks.push(plaintext);
    }
    const bytes = concatChunks(chunks);
    if (
      bytes.byteLength !== entry.size ||
      (await sha256Base64Url(bytes)) !== entry.sha256
    ) {
      throw new Error("A downloaded sync file failed verification.");
    }
    files.set(url, bytes);
  }
  return { files, downloadedBytes };
}

async function loadLocalBase(
  logicalId: string,
  deviceId: string,
): Promise<SyncDoc | undefined> {
  const bytes = await readLocalSyncDocument(logicalId);
  return bytes ? loadSyncDocument(bytes, deviceId) : undefined;
}

async function runSyncUnlocked(
  configuration: SyncRunConfiguration,
  signal?: AbortSignal,
): Promise<SyncRunResult> {
  // A browser may have closed after app data writes began but before the
  // materialized snapshot committed. Recover that durable transaction before
  // taking a new local CRDT capture.
  await ensureInterruptedBrowserSyncApplyRecovery();
  const rootKey = await getRootKey(configuration);
  const remote = await createSyncRemoteClient(
    configuration.provider,
    configuration.credentialSecret,
  );
  const deviceId = getSyncDeviceId();
  const vaultBase = await getVaultBase(rootKey, configuration.vaultId);
  const now = new Date().toISOString();
  const device: SyncDevice = {
    id: deviceId,
    name: configuration.deviceName,
    firstSeenAt: now,
    lastSeenAt: now,
  };

  const captured = await captureLocalSyncSnapshot();
  const blobs = await prepareLocalBlobManifest(
    captured.referencedOpfsUrls,
    remote,
    rootKey,
    vaultBase,
    signal,
  );
  captured.documents.push({
    id: "opfs-manifest",
    kind: "opfs-manifest",
    payload: toSyncJson({ entries: getBlobManifestPayload(blobs.entries) }),
  });

  let downloadedBytes = 0;
  let uploadedBytes = blobs.uploadedBytes;
  const localRootBase = await loadLocalBase(ROOT_DOCUMENT_ID, deviceId);
  const remoteRoot = await downloadRemoteDocument(
    remote,
    rootKey,
    vaultBase,
    ROOT_DOCUMENT_ID,
    deviceId,
    signal,
  );
  downloadedBytes += remoteRoot.downloadedBytes;
  const localPreviousRoot = localRootBase
    ? readSyncDocumentPayload(localRootBase)
    : undefined;
  const discoveredRoot =
    localRootBase && remoteRoot.doc
      ? await mergeSyncDocuments(localRootBase, remoteRoot.doc)
      : localRootBase || remoteRoot.doc;
  const discoveryPreviousRoot = discoveredRoot
    ? readSyncDocumentPayload(discoveredRoot)
    : undefined;
  const discoveredRootPayload = buildRootSyncIndex(
    discoveryPreviousRoot,
    captured.documents,
    configuration.vaultId,
    device,
    now,
    { inferTombstones: false },
  );
  const descriptors = descriptorMap(toSyncJson(discoveredRootPayload));
  const capturedMap = new Map(
    captured.documents.map((entry) => [entry.id, entry]),
  );
  const remoteDocuments = new Map<string, RemoteDocumentState>();

  for (const descriptor of Object.values(descriptors)) {
    const remoteState = await downloadRemoteDocument(
      remote,
      rootKey,
      vaultBase,
      descriptor.id,
      deviceId,
      signal,
    );
    downloadedBytes += remoteState.downloadedBytes;
    remoteDocuments.set(descriptor.id, remoteState);
  }

  // Capture once more after network IO. Persistent local CRDT baselines are
  // loaded again and changed only here, so the discovery pass cannot consume
  // the document handles or create a duplicate branch for this device actor.
  const latest = await captureLocalSyncSnapshot();
  const latestMap = new Map(latest.documents.map((entry) => [entry.id, entry]));
  latestMap.set("opfs-manifest", capturedMap.get("opfs-manifest")!);
  const latestRootPayload = buildRootSyncIndex(
    localPreviousRoot,
    [...latestMap.values()],
    configuration.vaultId,
    device,
    now,
    { inferTombstones: Boolean(localRootBase) },
  );
  const rootDoc = await mergeCapturedDocument({
    entry: {
      id: ROOT_DOCUMENT_ID,
      kind: "root",
      payload: toSyncJson(latestRootPayload),
    },
    localBase: await loadLocalBase(ROOT_DOCUMENT_ID, deviceId),
    remote: remoteRoot.doc,
    deviceId,
  });
  const mergedRoot = readSyncDocumentPayload(rootDoc);
  const latestDescriptors = descriptorMap(mergedRoot);
  const mergedDocuments = new Map<string, MergedDocument>();
  for (const descriptor of Object.values(latestDescriptors)) {
    const entry = latestMap.get(descriptor.id);
    const localBase = await loadLocalBase(descriptor.id, deviceId);
    const remoteDoc = remoteDocuments.get(descriptor.id)?.doc;
    let doc: SyncDoc | undefined;
    if (entry) {
      doc = await mergeCapturedDocument({
        entry,
        localBase,
        remote: remoteDoc,
        deviceId,
      });
    } else if (localBase && remoteDoc) {
      doc = await mergeSyncDocuments(localBase, remoteDoc);
    } else {
      doc = localBase || remoteDoc;
    }
    if (!doc) continue;
    mergedDocuments.set(descriptor.id, {
      descriptor,
      doc,
      payload: readSyncDocumentPayload(doc),
    });
  }
  for (const [id, entry] of latestMap) {
    if (mergedDocuments.has(id)) continue;
    const localBase = await loadLocalBase(id, deviceId);
    const doc = await mergeCapturedDocument({
      entry,
      localBase,
      remote: remoteDocuments.get(id)?.doc,
      deviceId,
    });
    mergedDocuments.set(id, {
      descriptor: latestDescriptors[id] || {
        id,
        kind: entry.kind,
        updatedAt: now,
      },
      doc,
      payload: readSyncDocumentPayload(doc),
    });
  }

  const materialized = new Map(
    [...mergedDocuments].map(([id, entry]) => [
      id,
      { descriptor: entry.descriptor, payload: entry.payload },
    ]),
  );
  const data = assembleSyncDocuments(materialized);
  const remoteFiles = await downloadRequiredBlobs(
    data,
    mergedDocuments.get("opfs-manifest")?.payload,
    remote,
    rootKey,
    signal,
  );
  downloadedBytes += remoteFiles.downloadedBytes;
  const changed = await applySyncedAppData(data, remoteFiles.files);

  const conflicts = (
    await Promise.all([
      collectSyncConflicts(rootDoc),
      ...[...mergedDocuments.values()].map((entry) =>
        collectSyncConflicts(entry.doc),
      ),
    ])
  ).flat();

  uploadedBytes += await uploadDocument(
    remote,
    rootKey,
    vaultBase,
    deviceId,
    ROOT_DOCUMENT_ID,
    rootDoc,
    signal,
  );
  for (const [id, entry] of mergedDocuments) {
    uploadedBytes += await uploadDocument(
      remote,
      rootKey,
      vaultBase,
      deviceId,
      id,
      entry.doc,
      signal,
    );
  }

  await writeLocalSyncDocument(
    ROOT_DOCUMENT_ID,
    await saveSyncDocument(rootDoc),
  );
  await Promise.all(
    [...mergedDocuments].map(([id, entry]) =>
      saveSyncDocument(entry.doc).then((bytes) =>
        writeLocalSyncDocument(id, bytes),
      ),
    ),
  );

  const rootRecord = isRecord(mergedRoot) ? mergedRoot : {};
  const devices = isRecord(rootRecord.devices)
    ? Object.values(rootRecord.devices)
        .filter(isRecord)
        .map((value) => value as unknown as SyncDevice)
    : [device];
  return {
    changed,
    uploadedBytes,
    downloadedBytes,
    devices,
    conflicts,
  };
}

export async function runEncryptedSync(
  configuration: SyncRunConfiguration,
  signal?: AbortSignal,
): Promise<SyncRunResult> {
  const execute = () => runSyncUnlocked(configuration, signal);
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(
      SYNC_RUN_LOCK,
      { mode: "exclusive" },
      execute,
    );
  }
  if (fallbackRun) return fallbackRun;
  fallbackRun = execute().finally(() => {
    fallbackRun = undefined;
  });
  return fallbackRun;
}

async function refreshMaterializedAppState(): Promise<void> {
  const [coreSettings, settings, chat, knowledge, memory] = await Promise.all([
    import("@/store/core/coreSettingsStore"),
    import("@/store/core/settingsStore"),
    import("@/store/core/chatStore"),
    import("@/store/core/knowledgeStore"),
    import("@/store/core/memoryStore"),
  ]);
  const activeSessionId = chat.useChatStore.getState().currentSessionId;
  await Promise.all([
    coreSettings.useCoreSettingsStore.persist.rehydrate(),
    settings.useSettingsStore.persist.rehydrate(),
    chat.useChatStore.persist.rehydrate(),
    knowledge.useKnowledgeStore.persist.rehydrate(),
    memory.useMemoryStore.persist.rehydrate(),
  ]);
  const sessionId =
    chat.useChatStore.getState().currentSessionId || activeSessionId;
  if (sessionId) await chat.useChatStore.getState().selectSession(sessionId);
}

export interface StoredConflictResolutionDependencies {
  deviceId?: string;
  readDocument?: (logicalId: string) => Promise<Uint8Array | null>;
  writeDocument?: (logicalId: string, bytes: Uint8Array) => Promise<void>;
  applySyncedData?: (
    data: ReturnType<typeof assembleSyncDocuments>,
  ) => Promise<boolean>;
  refreshAppState?: () => Promise<void>;
}

export async function resolveStoredSyncConflict(
  conflict: { documentId: string; path: string[] },
  value: SyncJsonValue,
  dependencies: StoredConflictResolutionDependencies = {},
): Promise<void> {
  const deviceId = dependencies.deviceId || getSyncDeviceId();
  const readDocument = dependencies.readDocument || readLocalSyncDocument;
  const writeDocument = dependencies.writeDocument || writeLocalSyncDocument;
  const applySyncedData =
    dependencies.applySyncedData ||
    ((data) => applySyncedAppData(data, new Map<string, Uint8Array>()));
  const refreshAppState =
    dependencies.refreshAppState || refreshMaterializedAppState;
  const bytes = await readDocument(conflict.documentId);
  if (!bytes) throw new Error("The conflicted sync document is unavailable.");
  const doc = await loadSyncDocument(bytes, deviceId);
  const resolved = await resolveSyncDocumentConflict(doc, conflict.path, value);
  const rootBytes =
    conflict.documentId === ROOT_DOCUMENT_ID
      ? await saveSyncDocument(resolved)
      : await readDocument(ROOT_DOCUMENT_ID);
  if (!rootBytes)
    throw new Error("The local sync document index is unavailable.");
  const rootDoc = await loadSyncDocument(rootBytes, deviceId);
  const descriptors = descriptorMap(readSyncDocumentPayload(rootDoc));
  const materialized = new Map<
    string,
    { descriptor: SyncDocumentDescriptor; payload: SyncJsonValue }
  >();
  let resolvedDocumentFound = conflict.documentId === ROOT_DOCUMENT_ID;
  for (const descriptor of Object.values(descriptors)) {
    const document =
      descriptor.id === conflict.documentId
        ? resolved
        : await readDocument(descriptor.id).then((stored) =>
            stored ? loadSyncDocument(stored, deviceId) : undefined,
          );
    if (!document) continue;
    if (descriptor.id === conflict.documentId) resolvedDocumentFound = true;
    materialized.set(descriptor.id, {
      descriptor,
      payload: readSyncDocumentPayload(document),
    });
  }
  if (!resolvedDocumentFound) {
    throw new Error("The conflicted sync document is not in the local index.");
  }

  await applySyncedData(assembleSyncDocuments(materialized));
  await writeDocument(conflict.documentId, await saveSyncDocument(resolved));
  await refreshAppState();
}

export async function resetLocalSyncVault(): Promise<void> {
  await clearLocalSyncDocuments();
}

export async function recoveryCodeToVaultId(code: string): Promise<string> {
  return deriveVaultId(await parseRecoveryCode(code));
}

export async function recoveryCodeToStoredKey(code: string): Promise<string> {
  return bytesToBase64Url(await parseRecoveryCode(code));
}
