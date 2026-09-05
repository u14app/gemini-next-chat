import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppExportPayload } from "@/lib/data/appExport";

const mocks = vi.hoisted(() => ({
  appDb: {
    getItem: vi.fn(),
    keys: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  },
  createBrowserAppExportPayload: vi.fn(),
  insideExclusiveLock: false,
  runWithExclusiveAppDataLock: vi.fn(
    async (operation: () => Promise<unknown>) => {
      mocks.insideExclusiveLock = true;
      try {
        return await operation();
      } finally {
        mocks.insideExclusiveLock = false;
      }
    },
  ),
  writeBlobToOPFS: vi.fn(),
}));

vi.mock("@/lib/data/appExport", () => ({
  collectReferencedOpfsUrls: vi.fn(() => new Set<string>()),
  createBrowserAppExportPayload: mocks.createBrowserAppExportPayload,
}));

vi.mock("@/lib/data/appRestoreJournal", () => ({
  runWithExclusiveAppDataLock: mocks.runWithExclusiveAppDataLock,
}));

vi.mock("@/store/storage/storageConfig", () => ({
  appDb: mocks.appDb,
  STORAGE_KEYS: {
    CHAT: "chat-storage",
    CORE_SETTINGS: "core-settings-storage",
    KNOWLEDGE: "knowledge-storage",
    MEMORY: "memory-storage",
    SETTINGS: "settings-storage",
  },
  validateRestoredAppData: vi.fn(),
}));

vi.mock("@/utils/opfs", () => ({
  writeBlobToOPFS: mocks.writeBlobToOPFS,
}));

vi.mock("@/lib/sync/applyJournal", () => ({
  commitSyncApplyTransaction: vi.fn(),
  createBrowserSyncApplyJournalOptions: vi.fn(),
  createSyncApplyTransaction: vi.fn(),
  ensureInterruptedSyncApplyRecovery: vi.fn(),
  setSyncApplyPhase: vi.fn(),
}));

function exportPayload(
  title: string,
  includeMessage: boolean,
): AppExportPayload {
  return {
    exportVersion: 3,
    storageVersion: 6,
    exportedAt: "2026-09-05T00:00:00.000Z",
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: { credentialsIncluded: false, excluded: [] },
    },
    data: {
      chat: {
        state: {
          currentSessionId: "session-1",
          sessions: [{ id: "session-1", title }],
          workspaces: [],
        },
        version: 6,
      },
      sessionMessages: {
        "session-1": {
          rootMessageIds: includeMessage ? ["message-1"] : [],
          nodesById: includeMessage
            ? {
                "message-1": {
                  id: "message-1",
                  content: "Written during download",
                },
              }
            : {},
          activeChildByParentId: {},
        },
      },
      knowledge: { state: { collections: [] }, version: 6 },
    },
  };
}

describe("sync apply baseline", () => {
  beforeEach(() => {
    mocks.appDb.getItem.mockReset();
    mocks.appDb.keys.mockReset();
    mocks.appDb.removeItem.mockReset();
    mocks.appDb.setItem.mockReset();
    mocks.createBrowserAppExportPayload.mockReset();
    mocks.insideExclusiveLock = false;
    mocks.runWithExclusiveAppDataLock.mockClear();
    mocks.writeBlobToOPFS.mockReset();
  });

  it("rejects a stale materialization inside the lock before overwriting a new title or message", async () => {
    const { applySyncedAppData, captureLocalSyncSnapshot } =
      await import("@/lib/sync/snapshot");
    const beforeDownload = exportPayload("Before download", false);
    const writtenDuringDownload = exportPayload("New title", true);
    mocks.createBrowserAppExportPayload.mockResolvedValueOnce(beforeDownload);
    const baseline = await captureLocalSyncSnapshot();
    mocks.createBrowserAppExportPayload.mockImplementationOnce(async () => {
      expect(mocks.insideExclusiveLock).toBe(true);
      return writtenDuringDownload;
    });

    const applied = applySyncedAppData(
      beforeDownload.data,
      new Map([["opfs://chat/session-1/image.png", new Uint8Array([1])]]),
      { baseline },
    );

    await expect(applied).rejects.toMatchObject({
      name: "StaleSyncSnapshotError",
      code: "SYNC_LOCAL_BASELINE_STALE",
      retryable: true,
    });
    expect(mocks.createBrowserAppExportPayload).toHaveBeenLastCalledWith({
      flushMessageWrites: false,
    });
    expect(mocks.appDb.setItem).not.toHaveBeenCalled();
    expect(mocks.appDb.removeItem).not.toHaveBeenCalled();
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });
});
