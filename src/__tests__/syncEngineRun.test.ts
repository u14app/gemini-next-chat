import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRemoteClient } from "@/lib/sync/remoteClient";
import type {
  CapturedSyncSnapshot,
  LocalSyncPayloadDocument,
} from "@/lib/sync/snapshot";
import type { SyncRunConfiguration } from "@/lib/sync/types";

const mocks = vi.hoisted(() => {
  const remoteObjects = new Map<string, Uint8Array>();
  return {
    appliedData: undefined as unknown,
    applySyncedAppData: vi.fn(async (...args: unknown[]) => {
      void args;
      return false;
    }),
    assembledIds: [] as string[],
    captureLocalSyncSnapshot: vi.fn(),
    collectReferencedOpfsUrls: vi.fn(() => [] as string[]),
    documents: new Map<string, Uint8Array>(),
    get: vi.fn(async (path: string) => {
      const bytes = remoteObjects.get(path);
      if (!bytes) throw new Error(`Missing remote object: ${path}`);
      return bytes;
    }),
    list: vi.fn(async (prefix: string) =>
      [...remoteObjects].flatMap(([path, bytes]) =>
        path.startsWith(prefix) ? [{ path, size: bytes.byteLength }] : [],
      ),
    ),
    put: vi.fn(async (path: string, bytes: Uint8Array) => {
      remoteObjects.set(path, bytes);
    }),
    remoteObjects,
    resolveOPFSBlob: vi.fn(async (...args: unknown[]) => {
      void args;
      return undefined as Blob | undefined;
    }),
  };
});

vi.mock("@/lib/data/appExport", () => ({
  collectReferencedOpfsUrls: mocks.collectReferencedOpfsUrls,
}));

vi.mock("@/lib/security/localSecrets", () => ({
  decryptLocalSecret: vi.fn(async () => "AA"),
  LOCAL_SECRET_CONTEXTS: { syncRootKey: "local:sync:root-key" },
}));

vi.mock("@/lib/sync/applyJournal", () => ({
  ensureInterruptedBrowserSyncApplyRecovery: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync/crypto", () => ({
  decryptSyncBytes: vi.fn(async (_key, envelope: { ciphertext: string }) =>
    Uint8Array.from(JSON.parse(envelope.ciphertext) as number[]),
  ),
  deriveOpaqueObjectName: vi.fn(async (_key, input: string) => input),
  deriveVaultId: vi.fn(async () => "vault-a"),
  encryptSyncBytes: vi.fn(async (_key, bytes: Uint8Array) => ({
    formatVersion: 1,
    algorithm: "A256GCM",
    iv: "iv",
    aad: "aad",
    ciphertext: JSON.stringify([...bytes]),
    plaintextBytes: bytes.byteLength,
  })),
  parseRecoveryCode: vi.fn(),
  sha256Base64Url: vi.fn(async () => "hash"),
  splitSyncChunks: vi.fn((bytes: Uint8Array) => [bytes]),
}));

vi.mock("@/lib/sync/deviceIdentity", () => ({
  getSyncDeviceId: () => "device-a",
}));

vi.mock("@/lib/sync/remoteClient", () => ({
  createSyncRemoteClient: vi.fn(
    async () =>
      ({
        test: vi.fn(async () => undefined),
        list: mocks.list,
        head: vi.fn(async () => ({ ok: true as const, exists: false })),
        get: mocks.get,
        put: mocks.put,
      }) satisfies SyncRemoteClient,
  ),
}));

vi.mock("@/lib/sync/snapshot", () => ({
  applySyncedAppData: mocks.applySyncedAppData,
  assembleSyncDocuments: vi.fn((documents: Map<string, unknown>) => {
    mocks.assembledIds = [...documents.keys()];
    const payload = (id: string) =>
      (documents.get(id) as { payload?: unknown } | undefined)?.payload;
    return {
      session: payload("session:session-1"),
      messages: payload("session-messages:session-1"),
    };
  }),
  captureLocalSyncSnapshot: mocks.captureLocalSyncSnapshot,
  getBlobManifestPayload: vi.fn((entries: Array<{ url: string }>) =>
    Object.fromEntries(entries.map((entry) => [entry.url, entry])),
  ),
}));

