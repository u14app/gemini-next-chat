import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RAGConfig } from "../types";

const {
  appDbMock,
  dirMock,
  encryptSecretMock,
  localforageClearMock,
  researchRepositoryMock,
  syncStorageClearMock,
  removeMock,
  tokenSecret,
  revokeSharesMock,
} = vi.hoisted(() => {
  const tokenSecret = {
    v: 1,
    kid: "test-key",
    alg: "RSA-OAEP-256+A256GCM",
    iv: "iv",
    wrappedKey: "wrapped",
    ciphertext: "ciphertext",
    context: "rag:token",
  } as const;
  const removeMock = vi.fn(() => Promise.resolve());
  return {
    appDbMock: {
      getItem: vi.fn(async (key: string) => {
        void key;
        return undefined as unknown;
      }),
      setItem: vi.fn(async (key: string, value: unknown) => {
        void key;
        void value;
      }),
      removeItem: vi.fn(async (key: string) => {
        void key;
      }),
      keys: vi.fn(async (): Promise<string[]> => []),
      clear: vi.fn(async () => undefined),
    },
    dirMock: vi.fn(() => ({
      exists: vi.fn(() => Promise.resolve(true)),
      remove: removeMock,
    })),
    encryptSecretMock: vi.fn(async () => tokenSecret),
    localforageClearMock: vi.fn(() => Promise.resolve()),
    researchRepositoryMock: {
      clear: vi.fn(async () => undefined),
    },
    syncStorageClearMock: vi.fn(() => Promise.resolve()),
    removeMock,
    tokenSecret,
    revokeSharesMock: vi.fn(async () => undefined),
  };
});

vi.mock("localforage", () => ({
  default: {
    clear: localforageClearMock,
    createInstance: vi.fn(() => ({
      clear: syncStorageClearMock,
    })),
  },
}));

vi.mock("opfs-tools", () => ({
  dir: dirMock,
  file: vi.fn(),
  write: vi.fn(),
}));

vi.mock("../store/storage/storageConfig", () => ({
  appDb: appDbMock,
  STORAGE_KEYS: {
    CORE_SETTINGS: "neo-chat-core-settings",
    SETTINGS: "neo-chat-settings",
    CHAT: "neo-chat-storage",
    KNOWLEDGE: "knowledge-storage",
    MEMORY: "neo-chat-memory",
  },
}));

vi.mock("../lib/byok/client", () => ({
  encryptSecret: encryptSecretMock,
  fetchWithByokRetry: vi.fn((requestFactory) => requestFactory()),
}));

vi.mock("../lib/api/client", async () => {
  const actual = await vi.importActual("../lib/api/client");
  return {
    ...actual,
    signedApiFetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init),
    ),
  };
});

vi.mock("../services/research", () => ({
  getResearchTaskRepository: () => researchRepositoryMock,
}));

vi.mock("@/services/sharing/client", () => ({
  revokeAllSessionSharesBeforeDelete: revokeSharesMock,
}));

const { clearBrowserAppData, clearBrowserAppDataSources } =
  await import("../lib/data/clearAppData");
const { APP_RESTORE_WRITE_LOCK_KEY, runWithAppDataWriteLock } =
  await import("../lib/data/appRestoreJournal");
const { deleteOPFSDirectory } = await import("../utils/opfs");

function createLocalStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

function createSerialWebLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request: vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1] as () => unknown;
      const current = tail.then(callback);
      tail = current.then(
        () => undefined,
        () => undefined,
      );
      return current;
    }),
  };
}

const ragConfig: RAGConfig = {
  enabled: true,
  url: "https://rag.example.com",
  token: "secret",
  topK: 10,
  chunkSize: 512,
  documentParseProvider: "mineru",
  mineruApiToken: "",
  llamaParseApiKey: "",
};

