import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

const { appDbMock, opfsBlobs, storedItems } = vi.hoisted(() => {
  const storedItems = new Map<string, unknown>();
  const opfsBlobs = new Map<string, Blob>();
  return {
    storedItems,
    opfsBlobs,
    appDbMock: {
      getItem: vi.fn(async (key: string) => storedItems.get(key) ?? null),
      setItem: vi.fn(async (_key: string, value: unknown) => value),
      removeItem: vi.fn(async () => undefined),
      keys: vi.fn(async () => [...storedItems.keys()]),
    },
  };
});

vi.mock("../store/storage/storageConfig", () => ({
  appDb: appDbMock,
  STORAGE_KEYS: {
    CORE_SETTINGS: "neo-chat-core-settings",
    SETTINGS: "neo-chat-settings",
    CHAT: "neo-chat-storage",
    KNOWLEDGE: "knowledge-storage",
    MEMORY: "neo-chat-memory",
  },
  STORAGE_VERSION: 5,
}));

vi.mock("../store/sessionMessagePersistence", () => ({
  flushSessionMessageWrites: vi.fn(async () => undefined),
}));

vi.mock("../utils/opfs", () => ({
  resolveOPFSBlob: vi.fn(async (url: string) => opfsBlobs.get(url) ?? null),
  deleteFromOPFS: vi.fn(async () => undefined),
  writeBlobToOPFS: vi.fn(async () => undefined),
  getSafeOPFSPath: vi.fn((url: string) => url.replace("opfs://", "")),
}));

import {
  createBrowserAppBackup,
  inspectBrowserAppBackup,
} from "../lib/data/appBackup";
import { runWithAppDataWriteLock } from "../lib/data/appRestoreJournal";
import { resolveOPFSBlob } from "../utils/opfs";

