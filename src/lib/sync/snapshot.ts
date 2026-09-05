import type { AppExportPayload } from "@/lib/data/appExport";
import {
  collectReferencedOpfsUrls,
  createBrowserAppExportPayload,
} from "@/lib/data/appExport";
import {
  runWithExclusiveAppDataLock,
  type AppRestoreSnapshot,
} from "@/lib/data/appRestoreJournal";
import {
  appDb,
  STORAGE_KEYS,
  validateRestoredAppData,
} from "@/store/storage/storageConfig";
import { writeBlobToOPFS } from "@/utils/opfs";
import {
  commitSyncApplyTransaction,
  createBrowserSyncApplyJournalOptions,
  createSyncApplyTransaction,
  ensureInterruptedSyncApplyRecovery,
  setSyncApplyPhase,
} from "./applyJournal";
import type {
  SyncBlobManifestEntry,
  SyncDocumentDescriptor,
  SyncDocumentKind,
  SyncJsonValue,
} from "./types";

export interface LocalSyncPayloadDocument {
  id: string;
  kind: SyncDocumentKind;
  payload: SyncJsonValue;
}

export interface CapturedSyncSnapshot {
  exported: AppExportPayload;
  documents: LocalSyncPayloadDocument[];
  referencedOpfsUrls: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? structuredClone(value) : {};
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function hasStableObjectIds(value: unknown[]): boolean {
  return value.every(
    (item) =>
      isRecord(item) && typeof item.id === "string" && item.id.length > 0,
  );
}

/**
 * Restores fields deliberately removed from the sync/export representation
 * from this device's current persisted value. Arrays of entities are matched
 * by id so a remote reorder cannot attach a local credential to another item.
 */
export function overlayLocalOnlySyncFields(
  localRaw: unknown,
  localScrubbed: unknown,
  synchronized: unknown,
): unknown {
  if (
    Array.isArray(localRaw) &&
    Array.isArray(localScrubbed) &&
    Array.isArray(synchronized)
  ) {
    if (hasStableObjectIds(localRaw) && hasStableObjectIds(localScrubbed)) {
      const rawById = new Map(
        localRaw.map((item) => [(item as Record<string, unknown>).id, item]),
      );
      const scrubbedById = new Map(
        localScrubbed.map((item) => [
          (item as Record<string, unknown>).id,
          item,
        ]),
      );
      return synchronized.map((item) => {
        if (!isRecord(item) || typeof item.id !== "string") return item;
        const raw = rawById.get(item.id);
        const scrubbed = scrubbedById.get(item.id);
        return raw === undefined || scrubbed === undefined
          ? item
          : overlayLocalOnlySyncFields(raw, scrubbed, item);
      });
    }
    return synchronized.map((item, index) =>
      index < localRaw.length && index < localScrubbed.length
        ? overlayLocalOnlySyncFields(
            localRaw[index],
            localScrubbed[index],
            item,
          )
        : item,
    );
  }

  if (isRecord(localRaw) && isRecord(localScrubbed) && isRecord(synchronized)) {
    const output = structuredClone(synchronized);
    for (const [key, localValue] of Object.entries(localRaw)) {
      if (!(key in localScrubbed)) {
        output[key] = structuredClone(localValue);
        continue;
      }
      if (key in output) {
        output[key] = overlayLocalOnlySyncFields(
          localValue,
          localScrubbed[key],
          output[key],
        );
      }
    }
    return output;
  }

  return synchronized;
}

async function readRawLocalAppData(): Promise<AppExportPayload["data"]> {
  const [settings, chat, knowledge, memory, keys] = await Promise.all([
    appDb.getItem<unknown>(STORAGE_KEYS.SETTINGS),
    appDb.getItem<unknown>(STORAGE_KEYS.CHAT),
    appDb.getItem<unknown>(STORAGE_KEYS.KNOWLEDGE),
    appDb.getItem<unknown>(STORAGE_KEYS.MEMORY),
    appDb.keys(),
  ]);
  const sessionMessages = Object.fromEntries(
    await Promise.all(
      keys
        .filter((key) => key.startsWith("session_messages_"))
        .map(async (key) => [
          key.slice("session_messages_".length),
          parseStoredValue(await appDb.getItem<unknown>(key)),
        ]),
    ),
  );

  return {
    coreSettings: parseStoredValue(
      window.localStorage.getItem(STORAGE_KEYS.CORE_SETTINGS),
    ),
    settings: parseStoredValue(settings),
    chat: parseStoredValue(chat),
    sessionMessages,
    knowledge: parseStoredValue(knowledge),
    memory: parseStoredValue(memory),
  };
}

function getPersistedState(value: unknown): Record<string, unknown> {
  const envelope = cloneRecord(value);
  return isRecord(envelope.state) ? envelope.state : {};
}

function isKnowledgeFileRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.name === "string" &&
    ("sourcePath" in value ||
      "contentPath" in value ||
      "indexStatus" in value ||
      "ragId" in value ||
      ("path" in value &&
        ("status" in value || "uploadedAt" in value || "contentKind" in value)))
  );
}

