import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicServerConfig } from "../lib/defaultConfig/shared";
import { SERVER_DEFAULT_PROVIDER_ID } from "../lib/defaultConfig/shared";

const { appDbMock, dbValues, coreMigrationMock, nextChatMigrationMock } =
  vi.hoisted(() => {
    const dbValues = new Map<string, unknown>();
    return {
      dbValues,
      coreMigrationMock: vi.fn(),
      nextChatMigrationMock: vi.fn(async () => undefined),
      appDbMock: {
        getItem: vi.fn(async (key: string) => dbValues.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => {
          dbValues.set(key, value);
          return value;
        }),
        removeItem: vi.fn(async (key: string) => {
          dbValues.delete(key);
        }),
        keys: vi.fn(async () => [...dbValues.keys()]),
      },
    };
  });

vi.mock("localforage", () => ({
  default: { createInstance: vi.fn(() => appDbMock) },
}));

vi.mock("../store/storage/legacyGeminiMigration", () => ({
  ensureLegacyGeminiCoreSettingsMigration: coreMigrationMock,
  ensureLegacyGeminiNextChatMigration: nextChatMigrationMock,
}));

import {
  APP_RESTORE_HYDRATION_TARGETS,
  APP_RESTORE_JOURNAL_KEY,
  APP_RESTORE_SNAPSHOT_KEY,
  APP_RESTORE_WRITE_LOCK_KEY,
  reportAppRestoreHydration,
  type AppRestoreSnapshot,
} from "../lib/data/appRestoreJournal";
import {
  STORAGE_KEYS,
  getAppDbStorage,
  getBrowserLocalStorage,
} from "../store/storage/storageConfig";

function createLocalStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    values,
  };
}

