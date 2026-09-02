import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/byok/encoding";
import { generateRecoveryCode } from "@/lib/sync/crypto";
import {
  recoveryCodeToStoredKey,
  recoveryCodeToVaultId,
  resetLocalSyncVault,
  resolveStoredSyncConflict,
  runEncryptedSync,
} from "@/lib/sync/engine";
import {
  getDefaultSyncDeviceName,
  getSyncDeviceId,
} from "@/lib/sync/deviceIdentity";
import { createSyncRemoteClient } from "@/lib/sync/remoteClient";
import {
  getSyncStateStorage,
  SYNC_CONFIGURATION_STORAGE_KEY,
} from "@/lib/sync/storage";
import type {
  PersistedSyncConfiguration,
  SyncConflict,
  SyncDevice,
  SyncJsonValue,
  SyncProviderConfig,
  SyncProviderCredentials,
  SyncStatus,
} from "@/lib/sync/types";
import {
  decryptLocalSecret,
  encryptLocalSecret,
  LOCAL_SECRET_CONTEXTS,
} from "@/lib/security/localSecrets";

export type ConnectionTestStatus = "idle" | "testing" | "success" | "error";

export interface SyncStoreState extends PersistedSyncConfiguration {
  hydrated: boolean;
  status: SyncStatus;
  error?: string;
  connectionTestStatus: ConnectionTestStatus;
  connectionTestError?: string;
  devices: SyncDevice[];
  conflicts: SyncConflict[];
  requiresReload: boolean;
  activeController?: AbortController;
  connectionController?: AbortController;
  syncOperationGeneration: number;
  connectionOperationGeneration: number;
  setHydrated: (hydrated: boolean) => void;
  setDeviceName: (name: string) => void;
  configureProvider: (
    provider: SyncProviderConfig,
    credentials: SyncProviderCredentials,
  ) => Promise<void>;
  testConnection: () => Promise<void>;
  createRecoveryCode: () => Promise<string>;
  initializeVault: (recoveryCode: string) => Promise<void>;
  disableSync: () => void;
  createNewVault: (recoveryCode: string) => Promise<void>;
  syncNow: (reason?: string) => Promise<void>;
  cancelSync: () => void;
  resolveConflict: (
    conflict: SyncConflict,
    value: SyncJsonValue,
  ) => Promise<void>;
  clearError: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Encrypted sync failed.";
}

function syncRemoteIdentity(provider?: SyncProviderConfig): string | undefined {
  if (!provider) return undefined;
  if (provider.kind === "webdav") {
    return JSON.stringify([provider.kind, provider.baseUrl, provider.rootPath]);
  }
  return JSON.stringify([
    provider.kind,
    provider.endpoint,
    provider.region,
    provider.bucket,
    provider.prefix,
    provider.forcePathStyle,
  ]);
}

function getConfiguredState(
  state: SyncStoreState,
): Required<
  Pick<
    PersistedSyncConfiguration,
    "provider" | "credentialSecret" | "rootKeySecret" | "vaultId"
  >
> | null {
  if (
    !state.provider ||
    !state.credentialSecret ||
    !state.rootKeySecret ||
    !state.vaultId
  ) {
    return null;
  }
  return {
    provider: state.provider,
    credentialSecret: state.credentialSecret,
    rootKeySecret: state.rootKeySecret,
    vaultId: state.vaultId,
  };
}

