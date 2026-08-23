import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import {
  ensureLegacyGeminiCoreSettingsMigration,
  ensureLegacyGeminiNextChatMigration,
} from "./legacyGeminiMigration";
import { logDevError } from "@/lib/utils/devLogger";
import {
  isAppRestoreHydrationInProgress,
  prepareAppRestoreHydration,
  runWithAppRestoreHydrationWriteLock,
  type AppRestoreDb,
  type AppRestoreSnapshot,
} from "@/lib/data/appRestoreJournal";
import { isSessionMessageTree } from "@/lib/chat/messageTree";

/**
 * Storage Configuration
 * Unified IndexedDB storage for all application data
 */

// Unified storage with multiple stores
export const appDb = localforage.createInstance({
  name: "neo-chat",
  storeName: "app_data",
  description: "Unified application storage",
});

export const STORAGE_VERSION = 6;
export type StorageVersion = typeof STORAGE_VERSION;

export const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const SESSION_MESSAGES_PREFIX = "session_messages_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStoredValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Restored ${label} data is not valid JSON.`);
  }
}

function validatePersistedChatState(value: unknown): Map<string, number> {
  const sessionMessageCounts = new Map<string, number>();
  if (value === null || value === undefined) return sessionMessageCounts;
  const persisted = parseStoredValue(value, "chat");
  if (!isRecord(persisted) || !isRecord(persisted.state)) {
    throw new Error("Restored chat data has an invalid persisted state.");
  }

  const sessions = persisted.state.sessions;
  if (sessions !== undefined && !Array.isArray(sessions)) {
    throw new Error("Restored chat sessions must be an array.");
  }
  const sessionIds = new Set<string>();
  for (const session of sessions || []) {
    if (!isRecord(session) || typeof session.id !== "string") {
      throw new Error("Restored chat data contains an invalid session.");
    }
    const id = session.id;
    if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(id) || sessionIds.has(id)) {
      throw new Error(
        "Restored chat data contains an invalid or duplicate session identifier.",
      );
    }
    if (
      typeof session.messageCount !== "number" ||
      !Number.isInteger(session.messageCount) ||
      session.messageCount < 0
    ) {
      throw new Error(
        "Restored chat data contains an invalid session message count.",
      );
    }
    sessionIds.add(id);
    sessionMessageCounts.set(id, session.messageCount);
  }

  const currentSessionId = persisted.state.currentSessionId;
  if (
    currentSessionId !== undefined &&
    currentSessionId !== null &&
    (typeof currentSessionId !== "string" || !sessionIds.has(currentSessionId))
  ) {
    throw new Error(
      "Restored chat data points to a session that does not exist.",
    );
  }

  return sessionMessageCounts;
}

