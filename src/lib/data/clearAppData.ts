import localforage from "localforage";
import { RAG_LIMITS } from "@/config/limits";
import type { Collection, RAGConfig } from "@/types";
import { buildKnowledgeVectorIds } from "../utils/knowledgeVectors";
import { appDb, STORAGE_KEYS } from "@/store/storage/storageConfig";
import { deleteOPFSDirectory } from "@/utils/opfs";
import { encryptSecret, fetchWithByokRetry } from "../byok/client";
import { signedApiFetch } from "../api/client";
import { BYOK_CONTEXTS } from "../byok/shared";
import { logDevWarn } from "../utils/devLogger";
import { clearLocalSyncState } from "../sync/storage";
import {
  hasRagVectorStore,
  resolveRagToken,
} from "../security/localSecretResolvers";
import { deleteLocalSecretMasterKey } from "../security/localSecrets";
import {
  APP_RESTORE_CREDENTIAL_NOTICE_KEY,
  runWithExclusiveAppDataClearLock,
} from "./appRestoreJournal";
import { getResearchTaskRepository } from "@/services/research";

const APP_OPFS_DIRECTORIES = ["knowledge-base", "workspaces", "images", "chat"];
const SESSION_MESSAGES_PREFIX = "session_messages_";
const FONT_SIZE_STORAGE_KEY = "neo-chat-font-size";

export type BrowserAppDataSource =
  | "cache"
  | "settings"
  | "chats"
  | "chatFiles"
  | "workspaceFiles"
  | "knowledge"
  | "memory"
  | "media";

export interface ClearBrowserAppDataSourcesOptions {
  sources: BrowserAppDataSource[];
  rag: RAGConfig;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parsePersistedState<T>(value: unknown): T | null {
  if (!value) return null;

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;

    const maybeState = parsed as { state?: unknown };
    return (maybeState.state || parsed) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function updatePersistedAppDbState(
  key: string,
  updater: (state: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const storedValue = await appDb.getItem<unknown>(key);
  if (!storedValue) return;

  try {
    const parsed =
      typeof storedValue === "string" ? JSON.parse(storedValue) : storedValue;
    if (!isRecord(parsed)) return;

    const currentState = isRecord(parsed.state) ? parsed.state : parsed;
    const nextState = updater(currentState);
    const nextValue = isRecord(parsed.state)
      ? { ...parsed, state: nextState }
      : nextState;

    await appDb.setItem(
      key,
      typeof storedValue === "string" ? JSON.stringify(nextValue) : nextValue,
    );
  } catch (error) {
    logDevWarn(
      `Failed to update persisted state "${key}" during clear:`,
      error,
    );
  }
}

async function deleteRAGIds(
  ids: string[],
  namespace: string,
  rag: RAGConfig,
): Promise<void> {
  if (!hasRagVectorStore(rag) || ids.length === 0) return;

  const useDefault = Boolean(
    rag.useDefaultVectorStore && rag.serverVectorStoreAvailable,
  );

  let tokenSecret: Awaited<ReturnType<typeof encryptSecret>> | undefined;
  if (!useDefault) {
    try {
      const token = await resolveRagToken(rag);
      tokenSecret = await encryptSecret(token, BYOK_CONTEXTS.ragToken);
    } catch (error) {
      logDevWarn("Failed to encrypt RAG token during clear:", error);
      return;
    }
    if (!tokenSecret) return;
  }

  for (const batch of chunkArray(ids, RAG_LIMITS.maxItemsPerRequest)) {
    try {
      const response = await fetchWithByokRetry(() =>
        signedApiFetch("/api/rag/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ids: batch,
            namespace,
            url: rag.url,
            useDefault,
            tokenSecret,
          }),
        }),
      );

      if (!response.ok) {
        logDevWarn("Failed to delete persisted RAG vectors during clear.");
      }
    } catch (error) {
      logDevWarn("Failed to delete persisted RAG vectors during clear:", error);
    }
  }
}

async function cleanupPersistedKnowledgeVectors(rag: RAGConfig): Promise<void> {
  const storedKnowledge = await appDb.getItem<unknown>(STORAGE_KEYS.KNOWLEDGE);
  const persisted = parsePersistedState<{ collections?: Collection[] }>(
    storedKnowledge,
  );

  const collections = Array.isArray(persisted?.collections)
    ? persisted.collections
    : [];

  for (const collection of collections) {
    const ids = collection.files.flatMap((file) =>
      file.ragId
        ? buildKnowledgeVectorIds(file.ragId, file.ragChunkCount || 1_000)
        : [],
    );
    await deleteRAGIds(ids, collection.id, rag);
  }
}

