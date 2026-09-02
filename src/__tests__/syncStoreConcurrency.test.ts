/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSyncRemoteClient: vi.fn(),
  runEncryptedSync: vi.fn(),
}));

vi.mock("@/lib/sync/engine", () => ({
  recoveryCodeToStoredKey: vi.fn(),
  recoveryCodeToVaultId: vi.fn(),
  resetLocalSyncVault: vi.fn(),
  resolveStoredSyncConflict: vi.fn(),
  runEncryptedSync: mocks.runEncryptedSync,
}));
vi.mock("@/lib/sync/crypto", () => ({
  generateRecoveryCode: vi.fn(),
}));
vi.mock("@/lib/sync/deviceIdentity", () => ({
  getDefaultSyncDeviceName: () => "Test device",
  getSyncDeviceId: vi.fn(),
}));
vi.mock("@/lib/sync/remoteClient", () => ({
  createSyncRemoteClient: mocks.createSyncRemoteClient,
}));
vi.mock("@/lib/sync/storage", () => ({
  getSyncStateStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  SYNC_CONFIGURATION_STORAGE_KEY: "test-sync-configuration",
}));
vi.mock("@/lib/security/localSecrets", () => ({
  decryptLocalSecret: vi.fn(),
  encryptLocalSecret: vi.fn(),
  LOCAL_SECRET_CONTEXTS: {
    syncRemoteCredentials: "local:sync:remote-credentials",
    syncRootKey: "local:sync:root-key",
  },
}));

import { useSyncStore, type SyncStoreState } from "@/store/core/syncStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function configureEnabledStore(): void {
  useSyncStore.setState({
    enabled: true,
    status: "idle",
    provider: {
      kind: "webdav",
      baseUrl: "https://dav.example.com",
      rootPath: "neo-chat",
    },
    credentialSecret: {} as NonNullable<SyncStoreState["credentialSecret"]>,
    rootKeySecret: {} as NonNullable<SyncStoreState["rootKeySecret"]>,
    vaultId: "vault-1",
  });
}

