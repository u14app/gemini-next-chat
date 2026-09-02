import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  PROVIDER_CONFIG_LIMITS,
  PROVIDER_MODEL_LIMITS,
} from "../config/limits";

const { appDbMock, deletedUrls, storedItems, writtenFiles } = vi.hoisted(() => {
  const storedItems = new Map<string, unknown>();
  const writtenFiles = new Map<string, Blob | Uint8Array>();
  const deletedUrls: string[] = [];
  return {
    storedItems,
    writtenFiles,
    deletedUrls,
    appDbMock: {
      getItem: vi.fn(async (key: string) => storedItems.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: unknown) => {
        storedItems.set(key, value);
        return value;
      }),
      removeItem: vi.fn(async (key: string) => {
        storedItems.delete(key);
      }),
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
  resolveOPFSBlob: vi.fn(async () => null),
  writeBlobToOPFS: vi.fn(async (url: string, value: Blob | Uint8Array) => {
    writtenFiles.set(url, value);
  }),
  deleteFromOPFS: vi.fn(async (url: string) => {
    deletedUrls.push(url);
    writtenFiles.delete(url);
  }),
  getSafeOPFSPath: vi.fn((url: string) =>
    url.startsWith("opfs://") ? url.slice("opfs://".length) : null,
  ),
}));

import {
  createBrowserAppBackup,
  restoreBrowserAppBackup,
  type BackupManifestV3,
} from "../lib/data/appBackup";
import { migrateCoreSettingsState } from "../lib/providers/config";
import { pruneUnavailableDefaultModels } from "../lib/utils/defaultModels";
import {
  APP_RESTORE_HYDRATION_TARGETS,
  APP_RESTORE_JOURNAL_KEY,
  APP_RESTORE_CREDENTIAL_NOTICE_KEY,
  APP_RESTORE_SNAPSHOT_KEY,
  APP_RESTORE_WRITE_LOCK_KEY,
  assertAppDataWritesAllowed,
  prepareAppRestoreHydration,
  reportAppRestoreHydration,
} from "../lib/data/appRestoreJournal";
import { flushSessionMessageWrites } from "../store/sessionMessagePersistence";
import { normalizeMessage } from "../store/storage/migrations";
import { deleteFromOPFS, writeBlobToOPFS } from "../utils/opfs";
import { createResearchTask } from "../lib/research";
import { getResearchTaskRepository } from "../services/research";

function createLocalStorage(initial: Record<string, string>) {
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

async function confirmAppliedRestore(
  localStorage: ReturnType<typeof createLocalStorage>,
): Promise<void> {
  await prepareAppRestoreHydration({
    db: appDbMock,
    localStorageRef: localStorage,
    deleteOpfsUrl: deleteFromOPFS,
  });
  await Promise.all(
    APP_RESTORE_HYDRATION_TARGETS.map((target) =>
      reportAppRestoreHydration(target),
    ),
  );
}

function makeBackup(): Blob {
  const exportedAt = "2026-07-16T00:00:00.000Z";
  const originalUrl = "opfs://knowledge-base/c1/source.pdf";
  const missingAttachmentUrl = "opfs://chat/new-session/missing.txt";
  const content = strToU8("pdf bytes");
  const manifest: BackupManifestV3 = {
    format: "neo-chat-backup",
    exportVersion: 3,
    storageVersion: 5,
    exportedAt,
    dataPath: "data.json",
    files: [
      {
        originalUrl,
        archivePath: "files/000000",
        size: content.byteLength,
        mimeType: "application/pdf",
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    ],
    missingReferences: [missingAttachmentUrl],
    excluded: [],
  };
  const payload = {
    exportVersion: 3,
    storageVersion: 5,
    exportedAt,
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: { credentialsIncluded: false, excluded: [] },
    },
    data: {
      coreSettings: {
        state: {
          theme: "dark",
          providers: [{ id: "p1", apiKey: "must-not-restore" }],
        },
        version: 5,
      },
      settings: {
        state: { rag: { enabled: true, token: "must-not-restore" } },
        version: 5,
      },
      chat: {
        state: {
          sessions: [{ id: "new-session" }],
          workspaces: [
            {
              id: "workspace-1",
              files: [
                {
                  id: "workspace-file",
                  fileName: "missing.txt",
                  mimeType: "text/plain",
                  url: missingAttachmentUrl,
                },
              ],
            },
          ],
        },
        version: 5,
      },
      sessionMessages: {
        "new-session": {
          nodesById: {
            message: {
              id: "message",
              message: {
                id: "message",
                content:
                  "Keep opfs://chat/new-session/not-a-reference.txt unchanged.",
                attachments: [
                  {
                    id: "chat-file",
                    fileName: "missing.txt",
                    mimeType: "text/plain",
                    url: missingAttachmentUrl,
                  },
                ],
                outputBlocks: [
                  {
                    id: "long-text",
                    type: "text",
                    content: "Recovered document body",
                    presentation: {
                      kind: "long_text",
                      title: "Recovered document",
                      format: "plain_text",
                      document: {
                        fileName: "Recovered document.txt",
                        mimeType: "text/plain",
                        url: missingAttachmentUrl,
                      },
                    },
                  },
                ],
              },
              childMessageIds: [],
            },
          },
          rootMessageIds: ["message"],
        },
      },
      knowledge: {
        state: {
          collections: [
            {
              id: "c1",
              files: [
                {
                  id: "f1",
                  name: "source.pdf",
                  sourcePath: originalUrl,
                  contentPath: originalUrl,
                  path: originalUrl,
                  ragId: "remote-vector",
                  ragChunkCount: 2,
                  status: "indexed",
                  indexStatus: "indexed",
                  indexError: "stale remote error",
                },
                {
                  id: "f2",
                  name: "unfinished.pdf",
                  sourcePath: originalUrl,
                  status: "parsing",
                  storageStatus: "parsing",
                  indexStatus: "indexing",
                },
              ],
            },
          ],
        },
        version: 5,
      },
      memory: { state: { memories: [] }, version: 5 },
      research: [
        {
          schemaVersion: 1,
          id: "legacy-research-task",
          sessionId: "new-session",
        },
      ],
    },
  };
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "data.json": strToU8(JSON.stringify(payload)),
    "files/000000": content,
  });
  return new Blob([bytes], { type: "application/zip" });
}