describe("clear app data", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createLocalStorage() });
    vi.clearAllMocks();
    revokeSharesMock.mockReset().mockResolvedValue(undefined);
    encryptSecretMock.mockResolvedValue(tokenSecret);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    appDbMock.getItem.mockResolvedValue(
      JSON.stringify({
        state: {
          collections: [
            {
              id: "collection-1",
              files: [
                {
                  id: "file-1",
                  ragId: "file-1",
                  ragChunkCount: 2,
                },
                {
                  id: "file-2",
                  ragId: "file-2",
                },
              ],
            },
          ],
        },
      }),
    );
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem?.(APP_RESTORE_WRITE_LOCK_KEY);
    }
    vi.unstubAllGlobals();
  });

  it("cleans persisted RAG vectors and OPFS directories before clearing storage", async () => {
    await clearBrowserAppData(ragConfig);

    expect(syncStorageClearMock).toHaveBeenCalledOnce();

    expect(fetch).toHaveBeenCalledWith(
      "/api/rag/delete",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"namespace":"collection-1"'),
      }),
    );
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const requestBodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1].body),
    );
    expect(JSON.stringify(requestBodies[0])).not.toContain("secret");
    expect(requestBodies[0].tokenSecret).toEqual(tokenSecret);
    const allIds = requestBodies.flatMap((body) => body.ids);
    expect(allIds.slice(0, 3)).toEqual(["file-1_0", "file-1_1", "file-2_0"]);
    expect(allIds).toHaveLength(1002);

    expect(dirMock).toHaveBeenCalledWith("knowledge-base");
    expect(dirMock).toHaveBeenCalledWith("workspaces");
    expect(removeMock).toHaveBeenCalledWith({ force: true });

    expect(appDbMock.getItem.mock.invocationCallOrder[0]).toBeLessThan(
      appDbMock.clear.mock.invocationCallOrder[0],
    );
    expect(localforageClearMock).toHaveBeenCalled();
    expect(appDbMock.clear).toHaveBeenCalled();
    expect(researchRepositoryMock.clear).toHaveBeenCalledOnce();
  });

  it("continues local cleanup when RAG token encryption fails", async () => {
    encryptSecretMock.mockRejectedValueOnce(
      new Error("public key unavailable"),
    );

    await clearBrowserAppData(ragConfig);

    expect(fetch).not.toHaveBeenCalled();
    expect(dirMock).toHaveBeenCalledWith("knowledge-base");
    expect(localforageClearMock).toHaveBeenCalled();
    expect(appDbMock.clear).toHaveBeenCalled();
  });

  it("clears cache metadata without clearing user settings or stores", async () => {
    appDbMock.getItem.mockResolvedValueOnce(
      JSON.stringify({
        state: {
          marketPlugins: [{ id: "cached-plugin" }],
          marketPluginsTimestamp: 123,
          marketAgents: [{ identifier: "cached-agent" }],
          marketAgentsTimestamp: 456,
          marketAgentsLocale: "zh",
          skillCatalogs: { en: { skills: [] } },
          skillCatalogTimestamps: { en: 789 },
          skillDefinitions: { "en:test.json": { id: "test" } },
          skillDefinitionTimestamps: { "en:test.json": 999 },
          modelMetadata: { "gpt-test": { id: "gpt-test" } },
          modelMetadataTimestamp: 321,
          installedPlugins: [{ id: "keep-plugin" }],
        },
        version: 4,
      }),
    );

    await clearBrowserAppDataSources({
      sources: ["cache"],
      rag: ragConfig,
    });

    expect(appDbMock.clear).not.toHaveBeenCalled();
    expect(localforageClearMock).not.toHaveBeenCalled();
    expect(appDbMock.removeItem).not.toHaveBeenCalled();
    expect(appDbMock.setItem).toHaveBeenCalledWith(
      "neo-chat-settings",
      expect.stringContaining('"installedPlugins":[{"id":"keep-plugin"}]'),
    );
    const saved = JSON.parse(appDbMock.setItem.mock.calls[0][1] as string);
    expect(saved.state).toMatchObject({
      marketPlugins: [],
      marketPluginsTimestamp: 0,
      marketAgents: [],
      marketAgentsTimestamp: 0,
      marketAgentsLocale: "",
      skillCatalogs: {},
      skillCatalogTimestamps: {},
      skillDefinitions: {},
      skillDefinitionTimestamps: {},
      modelMetadata: {},
      modelMetadataTimestamp: 0,
    });
  });

  it("does not clear data while a restore write gate is active", async () => {
    const values = new Map([[APP_RESTORE_WRITE_LOCK_KEY, "restore-1"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
      },
    });

    await expect(
      clearBrowserAppDataSources({ sources: ["chats"], rag: ragConfig }),
    ).rejects.toThrow("writes are paused");
    expect(appDbMock.removeItem).not.toHaveBeenCalled();
  });

  it("drains accepted Web Lock writes and rejects writes requested after clear", async () => {
    const localStorage = createLocalStorage();
    const locks = createSerialWebLocks();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", { locks });
    const writeCompleted = vi.fn();
    const lateWrite = vi.fn();
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const acceptedWrite = runWithAppDataWriteLock(async () => {
      markWriteStarted?.();
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      writeCompleted();
    });
    await writeStarted;

    const clear = clearBrowserAppDataSources({
      sources: ["chats"],
      rag: ragConfig,
    });
    await expect(runWithAppDataWriteLock(lateWrite)).rejects.toThrow(
      "writes are paused",
    );
    const queuedCrossContextWrite = locks.request(
      "neo-chat-app-data",
      { mode: "shared" },
      async () => {
        if (localStorage.getItem(APP_RESTORE_WRITE_LOCK_KEY)) {
          throw new Error("cross-context write gate is active");
        }
        lateWrite();
      },
    );
    const crossContextResult = expect(queuedCrossContextWrite).rejects.toThrow(
      "cross-context write gate is active",
    );
    expect(appDbMock.removeItem).not.toHaveBeenCalled();

    releaseWrite?.();
    await Promise.all([acceptedWrite, clear, crossContextResult]);

    expect(writeCompleted).toHaveBeenCalledTimes(1);
    expect(lateWrite).not.toHaveBeenCalled();
    expect(writeCompleted.mock.invocationCallOrder[0]).toBeLessThan(
      appDbMock.removeItem.mock.invocationCallOrder[0],
    );
    expect(localStorage.values.get(APP_RESTORE_WRITE_LOCK_KEY)).toMatch(
      /^clear-/,
    );
  });

  it("releases its persistent write gate when clear fails", async () => {
    const localStorage = createLocalStorage();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", { locks: createSerialWebLocks() });
    appDbMock.removeItem.mockRejectedValueOnce(
      new Error("simulated clear failure"),
    );

    await expect(
      clearBrowserAppDataSources({ sources: ["chats"], rag: ragConfig }),
    ).rejects.toThrow("simulated clear failure");

    expect(localStorage.values.has(APP_RESTORE_WRITE_LOCK_KEY)).toBe(false);
  });

  it("keeps all local data when share revocation fails", async () => {
    revokeSharesMock.mockRejectedValueOnce(
      new Error("Share revocation failed"),
    );
    await expect(clearBrowserAppData(ragConfig)).rejects.toThrow(
      "Share revocation failed",
    );
    expect(appDbMock.clear).not.toHaveBeenCalled();
    expect(appDbMock.removeItem).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
    expect(researchRepositoryMock.clear).not.toHaveBeenCalled();
  });

  it("revokes shares before clearing settings and their local encryption key", async () => {
    revokeSharesMock.mockRejectedValueOnce(
      new Error("Share revocation failed"),
    );
    await expect(
      clearBrowserAppDataSources({ sources: ["settings"], rag: ragConfig }),
    ).rejects.toThrow("Share revocation failed");
    expect(appDbMock.removeItem).not.toHaveBeenCalled();
  });

  it("clears chat metadata and per-session message records when requested", async () => {
    appDbMock.keys.mockResolvedValueOnce([
      "neo-chat-storage",
      "session_messages_a",
      "session_messages_b",
      "unrelated",
    ]);

    await clearBrowserAppDataSources({
      sources: ["chats"],
      rag: ragConfig,
    });

    expect(appDbMock.removeItem).toHaveBeenCalledWith("neo-chat-storage");
    expect(appDbMock.removeItem).toHaveBeenCalledWith("session_messages_a");
    expect(appDbMock.removeItem).toHaveBeenCalledWith("session_messages_b");
    expect(appDbMock.removeItem).not.toHaveBeenCalledWith("unrelated");
    expect(appDbMock.clear).not.toHaveBeenCalled();
    expect(researchRepositoryMock.clear).toHaveBeenCalledOnce();
  });

  it("clears the synchronous font preference with settings", async () => {
    const localStorage = createLocalStorage();
    vi.stubGlobal("window", { localStorage });

    await clearBrowserAppDataSources({
      sources: ["settings"],
      rag: ragConfig,
    });

    expect(localStorage.removeItem).toHaveBeenCalledWith("neo-chat-font-size");
  });

  it("clears knowledge metadata, vectors, and OPFS knowledge files when requested", async () => {
    await clearBrowserAppDataSources({
      sources: ["knowledge"],
      rag: ragConfig,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/rag/delete",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"namespace":"collection-1"'),
      }),
    );
    expect(dirMock).toHaveBeenCalledWith("knowledge-base");
    expect(appDbMock.removeItem).toHaveBeenCalledWith("knowledge-storage");
    expect(appDbMock.clear).not.toHaveBeenCalled();
  });

  it("rejects unsafe OPFS directory paths", async () => {
    await deleteOPFSDirectory("../secret");

    expect(dirMock).not.toHaveBeenCalled();
  });
});