vi.mock("@/lib/sync/storage", () => ({
  clearLocalSyncDocuments: vi.fn(async () => mocks.documents.clear()),
  readLocalSyncDocument: vi.fn(async (id: string) => mocks.documents.get(id)),
  writeLocalSyncDocument: vi.fn(async (id: string, bytes: Uint8Array) => {
    mocks.documents.set(id, bytes);
  }),
}));

vi.mock("@/utils/opfs", () => ({
  resolveOPFSBlob: mocks.resolveOPFSBlob,
}));

const configuration = {
  enabled: true,
  provider: { kind: "webdav", baseUrl: "https://sync.test", rootPath: "/" },
  credentialSecret: {},
  rootKeySecret: {},
  vaultId: "vault-a",
  deviceName: "Device A",
} as SyncRunConfiguration;

function captured(
  documents: LocalSyncPayloadDocument[],
  referencedOpfsUrls: string[] = [],
): CapturedSyncSnapshot {
  return {
    exported: { data: {} } as CapturedSyncSnapshot["exported"],
    documents,
    referencedOpfsUrls,
  };
}

function encryptedDocument(bytes: Uint8Array): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      formatVersion: 1,
      algorithm: "A256GCM",
      iv: "iv",
      aad: "aad",
      ciphertext: JSON.stringify([...bytes]),
      plaintextBytes: bytes.byteLength,
    }),
  );
}

function remoteDocumentPath(logicalId: string): string {
  return `v1/vault:vault-a/docs/document:${logicalId}/device:remote-device.json`;
}