function makeProviderBackup(coreSettings: unknown): Blob {
  const exportedAt = "2026-09-02T00:00:00.000Z";
  const manifest: BackupManifestV3 = {
    format: "neo-chat-backup",
    exportVersion: 3,
    storageVersion: 5,
    exportedAt,
    dataPath: "data.json",
    files: [],
    missingReferences: [],
    excluded: [],
  };
  const payload = {
    exportVersion: 3,
    storageVersion: 5,
    exportedAt,
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: { credentialsIncluded: false, excluded: [] },
    },
    data: {
      coreSettings,
      sessionMessages: {},
    },
  };

  return new Blob(
    [
      zipSync({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        "data.json": strToU8(JSON.stringify(payload)),
      }),
    ],
    { type: "application/zip" },
  );
}

async function expectCoreSettingsBackupRejected(
  coreSettings: unknown,
): Promise<void> {
  const oldCoreSettings = JSON.stringify({
    state: { providers: [{ id: "EXISTING" }] },
    version: 5,
  });
  const localStorage = createLocalStorage({
    "neo-chat-core-settings": oldCoreSettings,
  });
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("navigator", {
    storage: {
      estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
    },
  });
  const oldSettings = storedItems.get("neo-chat-settings");
  const oldChat = storedItems.get("neo-chat-storage");

  await expect(
    restoreBrowserAppBackup(makeProviderBackup(coreSettings)),
  ).rejects.toThrow(/backup|settings|provider|model/i);

  expect(localStorage.values.get("neo-chat-core-settings")).toBe(
    oldCoreSettings,
  );
  expect(storedItems.get("neo-chat-settings")).toBe(oldSettings);
  expect(storedItems.get("neo-chat-storage")).toBe(oldChat);
  expect(appDbMock.setItem).not.toHaveBeenCalled();
  expect(appDbMock.removeItem).not.toHaveBeenCalled();
}

async function expectProviderBackupRejected(providers: unknown): Promise<void> {
  await expectCoreSettingsBackupRejected({
    state: { providers },
    version: 5,
  });
}

function makeLegacyResearchBackup(): Blob {
  return new Blob(
    [
      JSON.stringify({
        exportVersion: 2,
        storageVersion: 5,
        exportedAt: "2026-07-16T00:00:00.000Z",
        data: {
          settings: { state: { theme: "dark" }, version: 5 },
          chat: {
            state: { sessions: [{ id: "legacy-session" }] },
            version: 5,
          },
          sessionMessages: {
            "legacy-session": { nodesById: {}, rootMessageIds: [] },
          },
          knowledge: { state: { collections: [] }, version: 5 },
          memory: { state: { memories: [] }, version: 5 },
          research: [
            {
              schemaVersion: 1,
              id: "legacy-json-research",
              sessionId: "legacy-session",
            },
          ],
        },
      }),
    ],
    { type: "application/json" },
  );
}