describe("browser backup export", () => {
  beforeEach(() => {
    storedItems.clear();
    opfsBlobs.clear();
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === "neo-chat-core-settings"
            ? JSON.stringify({
                state: {
                  providers: [
                    {
                      id: "provider-1",
                      apiKey: "plain-secret",
                      apiKeySecret: {
                        keyId: "key",
                        iv: "iv",
                        ciphertext: "ciphertext",
                        context: "provider",
                      },
                    },
                  ],
                },
                version: 5,
              })
            : null,
        ),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("bundles referenced OPFS files and excludes credentials and caches", async () => {
    const fileUrl = "opfs://chat/session-1/file.txt";
    storedItems.set(
      "neo-chat-settings",
      JSON.stringify({
        state: {
          installedPlugins: [{ id: "demo" }],
          marketPlugins: [{ id: "cached" }],
        },
        version: 5,
      }),
    );
    storedItems.set(
      "neo-chat-storage",
      JSON.stringify({
        state: { sessions: [{ id: "session-1" }] },
        version: 5,
      }),
    );
    storedItems.set("session_messages_session-1", {
      nodesById: {
        message: {
          message: {
            attachments: [
              {
                id: "file-1",
                fileName: "file.txt",
                mimeType: "text/plain",
                url: fileUrl,
              },
            ],
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message"],
    });
    opfsBlobs.set(fileUrl, new Blob(["hello"], { type: "text/plain" }));

    const phases: string[] = [];
    const backup = await createBrowserAppBackup({
      onProgress: (progress) => phases.push(progress.phase),
    });
    const inspection = await inspectBrowserAppBackup(backup.blob);
    const entries = unzipSync(new Uint8Array(await backup.blob.arrayBuffer()));
    const data = strFromU8(entries["data.json"]);

    expect(backup.fileName).toMatch(/^neo-chat-backup-.*\.zip$/);
    expect(inspection).toMatchObject({
      kind: "zip-v3",
      fileCount: 1,
      totalFileBytes: 5,
      skippedLegacyResearchTaskCount: 0,
      incomplete: false,
    });
    expect(data).toContain("installedPlugins");
    expect(data).not.toContain("marketPlugins");
    expect(data).not.toContain("plain-secret");
    expect(data).not.toContain("ciphertext");
    expect(phases).toContain("hashing");
    expect(phases).toContain("packing");
  });

  it("bundles scratch files, immutable Artifacts, and workspace archives", async () => {
    const workspaceUrl = "opfs://chat/workspace/session-1/out/report.md";
    const artifactUrl = `opfs://chat/artifacts/session-1/${"a".repeat(64)}-published.md`;
    const archiveUrl =
      "opfs://chat/archives/session-1/0192f0a1-2222-7000-8000-abcdefabcdef.zip";
    storedItems.set(
      "neo-chat-storage",
      JSON.stringify({
        state: { sessions: [{ id: "session-1" }] },
        version: 5,
      }),
    );
    storedItems.set("session_messages_session-1", {
      nodesById: {
        message: {
          message: {
            outputBlocks: [
              {
                id: "workspace-file",
                type: "workspace_file",
                file: {
                  path: "out/report.md",
                  fileName: "report.md",
                  mimeType: "text/markdown",
                  bytes: 6,
                  url: workspaceUrl,
                  revision: "revision-1",
                },
              },
              {
                id: "published-artifact",
                type: "workspace_file",
                file: {
                  path: "out/published.md",
                  fileName: "published.md",
                  mimeType: "text/markdown",
                  bytes: 9,
                  url: artifactUrl,
                  revision: `sha256:${"a".repeat(64)}`,
                },
              },
              {
                id: "workspace-archive",
                type: "workspace_archive",
                archive: {
                  fileName: "results.zip",
                  bytes: 3,
                  entryCount: 1,
                  url: archiveUrl,
                },
              },
            ],
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message"],
    });
    opfsBlobs.set(workspaceUrl, new Blob(["report"]));
    opfsBlobs.set(artifactUrl, new Blob(["immutable"]));
    opfsBlobs.set(archiveUrl, new Blob(["zip"]));

    const backup = await createBrowserAppBackup();

    expect(
      backup.manifest.files.map((file) => file.originalUrl).sort(),
    ).toEqual([archiveUrl, artifactUrl, workspaceUrl].sort());
    await expect(inspectBrowserAppBackup(backup.blob)).resolves.toMatchObject({
      fileCount: 3,
      totalFileBytes: 18,
      skippedLegacyResearchTaskCount: 0,
      incomplete: false,
    });
  });

  it("honors an already-aborted export signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createBrowserAppBackup({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels a no-file export after the reading phase starts", async () => {
    const controller = new AbortController();

    await expect(
      createBrowserAppBackup({
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === "reading") controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("captures metadata, message trees, and referenced files under one lock", async () => {
    const oldUrl = "opfs://chat/session-1/old.txt";
    const newUrl = "opfs://chat/session-1/new.txt";
    const createTree = (label: string, url: string) => ({
      nodesById: {
        message: {
          id: "message",
          message: {
            id: "message",
            role: "user",
            content: label,
            timestamp: 1,
            attachments: [
              {
                id: label,
                fileName: `${label}.txt`,
                mimeType: "text/plain",
                url,
              },
            ],
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message"],
    });
    storedItems.set(
      "neo-chat-storage",
      JSON.stringify({
        state: { sessions: [{ id: "session-1", title: "old metadata" }] },
        version: 5,
      }),
    );
    storedItems.set(
      "session_messages_session-1",
      createTree("old-tree", oldUrl),
    );
    opfsBlobs.set(oldUrl, new Blob(["old-file"], { type: "text/plain" }));
    opfsBlobs.set(newUrl, new Blob(["new-file"], { type: "text/plain" }));
    let markFileCaptured: (() => void) | undefined;
    const fileCaptured = new Promise<void>((resolve) => {
      markFileCaptured = resolve;
    });
    let releaseFileCapture: (() => void) | undefined;
    vi.mocked(resolveOPFSBlob).mockImplementationOnce(async () => {
      const oldBlob = opfsBlobs.get(oldUrl) || null;
      markFileCaptured?.();
      await new Promise<void>((resolve) => {
        releaseFileCapture = resolve;
      });
      return oldBlob;
    });

    const backupPromise = createBrowserAppBackup();
    await fileCaptured;
    const concurrentWrite = runWithAppDataWriteLock(async () => {
      storedItems.set(
        "neo-chat-storage",
        JSON.stringify({
          state: { sessions: [{ id: "session-1", title: "new metadata" }] },
          version: 5,
        }),
      );
      storedItems.set(
        "session_messages_session-1",
        createTree("new-tree", newUrl),
      );
    });
    releaseFileCapture?.();

    const [backup] = await Promise.all([backupPromise, concurrentWrite]);
    const entries = unzipSync(new Uint8Array(await backup.blob.arrayBuffer()));
    const data = strFromU8(entries["data.json"]);
    const archivedFile = strFromU8(entries["files/000000"]);

    expect(data).toContain("old metadata");
    expect(data).toContain("old-tree");
    expect(data).not.toContain("new metadata");
    expect(data).not.toContain("new-tree");
    expect(archivedFile).toBe("old-file");
  });
});