describe("encrypted sync engine run", () => {
  beforeEach(() => {
    mocks.appliedData = undefined;
    mocks.applySyncedAppData.mockReset();
    mocks.applySyncedAppData.mockResolvedValue(false);
    mocks.assembledIds = [];
    mocks.captureLocalSyncSnapshot.mockReset();
    mocks.collectReferencedOpfsUrls.mockReset();
    mocks.collectReferencedOpfsUrls.mockReturnValue([]);
    mocks.documents.clear();
    mocks.get.mockClear();
    mocks.list.mockClear();
    mocks.put.mockClear();
    mocks.remoteObjects.clear();
    mocks.resolveOPFSBlob.mockReset();
    mocks.resolveOPFSBlob.mockResolvedValue(undefined);
  });

  it("uploads root and data documents after listing an empty vault", async () => {
    const { loadSyncDocument, readSyncDocumentPayload } =
      await import("@/lib/sync/crdt");
    const { ROOT_DOCUMENT_ID, runEncryptedSync } =
      await import("@/lib/sync/engine");
    const settings = {
      id: "settings",
      kind: "settings" as const,
      payload: { state: { theme: "dark" }, version: 6 },
    };
    mocks.captureLocalSyncSnapshot
      .mockResolvedValueOnce(captured([settings]))
      .mockResolvedValueOnce(captured([settings]));

    await runEncryptedSync(configuration);

    expect(mocks.remoteObjects.size).toBeGreaterThanOrEqual(3);
    expect(mocks.documents.has(ROOT_DOCUMENT_ID)).toBe(true);
    const savedSettings = await loadSyncDocument(
      mocks.documents.get("settings")!,
      "inspector",
    );
    expect(readSyncDocumentPayload(savedSettings)).toEqual(settings.payload);
    expect(mocks.list.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.put.mock.invocationCallOrder[0],
    );
  });

  it("applies the latest capture once to a persisted local baseline", async () => {
    const {
      collectSyncConflicts,
      createSyncDocument,
      loadSyncDocument,
      readSyncDocumentPayload,
      saveSyncDocument,
    } = await import("@/lib/sync/crdt");
    const { buildRootSyncIndex, ROOT_DOCUMENT_ID, runEncryptedSync } =
      await import("@/lib/sync/engine");
    const now = "2026-09-02T00:00:00.000Z";
    const device = {
      id: "device-a",
      name: "Device A",
      firstSeenAt: now,
      lastSeenAt: now,
    };
    const initialSettings = {
      id: "settings",
      kind: "settings" as const,
      payload: { state: { theme: "system" }, version: 6 },
    };
    const rootIndex = buildRootSyncIndex(
      undefined,
      [initialSettings],
      "vault-a",
      device,
      now,
      { inferTombstones: false },
    );
    mocks.documents.set(
      ROOT_DOCUMENT_ID,
      await saveSyncDocument(
        await createSyncDocument(
          ROOT_DOCUMENT_ID,
          "root",
          rootIndex,
          "device-a",
        ),
      ),
    );
    mocks.documents.set(
      "settings",
      await saveSyncDocument(
        await createSyncDocument(
          "settings",
          "settings",
          initialSettings.payload,
          "device-a",
        ),
      ),
    );
    mocks.captureLocalSyncSnapshot
      .mockResolvedValueOnce(captured([initialSettings]))
      .mockResolvedValueOnce(
        captured([
          {
            ...initialSettings,
            payload: { state: { theme: "dark" }, version: 6 },
          },
        ]),
      );

    const result = await runEncryptedSync(configuration);

    const savedSettings = await loadSyncDocument(
      mocks.documents.get("settings")!,
      "inspector",
    );
    expect(readSyncDocumentPayload(savedSettings)).toEqual({
      state: { theme: "dark" },
      version: 6,
    });
    expect(await collectSyncConflicts(savedSettings)).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(mocks.put).toHaveBeenCalled();
  });

  it("uses the device actor when adding local data to a remote-first document", async () => {
    const {
      createSyncDocument,
      deriveAutomergeActorId,
      loadAutomerge,
      loadSyncDocument,
      saveSyncDocument,
    } = await import("@/lib/sync/crdt");
    const { buildRootSyncIndex, ROOT_DOCUMENT_ID, runEncryptedSync } =
      await import("@/lib/sync/engine");
    const now = "2026-09-02T00:00:00.000Z";
    const remoteSettings = {
      id: "settings",
      kind: "settings" as const,
      payload: { state: { theme: "dark" }, version: 6 },
    };
    const remoteRoot = buildRootSyncIndex(
      undefined,
      [remoteSettings],
      "vault-a",
      {
        id: "remote-device",
        name: "Remote device",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      now,
      { inferTombstones: false },
    );
    mocks.remoteObjects.set(
      remoteDocumentPath(ROOT_DOCUMENT_ID),
      encryptedDocument(
        await saveSyncDocument(
          await createSyncDocument(
            ROOT_DOCUMENT_ID,
            "root",
            remoteRoot,
            "remote-device",
          ),
        ),
      ),
    );
    mocks.remoteObjects.set(
      remoteDocumentPath("settings"),
      encryptedDocument(
        await saveSyncDocument(
          await createSyncDocument(
            "settings",
            "settings",
            remoteSettings.payload,
            "remote-device",
          ),
        ),
      ),
    );
    const localSettings = {
      ...remoteSettings,
      payload: {
        state: { theme: "dark", language: "zh" },
        version: 6,
      },
    };
    mocks.captureLocalSyncSnapshot
      .mockResolvedValueOnce(captured([localSettings]))
      .mockResolvedValueOnce(captured([localSettings]));

    await runEncryptedSync(configuration);

    const saved = await loadSyncDocument(
      mocks.documents.get("settings")!,
      "inspector",
    );
    const api = await loadAutomerge();
    const localChange = api
      .getAllChanges(saved)
      .map((change) => api.decodeChange(change))
      .find(
        (change) => change.message === "merge first local application snapshot",
      );
    expect(localChange?.actor).toBe(await deriveAutomergeActorId("device-a"));
  });

  it("preserves a concurrent remote scalar assignment as a conflict", async () => {
    const {
      applyLocalPayload,
      createSyncDocument,
      loadSyncDocument,
      saveSyncDocument,
    } = await import("@/lib/sync/crdt");
    const { buildRootSyncIndex, ROOT_DOCUMENT_ID, runEncryptedSync } =
      await import("@/lib/sync/engine");
    const now = "2026-09-02T00:00:00.000Z";
    const device = {
      id: "device-a",
      name: "Device A",
      firstSeenAt: now,
      lastSeenAt: now,
    };
    const initialSettings = {
      id: "settings",
      kind: "settings" as const,
      payload: { state: { theme: "system" }, version: 6 },
    };
    const rootIndex = buildRootSyncIndex(
      undefined,
      [initialSettings],
      "vault-a",
      device,
      now,
      { inferTombstones: false },
    );
    const rootBytes = await saveSyncDocument(
      await createSyncDocument(
        ROOT_DOCUMENT_ID,
        "root",
        rootIndex,
        "initial-device",
      ),
    );
    mocks.documents.set(ROOT_DOCUMENT_ID, rootBytes);
    mocks.remoteObjects.set(
      remoteDocumentPath(ROOT_DOCUMENT_ID),
      encryptedDocument(rootBytes),
    );

    const originalSettings = await createSyncDocument(
      "settings",
      "settings",
      initialSettings.payload,
      "initial-device",
    );
    const commonSettings = await saveSyncDocument(originalSettings);
    const localSettings = await applyLocalPayload(
      await loadSyncDocument(commonSettings, "device-a"),
      { state: { theme: "light" }, version: 6 },
    );
    const remoteSettings = await applyLocalPayload(
      await loadSyncDocument(commonSettings, "remote-device"),
      { state: { theme: "dark" }, version: 6 },
    );
    mocks.documents.set("settings", await saveSyncDocument(localSettings));
    mocks.remoteObjects.set(
      remoteDocumentPath("settings"),
      encryptedDocument(await saveSyncDocument(remoteSettings)),
    );
    const localCapture = {
      ...initialSettings,
      payload: { state: { theme: "light" }, version: 6 },
    };
    mocks.captureLocalSyncSnapshot
      .mockResolvedValueOnce(captured([localCapture]))
      .mockResolvedValueOnce(captured([localCapture]));

    const result = await runEncryptedSync(configuration);

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        documentId: "settings",
        values: expect.arrayContaining(["dark", "light"]),
      }),
    ]);
  });

  it("keeps a document added only by a remote device out of local tombstone inference", async () => {
    const {
      applyLocalPayload,
      createSyncDocument,
      loadSyncDocument,
      readSyncDocumentPayload,
      saveSyncDocument,
      toSyncJson,
    } = await import("@/lib/sync/crdt");
    const { buildRootSyncIndex, ROOT_DOCUMENT_ID, runEncryptedSync } =
      await import("@/lib/sync/engine");
    const now = "2026-09-02T00:00:00.000Z";
    const localDevice = {
      id: "device-a",
      name: "Device A",
      firstSeenAt: now,
      lastSeenAt: now,
    };
    const remoteDevice = {
      id: "remote-device",
      name: "Remote device",
      firstSeenAt: now,
      lastSeenAt: now,
    };
    const localSettings = {
      id: "settings",
      kind: "settings" as const,
      payload: { state: { theme: "system" }, version: 6 },
    };
    const remoteMemory = {
      id: "memory",
      kind: "memory" as const,
      payload: { memories: [{ id: "remote-memory", content: "Remember" }] },
    };
    const localRootIndex = buildRootSyncIndex(
      undefined,
      [localSettings],
      "vault-a",
      localDevice,
      now,
      { inferTombstones: false },
    );
    const commonRootBytes = await saveSyncDocument(
      await createSyncDocument(
        ROOT_DOCUMENT_ID,
        "root",
        localRootIndex,
        "initial-device",
      ),
    );
    mocks.documents.set(ROOT_DOCUMENT_ID, commonRootBytes);
    const remoteRootIndex = buildRootSyncIndex(
      toSyncJson(localRootIndex),
      [localSettings, remoteMemory],
      "vault-a",
      remoteDevice,
      now,
      { inferTombstones: false },
    );
    const remoteRoot = await applyLocalPayload(
      await loadSyncDocument(commonRootBytes, "remote-device"),
      remoteRootIndex,
    );
    mocks.remoteObjects.set(
      remoteDocumentPath(ROOT_DOCUMENT_ID),
      encryptedDocument(await saveSyncDocument(remoteRoot)),
    );
    mocks.remoteObjects.set(
      remoteDocumentPath("memory"),
      encryptedDocument(
        await saveSyncDocument(
          await createSyncDocument(
            "memory",
            "memory",
            remoteMemory.payload,
            "remote-device",
          ),
        ),
      ),
    );
    mocks.captureLocalSyncSnapshot
      .mockResolvedValueOnce(captured([localSettings]))
      .mockResolvedValueOnce(captured([localSettings]));

    await runEncryptedSync(configuration);

    const savedRoot = readSyncDocumentPayload(
      await loadSyncDocument(
        mocks.documents.get(ROOT_DOCUMENT_ID)!,
        "inspector",
      ),
    ) as { documents: Record<string, { deleted?: boolean }> };
    expect(savedRoot.documents.memory).toBeDefined();
    expect(savedRoot.documents.memory.deleted).not.toBe(true);
    expect(mocks.documents.has("memory")).toBe(true);
    expect(mocks.assembledIds).toContain("memory");
  });

  it("remerges a message and title written while a blob downloads", async () => {
    const { runEncryptedSync } = await import("@/lib/sync/engine");
    const fileUrl = "opfs://chat/session-1/image.png";
    let localRevision: "before" | "after" = "before";
    let blobLookupCount = 0;
    const documents = (): LocalSyncPayloadDocument[] => [
      {
        id: "session:session-1",
        kind: "session" as const,
        payload: {
          id: "session-1",
          title: localRevision === "before" ? "Before download" : "New title",
        },
      },
      {
        id: "session-messages:session-1",
        kind: "session-messages" as const,
        payload: {
          rootMessageIds: localRevision === "before" ? [] : ["message-1"],
          nodesById:
            localRevision === "before"
              ? {}
              : { "message-1": { id: "message-1", content: "New message" } },
          activeChildByParentId: {},
        },
      },
    ];
    mocks.captureLocalSyncSnapshot.mockImplementation(async () =>
      captured(documents(), [fileUrl]),
    );
    mocks.resolveOPFSBlob.mockImplementation(async () => {
      blobLookupCount += 1;
      return blobLookupCount % 2 === 1
        ? new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
        : undefined;
    });
    mocks.collectReferencedOpfsUrls.mockReturnValue([fileUrl]);
    mocks.get.mockImplementation(async (path: string) => {
      const bytes = mocks.remoteObjects.get(path);
      if (!bytes) throw new Error(`Missing remote object: ${path}`);
      if (path.includes("/blobs/")) localRevision = "after";
      return bytes;
    });
    mocks.applySyncedAppData.mockImplementation(
      async (data: unknown, _files: unknown, options: unknown) => {
        const baseline = (
          options as { baseline: CapturedSyncSnapshot }
        ).baseline.documents.find(
          (document) => document.id === "session:session-1",
        );
        if (
          localRevision === "after" &&
          (baseline?.payload as { title?: string }).title === "Before download"
        ) {
          throw Object.assign(new Error("stale local baseline"), {
            code: "SYNC_LOCAL_BASELINE_STALE",
            retryable: true,
          });
        }
        mocks.appliedData = data;
        return true;
      },
    );

    await runEncryptedSync(configuration);

    expect(mocks.applySyncedAppData).toHaveBeenCalledTimes(2);
    expect(mocks.captureLocalSyncSnapshot).toHaveBeenCalledTimes(4);
    expect(mocks.get.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applySyncedAppData.mock.invocationCallOrder[0],
    );
    expect(mocks.appliedData).toEqual({
      session: { id: "session-1", title: "New title" },
      messages: {
        rootMessageIds: ["message-1"],
        nodesById: {
          "message-1": { id: "message-1", content: "New message" },
        },
        activeChildByParentId: {},
      },
    });
  });

  it("stops after bounded stale-apply retries", async () => {
    const { runEncryptedSync } = await import("@/lib/sync/engine");
    const settings = {
      id: "settings",
      kind: "settings" as const,
      payload: { state: { theme: "dark" }, version: 6 },
    };
    mocks.captureLocalSyncSnapshot.mockResolvedValue(captured([settings]));
    const stale = Object.assign(new Error("stale local baseline"), {
      code: "SYNC_LOCAL_BASELINE_STALE",
      retryable: true,
    });
    mocks.applySyncedAppData.mockRejectedValue(stale);

    await expect(runEncryptedSync(configuration)).rejects.toBe(stale);

    expect(mocks.applySyncedAppData).toHaveBeenCalledTimes(3);
    expect(mocks.captureLocalSyncSnapshot).toHaveBeenCalledTimes(6);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