function validateStoredMessageTree(value: unknown, key: string): number {
  const parsed = parseStoredValue(value, key);
  if (!Array.isArray(parsed) && !isSessionMessageTree(parsed)) {
    throw new Error(`Restored message data in ${key} has an invalid shape.`);
  }
  const isValidMessage = (
    message: unknown,
  ): message is Record<string, unknown> & {
    id: string;
    role: "user" | "model";
    content: string;
  } =>
    isRecord(message) &&
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "model") &&
    typeof message.content === "string";

  if (Array.isArray(parsed)) {
    const messageIds = new Set<string>();
    for (const message of parsed) {
      if (!isValidMessage(message) || messageIds.has(message.id)) {
        throw new Error(`Restored message data in ${key} is inconsistent.`);
      }
      messageIds.add(message.id);
    }
    return parsed.length;
  }

  const rootIds = new Set(parsed.rootMessageIds);
  if (
    rootIds.size !== parsed.rootMessageIds.length ||
    !parsed.rootMessageIds.every(
      (id) => typeof id === "string" && isRecord(parsed.nodesById[id]),
    ) ||
    (parsed.activeRootMessageId !== undefined &&
      (typeof parsed.activeRootMessageId !== "string" ||
        !rootIds.has(parsed.activeRootMessageId)))
  ) {
    throw new Error(`Restored message data in ${key} is inconsistent.`);
  }

  for (const [nodeId, node] of Object.entries(parsed.nodesById)) {
    if (
      !isRecord(node) ||
      node.id !== nodeId ||
      !isValidMessage(node.message) ||
      node.message.id !== nodeId ||
      (node.parentMessageId !== undefined &&
        typeof node.parentMessageId !== "string") ||
      !Array.isArray(node.childMessageIds) ||
      !node.childMessageIds.every((id) => typeof id === "string") ||
      new Set(node.childMessageIds).size !== node.childMessageIds.length ||
      (node.activeChildMessageId !== undefined &&
        (typeof node.activeChildMessageId !== "string" ||
          !node.childMessageIds.includes(node.activeChildMessageId)))
    ) {
      throw new Error(`Restored message data in ${key} is inconsistent.`);
    }

    if (node.parentMessageId === undefined) {
      if (!rootIds.has(nodeId)) {
        throw new Error(`Restored message data in ${key} is inconsistent.`);
      }
    } else {
      const parent = parsed.nodesById[node.parentMessageId];
      if (
        !isRecord(parent) ||
        !Array.isArray(parent.childMessageIds) ||
        !parent.childMessageIds.includes(nodeId) ||
        rootIds.has(nodeId)
      ) {
        throw new Error(`Restored message data in ${key} is inconsistent.`);
      }
    }

    for (const childId of node.childMessageIds) {
      const child = parsed.nodesById[childId];
      if (!isRecord(child) || child.parentMessageId !== nodeId) {
        throw new Error(`Restored message data in ${key} is inconsistent.`);
      }
    }
  }

  const visited = new Set<string>();
  const pending = [...parsed.rootMessageIds];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (visited.has(nodeId)) {
      throw new Error(`Restored message data in ${key} is inconsistent.`);
    }
    visited.add(nodeId);
    pending.push(...parsed.nodesById[nodeId].childMessageIds);
  }
  if (visited.size !== Object.keys(parsed.nodesById).length) {
    throw new Error(`Restored message data in ${key} is inconsistent.`);
  }

  let activeMessageCount = 0;
  let activeMessageId: string | undefined =
    parsed.activeRootMessageId || parsed.rootMessageIds[0];
  while (activeMessageId) {
    activeMessageCount += 1;
    activeMessageId = parsed.nodesById[activeMessageId].activeChildMessageId;
  }
  return activeMessageCount;
}

type AppRestoreValidationDb = AppRestoreDb & {
  keys(): Promise<string[]>;
};

export async function validateRestoredAppData(
  snapshot: AppRestoreSnapshot,
  db: AppRestoreValidationDb = appDb,
): Promise<void> {
  const sessionMessageCounts = validatePersistedChatState(
    await db.getItem(STORAGE_KEYS.CHAT),
  );
  const keys = await db.keys();
  const restoredMessageKeys = keys.filter((key) =>
    key.startsWith(SESSION_MESSAGES_PREFIX),
  );
  const restoredSessionIds = new Set<string>();
  for (const key of restoredMessageKeys) {
    const sessionId = key.slice(SESSION_MESSAGES_PREFIX.length);
    const actualMessageCount = validateStoredMessageTree(
      await db.getItem(key),
      key,
    );
    const expectedMessageCount = sessionMessageCounts.get(sessionId);
    if (expectedMessageCount === undefined) {
      throw new Error(
        `Restored message data in ${key} has no matching chat session.`,
      );
    }
    if (actualMessageCount !== expectedMessageCount) {
      throw new Error(
        `Restored message data in ${key} does not match the session message count.`,
      );
    }
    restoredSessionIds.add(sessionId);
  }
  for (const [sessionId, messageCount] of sessionMessageCounts) {
    if (messageCount > 0 && !restoredSessionIds.has(sessionId)) {
      throw new Error(
        `Restored chat session ${sessionId} has no matching message data.`,
      );
    }
  }

  const unexpectedManagedKey = snapshot.managedDbKeys.find(
    (key) =>
      !Object.values(STORAGE_KEYS).includes(
        key as (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS],
      ) && !key.startsWith(SESSION_MESSAGES_PREFIX),
  );
  if (unexpectedManagedKey) {
    throw new Error("Restore snapshot contains an unsupported storage key.");
  }
}

