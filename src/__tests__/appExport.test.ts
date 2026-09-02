import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appDbMock, storedItems } = vi.hoisted(() => {
  const storedItems = new Map<string, unknown>();
  const appDbMock = {
    getItem: vi.fn(async (key: string) => storedItems.get(key)),
    keys: vi.fn(async () => [...storedItems.keys()]),
  };

  return { appDbMock, storedItems };
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
  STORAGE_VERSION: 4,
}));

import {
  APP_EXPORT_VERSION,
  collectOrphanOpfsUrls,
  collectReferencedOpfsUrls,
  createAppExportPayload,
  createBrowserAppExportPayload,
  scrubAppExportValue,
} from "../lib/data/appExport";
import { STORAGE_VERSION } from "../store/storage/storageConfig";
import { enqueueSessionMessageWrite } from "../store/sessionMessagePersistence";

describe("app export helpers", () => {
  beforeEach(() => {
    storedItems.clear();
    vi.clearAllMocks();
    appDbMock.getItem.mockImplementation(async (key: string) =>
      storedItems.get(key),
    );
    appDbMock.keys.mockImplementation(async () => [...storedItems.keys()]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a versioned local-first export payload", () => {
    const payload = createAppExportPayload({
      exportedAt: "2026-07-01T00:00:00.000Z",
      coreSettings: { theme: "dark" },
      settings: { activePlugins: ["weather"] },
      chat: { sessions: [{ id: "s1", title: "Chat" }] },
      sessionMessages: {
        s1: {
          nodesById: {},
          rootMessageIds: [],
        },
      },
      knowledge: { collections: [] },
      memory: { memories: [{ id: "mem-1" }] },
    });

    expect(APP_EXPORT_VERSION).toBe(3);
    expect(payload).toEqual({
      exportVersion: APP_EXPORT_VERSION,
      storageVersion: STORAGE_VERSION,
      exportedAt: "2026-07-01T00:00:00.000Z",
      metadata: {
        opfs: {
          mode: "bundled",
          includesBlobs: true,
        },
        security: {
          credentialsIncluded: false,
          excluded: expect.arrayContaining([
            expect.stringContaining("credentials"),
          ]),
        },
      },
      data: {
        coreSettings: { theme: "dark" },
        settings: { activePlugins: ["weather"] },
        chat: { sessions: [{ id: "s1", title: "Chat" }] },
        sessionMessages: {
          s1: {
            nodesById: {},
            rootMessageIds: [],
          },
        },
        knowledge: { collections: [] },
        memory: { memories: [{ id: "mem-1" }] },
      },
    });
  });

  it("removes plaintext credentials, encrypted envelopes, and transient caches", () => {
    const scrubbed = scrubAppExportValue({
      providers: [
        {
          id: "provider-1",
          apiKey: "plain-key",
          apiKeySecret: {
            v: 1,
            alg: "A256GCM",
            keyId: "key-id",
            iv: "iv",
            ciphertext: "ciphertext",
            context: "provider",
          },
        },
      ],
      pluginConfigs: {
        demo: {
          auth: {
            type: "bearer",
            value: "plain-token",
            localValueSecret: {
              v: 1,
              alg: "A256GCM",
              keyId: "key-id",
              iv: "iv",
              ciphertext: "ciphertext",
              context: "plugin",
            },
          },
        },
      },
      installedPlugins: [{ id: "demo" }],
      marketPlugins: [{ id: "cached" }],
      modelMetadata: { cached: { id: "cached" } },
    });

    expect(scrubbed).toEqual({
      providers: [{ id: "provider-1" }],
      pluginConfigs: { demo: { auth: { type: "bearer" } } },
      installedPlugins: [{ id: "demo" }],
    });
    expect(JSON.stringify(scrubbed)).not.toContain("ciphertext");
    expect(JSON.stringify(scrubbed)).not.toContain("plain-key");
    expect(JSON.stringify(scrubbed)).not.toContain("plain-token");
  });

  it("exports user providers in order without deployment-owned providers", () => {
    const payload = createAppExportPayload({
      coreSettings: {
        state: {
          providers: [
            {
              id: "FIRST",
              name: "First provider",
              type: "OpenAI Compatible",
              baseUrl: "https://first.example/v1",
              apiKey: "first-secret",
              enabled: true,
              directCall: true,
              models: ["first-model"],
              modelsList: ["first-model", "first-preview"],
            },
            {
              id: "SERVER_DEFAULT",
              name: "Deployment provider",
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
              models: ["second-model"],
              modelsList: ["second-model"],
            },
          ],
          defaultModels: {
            titleGeneration: "FIRST:first-model",
            relatedQuestions: "SERVER_DEFAULT:server-model",
          },
          serverDefaultProviderEnabled: true,
        },
        version: STORAGE_VERSION,
      },
    });

    expect(payload.data.coreSettings).toEqual({
      state: {
        providers: [
          {
            id: "FIRST",
            name: "First provider",
            type: "OpenAI Compatible",
            baseUrl: "https://first.example/v1",
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
            enabled: false,
            models: ["second-model"],
            modelsList: ["second-model"],
          },
        ],
        defaultModels: {
          titleGeneration: "FIRST:first-model",
          relatedQuestions: "",
        },
      },
      version: STORAGE_VERSION,
    });
  });

  it("scrubs configured URLs and arbitrary headers without changing content URLs", () => {
    const chapterUrl =
      "https://docs.example.com/chapter?author=ada&design=systems#author-section";
    const scrubbed = scrubAppExportValue({
      settings: {
        pluginConfigs: {
          demo: {
            baseUrl:
              "https://user:pass@example.com/api?keep=1&access_token=token&api_token=api-token&auth_token=auth-token&bearer_token=bearer-token&x-api-key=x-api-secret&subscription-key=subscription-secret&key=google-key&X-Amz-Credential=aws-credential&X-Amz-Security-Token=aws-session#access_token=fragment",
            headers: { "X-Custom-Tenant-Secret": "must-not-export" },
          },
        },
        installedPlugins: [
          {
            id: "schema-demo",
            baseUrl:
              "https://plugin-user:plugin-pass@plugin.example.com/api?token=plugin-secret",
            functions: [
              {
                name: "call",
                parameters: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    headers: { type: "object" },
                  },
                },
              },
            ],
            mcp: {
              serverUrl: "https://mcp.example.com?token=mcp-secret",
              headers: { "X-Arbitrary-Auth": "must-not-export" },
            },
          },
        ],
      },
      sessionMessages: {
        s1: {
          nodesById: {
            m1: {
              message: {
                content: chapterUrl,
                toolCalls: [
                  {
                    result: {
                      secret: "business-result",
                      credentials: "business-label",
                      url: chapterUrl,
                    },
                  },
                ],
                attachments: [
                  {
                    id: "temporary",
                    fileName: "temporary.txt",
                    mimeType: "text/plain",
                    url: "blob:https://app.example/id",
                  },
                  {
                    id: "signed",
                    fileName: "signed.txt",
                    mimeType: "text/plain",
                    url: "https://files.example/signed.txt?X-Amz-Credential=credential&X-Amz-Signature=signature",
                  },
                ],
              },
            },
          },
        },
      },
    }) as any;

    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain("must-not-export");
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("google-key");
    expect(serialized).not.toContain("api-token");
    expect(serialized).not.toContain("auth-token");
    expect(serialized).not.toContain("bearer-token");
    expect(serialized).not.toContain("x-api-secret");
    expect(serialized).not.toContain("subscription-secret");
    expect(serialized).not.toContain("aws-credential");
    expect(serialized).not.toContain("aws-session");
    expect(serialized).not.toContain("mcp-secret");
    expect(serialized).not.toContain("plugin-secret");
    expect(serialized).not.toContain("plugin-user");
    expect(serialized).not.toContain("blob:https://");
    expect(
      scrubbed.settings.installedPlugins[0].functions[0].parameters.properties,
    ).toEqual({
      token: { type: "string" },
      headers: { type: "object" },
    });
    expect(scrubbed.settings.installedPlugins[0].mcp.headers).toBeUndefined();
    expect(scrubbed.sessionMessages.s1.nodesById.m1.message.content).toBe(
      chapterUrl,
    );
    expect(
      scrubbed.sessionMessages.s1.nodesById.m1.message.toolCalls[0].result,
    ).toEqual({
      secret: "business-result",
      credentials: "business-label",
      url: chapterUrl,
    });
    expect(
      scrubbed.sessionMessages.s1.nodesById.m1.message.attachments[0],
    ).toMatchObject({ localFileMissing: true });
    expect(
      scrubbed.sessionMessages.s1.nodesById.m1.message.attachments[1],
    ).toMatchObject({
      localFileMissing: true,
      localFileError: expect.stringContaining("credential-bearing"),
    });
    expect(
      scrubbed.sessionMessages.s1.nodesById.m1.message.attachments[1].url,
    ).toBeUndefined();
  });

  it("exports every stored session message tree, including orphans", async () => {
    const storedMessageTree = {
      nodesById: {
        message1: {
          id: "message1",
          message: {
            id: "message1",
            role: "model",
            content: "image",
            timestamp: 1,
            attachments: [
              {
                id: "image1",
                fileName: "image.png",
                mimeType: "image/png",
                url: "opfs://images/generated/image.png",
              },
            ],
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message1"],
      activeRootMessageId: "message1",
    };
    const orphanMessageTree = {
      nodesById: {},
      rootMessageIds: [],
    };
    storedItems.set(
      "neo-chat-storage",
      JSON.stringify({ state: { sessions: [{ id: "session1" }] } }),
    );
    storedItems.set("session_messages_session1", storedMessageTree);
    storedItems.set("session_messages_orphan", orphanMessageTree);
    storedItems.set("unrelated-record", { ignored: true });

    const payload = await createBrowserAppExportPayload();

    expect(payload.data.chat).toEqual({
      state: { sessions: [{ id: "session1" }] },
    });
    expect(payload.data.sessionMessages).toEqual({
      session1: storedMessageTree,
      orphan: orphanMessageTree,
    });
    expect(payload.data.research).toEqual([]);
    expect(
      (payload.data.sessionMessages.session1 as typeof storedMessageTree)
        .nodesById.message1.message.attachments[0].url,
    ).toBe("opfs://images/generated/image.png");
    expect(appDbMock.keys).toHaveBeenCalledOnce();
    expect(appDbMock.getItem).toHaveBeenCalledWith("session_messages_orphan");
    expect(appDbMock.getItem).not.toHaveBeenCalledWith("unrelated-record");
  });

  it("waits for pending message persistence before enumerating export data", async () => {
    const latestTree = {
      nodesById: {},
      rootMessageIds: [],
      activeRootMessageId: null,
    };
    let resolveWrite: (() => void) | undefined;
    const write = enqueueSessionMessageWrite(
      "pending-session",
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = () => {
            storedItems.set("session_messages_pending-session", latestTree);
            resolve();
          };
        }),
    );

    const exportPromise = createBrowserAppExportPayload();
    await Promise.resolve();
    expect(appDbMock.keys).not.toHaveBeenCalled();

    resolveWrite?.();
    await write;
    const payload = await exportPromise;

    expect(payload.data.sessionMessages).toEqual({
      "pending-session": latestTree,
    });
  });

  it("rejects instead of returning a partial export when a message tree read fails", async () => {
    storedItems.set("session_messages_session1", {
      nodesById: {},
      rootMessageIds: [],
    });
    storedItems.set("session_messages_broken", {
      nodesById: {},
      rootMessageIds: [],
    });
    appDbMock.getItem.mockImplementation(async (key: string) => {
      if (key === "session_messages_broken") {
        throw new Error("IndexedDB read failed");
      }
      return storedItems.get(key);
    });

    await expect(createBrowserAppExportPayload()).rejects.toThrow(
      "IndexedDB read failed",
    );
  });

  it("collects referenced OPFS URLs and identifies app-owned orphans", () => {
    const referenced = collectReferencedOpfsUrls({
      chat: {
        workspaces: [
          {
            files: [
              {
                fileName: "preset.txt",
                mimeType: "text/plain",
                url: "opfs://workspaces/w1/preset.txt",
              },
              {
                fileName: "remote.txt",
                mimeType: "text/plain",
                url: "https://example.com/remote.txt",
              },
            ],
          },
        ],
        sessions: [
          {
            messages: [
              {
                attachments: [
                  {
                    fileName: "attachment.txt",
                    mimeType: "text/plain",
                    url: "opfs://chat/s1/attachment.txt",
                    displayCache: {
                      opfsUrl: "opfs://images/generated/display-cache.png",
                    },
                  },
                ],
                content: "opfs://chat/s1/mentioned-only.txt",
                outputBlocks: [
                  {
                    type: "image",
                    image: {
                      displayCache: {
                        opfsUrl: "opfs://images/generated/output-block.png",
                      },
                    },
                  },
                  {
                    type: "text",
                    content: "Document body",
                    presentation: {
                      kind: "long_text",
                      title: "Document",
                      format: "markdown",
                      document: {
                        fileName: "Document.md",
                        mimeType: "text/markdown",
                        url: "opfs://chat/long-text/document.md",
                      },
                    },
                  },
                  {
                    type: "workspace_file",
                    file: {
                      path: "out/report.md",
                      fileName: "report.md",
                      mimeType: "text/markdown",
                      bytes: 12,
                      url: "opfs://chat/workspace/s1/out/report.md",
                    },
                  },
                  {
                    type: "workspace_file",
                    file: {
                      path: "out/published.md",
                      fileName: "published.md",
                      mimeType: "text/markdown",
                      bytes: 9,
                      url: `opfs://chat/artifacts/s1/${"a".repeat(64)}-published.md`,
                    },
                  },
                  {
                    type: "workspace_archive",
                    archive: {
                      fileName: "bundle.zip",
                      bytes: 24,
                      entryCount: 1,
                      url: "opfs://chat/archives/s1/archive-id.zip",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      knowledge: {
        collections: [
          {
            files: [
              {
                name: "local.md",
                status: "saved",
                path: "opfs://knowledge-base/c1/local.md",
              },
            ],
          },
        ],
      },
    });

    expect([...referenced].sort()).toEqual([
      "opfs://chat/archives/s1/archive-id.zip",
      `opfs://chat/artifacts/s1/${"a".repeat(64)}-published.md`,
      "opfs://chat/long-text/document.md",
      "opfs://chat/s1/attachment.txt",
      "opfs://chat/workspace/s1/out/report.md",
      "opfs://knowledge-base/c1/local.md",
      "opfs://workspaces/w1/preset.txt",
    ]);
    expect(
      collectOrphanOpfsUrls({
        existingUrls: [
          "opfs://chat/s1/attachment.txt",
          "opfs://chat/s1/orphan.txt",
          "opfs://external/outside.txt",
        ],
        referencedUrls: referenced,
      }),
    ).toEqual(["opfs://chat/s1/orphan.txt"]);
  });
});