async function cleanupOPFSDirectories(): Promise<void> {
  for (const directory of APP_OPFS_DIRECTORIES) {
    await cleanupOPFSDirectory(directory);
  }
}

async function cleanupOPFSDirectory(directory: string): Promise<void> {
  try {
    await deleteOPFSDirectory(directory);
  } catch (error) {
    logDevWarn(`Failed to delete OPFS directory "${directory}":`, error);
  }
}

async function clearCacheData(): Promise<void> {
  await updatePersistedAppDbState(STORAGE_KEYS.SETTINGS, (state) => ({
    ...state,
    marketPlugins: [],
    marketPluginsTimestamp: 0,
    marketMcpServers: [],
    marketMcpServersTimestamp: 0,
    marketAgents: [],
    marketAgentsTimestamp: 0,
    marketAgentsLocale: "",
    skillCatalogs: {},
    skillCatalogTimestamps: {},
    skillDefinitions: {},
    skillDefinitionTimestamps: {},
    modelMetadata: {},
    modelMetadataTimestamp: 0,
  }));
}

async function clearSettingsAndSecrets(): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEYS.CORE_SETTINGS);
    window.localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    window.localStorage.removeItem(FONT_SIZE_STORAGE_KEY);
    window.localStorage.removeItem(APP_RESTORE_CREDENTIAL_NOTICE_KEY);
  }
  await appDb.removeItem(STORAGE_KEYS.SETTINGS);
  await deleteLocalSecretMasterKey();
}

async function clearChatMetadataAndMessages(): Promise<void> {
  await appDb.removeItem(STORAGE_KEYS.CHAT);
  let keys: string[] = [];
  try {
    keys = await appDb.keys();
  } catch (error) {
    logDevWarn("Failed to list chat message records during clear:", error);
  }

  for (const key of keys) {
    if (key.startsWith(SESSION_MESSAGES_PREFIX)) {
      await appDb.removeItem(key);
    }
  }
}

async function clearResearchTasks(): Promise<void> {
  await getResearchTaskRepository().clear();
}

async function clearKnowledgeData(rag: RAGConfig): Promise<void> {
  await cleanupPersistedKnowledgeVectors(rag);
  await cleanupOPFSDirectory("knowledge-base");
  await appDb.removeItem(STORAGE_KEYS.KNOWLEDGE);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEYS.KNOWLEDGE);
  }
}

async function clearMemoryData(): Promise<void> {
  await appDb.removeItem(STORAGE_KEYS.MEMORY);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEYS.MEMORY);
  }
}

export async function clearBrowserAppDataSources({
  sources,
  rag,
}: ClearBrowserAppDataSourcesOptions): Promise<void> {
  await runWithExclusiveAppDataClearLock(async () => {
    const uniqueSources = Array.from(new Set(sources));

    for (const source of uniqueSources) {
      switch (source) {
        case "cache":
          await clearCacheData();
          break;
        case "settings":
          await clearSettingsAndSecrets();
          break;
        case "chats":
          await clearChatMetadataAndMessages();
          await clearResearchTasks();
          break;
        case "chatFiles":
          await cleanupOPFSDirectory("chat");
          break;
        case "workspaceFiles":
          await cleanupOPFSDirectory("workspaces");
          break;
        case "knowledge":
          await clearKnowledgeData(rag);
          break;
        case "memory":
          await clearMemoryData();
          break;
        case "media":
          await cleanupOPFSDirectory("images");
          break;
      }
    }
  });
}

async function clearLocalStorageKeys(): Promise<void> {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(STORAGE_KEYS.CORE_SETTINGS);
  window.localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  window.localStorage.removeItem(STORAGE_KEYS.CHAT);
  window.localStorage.removeItem(STORAGE_KEYS.KNOWLEDGE);
  window.localStorage.removeItem(STORAGE_KEYS.MEMORY);
  window.localStorage.removeItem(FONT_SIZE_STORAGE_KEY);
  window.localStorage.removeItem(APP_RESTORE_CREDENTIAL_NOTICE_KEY);
  await deleteLocalSecretMasterKey();
}

export async function clearBrowserAppData(rag: RAGConfig): Promise<void> {
  await runWithExclusiveAppDataClearLock(async () => {
    await cleanupPersistedKnowledgeVectors(rag);
    await cleanupOPFSDirectories();
    await clearLocalStorageKeys();
    await clearResearchTasks();
    await localforage.clear();
    await appDb.clear();
    await clearLocalSyncState();
  });
}