function prepareBrowserAppRestoreHydration(): Promise<void> | undefined {
  if (typeof window === "undefined") return undefined;

  return prepareAppRestoreHydration({
    db: appDb,
    localStorageRef: window.localStorage,
    deleteOpfsUrl: async (url) => {
      const { deleteFromOPFS } = await import("@/utils/opfs");
      await deleteFromOPFS(url);
    },
    validateRestoredData: validateRestoredAppData,
  });
}

let browserSyncRecoveryImport: Promise<void> | undefined;

/**
 * A sync materialization may have been interrupted after only some persisted
 * stores were replaced. Every application store waits on this shared recovery
 * barrier before its first hydration read or write, so a reloaded page cannot
 * observe or persist the mixed state.
 */
function prepareBrowserSyncApplyRecovery(): Promise<void> | undefined {
  if (typeof window === "undefined") return undefined;
  browserSyncRecoveryImport ||= import("@/lib/sync/applyJournal").then(
    ({ prepareBrowserSyncApplyRecovery: prepare }) => prepare(),
  );
  return browserSyncRecoveryImport;
}

function prepareBrowserAppDataHydration(): Promise<void> | undefined {
  const syncRecovery = prepareBrowserSyncApplyRecovery();
  if (!syncRecovery) return prepareBrowserAppRestoreHydration();
  return syncRecovery.then(() => prepareBrowserAppRestoreHydration());
}

export const getAppDbStorage = (): StateStorage => {
  if (typeof window === "undefined") return noopStorage;
  return {
    getItem: async (name) => {
      await prepareBrowserAppDataHydration();
      if (!isAppRestoreHydrationInProgress()) {
        try {
          await ensureLegacyGeminiNextChatMigration({
            targetDb: appDb,
            localStorageRef: window.localStorage,
            storageKeys: STORAGE_KEYS,
          });
        } catch (error) {
          logDevError("Legacy Gemini data migration failed:", error);
        }
      }
      return appDb.getItem<string>(name);
    },
    setItem: async (name, value) => {
      await prepareBrowserAppDataHydration();
      return runWithAppRestoreHydrationWriteLock(() =>
        appDb.setItem(name, value),
      );
    },
    removeItem: async (name) => {
      await prepareBrowserAppDataHydration();
      return runWithAppRestoreHydrationWriteLock(() => appDb.removeItem(name));
    },
  };
};

export const getBrowserLocalStorage = (): StateStorage => {
  if (typeof window === "undefined") return noopStorage;
  const readItem = (name: string) => {
    if (!isAppRestoreHydrationInProgress()) {
      try {
        ensureLegacyGeminiCoreSettingsMigration({
          localStorageRef: window.localStorage,
          storageKeys: STORAGE_KEYS,
        });
      } catch (error) {
        logDevError("Legacy Gemini core settings migration failed:", error);
      }
    }
    return window.localStorage.getItem(name);
  };

  return {
    getItem: (name) => {
      const preparation = prepareBrowserAppDataHydration();
      return preparation
        ? preparation.then(() => readItem(name))
        : readItem(name);
    },
    setItem: async (name, value) => {
      await prepareBrowserAppDataHydration();
      return runWithAppRestoreHydrationWriteLock(async () => {
        window.localStorage.setItem(name, value);
      });
    },
    removeItem: async (name) => {
      await prepareBrowserAppDataHydration();
      return runWithAppRestoreHydrationWriteLock(async () => {
        window.localStorage.removeItem(name);
      });
    },
  };
};

// Storage keys
export const STORAGE_KEYS = {
  // Core settings (localStorage via zustand default)
  CORE_SETTINGS: "neo-chat-core-settings",

  // Store names (IndexedDB)
  SETTINGS: "neo-chat-settings",
  CHAT: "neo-chat-storage",
  KNOWLEDGE: "knowledge-storage",
  MEMORY: "neo-chat-memory",
  AGENT_PROFILE_REVISIONS: "neo-chat-agent-profile-revisions",
} as const;