export const useSyncStore = create<SyncStoreState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      enabled: false,
      status: "disabled",
      connectionTestStatus: "idle",
      deviceName: getDefaultSyncDeviceName(),
      devices: [],
      conflicts: [],
      requiresReload: false,
      syncOperationGeneration: 0,
      connectionOperationGeneration: 0,
      setHydrated: (hydrated) => set({ hydrated }),
      setDeviceName: (deviceName) =>
        set({ deviceName: deviceName.trim().slice(0, 120) || "This device" }),
      configureProvider: async (provider, credentials) => {
        if (provider.kind !== credentials.kind) {
          throw new Error(
            "Sync credentials do not match the selected provider.",
          );
        }
        const credentialSecret = await encryptLocalSecret(
          JSON.stringify(credentials),
          LOCAL_SECRET_CONTEXTS.syncRemoteCredentials,
        );
        if (!credentialSecret)
          throw new Error("Sync credentials are required.");
        const current = get();
        const remoteChanged =
          syncRemoteIdentity(current.provider) !== syncRemoteIdentity(provider);
        current.activeController?.abort();
        current.connectionController?.abort();
        set((state) => ({
          provider,
          credentialSecret,
          error: undefined,
          status: "idle",
          connectionTestStatus: "idle",
          connectionTestError: undefined,
          activeController: undefined,
          connectionController: undefined,
          syncOperationGeneration: state.syncOperationGeneration + 1,
          connectionOperationGeneration:
            state.connectionOperationGeneration + 1,
          ...(remoteChanged
            ? { lastSyncAt: undefined, lastSyncBytes: undefined }
            : {}),
        }));
      },
      testConnection: async () => {
        const { provider, credentialSecret } = get();
        if (!provider || !credentialSecret) {
          const message = "Configure a sync provider first.";
          set({
            connectionTestStatus: "error",
            connectionTestError: message,
          });
          throw new Error(message);
        }
        get().connectionController?.abort();
        const controller = new AbortController();
        const operationGeneration = get().connectionOperationGeneration + 1;
        set({
          connectionTestStatus: "testing",
          connectionTestError: undefined,
          connectionController: controller,
          connectionOperationGeneration: operationGeneration,
        });
        try {
          await (
            await createSyncRemoteClient(provider, credentialSecret)
          ).test(controller.signal);
          const latest = get();
          if (
            controller.signal.aborted ||
            latest.connectionOperationGeneration !== operationGeneration ||
            latest.connectionController !== controller
          ) {
            return;
          }
          set({
            connectionTestStatus: "success",
            connectionTestError: undefined,
            connectionController: undefined,
          });
        } catch (error) {
          const latest = get();
          if (
            controller.signal.aborted ||
            latest.connectionOperationGeneration !== operationGeneration ||
            latest.connectionController !== controller
          ) {
            return;
          }
          set({
            connectionTestStatus: "error",
            connectionTestError: errorMessage(error),
            connectionController: undefined,
          });
          throw error;
        }
      },
      createRecoveryCode: async () =>
        (await generateRecoveryCode()).recoveryCode,
      initializeVault: async (recoveryCode) => {
        const rootKey = await recoveryCodeToStoredKey(recoveryCode);
        const vaultId = await recoveryCodeToVaultId(recoveryCode);
        const rootKeySecret = await encryptLocalSecret(
          rootKey,
          LOCAL_SECRET_CONTEXTS.syncRootKey,
        );
        if (!rootKeySecret)
          throw new Error("Could not store the sync recovery key.");
        const { activeController, connectionController } = get();
        activeController?.abort();
        connectionController?.abort();
        set((state) => ({
          status: state.enabled ? "idle" : "disabled",
          activeController: undefined,
          connectionController: undefined,
          connectionTestStatus: "idle",
          connectionTestError: undefined,
          syncOperationGeneration: state.syncOperationGeneration + 1,
          connectionOperationGeneration:
            state.connectionOperationGeneration + 1,
        }));
        await resetLocalSyncVault();
        getSyncDeviceId();
        set((state) => ({
          rootKeySecret,
          vaultId,
          enabled: true,
          status: "idle",
          error: undefined,
          connectionTestStatus: "idle",
          connectionTestError: undefined,
          lastSyncAt: undefined,
          lastSyncBytes: undefined,
          devices: [],
          conflicts: [],
          requiresReload: false,
          activeController: undefined,
          connectionController: undefined,
          syncOperationGeneration: state.syncOperationGeneration + 1,
          connectionOperationGeneration:
            state.connectionOperationGeneration + 1,
        }));
      },
      disableSync: () => {
        const { activeController, connectionController } = get();
        activeController?.abort();
        connectionController?.abort();
        set((state) => ({
          enabled: false,
          status: "disabled",
          connectionTestStatus: "idle",
          connectionTestError: undefined,
          activeController: undefined,
          connectionController: undefined,
          syncOperationGeneration: state.syncOperationGeneration + 1,
          connectionOperationGeneration:
            state.connectionOperationGeneration + 1,
        }));
      },
      createNewVault: async (recoveryCode) => {
        await get().initializeVault(recoveryCode);
      },
      syncNow: async () => {
        const state = get();
        if (!state.enabled) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          set({ status: "offline", error: undefined });
          return;
        }
        const configuration = getConfiguredState(state);
        if (!configuration) {
          set({ status: "error", error: "Sync setup is incomplete." });
          return;
        }
        if (state.activeController) return;

        const controller = new AbortController();
        const operationGeneration = state.syncOperationGeneration + 1;
        set({
          status: "syncing",
          error: undefined,
          activeController: controller,
          syncOperationGeneration: operationGeneration,
        });
        try {
          const result = await runEncryptedSync(
            {
              ...state,
              ...configuration,
            },
            controller.signal,
          );
          const latest = get();
          const isCurrentOperation =
            latest.syncOperationGeneration === operationGeneration &&
            latest.activeController === controller;
          if (
            !isCurrentOperation ||
            !latest.enabled ||
            controller.signal.aborted
          ) {
            if (isCurrentOperation) {
              set({
                status: latest.enabled ? "idle" : "disabled",
                activeController: undefined,
              });
            }
            return;
          }
          const completedAt = new Date().toISOString();
          set({
            status: result.conflicts.length ? "conflict" : "up-to-date",
            ...(result.conflicts.length
              ? {}
              : {
                  lastSyncAt: completedAt,
                  lastSyncBytes: result.uploadedBytes + result.downloadedBytes,
                }),
            devices: result.devices,
            conflicts: result.conflicts,
            requiresReload: latest.requiresReload || result.changed,
            activeController: undefined,
          });
          if (result.changed && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("neo-chat-sync-applied"));
          }
        } catch (error) {
          const latest = get();
          const isCurrentOperation =
            latest.syncOperationGeneration === operationGeneration &&
            latest.activeController === controller;
          if (controller.signal.aborted) {
            if (isCurrentOperation) {
              set({
                status: latest.enabled ? "idle" : "disabled",
                activeController: undefined,
              });
            }
            return;
          }
          if (!isCurrentOperation || !latest.enabled) return;
          set({
            status: "error",
            error: errorMessage(error),
            activeController: undefined,
          });
          throw error;
        }
      },
      cancelSync: () => get().activeController?.abort(),
      resolveConflict: async (conflict, value) => {
        await resolveStoredSyncConflict(conflict, value);
        set((state) => ({
          conflicts: state.conflicts.filter((item) => item.id !== conflict.id),
          status: state.conflicts.length <= 1 ? "idle" : "conflict",
        }));
      },
      clearError: () =>
        set({ error: undefined, status: get().enabled ? "idle" : "disabled" }),
    }),
    {
      name: SYNC_CONFIGURATION_STORAGE_KEY,
      storage: createJSONStorage(getSyncStateStorage),
      version: 1,
      partialize: (state) => ({
        enabled: state.enabled,
        provider: state.provider,
        credentialSecret: state.credentialSecret,
        rootKeySecret: state.rootKeySecret,
        vaultId: state.vaultId,
        deviceName: state.deviceName,
        lastSyncAt: state.lastSyncAt,
        lastSyncBytes: state.lastSyncBytes,
      }),
      onRehydrateStorage: () => (state, error) => {
        state?.setHydrated(true);
        if (error) {
          useSyncStore.setState({
            status: "error",
            error: errorMessage(error),
            connectionTestStatus: "idle",
            connectionTestError: undefined,
          });
        } else if (state?.enabled) {
          useSyncStore.setState({
            status: "idle",
            connectionTestStatus: "idle",
            connectionTestError: undefined,
          });
        } else {
          useSyncStore.setState({
            connectionTestStatus: "idle",
            connectionTestError: undefined,
          });
        }
      },
    },
  ),
);

export async function exportSyncRecoveryCodeForTesting(): Promise<
  string | null
> {
  const secret = useSyncStore.getState().rootKeySecret;
  if (!secret) return null;
  const encoded = await decryptLocalSecret(
    secret,
    LOCAL_SECRET_CONTEXTS.syncRootKey,
  );
  if (!encoded) return null;
  const rootKey = base64UrlToBytes(encoded);
  return (await import("@/lib/sync/crypto")).formatRecoveryCode(rootKey);
}

export async function initializeGeneratedSyncVaultForTesting(): Promise<string> {
  const { rootKey, recoveryCode } = await generateRecoveryCode();
  if (
    bytesToBase64Url(rootKey) !== (await recoveryCodeToStoredKey(recoveryCode))
  ) {
    throw new Error("Generated recovery code did not round-trip.");
  }
  await useSyncStore.getState().initializeVault(recoveryCode);
  return recoveryCode;
}