/**
 * Vector provider identifiers and index progress are device-local. They are
 * never valid evidence that another device has an index, so CRDT documents
 * carry only a deterministic "not indexed" state.
 */
export function resetKnowledgeVectorState(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resetKnowledgeVectorState(item));
  }
  if (!isRecord(value)) return value;

  const output = Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "ragId" &&
          key !== "ragChunkCount" &&
          key !== "indexedChunkingRevision" &&
          key !== "indexError",
      )
      .map(([key, nested]) => [key, resetKnowledgeVectorState(nested)]),
  );
  if (!isKnowledgeFileRecord(value)) return output;

  output.indexStatus = "not_indexed";
  if (
    output.status === "indexed" ||
    output.status === "indexing" ||
    (value.indexStatus === "error" && output.storageStatus !== "error")
  ) {
    output.status = "saved";
  }
  if (value.indexStatus === "error" && output.storageStatus !== "error") {
    delete output.error;
  }
  return output;
}

function knowledgeCollections(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const state = isRecord(value.state) ? value.state : {};
  return Array.isArray(state.collections)
    ? state.collections.filter(isRecord)
    : [];
}

function fileContentUrl(value: Record<string, unknown>): string | undefined {
  return typeof value.contentPath === "string"
    ? value.contentPath
    : typeof value.path === "string"
      ? value.path
      : undefined;
}

/**
 * A local vector index can survive an unrelated sync change only when the
 * same file bytes remain in OPFS and the collection's chunking revision is
 * unchanged. A downloaded URL is hash-verified by the blob manifest and
 * therefore proves that the prior local index is stale.
 */
export function restoreCompatibleLocalKnowledgeVectorState(
  localKnowledge: unknown,
  synchronizedKnowledge: unknown,
  downloadedFileUrls: ReadonlySet<string>,
): unknown {
  const output = cloneRecord(synchronizedKnowledge);
  const localCollections = new Map(
    knowledgeCollections(localKnowledge)
      .filter((collection) => typeof collection.id === "string")
      .map((collection) => [String(collection.id), collection]),
  );

  for (const collection of knowledgeCollections(output)) {
    if (typeof collection.id !== "string" || !Array.isArray(collection.files)) {
      continue;
    }
    const localCollection = localCollections.get(collection.id);
    if (!localCollection || !Array.isArray(localCollection.files)) continue;
    if (
      typeof collection.chunkingRevision === "string" &&
      collection.chunkingRevision !== localCollection.chunkingRevision
    ) {
      continue;
    }
    const localFiles = new Map(
      localCollection.files
        .filter(isRecord)
        .filter((file) => typeof file.id === "string")
        .map((file) => [String(file.id), file]),
    );
    for (const file of collection.files.filter(isRecord)) {
      if (typeof file.id !== "string") continue;
      const localFile = localFiles.get(file.id);
      const contentUrl = fileContentUrl(file);
      if (
        !localFile ||
        !contentUrl ||
        fileContentUrl(localFile) !== contentUrl ||
        downloadedFileUrls.has(contentUrl) ||
        typeof localFile.ragId !== "string" ||
        (localFile.indexStatus !== "indexed" &&
          localFile.status !== "indexed") ||
        (typeof localFile.indexedChunkingRevision === "string" &&
          localFile.indexedChunkingRevision !== collection.chunkingRevision)
      ) {
        continue;
      }
      file.ragId = localFile.ragId;
      if (typeof localFile.ragChunkCount === "number") {
        file.ragChunkCount = localFile.ragChunkCount;
      }
      if (typeof localFile.indexedChunkingRevision === "string") {
        file.indexedChunkingRevision = localFile.indexedChunkingRevision;
      }
      file.indexStatus = "indexed";
      file.status = "indexed";
      delete file.indexError;
    }
  }
  return output;
}