function makeWorkspaceOutputBackup(): Blob {
  const exportedAt = "2026-08-23T00:00:00.000Z";
  const workspaceUrl = "opfs://chat/workspace/new-session/out/report.md";
  const archiveUrl = "opfs://chat/archives/new-session/archive-id.zip";
  const artifactContent = strToU8("immutable report");
  const artifactHash = createHash("sha256")
    .update(artifactContent)
    .digest("hex");
  const artifactUrl = `opfs://chat/artifacts/new-session/${artifactHash}-published.md`;
  const researchArtifactContent = strToU8("shared research report");
  const researchArtifactHash = createHash("sha256")
    .update(researchArtifactContent)
    .digest("hex");
  const researchArtifactUrl = `opfs://chat/research-artifacts/${researchArtifactHash}.md`;
  const workspaceContent = strToU8("restored report");
  const archiveContent = strToU8("zip bytes");
  const files = [
    {
      originalUrl: workspaceUrl,
      archivePath: "files/000000",
      mimeType: "text/markdown",
      content: workspaceContent,
    },
    {
      originalUrl: archiveUrl,
      archivePath: "files/000001",
      mimeType: "application/zip",
      content: archiveContent,
    },
    {
      originalUrl: artifactUrl,
      archivePath: "files/000002",
      mimeType: "text/markdown",
      content: artifactContent,
    },
    {
      originalUrl: researchArtifactUrl,
      archivePath: "files/000003",
      mimeType: "text/markdown",
      content: researchArtifactContent,
    },
  ];
  const researchTask = {
    ...createResearchTask({
      id: "research-backup",
      sessionId: "new-session",
      goal: "Restore a research report",
      now: 1,
    }),
    status: "completed" as const,
    updatedAt: 5,
    endedAt: 5,
    planVersions: [
      {
        id: "plan-backup",
        version: 1,
        title: "Restore plan",
        summary: "Verify report backup and restore.",
        objective: "Verify research report backup and restore.",
        scope: {
          audience: "The backup owner",
          includes: ["Report Artifact availability"],
          excludes: [],
          allowedSourceTypes: ["workspace" as const],
        },
        assumptions: [],
        deliverable: {
          kind: "exact_answer" as const,
          description: "A restorable report.",
          requiredSections: ["Answer", "Sources"],
        },
        strategy: {
          initialBreadth: 1,
          maxDepth: 1,
          maxQueries: 2,
          resultsPerQuery: 3,
        },
        recon: {
          status: "unavailable" as const,
          sourceFeasibility: "unverified" as const,
          startedAt: 1,
          completedAt: 1,
          timeoutMs: 30_000,
          queryLimit: 2,
          resultsPerQuery: 5,
          usage: { queryCount: 0, resultCount: 0, wallTimeMs: 0 },
          queries: [],
        },
        steps: [
          {
            id: "step-backup",
            title: "Verify report availability",
            objective: "Confirm the report Artifact remains available.",
            questions: ["Does the report remain available?"],
            queryTopics: ["research report backup"],
            sourcePriorities: [
              { sourceType: "workspace" as const, priority: "high" as const },
            ],
            evidenceCriteria: ["The immutable Artifact can be read."],
            priority: "high" as const,
          },
          {
            id: "step-backup-context",
            title: "Check backup context",
            objective: "Confirm backup context remains readable.",
            questions: ["Is backup context preserved?"],
            queryTopics: ["backup context"],
            sourcePriorities: [
              { sourceType: "workspace" as const, priority: "low" as const },
            ],
            evidenceCriteria: ["The backup context can be read."],
            priority: "low" as const,
          },
          {
            id: "step-backup-reference",
            title: "Check report reference",
            objective: "Confirm the report run reference remains valid.",
            questions: ["Is the report run reference preserved?"],
            queryTopics: ["report run reference"],
            sourcePriorities: [
              { sourceType: "workspace" as const, priority: "low" as const },
            ],
            evidenceCriteria: ["The run reference is consistent."],
            priority: "low" as const,
          },
        ],
        completionCriteria: ["The report Artifact is restored."],
        createdAt: 2,
      },
    ],
    activePlanVersion: 1,
    reportRuns: [
      {
        id: "run-backup",
        taskId: "research-backup",
        planVersion: 1,
        reportKind: "initial" as const,
        phase: "completed" as const,
        strategy: {
          initialBreadth: 1,
          maxDepth: 1,
          maxQueries: 2,
          resultsPerQuery: 3,
        },
        waves: [],
        nodes: [],
        learningPackets: [],
        claims: [],
        frontierNodeIds: [],
        executedQueries: [],
        coverage: {
          requiredStepCount: 1,
          coveredStepCount: 1,
          majorClaimCount: 0,
          verifiedMajorClaimCount: 0,
          unresolvedMajorClaimCount: 0,
          stepRatio: 1,
          claimRatio: 1,
          overallRatio: 1,
          complete: true,
        },
        usage: {
          queryCount: 0,
          sourceBodyCount: 0,
          toolRounds: 0,
          toolCalls: 0,
          wallTimeMs: 0,
          totalTokens: 0,
        },
        startedAt: 3,
        updatedAt: 4,
        endedAt: 4,
        stopReason: { code: "coverage_satisfied" as const, at: 4 },
      },
    ],
    activeReportRunId: "run-backup",
    reportVersions: [
      {
        id: "report-backup",
        version: 1,
        artifactId: researchArtifactUrl,
        planVersion: 1,
        researchRunId: "run-backup",
        createdAt: 4,
        summary: "The report is restorable.",
        keyFindings: ["The report Artifact is included."],
        gaps: [],
        coveredStepIds: ["step-backup"],
        kind: "initial" as const,
      },
    ],
    activeReportVersion: 1,
  };
  const manifest: BackupManifestV3 = {
    format: "neo-chat-backup",
    exportVersion: 3,
    storageVersion: 5,
    exportedAt,
    dataPath: "data.json",
    files: files.map((file) => ({
      originalUrl: file.originalUrl,
      archivePath: file.archivePath,
      size: file.content.byteLength,
      mimeType: file.mimeType,
      sha256: createHash("sha256").update(file.content).digest("hex"),
    })),
    missingReferences: [],
    excluded: [],
  };
  const payload = {
    exportVersion: 3,
    storageVersion: 5,
    exportedAt,
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: { credentialsIncluded: false, excluded: [] },
    },
    data: {
      coreSettings: { state: {}, version: 5 },
      settings: { state: {}, version: 5 },
      chat: { state: { sessions: [{ id: "new-session" }] }, version: 5 },
      sessionMessages: {
        "new-session": {
          nodesById: {
            message: {
              id: "message",
              message: {
                id: "message",
                role: "model",
                content: "",
                timestamp: 1,
                outputBlocks: [
                  {
                    id: "workspace-file",
                    type: "workspace_file",
                    file: {
                      path: "out/report.md",
                      fileName: "report.md",
                      mimeType: "text/markdown",
                      bytes: workspaceContent.byteLength,
                      url: workspaceUrl,
                      revision: "revision-before-backup",
                    },
                  },
                  {
                    id: "published-artifact",
                    type: "workspace_file",
                    file: {
                      path: "out/published.md",
                      fileName: "published.md",
                      mimeType: "text/markdown",
                      bytes: artifactContent.byteLength,
                      url: artifactUrl,
                      revision: `sha256:${artifactHash}`,
                    },
                  },
                  {
                    id: "workspace-archive",
                    type: "workspace_archive",
                    archive: {
                      fileName: "results.zip",
                      bytes: archiveContent.byteLength,
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
        },
      },
      knowledge: { state: { collections: [] }, version: 5 },
      memory: { state: { memories: [] }, version: 5 },
      research: [researchTask],
    },
  };
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "data.json": strToU8(JSON.stringify(payload)),
    ...Object.fromEntries(
      files.map((file) => [file.archivePath, file.content]),
    ),
  });
  return new Blob([bytes], { type: "application/zip" });
}

describe("browser backup restore", () => {
  beforeEach(() => {
    storedItems.clear();
    writtenFiles.clear();
    deletedUrls.length = 0;
    vi.clearAllMocks();
    storedItems.set(
      "neo-chat-settings",
      JSON.stringify({ state: { system: {} }, version: 5 }),
    );
    storedItems.set(
      "neo-chat-storage",
      JSON.stringify({
        state: {
          sessions: [{ id: "old-session" }],
          workspaces: [
            {
              id: "w1",
              files: [
                {
                  id: "old-file",
                  fileName: "old.txt",
                  mimeType: "text/plain",
                  url: "opfs://workspaces/w1/old.txt",
                },
              ],
            },
          ],
        },
        version: 5,
      }),
    );
    storedItems.set("session_messages_old-session", {
      nodesById: {},
      rootMessageIds: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    appDbMock.setItem.mockImplementation(async (key, value) => {
      storedItems.set(key, value);
      return value;
    });
  });

  it("stages files, replaces stores, strips credentials, and resets RAG IDs", async () => {
    const localStorage = createLocalStorage({
      "neo-chat-core-settings": JSON.stringify({
        state: { theme: "light" },
        version: 5,
      }),
    });
    vi.stubGlobal("window", { localStorage });
    const locks = createSerialWebLocks();
    vi.stubGlobal("navigator", {
      locks,
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });

    const phases: string[] = [];
    const result = await restoreBrowserAppBackup(makeBackup(), {
      onProgress: (progress) => {
        phases.push(progress.phase);
        if (progress.phase === "staging") {
          expect(() => assertAppDataWritesAllowed(localStorage)).toThrow(
            "writes are paused",
          );
        }
      },
    });
    const settings = String(storedItems.get("neo-chat-settings"));
    const chat = String(storedItems.get("neo-chat-storage"));
    const knowledge = String(storedItems.get("knowledge-storage"));
    const restoredKnowledge = JSON.parse(knowledge);
    const sessionMessages = JSON.stringify(
      storedItems.get("session_messages_new-session"),
    );
    const restoredSessionMessages = storedItems.get(
      "session_messages_new-session",
    ) as any;

    expect(result).toMatchObject({
      restoredFileCount: 1,
      skippedLegacyResearchTaskCount: 1,
      incomplete: true,
      requiresReload: true,
    });
    expect(writtenFiles.size).toBe(1);
    expect(settings).not.toContain("must-not-restore");
    expect(localStorage.values.get("neo-chat-core-settings")).not.toContain(
      "must-not-restore",
    );
    expect(knowledge).not.toContain("remote-vector");
    expect(knowledge).not.toContain("ragChunkCount");
    expect(knowledge).toContain("not_indexed");
    expect(knowledge).not.toContain("stale remote error");
    expect(knowledge).not.toContain('"indexStatus":"indexing"');
    expect(knowledge).not.toContain('"storageStatus":"parsing"');
    expect(knowledge).toContain("opfs://knowledge-base/restored-");
    expect(restoredKnowledge.state.collections[0].files[1]).toMatchObject({
      status: "error",
      storageStatus: "error",
      indexStatus: "not_indexed",
    });
    expect(chat).not.toContain("opfs://chat/new-session/missing.txt");
    expect(chat).toContain("localFileMissing");
    expect(sessionMessages).not.toContain(
      "opfs://chat/new-session/missing.txt",
    );
    expect(sessionMessages).toContain("localFileMissing");
    expect(
      restoredSessionMessages.nodesById.message.message.outputBlocks[0]
        .presentation.document,
    ).toMatchObject({
      fileName: "Recovered document.txt",
      mimeType: "text/plain",
      localFileMissing: true,
    });
    expect(sessionMessages).toContain(
      "Keep opfs://chat/new-session/not-a-reference.txt unchanged.",
    );
    expect(storedItems.has("session_messages_old-session")).toBe(false);
    expect(storedItems.has("session_messages_new-session")).toBe(true);
    await expect(
      getResearchTaskRepository().get("legacy-research-task"),
    ).resolves.toBeNull();
    expect(localStorage.values.get(APP_RESTORE_JOURNAL_KEY)).toContain(
      '"phase":"applied_pending_boot"',
    );
    expect(localStorage.values.has(APP_RESTORE_WRITE_LOCK_KEY)).toBe(true);
    expect(
      localStorage.values.get(APP_RESTORE_CREDENTIAL_NOTICE_KEY),
    ).toContain('"providers"');
    expect(phases).toContain("validating");
    expect(phases).toContain("staging");
    expect(phases).toContain("applying");
    expect(flushSessionMessageWrites).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(flushSessionMessageWrites).mock.invocationCallOrder[0],
    ).toBeLessThan(locks.request.mock.invocationCallOrder[0]);

    await confirmAppliedRestore(localStorage);
    expect(deletedUrls).toContain("opfs://workspaces/w1/old.txt");
    expect(storedItems.has(APP_RESTORE_SNAPSHOT_KEY)).toBe(false);
    expect(localStorage.values.has(APP_RESTORE_JOURNAL_KEY)).toBe(false);
    expect(localStorage.values.has(APP_RESTORE_WRITE_LOCK_KEY)).toBe(false);
    expect(
      localStorage.values.get(APP_RESTORE_CREDENTIAL_NOTICE_KEY),
    ).toContain('"plugins"');
  });

  it("rejects duplicate provider identifiers before changing persisted data", async () => {
    await expectProviderBackupRejected([
      { id: "DUPLICATE", type: "OpenAI", models: ["model-a"] },
      { id: "DUPLICATE", type: "OpenAI", models: ["model-b"] },
    ]);
  });

  it.each([
    ["string", "invalid core settings"],
    ["null", null],
    ["array", []],
  ])(
    "rejects a %s core settings payload before changing persisted data",
    async (_, coreSettings) => {
      await expectCoreSettingsBackupRejected(coreSettings);
    },
  );

  it("round-trips portable providers through browser export and restore", async () => {
    const localStorage = createLocalStorage({
      "neo-chat-core-settings": JSON.stringify({
        state: {
          providers: [
            {
              id: "FIRST",
              name: "First provider",
              type: "OpenAI Compatible",
              baseUrl: "https://first.example/v1",
              apiKey: "plaintext-secret",
              enabled: true,
              directCall: true,
              models: ["first-model"],
              modelsList: ["first-model", "first-preview"],
            },
            {
              id: "SERVER_DEFAULT",
              name: "Source deployment provider",
              type: "OpenAI",
              baseUrl: "default",
              apiKey: "",
              enabled: true,
              models: ["server-model"],
              modelsList: ["server-model"],
              isServerDefault: true,
            },
            {
              id: "SECOND",
              name: "Second provider",
              type: "Anthropic",
              baseUrl: "https://second.example/v1",
              apiKeySecret: {
                v: 1,
                alg: "A256GCM",
                keyId: "key-id",
                iv: "iv",
                ciphertext: "ciphertext",
                context: "provider",
              },
              enabled: false,
              directCall: false,
              models: ["second-model"],
              modelsList: ["second-model"],
            },
          ],
          defaultModels: {
            titleGeneration: "FIRST:first-model",
            relatedQuestions: "SERVER_DEFAULT:server-model",
            contextCompression: "SECOND:second-model",
          },
        },
        version: 5,
      }),
    });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });
    storedItems.clear();
    const backup = await createBrowserAppBackup();

    localStorage.values.clear();
    storedItems.clear();
    await restoreBrowserAppBackup(backup.blob);

    const stored = JSON.parse(
      localStorage.values.get("neo-chat-core-settings") || "null",
    );
    const migrated = migrateCoreSettingsState(stored.state);
    const defaultModels = pruneUnavailableDefaultModels(
      migrated.defaultModels,
      migrated.providers || [],
    );

    expect(migrated.providers).toEqual([
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
    expect(defaultModels).toMatchObject({
      titleGeneration: "FIRST:first-model",
      relatedQuestions: "",
      contextCompression: "",
    });
    expect(JSON.stringify(stored)).not.toContain("plaintext-secret");
    expect(JSON.stringify(stored)).not.toContain("ciphertext");
    expect(JSON.stringify(stored)).not.toContain("SERVER_DEFAULT");
  });

  it.each([
    ["non-array provider list", {}],
    ["non-object provider", [null]],
    ["empty provider identifier", [{ id: "", type: "OpenAI" }]],
    ["unknown provider type", [{ id: "UNKNOWN", type: "Unknown Provider" }]],
    [
      "non-boolean provider flags",
      [{ id: "FLAGS", type: "OpenAI", enabled: "yes" }],
    ],
    [
      "invalid provider URL",
      [{ id: "URL", type: "OpenAI Compatible", baseUrl: "https://" }],
    ],
    [
      "provider count overflow",
      Array.from(
        { length: PROVIDER_CONFIG_LIMITS.maxProviders + 1 },
        (_, index) => ({ id: `P${index}`, type: "OpenAI" }),
      ),
    ],
    [
      "duplicate normalized model identifier",
      [
        {
          id: "MODELS",
          type: "Google",
          models: ["models/gemini-flash", "gemini-flash"],
        },
      ],
    ],
    [
      "model count overflow",
      [
        {
          id: "MODELS",
          type: "OpenAI",
          models: Array.from(
            { length: PROVIDER_MODEL_LIMITS.maxModels + 1 },
            (_, index) => `model-${index}`,
          ),
        },
      ],
    ],
    [
      "selected model outside the available list",
      [
        {
          id: "MODELS",
          type: "OpenAI",
          models: ["selected-model"],
          modelsList: ["available-model"],
        },
      ],
    ],
  ])("rejects %s without changing persisted data", async (_, providers) => {
    await expectProviderBackupRejected(providers);
  });

  it("restores legal v2 provider state and discards its source deployment provider", async () => {
    const localStorage = createLocalStorage({});
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });
    const backup = new Blob([
      JSON.stringify({
        exportVersion: 2,
        storageVersion: 5,
        exportedAt: "2026-09-02T00:00:00.000Z",
        data: {
          coreSettings: {
            state: {
              providers: [
                {
                  id: "SERVER_DEFAULT",
                  name: "Old deployment provider",
                  type: "OpenAI",
                  baseUrl: "default",
                  enabled: true,
                  models: ["server-model"],
                  isServerDefault: true,
                },
                {
                  id: "LEGACY_GOOGLE",
                  name: "Legacy Google",
                  type: "Gemini",
                  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
                  enabled: true,
                  models: ["models/gemini-flash"],
                },
              ],
              defaultModels: {
                titleGeneration: "LEGACY_GOOGLE:gemini-flash",
                relatedQuestions: "SERVER_DEFAULT:server-model",
              },
            },
            version: 5,
          },
          sessionMessages: {},
        },
      }),
    ]);

    await restoreBrowserAppBackup(backup);

    const restored = JSON.parse(
      localStorage.values.get("neo-chat-core-settings") || "null",
    );
    expect(restored.state.providers).toEqual([
      expect.objectContaining({
        id: "LEGACY_GOOGLE",
        type: "Google",
        models: ["gemini-flash"],
        modelsList: ["gemini-flash"],
      }),
    ]);
    expect(restored.state.defaultModels).toEqual({
      titleGeneration: "LEGACY_GOOGLE:gemini-flash",
      relatedQuestions: "",
    });
  });

  it("restores workspace file and archive blocks to valid OPFS locations", async () => {
    const localStorage = createLocalStorage({});
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });

    const result = await restoreBrowserAppBackup(makeWorkspaceOutputBackup());
    const restoredTree = storedItems.get("session_messages_new-session") as any;
    const [fileBlock, artifactBlock, archiveBlock] =
      restoredTree.nodesById.message.message.outputBlocks;
    const restoredResearchTask =
      await getResearchTaskRepository().get("research-backup");

    expect(result.restoredFileCount).toBe(4);
    expect(result.skippedLegacyResearchTaskCount).toBe(0);
    expect(fileBlock.file.url).toMatch(
      /^opfs:\/\/chat\/workspace\/new-session\/restored-[a-z0-9]+\/000000\/report\.md$/,
    );
    expect(fileBlock.file.path).toBe(
      fileBlock.file.url.replace("opfs://chat/workspace/new-session/", ""),
    );
    expect(fileBlock.file.revision).toBe("revision-before-backup");
    expect(writtenFiles.has(fileBlock.file.url)).toBe(true);
    expect(archiveBlock.archive).toMatchObject({
      fileName: "results.zip",
      entryCount: 1,
    });
    expect(archiveBlock.archive.url).toMatch(
      /^opfs:\/\/chat\/archives\/new-session\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.zip$/,
    );
    expect(writtenFiles.has(archiveBlock.archive.url)).toBe(true);
    expect(artifactBlock.file).toMatchObject({
      fileName: "published.md",
      revision: expect.stringMatching(/^sha256:/),
    });
    expect(artifactBlock.file.url).toMatch(
      /^opfs:\/\/chat\/artifacts\/new-session\/[a-f0-9]{64}-__restore_[a-z0-9]+_000002__published\.md$/,
    );
    expect(writtenFiles.has(artifactBlock.file.url)).toBe(true);
    expect(restoredResearchTask).toMatchObject({
      id: "research-backup",
      status: "completed",
      reportVersions: [
        {
          artifactId: expect.stringMatching(
            /^opfs:\/\/chat\/research-artifacts\/[a-f0-9]{64}-__restore_[a-z0-9]+_000003__\.md$/,
          ),
        },
      ],
    });
    expect(
      writtenFiles.has(
        restoredResearchTask?.reportVersions[0]?.artifactId || "",
      ),
    ).toBe(true);
    expect(
      normalizeMessage(restoredTree.nodesById.message.message).outputBlocks,
    ).toEqual([
      expect.objectContaining({ type: "workspace_file" }),
      expect.objectContaining({ type: "workspace_file" }),
      expect.objectContaining({ type: "workspace_archive" }),
    ]);
  });

  it("restores unrelated legacy JSON data while skipping v1 research tasks", async () => {
    const localStorage = createLocalStorage({});
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });

    const result = await restoreBrowserAppBackup(makeLegacyResearchBackup());

    expect(result).toMatchObject({
      kind: "legacy-json-v2",
      restoredFileCount: 0,
      skippedLegacyResearchTaskCount: 1,
      incomplete: true,
      requiresReload: true,
    });
    expect(storedItems.has("session_messages_legacy-session")).toBe(true);
    await expect(
      getResearchTaskRepository().get("legacy-json-research"),
    ).resolves.toBeNull();

    await confirmAppliedRestore(localStorage);
  });

  it("rolls current data back when applying imported stores fails", async () => {
    const oldSettings = storedItems.get("neo-chat-settings");
    const oldChat = storedItems.get("neo-chat-storage");
    const localStorage = createLocalStorage({
      "neo-chat-core-settings": "old-core",
    });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });
    let failed = false;
    appDbMock.setItem.mockImplementation(async (key, value) => {
      if (key === "neo-chat-storage" && !failed) {
        failed = true;
        throw new Error("simulated IndexedDB failure");
      }
      storedItems.set(key, value);
      return value;
    });

    await expect(restoreBrowserAppBackup(makeBackup())).rejects.toThrow(
      "simulated IndexedDB failure",
    );

    expect(storedItems.get("neo-chat-settings")).toEqual(oldSettings);
    expect(storedItems.get("neo-chat-storage")).toEqual(oldChat);
    expect(storedItems.has("session_messages_old-session")).toBe(true);
    expect(storedItems.has("session_messages_new-session")).toBe(false);
    expect(localStorage.values.get("neo-chat-core-settings")).toBe("old-core");
    expect(localStorage.values.has(APP_RESTORE_JOURNAL_KEY)).toBe(false);
    expect(localStorage.values.has(APP_RESTORE_WRITE_LOCK_KEY)).toBe(false);
    expect(writtenFiles.size).toBe(0);
  });

  it("rolls staged files back when restore is cancelled before apply", async () => {
    const oldSettings = storedItems.get("neo-chat-settings");
    const localStorage = createLocalStorage({
      "neo-chat-core-settings": "old-core",
    });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });
    const controller = new AbortController();

    await expect(
      restoreBrowserAppBackup(makeBackup(), {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === "staging" && progress.completed === 1) {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(storedItems.get("neo-chat-settings")).toEqual(oldSettings);
    expect(localStorage.values.get("neo-chat-core-settings")).toBe("old-core");
    expect(localStorage.values.has(APP_RESTORE_JOURNAL_KEY)).toBe(false);
    expect(writtenFiles.size).toBe(0);
    expect(localStorage.values.has(APP_RESTORE_CREDENTIAL_NOTICE_KEY)).toBe(
      false,
    );
  });

  it("serializes concurrent restores without orphaning another transaction snapshot", async () => {
    const localStorage = createLocalStorage({
      "neo-chat-core-settings": "old-core",
    });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      locks: createSerialWebLocks(),
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });

    const [first, second] = await Promise.all([
      restoreBrowserAppBackup(makeBackup()),
      restoreBrowserAppBackup(makeBackup()),
    ]);
    expect(first.restoredFileCount).toBe(1);
    expect(second.restoredFileCount).toBe(1);

    const journal = JSON.parse(
      localStorage.values.get(APP_RESTORE_JOURNAL_KEY) || "null",
    );
    const snapshot = storedItems.get(APP_RESTORE_SNAPSHOT_KEY) as
      { transactionId?: string } | undefined;
    expect(journal?.phase).toBe("applied_pending_boot");
    expect(snapshot?.transactionId).toBe(journal?.transactionId);

    await confirmAppliedRestore(localStorage);
    expect(storedItems.has(APP_RESTORE_SNAPSHOT_KEY)).toBe(false);
    expect(localStorage.values.has(APP_RESTORE_JOURNAL_KEY)).toBe(false);
    expect(localStorage.values.has(APP_RESTORE_WRITE_LOCK_KEY)).toBe(false);
    expect(writtenFiles.size).toBe(1);
  });

  it("does not deadlock when a queued restore observes the first restore failing", async () => {
    const localStorage = createLocalStorage({
      "neo-chat-core-settings": "old-core",
    });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {
      locks: createSerialWebLocks(),
      storage: {
        estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
      },
    });

    let failFirstWrite: (() => void) | undefined;
    let markFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      markFirstWriteStarted = resolve;
    });
    vi.mocked(writeBlobToOPFS).mockImplementationOnce(async () => {
      markFirstWriteStarted?.();
      await new Promise<void>((_resolve, reject) => {
        failFirstWrite = () => reject(new Error("simulated OPFS failure"));
      });
    });

    const firstRestore = restoreBrowserAppBackup(makeBackup());
    await firstWriteStarted;
    const queuedRestore = restoreBrowserAppBackup(makeBackup());
    failFirstWrite?.();

    await expect(firstRestore).rejects.toThrow("simulated OPFS failure");
    await expect(queuedRestore).resolves.toMatchObject({
      restoredFileCount: 1,
      requiresReload: true,
    });

    expect(localStorage.values.get(APP_RESTORE_JOURNAL_KEY)).toContain(
      '"phase":"applied_pending_boot"',
    );
    expect(localStorage.values.has(APP_RESTORE_WRITE_LOCK_KEY)).toBe(true);
  });
});
