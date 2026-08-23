import { describe, expect, it } from "vitest";
import {
  ensureLegacyGeminiNextChatMigration,
  normalizeLegacyGeminiMessage,
} from "../store/storage/legacyGeminiMigration";
import {
  normalizeMessage,
  normalizeToolCall,
} from "../store/storage/migrations";

function createAsyncStorage(initial?: Record<string, unknown>) {
  const items = new Map<string, unknown>(Object.entries(initial || {}));
  return {
    items,
    storage: {
      getItem: async <T = unknown>(key: string) =>
        (items.has(key) ? items.get(key) : null) as T | null,
      setItem: async <T = unknown>(key: string, value: T) => {
        items.set(key, value);
        return value;
      },
      removeItem: async (key: string) => {
        items.delete(key);
      },
    },
  };
}

function createLocalStorage(initial?: Record<string, string>) {
  const items = new Map<string, string>(Object.entries(initial || {}));
  return {
    items,
    storage: {
      getItem: (key: string) => (items.has(key) ? items.get(key)! : null),
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
    } as Storage,
  };
}

function persisted(state: unknown) {
  return { state, version: 1 };
}

describe("storage migrations", () => {
  it("normalizes forced plugin ids stored on user messages", () => {
    const normalized = normalizeMessage({
      id: "message",
      role: "user",
      content: "Use the referenced plugin",
      timestamp: 1,
      forcedPluginIds: [" weather ", "weather", "", 42],
    } as never);

    expect(normalized.forcedPluginIds).toEqual(["weather"]);
  });

  it("preserves valid long text metadata and drops malformed presentation data", () => {
    const normalized = normalizeMessage({
      id: "message",
      role: "model",
      content: "BodyLegacy",
      timestamp: 1,
      outputBlocks: [
        {
          id: "document",
          type: "text",
          content: "Body",
          presentation: {
            kind: "long_text",
            title: "Notes",
            format: "markdown",
            document: {
              fileName: "Notes.md",
              mimeType: "text/markdown",
              url: "opfs://chat/long-text/notes.md",
            },
          },
        },
        {
          id: "legacy-text",
          type: "text",
          content: "Legacy",
          presentation: {
            kind: "long_text",
            title: "",
            format: "markdown",
            document: {
              fileName: "bad.md",
              mimeType: "text/markdown",
            },
          },
        },
      ],
    });

    expect(normalized.outputBlocks).toEqual([
      expect.objectContaining({
        id: "document",
        presentation: expect.objectContaining({
          title: "Notes",
          document: expect.objectContaining({
            url: "opfs://chat/long-text/notes.md",
          }),
        }),
      }),
      { id: "legacy-text", type: "text", content: "Legacy" },
    ]);
  });

  it("round-trips scratch and published Artifact blocks while dropping unsafe references", () => {
    const artifactHash = "a".repeat(64);
    const normalized = normalizeMessage({
      id: "message",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [
        {
          id: "shared",
          type: "workspace_file",
          file: {
            path: "out/report.md",
            fileName: "report.md",
            mimeType: "text/markdown",
            bytes: 8,
            url: "opfs://chat/workspace/session-1/out/report.md",
            revision: "revision-1",
            title: "Report",
          },
        },
        {
          id: "published",
          type: "workspace_file",
          file: {
            path: "out/published.md",
            fileName: "published.md",
            mimeType: "text/markdown",
            bytes: 9,
            url: `opfs://chat/artifacts/session-1/${artifactHash}-__restore_tx_000001__published.md`,
            revision: `sha256:${artifactHash}`,
          },
        },
        {
          id: "forged-artifact",
          type: "workspace_file",
          file: {
            path: "out/forged.md",
            fileName: "forged.md",
            mimeType: "text/markdown",
            bytes: 9,
            url: `opfs://chat/artifacts/session-1/${artifactHash}-forged.md`,
            revision: `sha256:${"b".repeat(64)}`,
          },
        },
        {
          id: "escaped",
          type: "workspace_file",
          file: {
            path: "secret.txt",
            fileName: "secret.txt",
            mimeType: "text/plain",
            bytes: 4,
            url: "opfs://knowledge-base/secret.txt",
          },
        },
      ],
    } as never);

    expect(normalized.outputBlocks).toEqual([
      {
        id: "shared",
        type: "workspace_file",
        file: expect.objectContaining({
          path: "out/report.md",
          url: "opfs://chat/workspace/session-1/out/report.md",
          revision: "revision-1",
        }),
      },
      {
        id: "published",
        type: "workspace_file",
        file: expect.objectContaining({
          path: "out/published.md",
          revision: `sha256:${artifactHash}`,
        }),
      },
    ]);
  });

  it("adds a deterministic legacy revision to older workspace file blocks", () => {
    const message = {
      id: "message",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [
        {
          id: "shared",
          type: "workspace_file",
          file: {
            path: "out/report.md",
            fileName: "report.md",
            mimeType: "text/markdown",
            bytes: 8,
            url: "opfs://chat/workspace/session-1/out/report.md",
          },
        },
      ],
    } as never;

    const first = normalizeMessage(message);
    const second = normalizeMessage(message);
    const firstBlock = first.outputBlocks?.[0];
    const secondBlock = second.outputBlocks?.[0];

    expect(firstBlock?.type).toBe("workspace_file");
    expect(secondBlock?.type).toBe("workspace_file");
    if (
      firstBlock?.type === "workspace_file" &&
      secondBlock?.type === "workspace_file"
    ) {
      expect(firstBlock.file.revision).toMatch(/^legacy-[0-9a-f]{8}$/);
      expect(secondBlock.file.revision).toBe(firstBlock.file.revision);
    }
  });

  it("round-trips archive blocks and drops ones pointing outside the archive root", () => {
    const normalized = normalizeMessage({
      id: "message",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [
        {
          id: "bundle",
          type: "workspace_archive",
          archive: {
            fileName: "bundle.zip",
            bytes: 120,
            entryCount: 3,
            url: "opfs://chat/archives/session-1/bundle.zip",
            title: "Results",
          },
        },
        {
          id: "escaped",
          type: "workspace_archive",
          archive: {
            fileName: "secret.zip",
            bytes: 4,
            entryCount: 1,
            url: "opfs://knowledge-base/secret.zip",
          },
        },
        {
          id: "workspace-url",
          type: "workspace_archive",
          archive: {
            fileName: "sneaky.zip",
            bytes: 4,
            entryCount: 1,
            url: "opfs://chat/workspace/session-1/sneaky.zip",
          },
        },
      ],
    } as never);

    expect(normalized.outputBlocks).toEqual([
      {
        id: "bundle",
        type: "workspace_archive",
        archive: expect.objectContaining({
          fileName: "bundle.zip",
          entryCount: 3,
          url: "opfs://chat/archives/session-1/bundle.zip",
        }),
      },
    ]);
  });

  it("derives missing tool call status from legacy fields", () => {
    expect(
      normalizeToolCall({
        id: "a",
        name: "ok",
        args: {},
        result: { value: 1 },
      }).status,
    ).toBe("success");

    expect(
      normalizeToolCall({
        id: "b",
        name: "bad",
        args: {},
        isError: true,
      }).status,
    ).toBe("error");
  });

  it("preserves images attached to tool results", () => {
    expect(
      normalizeToolCall({
        id: "image",
        name: "generate_image",
        args: {},
        status: "success",
        result: { imageBase64: "[image omitted]", imageCount: 1 },
        resultImages: [
          {
            id: "image_1",
            mimeType: "image/png",
            data: "aW1hZ2U=",
            fileName: "plugin-image.png",
          },
        ],
      }),
    ).toMatchObject({
      resultImages: [
        {
          id: "image_1",
          mimeType: "image/png",
          data: "aW1hZ2U=",
          fileName: "plugin-image.png",
        },
      ],
    });
  });

  it("preserves permission metadata and closes interrupted confirmations", () => {
    expect(
      normalizeToolCall({
        id: "confirmed",
        name: "create_record",
        pluginId: "writer",
        pluginTitle: "Writer",
        functionFingerprint: "v1:abc",
        risk: "write",
        args: { title: "Draft" },
        status: "success",
        confirmation: {
          required: true,
          state: "approved",
          decision: "allow_once",
          decidedAt: 123,
        },
        errorInfo: { code: "OLD_ERROR", message: "old", recoverable: true },
      }),
    ).toMatchObject({
      pluginId: "writer",
      pluginTitle: "Writer",
      functionFingerprint: "v1:abc",
      risk: "write",
      confirmation: {
        required: true,
        state: "approved",
        decision: "allow_once",
        decidedAt: 123,
      },
      errorInfo: { code: "OLD_ERROR", message: "old", recoverable: true },
    });

    expect(
      normalizeToolCall({
        id: "interrupted",
        name: "delete_record",
        args: {},
        status: "awaiting_confirmation",
        confirmation: { required: true, state: "pending" },
      }),
    ).toMatchObject({
      status: "error",
      isError: true,
      confirmation: { state: "interrupted" },
      errorInfo: { code: "CONFIRMATION_INTERRUPTED" },
      result: { error: { code: "CONFIRMATION_INTERRUPTED" } },
    });
  });

  it("normalizes legacy Gemini message parts", () => {
    const message = normalizeLegacyGeminiMessage(
      {
        id: "legacy-message",
        role: "model",
        parts: [
          { text: "Hello" },
          {
            functionCall: {
              name: "lookup",
              args: { q: "neo" },
            },
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: "abc123",
            },
          },
        ],
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: "https://example.com", title: "Example" } },
          ],
          groundingSupports: [{ segment: { text: "Grounded text" } }],
        },
      },
      "GEMINI:gemini-1.5-pro",
      123,
    );

    expect(message).toMatchObject({
      id: "legacy-message",
      role: "model",
      model: "GEMINI:gemini-1.5-pro",
      timestamp: 123,
      content: expect.stringContaining("Hello"),
      attachments: [
        {
          fileName: "attachment-3",
          mimeType: "image/png",
          data: "abc123",
        },
      ],
      searchSources: [
        {
          title: "Example",
          url: "https://example.com",
          content: "Grounded text",
        },
      ],
    });
    expect(message?.content).toContain("Function call: lookup");
  });

  it("migrates legacy Gemini settings and conversations into current storage", async () => {
    const target = createAsyncStorage();
    const legacyDb = createAsyncStorage({
      chatStore: persisted({
        title: "Active chat",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ text: "Hi" }],
          },
          {
            id: "m2",
            role: "model",
            parts: [{ text: "Hello" }],
          },
        ],
        summary: { ids: ["m1"], content: "Previous summary" },
        systemInstruction: "Be concise",
      }),
      conversationStore: persisted({
        currentId: "active",
        pinned: ["saved"],
        conversationList: {
          saved: {
            title: "Saved chat",
            messages: [
              {
                id: "s1",
                role: "user",
                parts: [{ text: "Saved question" }],
              },
            ],
          },
        },
      }),
      modelStore: persisted({
        models: [
          {
            name: "models/gemini-1.5-pro",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
      assistantStore: persisted({
        assistants: [
          {
            identifier: "writer",
            meta: {
              avatar: "W",
              title: "Writer",
              description: "Writes clearly",
              tags: ["writing"],
            },
            config: { systemRole: "Write clearly." },
            createdAt: "2024-01-01",
            homepage: "",
            author: "user",
          },
        ],
      }),
    });
    const local = createLocalStorage({
      "twg-settings": JSON.stringify(
        persisted({
          apiKey: "legacy-key",
          apiProxy: "https://proxy.example.com",
          model: "models/gemini-1.5-pro",
          lang: "zh-CN",
          temperature: 1.2,
        }),
      ),
    });

    await ensureLegacyGeminiNextChatMigration({
      targetDb: target.storage,
      legacyDb: legacyDb.storage,
      localStorageRef: local.storage,
      storageKeys: {
        CORE_SETTINGS: "neo-chat-core-settings",
        SETTINGS: "neo-chat-settings",
        CHAT: "neo-chat-storage",
      },
    });

    const core = JSON.parse(local.items.get("neo-chat-core-settings") || "{}");
    expect(core.version).toBe(0);
    expect(core.state.language).toBe("zh");
    expect(core.state.providers[0]).toMatchObject({
      id: "GEMINI",
      type: "Google",
      apiKey: "legacy-key",
      baseUrl: "https://proxy.example.com",
    });
    expect(core.state.providers[0].models).toContain("gemini-1.5-pro");

    const chat = JSON.parse(target.items.get("neo-chat-storage") as string);
    expect(chat.version).toBe(0);
    expect(chat.state.selectedModel).toBe("GEMINI:gemini-1.5-pro");
    expect(chat.state.chatConfig.temperature).toBe(1.2);
    expect(chat.state.currentSessionId).toBe("active");
    expect(chat.state.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "active",
          title: "Active chat",
          systemInstruction: "Be concise",
          messageCount: 2,
        }),
        expect.objectContaining({
          id: "saved",
          title: "Saved chat",
          pinned: true,
          messageCount: 1,
        }),
      ]),
    );

    expect(target.items.get("session_messages_active")).toMatchObject([
      { id: "m1", role: "user", content: "Hi" },
      {
        id: "m2",
        role: "model",
        content: "Hello",
        model: "GEMINI:gemini-1.5-pro",
      },
    ]);

    const settings = JSON.parse(
      target.items.get("neo-chat-settings") as string,
    );
    expect(settings.state.customAgents).toEqual([
      expect.objectContaining({
        identifier: "writer",
        isCustom: true,
      }),
    ]);
    expect(target.items.get("legacy-gemini-next-chat-migration")).toMatchObject(
      {
        chatMigrated: true,
        settingsMigrated: true,
      },
    );
  });
});