function prepareDataForSync(
  data: AppExportPayload["data"],
): AppExportPayload["data"] {
  return {
    ...data,
    knowledge: resetKnowledgeVectorState(data.knowledge),
  } as AppExportPayload["data"];
}

function splitIdEntities(
  values: unknown,
  kind: "workspace" | "session" | "knowledge-collection",
): { documents: LocalSyncPayloadDocument[]; order: string[] } {
  if (!Array.isArray(values)) return { documents: [], order: [] };
  const documents: LocalSyncPayloadDocument[] = [];
  const order: string[] = [];
  for (const value of values) {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id) continue;
    order.push(value.id);
    documents.push({
      id: `${kind}:${value.id}`,
      kind,
      payload: value as SyncJsonValue,
    });
  }
  return { documents, order };
}

export function splitAppExportIntoSyncDocuments(
  exported: AppExportPayload,
): LocalSyncPayloadDocument[] {
  const documents: LocalSyncPayloadDocument[] = [];
  const { coreSettings, settings, chat, sessionMessages, knowledge, memory } =
    exported.data;
  if (coreSettings !== undefined) {
    documents.push({
      id: "core-settings",
      kind: "core-settings",
      payload: coreSettings as SyncJsonValue,
    });
  }
  if (settings !== undefined) {
    documents.push({
      id: "settings",
      kind: "settings",
      payload: settings as SyncJsonValue,
    });
  }
  if (memory !== undefined) {
    documents.push({
      id: "memory",
      kind: "memory",
      payload: memory as SyncJsonValue,
    });
  }

  const chatEnvelope = cloneRecord(chat);
  const chatState = getPersistedState(chatEnvelope);
  const workspaces = splitIdEntities(chatState.workspaces, "workspace");
  const sessions = splitIdEntities(chatState.sessions, "session");
  delete chatState.workspaces;
  delete chatState.sessions;
  chatEnvelope.state = chatState;
  documents.push({
    id: "chat-meta",
    kind: "chat-meta",
    payload: {
      envelope: chatEnvelope as SyncJsonValue,
      workspaceOrder: workspaces.order,
      sessionOrder: sessions.order,
    },
  });
  documents.push(...workspaces.documents, ...sessions.documents);

  for (const [sessionId, value] of Object.entries(sessionMessages)) {
    documents.push({
      id: `session-messages:${sessionId}`,
      kind: "session-messages",
      payload: value as SyncJsonValue,
    });
  }

  const knowledgeEnvelope = cloneRecord(resetKnowledgeVectorState(knowledge));
  const knowledgeState = getPersistedState(knowledgeEnvelope);
  const collections = splitIdEntities(
    knowledgeState.collections,
    "knowledge-collection",
  );
  delete knowledgeState.collections;
  knowledgeEnvelope.state = knowledgeState;
  documents.push({
    id: "knowledge-meta",
    kind: "knowledge-meta",
    payload: {
      envelope: knowledgeEnvelope as SyncJsonValue,
      collectionOrder: collections.order,
    },
  });
  documents.push(...collections.documents);
  return documents;
}

