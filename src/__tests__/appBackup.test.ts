import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  APP_BACKUP_LIMITS,
  inspectBrowserAppBackup,
  type BackupManifestV3,
} from "../lib/data/appBackup";
import {
  APP_EXPORT_EXCLUSIONS,
  APP_EXPORT_VERSION,
  type AppExportPayload,
} from "../lib/data/appExport";
import { STORAGE_VERSION } from "../store/storage/storageConfig";

const exportedAt = "2026-07-16T00:00:00.000Z";
const originalUrl = "opfs://knowledge-base/c1/file.txt";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createPayload(referenceUrl = originalUrl): AppExportPayload {
  return {
    exportVersion: APP_EXPORT_VERSION,
    storageVersion: STORAGE_VERSION,
    exportedAt,
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: {
        credentialsIncluded: false,
        excluded: APP_EXPORT_EXCLUSIONS,
      },
    },
    data: {
      coreSettings: { state: { theme: "dark" }, version: STORAGE_VERSION },
      settings: { state: { installedPlugins: [] }, version: STORAGE_VERSION },
      chat: { state: { sessions: [] }, version: STORAGE_VERSION },
      sessionMessages: {},
      knowledge: {
        state: {
          collections: [
            {
              id: "c1",
              files: [
                {
                  id: "f1",
                  name: "file.txt",
                  status: "saved",
                  path: referenceUrl,
                  sourcePath: referenceUrl,
                  contentPath: referenceUrl,
                },
              ],
            },
          ],
        },
        version: STORAGE_VERSION,
      },
      memory: { state: { memories: [] }, version: STORAGE_VERSION },
    },
  };
}

function createZipBackup(
  options: {
    content?: Uint8Array;
    checksum?: string;
    extraEntries?: Record<string, Uint8Array>;
    payload?: AppExportPayload;
  } = {},
): Blob {
  const content = options.content || strToU8("knowledge content");
  const manifest: BackupManifestV3 = {
    format: "neo-chat-backup",
    exportVersion: APP_EXPORT_VERSION,
    storageVersion: STORAGE_VERSION,
    exportedAt,
    dataPath: "data.json",
    files: [
      {
        originalUrl,
        archivePath: "files/000000",
        size: content.byteLength,
        mimeType: "text/plain",
        sha256: options.checksum || sha256(content),
      },
    ],
    missingReferences: [],
    excluded: APP_EXPORT_EXCLUSIONS,
  };
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "data.json": strToU8(JSON.stringify(options.payload || createPayload())),
    "files/000000": content,
    ...options.extraEntries,
  });
  return new Blob([zipped], { type: "application/zip" });
}

describe("browser app backups", () => {
  it("validates a v3 archive and reports bundled files", async () => {
    await expect(inspectBrowserAppBackup(createZipBackup())).resolves.toEqual({
      kind: "zip-v3",
      exportedAt,
      storageVersion: STORAGE_VERSION,
      fileCount: 1,
      totalFileBytes: strToU8("knowledge content").byteLength,
      missingFileCount: 0,
      credentialsIncluded: false,
      skippedLegacyResearchTaskCount: 0,
      incomplete: false,
    });
  });

  it("rejects a file whose SHA-256 does not match the manifest", async () => {
    await expect(
      inspectBrowserAppBackup(createZipBackup({ checksum: "0".repeat(64) })),
    ).rejects.toThrow("checksum mismatch");
  });

  it("rejects unexpected and traversal ZIP entries", async () => {
    await expect(
      inspectBrowserAppBackup(
        createZipBackup({ extraEntries: { "../outside.txt": strToU8("x") } }),
      ),
    ).rejects.toThrow("unsafe ZIP entry");

    await expect(
      inspectBrowserAppBackup(
        createZipBackup({ extraEntries: { "extra.txt": strToU8("x") } }),
      ),
    ).rejects.toThrow("unexpected or missing files");
  });

  it("requires the manifest to cover exactly the schema-backed OPFS references", async () => {
    await expect(
      inspectBrowserAppBackup(
        createZipBackup({
          payload: createPayload("opfs://knowledge-base/c1/other.txt"),
        }),
      ),
    ).rejects.toThrow("local file references");

    const payload = createPayload();
    payload.data.sessionMessages.s1 = {
      nodesById: {
        m1: {
          message: {
            content: "Mention opfs://chat/s1/not-a-reference.txt as text.",
          },
        },
      },
    };
    await expect(
      inspectBrowserAppBackup(createZipBackup({ payload })),
    ).resolves.toMatchObject({ fileCount: 1 });
  });

  it("accepts v2 JSON with an explicit incomplete warning", async () => {
    const legacy = {
      exportVersion: 2,
      storageVersion: STORAGE_VERSION,
      exportedAt,
      metadata: {
        opfs: { mode: "references-only", includesBlobs: false },
      },
      data: {
        chat: {},
        sessionMessages: {},
        knowledge: {
          collections: [
            {
              files: [
                {
                  name: "missing.txt",
                  status: "saved",
                  path: "opfs://knowledge-base/c1/missing.txt",
                },
              ],
            },
          ],
        },
        research: [
          {
            schemaVersion: 1,
            id: "legacy-research-task",
            sessionId: "session-1",
          },
        ],
      },
    };

    await expect(
      inspectBrowserAppBackup(
        new Blob([JSON.stringify(legacy)], { type: "application/json" }),
      ),
    ).resolves.toMatchObject({
      kind: "legacy-json-v2",
      fileCount: 0,
      missingFileCount: 1,
      credentialsIncluded: false,
      skippedLegacyResearchTaskCount: 1,
      incomplete: true,
    });
  });

  it("reports legacy research entries without rejecting unrelated backup data", async () => {
    const payload = createPayload();
    payload.data.research = [
      {
        schemaVersion: 1,
        id: "legacy-research-task",
        sessionId: "session-1",
      },
    ];

    await expect(
      inspectBrowserAppBackup(createZipBackup({ payload })),
    ).resolves.toMatchObject({
      kind: "zip-v3",
      skippedLegacyResearchTaskCount: 1,
      incomplete: true,
    });
  });

  it("rejects archives above the synchronous browser-safe import limit", async () => {
    const oversized = {
      size: APP_BACKUP_LIMITS.maxArchiveBytes + 1,
    } as Blob;

    await expect(inspectBrowserAppBackup(oversized)).rejects.toThrow(
      "browser-safe 128 MiB archive limit",
    );
  });
});