describe("sync store operation guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSyncStore.setState(useSyncStore.getInitialState(), true);
    configureEnabledStore();
  });

  it("keeps disabled state and suppresses apply events from a late sync result", async () => {
    const pending = deferred<{
      changed: boolean;
      uploadedBytes: number;
      downloadedBytes: number;
      devices: [];
      conflicts: [];
    }>();
    mocks.runEncryptedSync.mockReturnValueOnce(pending.promise);
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");

    const syncPromise = useSyncStore.getState().syncNow("manual");
    expect(useSyncStore.getState().status).toBe("syncing");

    useSyncStore.getState().disableSync();
    pending.resolve({
      changed: true,
      uploadedBytes: 10,
      downloadedBytes: 20,
      devices: [],
      conflicts: [],
    });
    await syncPromise;

    expect(useSyncStore.getState()).toMatchObject({
      enabled: false,
      status: "disabled",
      activeController: undefined,
      requiresReload: false,
    });
    expect(useSyncStore.getState()).toMatchObject({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "neo-chat-sync-applied" }),
    );
  });

  it("tracks connection tests separately from the formal sync status", async () => {
    const pending = deferred<void>();
    const test = vi.fn(() => pending.promise);
    mocks.createSyncRemoteClient.mockResolvedValueOnce({ test });
    useSyncStore.setState({
      status: "up-to-date",
      lastSyncAt: "2026-09-02T00:00:00.000Z",
      lastSyncBytes: 42,
    });

    const testPromise = useSyncStore.getState().testConnection();
    expect(useSyncStore.getState()).toMatchObject({
      status: "up-to-date",
      connectionTestStatus: "testing",
      connectionTestError: undefined,
    });

    pending.resolve();
    await testPromise;

    expect(useSyncStore.getState()).toMatchObject({
      status: "up-to-date",
      connectionTestStatus: "success",
      connectionTestError: undefined,
      connectionController: undefined,
      lastSyncAt: "2026-09-02T00:00:00.000Z",
      lastSyncBytes: 42,
    });
  });

  it("records connection-test failures without changing formal sync state", async () => {
    mocks.createSyncRemoteClient.mockResolvedValueOnce({
      test: vi.fn(async () => {
        throw new Error("Remote endpoint rejected the request.");
      }),
    });
    useSyncStore.setState({ status: "up-to-date" });

    await expect(useSyncStore.getState().testConnection()).rejects.toThrow(
      "Remote endpoint rejected the request.",
    );

    expect(useSyncStore.getState()).toMatchObject({
      status: "up-to-date",
      connectionTestStatus: "error",
      connectionTestError: "Remote endpoint rejected the request.",
      connectionController: undefined,
    });
    expect(useSyncStore.getState().error).toBeUndefined();
  });

  it("ignores a late connection-test result after sync is disabled", async () => {
    const pending = deferred<void>();
    const test = vi.fn(() => pending.promise);
    mocks.createSyncRemoteClient.mockResolvedValueOnce({ test });

    const testPromise = useSyncStore.getState().testConnection();
    expect(useSyncStore.getState()).toMatchObject({
      status: "idle",
      connectionTestStatus: "testing",
    });

    useSyncStore.getState().disableSync();
    pending.resolve();
    await testPromise;

    expect(test).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(useSyncStore.getState()).toMatchObject({
      enabled: false,
      status: "disabled",
      connectionTestStatus: "idle",
      connectionTestError: undefined,
      connectionController: undefined,
    });
    expect(useSyncStore.getState().error).toBeUndefined();
  });

  it("does not surface an aborted late connection-test failure", async () => {
    const pending = deferred<void>();
    mocks.createSyncRemoteClient.mockResolvedValueOnce({
      test: vi.fn(() => pending.promise),
    });

    const testPromise = useSyncStore.getState().testConnection();
    useSyncStore.getState().disableSync();
    pending.reject(new Error("late connection failure"));

    await expect(testPromise).resolves.toBeUndefined();
    expect(useSyncStore.getState()).toMatchObject({
      status: "disabled",
      connectionTestStatus: "idle",
      connectionTestError: undefined,
    });
    expect(useSyncStore.getState().error).toBeUndefined();
  });

  it("ignores a superseded connection-test result", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.createSyncRemoteClient
      .mockResolvedValueOnce({ test: vi.fn(() => first.promise) })
      .mockResolvedValueOnce({ test: vi.fn(() => second.promise) });

    const firstPromise = useSyncStore.getState().testConnection();
    const secondPromise = useSyncStore.getState().testConnection();
    expect(useSyncStore.getState().connectionTestStatus).toBe("testing");

    first.reject(new Error("stale connection failure"));
    await firstPromise;
    expect(useSyncStore.getState()).toMatchObject({
      status: "idle",
      connectionTestStatus: "testing",
      connectionTestError: undefined,
    });

    second.resolve();
    await secondPromise;
    expect(useSyncStore.getState()).toMatchObject({
      status: "idle",
      connectionTestStatus: "success",
      connectionTestError: undefined,
    });
  });

  it("does not advance the last successful sync metadata for conflicts", async () => {
    mocks.runEncryptedSync.mockResolvedValueOnce({
      changed: true,
      uploadedBytes: 10,
      downloadedBytes: 20,
      devices: [],
      conflicts: [
        {
          id: "settings:theme",
          documentId: "settings",
          path: ["theme"],
          currentValue: "light",
          values: ["light", "dark"],
        },
      ],
    });
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });

    await useSyncStore.getState().syncNow("manual");

    expect(useSyncStore.getState()).toMatchObject({
      status: "conflict",
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });
  });

  it("advances the last successful sync metadata after a complete clean sync", async () => {
    mocks.runEncryptedSync.mockResolvedValueOnce({
      changed: false,
      uploadedBytes: 10,
      downloadedBytes: 20,
      devices: [],
      conflicts: [],
    });

    await useSyncStore.getState().syncNow("manual");

    expect(useSyncStore.getState()).toMatchObject({
      status: "up-to-date",
      lastSyncBytes: 30,
    });
    expect(useSyncStore.getState().lastSyncAt).toEqual(expect.any(String));
  });

  it("preserves the last successful sync metadata after cancellation", async () => {
    const pending = deferred<{
      changed: boolean;
      uploadedBytes: number;
      downloadedBytes: number;
      devices: [];
      conflicts: [];
    }>();
    mocks.runEncryptedSync.mockReturnValueOnce(pending.promise);
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });

    const syncPromise = useSyncStore.getState().syncNow("manual");
    useSyncStore.getState().cancelSync();
    pending.resolve({
      changed: true,
      uploadedBytes: 10,
      downloadedBytes: 20,
      devices: [],
      conflicts: [],
    });
    await syncPromise;

    expect(useSyncStore.getState()).toMatchObject({
      status: "idle",
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });
  });

  it("preserves the last successful sync metadata after a failed sync", async () => {
    mocks.runEncryptedSync.mockRejectedValueOnce(new Error("sync failed"));
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });

    await expect(useSyncStore.getState().syncNow("manual")).rejects.toThrow(
      "sync failed",
    );

    expect(useSyncStore.getState()).toMatchObject({
      status: "error",
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });
  });

  it("clears successful sync metadata only when the remote identity changes", async () => {
    const encryptLocalSecret = await import("@/lib/security/localSecrets");
    vi.mocked(encryptLocalSecret.encryptLocalSecret).mockResolvedValue({
      version: 1,
    } as never);
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });

    await useSyncStore.getState().configureProvider(
      {
        kind: "webdav",
        baseUrl: "https://dav.example.com",
        rootPath: "neo-chat",
      },
      { kind: "webdav", username: "other", password: "new" },
    );

    expect(useSyncStore.getState()).toMatchObject({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
      connectionTestStatus: "idle",
      connectionTestError: undefined,
    });

    await useSyncStore.getState().configureProvider(
      {
        kind: "webdav",
        baseUrl: "https://dav.example.com",
        rootPath: "different-vault",
      },
      { kind: "webdav", username: "same", password: "credentials" },
    );

    expect(useSyncStore.getState()).toMatchObject({
      lastSyncAt: undefined,
      lastSyncBytes: undefined,
      connectionTestStatus: "idle",
      connectionTestError: undefined,
    });
  });

  it("clears successful sync metadata and invalidates tests for a new vault", async () => {
    const engine = await import("@/lib/sync/engine");
    const localSecrets = await import("@/lib/security/localSecrets");
    vi.mocked(engine.recoveryCodeToStoredKey).mockResolvedValue("root-key");
    vi.mocked(engine.recoveryCodeToVaultId).mockResolvedValue("vault-2");
    vi.mocked(localSecrets.encryptLocalSecret).mockResolvedValue({
      version: 1,
    } as never);
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
      status: "up-to-date",
      connectionTestStatus: "success",
    });

    await useSyncStore.getState().initializeVault("recovery-code");

    expect(useSyncStore.getState()).toMatchObject({
      vaultId: "vault-2",
      status: "idle",
      connectionTestStatus: "idle",
      connectionTestError: undefined,
      lastSyncAt: undefined,
      lastSyncBytes: undefined,
    });
  });

  it("invalidates an in-flight sync before a new vault reset completes", async () => {
    const engine = await import("@/lib/sync/engine");
    const localSecrets = await import("@/lib/security/localSecrets");
    const reset = deferred<void>();
    const sync = deferred<{
      changed: boolean;
      uploadedBytes: number;
      downloadedBytes: number;
      devices: [];
      conflicts: [];
    }>();
    vi.mocked(engine.recoveryCodeToStoredKey).mockResolvedValue("root-key");
    vi.mocked(engine.recoveryCodeToVaultId).mockResolvedValue("vault-2");
    vi.mocked(engine.resetLocalSyncVault).mockReturnValueOnce(reset.promise);
    vi.mocked(localSecrets.encryptLocalSecret).mockResolvedValue({
      version: 1,
    } as never);
    mocks.runEncryptedSync.mockReturnValueOnce(sync.promise);
    useSyncStore.setState({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });

    const syncPromise = useSyncStore.getState().syncNow("manual");
    const vaultPromise = useSyncStore
      .getState()
      .initializeVault("recovery-code");
    await vi.waitFor(() => {
      expect(engine.resetLocalSyncVault).toHaveBeenCalledTimes(1);
    });

    expect(useSyncStore.getState()).toMatchObject({
      activeController: undefined,
      status: "idle",
    });
    sync.resolve({
      changed: true,
      uploadedBytes: 10,
      downloadedBytes: 20,
      devices: [],
      conflicts: [],
    });
    await syncPromise;
    expect(useSyncStore.getState()).toMatchObject({
      lastSyncAt: "2026-09-01T00:00:00.000Z",
      lastSyncBytes: 99,
    });

    reset.resolve();
    await vaultPromise;
    expect(useSyncStore.getState().vaultId).toBe("vault-2");
  });

  it("does not persist transient connection-test state", () => {
    useSyncStore.setState({
      connectionTestStatus: "success",
      connectionTestError: "stale error",
    });
    const partialize = useSyncStore.persist.getOptions().partialize!;
    const persisted = partialize(useSyncStore.getState()) as Record<
      string,
      unknown
    >;

    expect(persisted).not.toHaveProperty("connectionTestStatus");
    expect(persisted).not.toHaveProperty("connectionTestError");
  });
});