describe("restore hydration storage boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    dbValues.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not merge legacy Gemini data into a restored database", async () => {
    const transactionId = "restore-no-legacy-merge";
    const snapshot: AppRestoreSnapshot = {
      version: 1,
      transactionId,
      managedDbKeys: [
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.CHAT,
        STORAGE_KEYS.KNOWLEDGE,
        STORAGE_KEYS.MEMORY,
        "session_messages_session1",
      ],
      dbEntries: [],
      localStorageEntries: [],
      stagedOpfsUrls: [],
      previousOpfsUrls: [],
    };
    dbValues.set(APP_RESTORE_SNAPSHOT_KEY, snapshot);
    dbValues.set(
      STORAGE_KEYS.CHAT,
      JSON.stringify({
        state: {
          sessions: [
            {
              id: "session1",
              title: "Restored",
              messageCount: 1,
              model: "provider:model",
              updatedAt: 1,
            },
          ],
          currentSessionId: "session1",
          workspaces: [],
        },
        version: 5,
      }),
    );
    dbValues.set("session_messages_session1", {
      nodesById: {
        message1: {
          id: "message1",
          message: {
            id: "message1",
            role: "user",
            content: "restored message",
            timestamp: 1,
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message1"],
      activeRootMessageId: "message1",
    });
    const localStorage = createLocalStorage({
      [STORAGE_KEYS.CORE_SETTINGS]: JSON.stringify({
        state: { theme: "dark" },
        version: 5,
      }),
      [APP_RESTORE_JOURNAL_KEY]: JSON.stringify({
        version: 1,
        transactionId,
        phase: "applied_pending_boot",
      }),
      [APP_RESTORE_WRITE_LOCK_KEY]: transactionId,
    });
    vi.stubGlobal("window", { localStorage });

    await getAppDbStorage().getItem(STORAGE_KEYS.CHAT);
    await getBrowserLocalStorage().getItem(STORAGE_KEYS.CORE_SETTINGS);

    expect(nextChatMigrationMock).not.toHaveBeenCalled();
    expect(coreMigrationMock).not.toHaveBeenCalled();

    await Promise.all(
      APP_RESTORE_HYDRATION_TARGETS.map((target) =>
        reportAppRestoreHydration(target),
      ),
    );
    expect(localStorage.values.has(APP_RESTORE_JOURNAL_KEY)).toBe(false);
    expect(dbValues.has(APP_RESTORE_SNAPSHOT_KEY)).toBe(false);
  });

  it("rehydrates restored providers before rebuilding the target server default", async () => {
    const localStorage = createLocalStorage({
      [STORAGE_KEYS.CORE_SETTINGS]: JSON.stringify({
        state: {
          theme: "dark",
          language: "zh",
          providers: [
            {
              id: "FIRST",
              name: "First provider",
              type: "OpenAI Compatible",
              baseUrl: "https://first.example/v1",
              apiKey: "",
              enabled: true,
              directCall: true,
              models: ["first-model"],
              modelsList: ["first-model", "first-preview"],
            },
            {
              id: "SECOND",
              name: "Second provider",
              type: "Anthropic",
              baseUrl: "https://second.example/v1",
              apiKey: "",
              enabled: false,
              directCall: false,
              models: ["second-model"],
              modelsList: ["second-model"],
            },
          ],
          defaultModels: {
            titleGeneration: "FIRST:first-model",
            relatedQuestions: "",
            contextCompression: "",
            promptOptimization: "",
            ragQuery: "",
            memory: "",
          },
        },
        version: 5,
      }),
    });
    vi.stubGlobal("window", {
      localStorage,
      location: { reload: vi.fn() },
    });

    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");
    await useCoreSettingsStore.persist.rehydrate();
    await vi.dynamicImportSettled();

    expect(
      useCoreSettingsStore.getState().providers.map((provider) => provider.id),
    ).toEqual(["FIRST", "SECOND"]);
    expect(useCoreSettingsStore.getState().providers).toEqual([
      {
        id: "FIRST",
        name: "First provider",
        type: "OpenAI Compatible",
        baseUrl: "https://first.example/v1",
        apiKey: "",
        enabled: true,
        directCall: true,
        models: ["first-model"],
        modelsList: ["first-model", "first-preview"],
      },
      {
        id: "SECOND",
        name: "Second provider",
        type: "Anthropic",
        baseUrl: "https://second.example/v1",
        apiKey: "",
        enabled: false,
        directCall: false,
        models: ["second-model"],
        modelsList: ["second-model"],
      },
    ]);
    expect(useCoreSettingsStore.getState().defaultModels).toEqual({
      titleGeneration: "FIRST:first-model",
      relatedQuestions: "",
      contextCompression: "",
      promptOptimization: "",
      ragQuery: "",
      memory: "",
    });

    const targetServerConfig: PublicServerConfig = {
      modelProvider: {
        available: true,
        id: SERVER_DEFAULT_PROVIDER_ID,
        name: "Target deployment provider",
        type: "Google",
        models: ["target-model"],
        defaultModels: {
          relatedQuestions: "target-model",
          memory: "target-model",
        },
        modelMetadata: {},
      },
      search: { available: false },
      rag: {
        vectorStoreAvailable: false,
        documentProcessingAvailable: false,
      },
      voice: {
        elevenLabsAvailable: false,
        mimoAvailable: false,
        defaultSttAvailable: false,
        defaultTtsAvailable: false,
      },
      limits: { attachments: { maxFileBytes: 10 * 1024 * 1024 } },
    };

    useCoreSettingsStore.getState().applyServerConfig(targetServerConfig);

    const state = useCoreSettingsStore.getState();
    expect(state.providers.map((provider) => provider.id)).toEqual([
      SERVER_DEFAULT_PROVIDER_ID,
      "FIRST",
      "SECOND",
    ]);
    expect(state.providers[0]).toMatchObject({
      id: SERVER_DEFAULT_PROVIDER_ID,
      name: "Target deployment provider",
      type: "Google",
      baseUrl: "default",
      models: ["target-model"],
      modelsList: ["target-model"],
      isServerDefault: true,
    });
    expect(JSON.stringify(state.providers)).not.toContain(
      "Source deployment provider",
    );
    expect(JSON.stringify(state.providers)).not.toContain("source-model");
    expect(state.providers.slice(1)).toEqual([
      expect.objectContaining({ id: "FIRST", directCall: true }),
      expect.objectContaining({ id: "SECOND", directCall: false }),
    ]);
    expect(state.defaultModels).toEqual({
      titleGeneration: "FIRST:first-model",
      relatedQuestions: "SERVER_DEFAULT:target-model",
      contextCompression: "",
      promptOptimization: "",
      ragQuery: "",
      memory: "SERVER_DEFAULT:target-model",
    });
  });
});