export async function captureLocalSyncSnapshot(): Promise<CapturedSyncSnapshot> {
  const captured = await createBrowserAppExportPayload();
  const exported: AppExportPayload = {
    ...captured,
    data: prepareDataForSync(captured.data),
  };
  return {
    exported,
    documents: splitAppExportIntoSyncDocuments(exported),
    referencedOpfsUrls: [
      ...collectReferencedOpfsUrls({ data: exported.data }),
    ].sort(),
  };
}

function sortEntities(
  values: SyncJsonValue[],
  orderValue: unknown,
): SyncJsonValue[] {
  const order = Array.isArray(orderValue)
    ? orderValue.filter((item): item is string => typeof item === "string")
    : [];
  const position = new Map(order.map((id, index) => [id, index]));
  return [...values].sort((left, right) => {
    const leftId = isRecord(left) && typeof left.id === "string" ? left.id : "";
    const rightId =
      isRecord(right) && typeof right.id === "string" ? right.id : "";
    return (
      (position.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
      leftId.localeCompare(rightId)
    );
  });
}

export function assembleSyncDocuments(
  documents: Map<
    string,
    { descriptor: SyncDocumentDescriptor; payload: SyncJsonValue }
  >,
): AppExportPayload["data"] {
  const value = (id: string) => documents.get(id)?.payload;
  const activeByKind = (kind: SyncDocumentKind) =>
    [...documents.values()]
      .filter(
        (entry) => entry.descriptor.kind === kind && !entry.descriptor.deleted,
      )
      .map((entry) => entry.payload);

  const chatMeta = cloneRecord(value("chat-meta"));
  const chatEnvelope = cloneRecord(chatMeta.envelope);
  const chatState = getPersistedState(chatEnvelope);
  chatState.workspaces = sortEntities(
    activeByKind("workspace"),
    chatMeta.workspaceOrder,
  );
  chatState.sessions = sortEntities(
    activeByKind("session"),
    chatMeta.sessionOrder,
  );
  chatEnvelope.state = chatState;

  const knowledgeMeta = cloneRecord(value("knowledge-meta"));
  const knowledgeEnvelope = cloneRecord(knowledgeMeta.envelope);
  const knowledgeState = getPersistedState(knowledgeEnvelope);
  knowledgeState.collections = sortEntities(
    activeByKind("knowledge-collection"),
    knowledgeMeta.collectionOrder,
  );
  knowledgeEnvelope.state = knowledgeState;

  const sessionMessages = Object.fromEntries(
    [...documents.entries()]
      .filter(
        ([, entry]) =>
          entry.descriptor.kind === "session-messages" &&
          !entry.descriptor.deleted,
      )
      .map(([id, entry]) => [
        id.slice("session-messages:".length),
        entry.payload,
      ]),
  );

  return {
    coreSettings: value("core-settings"),
    settings: value("settings"),
    chat: chatEnvelope,
    sessionMessages,
    knowledge: knowledgeEnvelope,
    memory: value("memory"),
  };
}

function serializePersisted(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export async function applySyncedAppData(
  data: AppExportPayload["data"],
  downloadedFiles: Map<string, Uint8Array>,
): Promise<boolean> {
  const sessionPrefix = "session_messages_";
  const [current, currentRaw] = await Promise.all([
    createBrowserAppExportPayload({ flushMessageWrites: false }),
    readRawLocalAppData(),
  ]);
  const synchronizedData = prepareDataForSync(data);
  const currentSyncData = prepareDataForSync(current.data);
  const restoredData = overlayLocalOnlySyncFields(
    currentRaw,
    current.data,
    synchronizedData,
  ) as AppExportPayload["data"];
  restoredData.knowledge = restoreCompatibleLocalKnowledgeVectorState(
    currentRaw.knowledge,
    restoredData.knowledge,
    new Set(downloadedFiles.keys()),
  );
  const changed =
    JSON.stringify(currentSyncData) !== JSON.stringify(synchronizedData) ||
    downloadedFiles.size > 0;
  if (!changed) return false;

  await runWithExclusiveAppDataLock(async () => {
    const { withSessionSharesRemoved } =
      await import("@/services/sharing/client");
    const nextSessions = getPersistedState(restoredData.chat).sessions;
    await withSessionSharesRemoved(
      new Set(
        Array.isArray(nextSessions)
          ? nextSessions.flatMap((session) =>
              isRecord(session) && typeof session.id === "string"
                ? [session.id]
                : [],
            )
          : [],
      ),
      async () => {
        const journalOptions = createBrowserSyncApplyJournalOptions();
        await ensureInterruptedSyncApplyRecovery(journalOptions, true);
        const existingKeys = await appDb.keys();
        const managedKeys = [
          STORAGE_KEYS.SETTINGS,
          STORAGE_KEYS.CHAT,
          STORAGE_KEYS.KNOWLEDGE,
          STORAGE_KEYS.MEMORY,
          ...existingKeys.filter((key) => key.startsWith(sessionPrefix)),
          ...Object.keys(restoredData.sessionMessages).map(
            (id) => `${sessionPrefix}${id}`,
          ),
        ];
        const uniqueManagedKeys = [...new Set(managedKeys)];

        try {
          let journal = await createSyncApplyTransaction(journalOptions, {
            managedDbKeys: uniqueManagedKeys,
            fileUrls: [...downloadedFiles.keys()],
          });
          journal = await setSyncApplyPhase(
            journalOptions,
            journal,
            "applying",
          );
          for (const [url, bytes] of downloadedFiles) {
            await writeBlobToOPFS(url, bytes);
          }
          const mainValues: Array<[string, unknown]> = [
            [STORAGE_KEYS.SETTINGS, restoredData.settings],
            [STORAGE_KEYS.CHAT, restoredData.chat],
            [STORAGE_KEYS.KNOWLEDGE, restoredData.knowledge],
            [STORAGE_KEYS.MEMORY, restoredData.memory],
          ];
          for (const [key, value] of mainValues) {
            const serialized = serializePersisted(value);
            if (serialized === null) await appDb.removeItem(key);
            else await appDb.setItem(key, serialized);
          }
          for (const key of existingKeys.filter((item) =>
            item.startsWith(sessionPrefix),
          )) {
            if (
              !(key.slice(sessionPrefix.length) in restoredData.sessionMessages)
            ) {
              await appDb.removeItem(key);
            }
          }
          for (const [sessionId, value] of Object.entries(
            restoredData.sessionMessages,
          )) {
            await appDb.setItem(
              `${sessionPrefix}${sessionId}`,
              JSON.stringify(value),
            );
          }
          const core = serializePersisted(restoredData.coreSettings);
          if (core === null)
            window.localStorage.removeItem(STORAGE_KEYS.CORE_SETTINGS);
          else window.localStorage.setItem(STORAGE_KEYS.CORE_SETTINGS, core);

          const validationSnapshot: AppRestoreSnapshot = {
            version: 1,
            transactionId: `sync-${Date.now()}`,
            managedDbKeys: uniqueManagedKeys,
            dbEntries: [],
            localStorageEntries: [],
            stagedOpfsUrls: [],
            previousOpfsUrls: [],
          };
          await validateRestoredAppData(validationSnapshot);
          journal = await setSyncApplyPhase(journalOptions, journal, "applied");
          await commitSyncApplyTransaction(journalOptions, journal);
        } catch (error) {
          try {
            await ensureInterruptedSyncApplyRecovery(journalOptions, true);
          } catch (recoveryError) {
            throw new AggregateError(
              [error, recoveryError],
              "Sync apply failed and its rollback could not be completed.",
            );
          }
          throw error;
        }
      },
    );
  });
  return true;
}

export function getBlobManifestPayload(
  entries: SyncBlobManifestEntry[],
): Record<string, SyncBlobManifestEntry> {
  return Object.fromEntries(entries.map((entry) => [entry.url, entry]));
}
