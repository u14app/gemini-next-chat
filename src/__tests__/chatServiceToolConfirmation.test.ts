import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_EXECUTION_LIMITS } from "../config/limits";
import type {
  MessageOutputBlock,
  ModelMetadata,
  Plugin,
  ToolCall,
  ToolConfirmationController,
  ToolConfirmationDecision,
} from "../types";
import { createKnowledgeCollectionAttachment } from "../lib/utils/knowledgeAttachments";

const mocks = vi.hoisted(() => ({
  executePluginFunction: vi.fn(),
  settingsState: {} as Record<string, unknown>,
  memoryState: {} as Record<string, unknown>,
  coreState: {} as Record<string, unknown>,
  searchCompatibility: { enabled: true, mode: "native" },
  supportsImageGeneration: vi.fn<(metadata?: ModelMetadata) => boolean>(
    () => false,
  ),
  supportsTextOutput: vi.fn<(metadata?: ModelMetadata) => boolean>(() => true),
  supportsToolCalls: vi.fn<(metadata?: ModelMetadata) => boolean>(() => true),
  retrieveKnowledgeSources: vi.fn(),
}));

vi.mock("@/utils/pluginUtils", () => ({
  executePluginFunction: mocks.executePluginFunction,
}));

vi.mock("@/store/core/settingsStore", () => ({
  getTaskModel: vi.fn(() => "openai:gpt-task"),
  useSettingsStore: {
    getState: () => mocks.settingsState,
  },
}));

vi.mock("@/store/core/coreSettingsStore", () => ({
  useCoreSettingsStore: {
    getState: () => mocks.coreState,
  },
}));

vi.mock("@/store/core/memoryStore", () => ({
  useMemoryStore: {
    getState: () => mocks.memoryState,
  },
}));

vi.mock("@/lib/byok/client", () => ({
  buildProviderRuntimeConfig: vi.fn(async (provider) => provider),
  fetchWithByokRetry: vi.fn((requestFactory) => requestFactory()),
}));

vi.mock("../lib/byok/client", () => ({
  buildProviderRuntimeConfig: vi.fn(async (provider) => provider),
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

vi.mock("@/lib/plugin/resolve", () => ({
  getEnabledPluginFunctions: vi.fn((plugin: Plugin) => plugin.functions || []),
  resolveEnabledPluginFunction: vi.fn(
    (plugins: Plugin[], functionName: string, allowedPluginIds?: string[]) => {
      const allowed = allowedPluginIds?.length
        ? new Set(allowedPluginIds)
        : null;
      let resolved: {
        plugin: Plugin;
        functionDef: Plugin["functions"][number];
      } | null = null;
      for (const plugin of plugins) {
        if (allowed && !allowed.has(plugin.id)) continue;
        const functionDef = plugin.functions.find(
          (candidate) => candidate.name === functionName,
        );
        if (!functionDef) continue;
        if (resolved) return null;
        resolved = { plugin, functionDef };
      }
      return resolved;
    },
  ),
}));

vi.mock("@/lib/utils/model", () => ({
  parseModelString: vi.fn((model: string) => {
    const [providerId, modelName] = model.split(":");
    return { providerId, modelName };
  }),
  resolveProviderModelMetadata: vi.fn(
    ({
      providerId,
      modelName,
      modelMetadata,
      customModelMetadata,
    }: {
      providerId?: string;
      modelName: string;
      modelMetadata?: Record<string, ModelMetadata>;
      customModelMetadata?: Record<string, ModelMetadata>;
    }) =>
      (providerId
        ? customModelMetadata?.[`${providerId}:${modelName}`]
        : undefined) ||
      customModelMetadata?.[modelName] ||
      modelMetadata?.[modelName],
  ),
  supportsImageGeneration: mocks.supportsImageGeneration,
  supportsTextOutput: mocks.supportsTextOutput,
  supportsToolCalls: mocks.supportsToolCalls,
}));

vi.mock("@/lib/settings/searchRag", () => ({
  getSearchCompatibility: vi.fn(() => mocks.searchCompatibility),
  resolveEffectiveSearchCapability: vi.fn(() => mocks.searchCompatibility),
  getSearchCompatibilityErrorMessage: vi.fn(() => "Search is unavailable"),
}));

vi.mock("@/lib/utils/chatInput", () => ({
  appendContextToChatInput: vi.fn(
    (message: string, context: string) => `${message}\n\n${context}`,
  ),
  clampChatInputText: vi.fn((message: string) => message),
}));

vi.mock("@/lib/chat/entities", () => ({
  normalizeSessionTitle: vi.fn((title?: string) => title || "New Chat"),
}));

vi.mock("@/lib/chat/htmlVisualPrompt", async () =>
  vi.importActual("../lib/chat/htmlVisualPrompt"),
);

vi.mock("@/lib/utils/contextCompression", () => ({
  buildCompressionSource: vi.fn(() => ({
    text: "",
    includedMemoryIds: [],
  })),
  createContextCompressionSummaryPrompt: vi.fn((text: string) => text),
  mergeCompressedContent: vi.fn((content: string) => content),
  normalizeCompressedContent: vi.fn((content: string) => content),
  textToBase64: vi.fn((text: string) => text),
}));

vi.mock("@/lib/utils/devLogger", () => ({
  logDevError: vi.fn(),
  logDevWarn: vi.fn(),
}));

vi.mock("../services/api/searchService", () => ({
  createSearchProvider: vi.fn(),
}));

vi.mock("@/lib/knowledge/retrieveKnowledgeSources", () => ({
  retrieveKnowledgeSources: mocks.retrieveKnowledgeSources,
}));

import { createSearchProvider } from "../services/api/searchService";

const encoder = new TextEncoder();

function createAllowOnceController(): ToolConfirmationController {
  return {
    requestConfirmation: vi.fn(
      async (): Promise<ToolConfirmationDecision> => "allow_once",
    ),
  };
}

function sseResponse(events: unknown[]) {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

function rawSseResponse(body: string) {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

function pendingToolEvents(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    type: "tool_call",
    toolCall: {
      id: `${prefix}_${index}`,
      name: "create_record",
      args: { index },
      status: "pending",
    },
  }));
}

function abortableSseResponse(
  signal: AbortSignal,
  events: unknown[],
): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        signal.addEventListener(
          "abort",
          () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

const writePlugin: Plugin = {
  id: "writer",
  title: "Writer",
  description: "Writes data",
  logoUrl: "",
  manifestUrl: "",
  baseUrl: "https://example.com",
  functions: [
    {
      name: "create_record",
      description: "Create a record",
      method: "POST",
      path: "/records",
      parameters: { type: "object", properties: {} },
    },
  ],
};

const memoryNamedPlugin: Plugin = {
  id: "memory-plugin",
  title: "Memory Plugin",
  description: "Provides a plugin-owned memory search function",
  logoUrl: "",
  manifestUrl: "",
  baseUrl: "https://example.com",
  functions: [
    {
      name: "memory_search",
      description: "Search plugin memory",
      method: "GET",
      path: "/memory",
      parameters: { type: "object", properties: {} },
    },
  ],
};

const destructivePlugin: Plugin = {
  ...writePlugin,
  functions: [
    {
      ...writePlugin.functions[0],
      name: "delete_record",
      description: "Delete a record",
      method: "DELETE",
      path: "/records/{id}",
    },
  ],
};

const externalMcpPlugin: Plugin = {
  ...writePlugin,
  id: "mcp-tools",
  title: "MCP Tools",
  source: "mcp",
  functions: [
    {
      name: "query_remote_tool",
      description: "Query an MCP tool",
      mcpToolName: "query_remote_tool",
      risk: "external",
      parameters: { type: "object", properties: {} },
    },
  ],
  mcp: {
    transport: "streamable-http",
    serverUrl: "https://mcp.example.com/mcp",
    serverName: "example",
  },
};

const imagePlugin: Plugin = {
  id: "openai-image-generation",
  title: "OpenAI-compatible Image Processing",
  description: "Process images",
  logoUrl: "",
  manifestUrl: "",
  baseUrl: "https://api.openai.com/v1",
  functions: [
    {
      name: "generate_image_with_images_api",
      description: "Generate or edit images",
      method: "POST",
      path: "/images/generations",
      parameters: { type: "object", properties: {} },
    },
  ],
};

describe("chat service tool execution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.executePluginFunction.mockReset();
    mocks.settingsState = {
      system: { enableDestructiveToolConfirmation: false },
      search: { provider: "google", configs: {} },
      installedPlugins: [writePlugin],
      pluginConfigs: {},
    };
    mocks.memoryState = {
      settings: {
        enabled: false,
        searchEnabled: false,
        autoRecordEnabled: false,
        dreamEnabled: false,
        triggerCount: 100,
        targetCount: 50,
      },
      memories: [],
      markMemoriesUsed: vi.fn(),
    };
    mocks.coreState = {
      providers: [
        {
          id: "openai",
          enabled: true,
          type: "OpenAI",
          name: "OpenAI",
          apiKey: "test-key",
        },
      ],
    };
    mocks.supportsImageGeneration.mockReset();
    mocks.supportsImageGeneration.mockReturnValue(false);
    mocks.supportsTextOutput.mockReset();
    mocks.supportsTextOutput.mockReturnValue(true);
    mocks.supportsToolCalls.mockReset();
    mocks.supportsToolCalls.mockReturnValue(true);
    mocks.retrieveKnowledgeSources.mockReset();
    mocks.searchCompatibility = { enabled: true, mode: "native" };
    vi.mocked(createSearchProvider).mockReset();
  });

  it("does not expose memory_search for ordinary prompts", async () => {
    mocks.memoryState = {
      settings: {
        enabled: true,
        searchEnabled: true,
        autoRecordEnabled: false,
        dreamEnabled: false,
        triggerCount: 100,
        targetCount: 50,
      },
      memories: [
        {
          id: "mem_1",
          type: "project",
          content: "Keep Mineru as the default document parser.",
          createdAt: 100,
          updatedAt: 100,
          lastUsedAt: 0,
          importance: 5,
          tags: ["mineru", "documents"],
          source: "manual",
        },
      ],
      markMemoriesUsed: vi.fn(),
    };

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools.map((tool: any) => tool.function.name)).not.toContain(
          "memory_search",
        );
        return sseResponse([
          { type: "content", content: "Use the configured parser." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Which parser should I use?",
      [],
      {},
      () => undefined,
    );

    expect(result).toBe("Use the configured parser.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a plugin-owned memory_search available when no built-in binding was collected", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [memoryNamedPlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ source: "plugin" });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools.map((tool: any) => tool.function.name)).toContain(
          "memory_search",
        );
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_plugin_memory",
              name: "memory_search",
              args: { query: "document parser" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Plugin memory searched." },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Search the plugin memory",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["memory-plugin"],
    );

    expect(result).toBe("Plugin memory searched.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).toHaveBeenCalledWith(
      "memory_search",
      { query: "document parser" },
      undefined,
      ["memory-plugin"],
      undefined,
      expect.objectContaining({
        pluginId: "memory-plugin",
        risk: "read",
      }),
    );
  });

  it("rejects plugin functions omitted from the request tool snapshot", async () => {
    const widePlugin: Plugin = {
      id: "wide-plugin",
      title: "Wide Plugin",
      description: "Exposes more functions than one request may offer",
      logoUrl: "",
      manifestUrl: "",
      baseUrl: "https://example.com",
      functions: Array.from({ length: 65 }, (_, index) => ({
        name: `wide_tool_${index}`,
        description: `Wide tool ${index}`,
        method: "GET",
        path: `/tools/${index}`,
        parameters: { type: "object", properties: {} },
      })),
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [widePlugin],
    };
    const toolUpdates: ToolCall[][] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const offeredNames = body.tools.map((tool: any) => tool.function.name);
        expect(offeredNames).toHaveLength(64);
        expect(offeredNames).not.toContain("wide_tool_64");
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_omitted",
              name: "wide_tool_64",
              args: {},
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "The unavailable tool was rejected." },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Call the omitted tool.",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => toolUpdates.push(toolCalls),
      undefined,
      undefined,
      undefined,
      ["wide-plugin"],
    );

    expect(result).toBe("The unavailable tool was rejected.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
    expect(toolUpdates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_omitted",
          status: "error",
          errorInfo: expect.objectContaining({
            code: "TOOL_FUNCTION_NOT_FOUND",
          }),
        }),
      ]),
    );
  });

  it("executes explicit memory_search as an internal tool before plugin tools", async () => {
    const markMemoriesUsed = vi.fn();
    mocks.memoryState = {
      settings: {
        enabled: true,
        searchEnabled: true,
        autoRecordEnabled: false,
        dreamEnabled: false,
        triggerCount: 100,
        targetCount: 50,
      },
      memories: [
        {
          id: "mem_1",
          type: "project",
          content: "Keep Mineru as the default document parser.",
          createdAt: 100,
          updatedAt: 100,
          lastUsedAt: 0,
          importance: 5,
          tags: ["mineru", "documents"],
          source: "manual",
        },
      ],
      markMemoriesUsed,
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [memoryNamedPlugin],
    };

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools.map((tool: any) => tool.function.name)).toContain(
          "memory_search",
        );
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_memory",
              name: "memory_search",
              args: { query: "document parser" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Mineru stays the default." },
          { type: "done" },
        ]),
      );

    const updates: ToolCall[][] = [];

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "What do you remember about my document parser decision?",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => updates.push(toolCalls),
      undefined,
      undefined,
      undefined,
      ["memory-plugin"],
    );

    expect(result).toBe("Mineru stays the default.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
    expect(markMemoriesUsed).toHaveBeenCalledWith(["mem_1"]);
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_memory",
          status: "success",
          result: expect.objectContaining({
            memories: [
              expect.objectContaining({
                id: "mem_1",
                content: "Keep Mineru as the default document parser.",
              }),
            ],
          }),
        }),
      ]),
    );
  });

  it("auto-executes write tools when destructive confirmation is enabled", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ id: "record-1" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_write",
              name: "create_record",
              args: { title: "Draft" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Created record-1." },
          { type: "done" },
        ]),
      );
    const updates: ToolCall[][] = [];
    const confirmationController = createAllowOnceController();

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Create a record",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => updates.push(toolCalls),
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      confirmationController,
    );

    expect(result).toBe("Created record-1.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).toHaveBeenCalledWith(
      "create_record",
      { title: "Draft" },
      undefined,
      ["writer"],
      undefined,
      expect.objectContaining({
        pluginId: "writer",
        risk: "write",
        functionFingerprint: expect.any(String),
      }),
    );
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_write",
          status: "success",
          result: { id: "record-1" },
          confirmation: expect.objectContaining({
            required: false,
            decision: "automatic",
          }),
        }),
      ]),
    );
    expect(updates.flat()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "awaiting_confirmation" }),
      ]),
    );
    expect(confirmationController.requestConfirmation).not.toHaveBeenCalled();
  });

  it("auto-executes destructive tools when confirmation is disabled", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [destructivePlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ deleted: true });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_delete",
              name: "delete_record",
              args: { id: "record-1" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Deleted." },
          { type: "done" },
        ]),
      );
    const updates: ToolCall[][] = [];
    const confirmationController = createAllowOnceController();

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Delete a record",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => updates.push(toolCalls),
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      confirmationController,
    );

    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
    expect(confirmationController.requestConfirmation).not.toHaveBeenCalled();
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_delete",
          risk: "destructive",
          status: "success",
          confirmation: expect.objectContaining({
            required: false,
            decision: "automatic",
          }),
        }),
      ]),
    );
  });

  it("auto-executes a read-only plugin tool without confirmation", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [
        {
          ...writePlugin,
          functions: [
            {
              ...writePlugin.functions[0],
              name: "get_record",
              method: "GET",
              path: "/records/{id}",
            },
          ],
        },
      ],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ id: "record-1" });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_read",
              name: "get_record",
              args: { id: "record-1" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "Found." }, { type: "done" }]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Read a record",
        [],
        {},
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["writer"],
      ),
    ).resolves.toBe("Found.");

    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
  });

  it("auto-executes external MCP tools when destructive confirmation is enabled", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
      installedPlugins: [externalMcpPlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ result: "remote" });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_external",
              name: "query_remote_tool",
              args: { query: "status" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Remote result." },
          { type: "done" },
        ]),
      );
    const confirmationController = createAllowOnceController();

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Query the MCP tool",
        [],
        {},
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["mcp-tools"],
        undefined,
        undefined,
        confirmationController,
      ),
    ).resolves.toBe("Remote result.");

    expect(confirmationController.requestConfirmation).not.toHaveBeenCalled();
    expect(mocks.executePluginFunction).toHaveBeenCalledWith(
      "query_remote_tool",
      { query: "status" },
      undefined,
      ["mcp-tools"],
      undefined,
      expect.objectContaining({
        pluginId: "mcp-tools",
        risk: "external",
        functionFingerprint: expect.any(String),
      }),
    );
  });

  it("fails closed and feeds an unavailable-confirmation result back without a controller", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
      installedPlugins: [destructivePlugin],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_delete",
              name: "delete_record",
              args: { id: "record-1" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.history[1].toolCalls[0]).toMatchObject({
          status: "error",
          confirmation: { state: "error" },
          result: {
            error: {
              code: "TOOL_CONFIRMATION_UNAVAILABLE",
            },
          },
        });
        return sseResponse([
          { type: "content", content: "I did not create the record." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Delete a record",
        [],
        {},
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["writer"],
      ),
    ).resolves.toBe("I did not create the record.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
  });

  it("interrupts a pending confirmation without executing the tool", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
      installedPlugins: [destructivePlugin],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        {
          type: "tool_call",
          toolCall: {
            id: "call_delete",
            name: "delete_record",
            args: { id: "record-1" },
            status: "pending",
          },
        },
        { type: "done" },
      ]),
    );
    const updates: ToolCall[][] = [];
    const abortController = new AbortController();
    const confirmationController: ToolConfirmationController = {
      requestConfirmation: vi.fn(
        () => new Promise<ToolConfirmationDecision>(() => undefined),
      ),
    };

    const { streamChatResponse } = await import("../services/api/chatService");
    const response = streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Delete a record",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => updates.push(toolCalls),
      undefined,
      undefined,
      abortController.signal,
      ["writer"],
      undefined,
      undefined,
      confirmationController,
    );

    await vi.waitFor(() =>
      expect(updates.flat()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "awaiting_confirmation" }),
        ]),
      ),
    );
    abortController.abort();

    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "error",
          confirmation: expect.objectContaining({ state: "interrupted" }),
          errorInfo: expect.objectContaining({
            code: "CONFIRMATION_INTERRUPTED",
          }),
        }),
      ]),
    );
  });

  it("downgrades a destructive session decision to a one-time approval", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
      installedPlugins: [destructivePlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ deleted: true });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_delete",
              name: "delete_record",
              args: { id: "record-1" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Deleted." },
          { type: "done" },
        ]),
      );
    const updates: ToolCall[][] = [];
    const grantSessionApproval = vi.fn();
    const confirmationController: ToolConfirmationController = {
      requestConfirmation: vi.fn(
        async (): Promise<ToolConfirmationDecision> => "allow_session",
      ),
      grantSessionApproval,
    };

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Delete a record",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => updates.push(toolCalls),
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      confirmationController,
    );

    expect(grantSessionApproval).not.toHaveBeenCalled();
    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_delete",
          risk: "destructive",
          status: "success",
          confirmation: expect.objectContaining({
            decision: "allow_once",
          }),
        }),
      ]),
    );
  });

  it("feeds a denied destructive call back without executing it", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
      installedPlugins: [destructivePlugin],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_delete",
              name: "delete_record",
              args: { id: "record-1" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.history[1].toolCalls[0]).toMatchObject({
          status: "denied",
          confirmation: { state: "denied", decision: "deny" },
          result: { error: { code: "TOOL_CALL_DENIED" } },
        });
        return sseResponse([
          { type: "content", content: "I did not delete the record." },
          { type: "done" },
        ]);
      });
    const confirmationController: ToolConfirmationController = {
      requestConfirmation: vi.fn(
        async (): Promise<ToolConfirmationDecision> => "deny",
      ),
    };

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Delete a record",
        [],
        {},
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["writer"],
        undefined,
        undefined,
        confirmationController,
      ),
    ).resolves.toBe("I did not delete the record.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
  });

  it("snapshots destructive confirmation at generation start", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      system: { enableDestructiveToolConfirmation: true },
      installedPlugins: [destructivePlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({ deleted: true });
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        mocks.settingsState = {
          ...mocks.settingsState,
          system: { enableDestructiveToolConfirmation: false },
        };
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_delete",
              name: "delete_record",
              args: { id: "record-1" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Deleted." },
          { type: "done" },
        ]),
      );
    const confirmationController = createAllowOnceController();

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Delete a record",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      confirmationController,
    );

    expect(confirmationController.requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "call_delete",
        risk: "destructive",
      }),
      undefined,
    );
    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
  });

  it("limits tool execution concurrency to four", async () => {
    let activeExecutions = 0;
    let maxActiveExecutions = 0;
    mocks.executePluginFunction.mockImplementation(async () => {
      activeExecutions += 1;
      maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      activeExecutions -= 1;
      return { ok: true };
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([...pendingToolEvents(8, "first"), { type: "done" }]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "Done" }, { type: "done" }]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Run tools",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      createAllowOnceController(),
    );

    expect(maxActiveExecutions).toBeLessThanOrEqual(
      PLUGIN_EXECUTION_LIMITS.maxToolConcurrency,
    );
    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(8);
  });

  it("skips tool calls beyond the per-generation total budget", async () => {
    mocks.executePluginFunction.mockResolvedValue({ ok: true });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([...pendingToolEvents(60, "first"), { type: "done" }]),
      )
      .mockResolvedValueOnce(
        sseResponse([...pendingToolEvents(60, "second"), { type: "done" }]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "Done" }, { type: "done" }]),
      );
    const updates: ToolCall[][] = [];

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Run many tools",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => updates.push(toolCalls),
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      createAllowOnceController(),
    );

    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(
      PLUGIN_EXECUTION_LIMITS.maxTotalToolCalls,
    );
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          result: expect.stringMatching(/total tool-call budget/i),
        }),
      ]),
    );
  });

  it("routes image plugin results to model attachments and visible output blocks", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [imagePlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({
      imageBase64: "aW1hZ2U=",
      imageUrl: null,
      imageCount: 1,
      revisedPrompt: null,
      raw: {
        data: [{ b64_json: "aW1hZ2U=" }],
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_image",
              name: "generate_image_with_images_api",
              args: { prompt: "Edit this image" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Edited." },
          { type: "done" },
        ]),
      );
    const outputSnapshots: MessageOutputBlock[][] = [];

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Edit this image",
      [],
      {},
      (_content, _reasoning, outputBlocks) => {
        if (outputBlocks) outputSnapshots.push(outputBlocks);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["openai-image-generation"],
      undefined,
      (outputBlocks) => outputSnapshots.push(outputBlocks),
      createAllowOnceController(),
    );

    expect(result).toBe("Edited.");
    expect(
      outputSnapshots.some((blocks) =>
        blocks.some(
          (block) =>
            block.type === "tool_group" &&
            block.toolCalls.some(
              (toolCall) =>
                toolCall.id === "call_image" && toolCall.status === "success",
            ),
        ),
      ),
    ).toBe(true);
    const imageToolCall = outputSnapshots
      .flat()
      .flatMap((block) => (block.type === "tool_group" ? block.toolCalls : []))
      .find(
        (toolCall) =>
          toolCall.id === "call_image" && toolCall.resultImages?.length,
      );
    expect(imageToolCall).toMatchObject({
      resultImages: [
        expect.objectContaining({
          mimeType: "image/png",
          data: "aW1hZ2U=",
          fileName: "plugin-image.png",
        }),
      ],
    });
    expect(outputSnapshots.flat().some((block) => block.type === "image")).toBe(
      false,
    );
    const followUpRequestBody = (fetchMock.mock.calls[1]?.[1] as RequestInit)
      .body;
    expect(followUpRequestBody).toBeInstanceOf(FormData);
    const followUpForm = followUpRequestBody as FormData;
    const followUpBody = JSON.parse(String(followUpForm.get("payload")));
    expect(followUpBody.attachments).toEqual([
      expect.objectContaining({
        mimeType: "image/png",
        fileName: "plugin-image.png",
        uploadId: "image-0",
      }),
    ]);
    expect(followUpBody.attachments[0]).not.toHaveProperty("data");
    expect(followUpForm.get("image:image-0")).toBeInstanceOf(File);
    expect(followUpBody.newMessage).toContain("attached image outputs");
    const toolResult = followUpBody.history?.[1]?.toolCalls?.[0]
      ?.result as Record<string, unknown>;
    expect(toolResult).toEqual({
      imageUrl: null,
      imageBase64: "[image omitted]",
      imageCount: 1,
      revisedPrompt: null,
    });
    expect(JSON.stringify(followUpBody.history)).not.toContain("aW1hZ2U=");
    expect(toolResult).not.toHaveProperty("raw");
  });

  it("emits one error output transition when tool execution fails", async () => {
    mocks.executePluginFunction.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_write",
              name: "create_record",
              args: { title: "Draft" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "The tool failed." },
          { type: "done" },
        ]),
      );
    const outputSnapshots: MessageOutputBlock[][] = [];

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Create a record",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      (blocks) => outputSnapshots.push(blocks),
      createAllowOnceController(),
    );

    const statuses = outputSnapshots
      .map(
        (blocks) =>
          blocks
            .find((block) => block.type === "tool_group")
            ?.toolCalls.find((toolCall) => toolCall.id === "call_write")
            ?.status,
      )
      .filter(Boolean);

    expect(result).toBe("The tool failed.");
    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["pending", "running", "error"]);
  });

  it("keeps streamed generated images in output blocks without duplicating them as attachments", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      sseResponse([
        {
          type: "image",
          image: {
            id: "img_generated",
            mimeType: "image/png",
            data: "aW1hZ2U=",
            fileName: "generated.png",
          },
        },
        { type: "done" },
      ]),
    );
    const chunks: MessageOutputBlock[][] = [];
    const onImage = vi.fn();

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Create an image",
      [],
      {},
      (_content, _reasoning, outputBlocks) => {
        if (outputBlocks) chunks.push(outputBlocks);
      },
      undefined,
      undefined,
      undefined,
      onImage,
    );

    expect(onImage).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toEqual([
      expect.objectContaining({
        type: "image",
        image: expect.objectContaining({
          id: "img_generated",
          data: "aW1hZ2U=",
        }),
      }),
    ]);
  });

  it("adds API-only HTML visual request instructions when system prompt enables them", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        sseResponse([
          { type: "content", content: "Rendered." },
          { type: "done" },
        ]),
      );
    const { buildHtmlVisualPromptInstruction } =
      await import("../lib/chat/htmlVisualPrompt");
    const { buildDiagramPromptInstruction } =
      await import("../lib/chat/diagramPrompt");
    const { streamChatResponse } = await import("../services/api/chatService");

    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Compare these options.",
      [],
      {},
      () => undefined,
      `${buildDiagramPromptInstruction({ enhanced: true })}\n\n${buildHtmlVisualPromptInstruction()}`,
    );

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body.newMessage).toContain("Compare these options.");
    expect(body.newMessage).toContain("<format_instructions");
    expect(body.newMessage).toContain("raw HTML fragments directly");
    expect(body.newMessage).toContain(
      "Never place HTML visual fragments inside code fences",
    );
    expect(body.newMessage).toContain(
      "Use light or pale backgrounds with dark, readable foreground text",
    );
    expect(body.newMessage).toContain(
      "Aim for at least a 4.5:1 foreground/background contrast ratio",
    );
    expect(body.newMessage).toContain('data-diagram-rendering="true"');
    expect(body.newMessage).toContain("Mermaid");
    expect(body.newMessage).toContain("mindmap");
    expect(body.systemInstruction).toContain("<html-visual>");
    expect(body.systemInstruction).toContain("<diagram-rendering>");
    expect(body.systemInstruction).toContain("<diagram-visual-polish>");
  });

  it("injects resolved skills context into the final model request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        sseResponse([
          { type: "content", content: "Translated." },
          { type: "done" },
        ]),
      );
    const { streamChatResponse } = await import("../services/api/chatService");

    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "请翻译成英文",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "[Skills]\nUse Translation & Localization.",
    );

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body.newMessage).toContain("请翻译成英文");
    expect(body.newMessage).toContain("[Skills]");
    expect(body.newMessage).toContain("Translation & Localization");
    expect(body.systemInstruction).toBeUndefined();
  });

  it("routes OpenAI Compatible image-only models through the direct image endpoint", async () => {
    mocks.coreState = {
      providers: [
        {
          id: "krill",
          enabled: true,
          type: "OpenAI Compatible",
          name: "Krill",
          baseUrl: "https://api.krill-ai.com/v1",
          apiKey: "test-key",
          models: ["gpt-image-2"],
        },
      ],
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      modelMetadata: {
        "gpt-image-2": {
          id: "gpt-image-2",
          modalities: { input: ["text", "image"], output: ["image"] },
        },
      },
    };
    mocks.supportsImageGeneration.mockImplementation(
      (metadata) =>
        Array.isArray(metadata?.modalities?.output) &&
        metadata.modalities.output.includes("image"),
    );
    mocks.supportsTextOutput.mockImplementation(
      (metadata) =>
        !Array.isArray(metadata?.modalities?.output) ||
        metadata.modalities.output.includes("text"),
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        images: [{ id: "img_1", mimeType: "image/png", data: "aW1hZ2U=" }],
        message: "Generated image",
      }),
    );
    const outputSnapshots: MessageOutputBlock[][] = [];
    const { streamChatResponse } = await import("../services/api/chatService");

    await streamChatResponse(
      "session-1",
      "krill:gpt-image-2",
      [],
      "Draw a quiet dashboard.",
      [],
      {},
      (_content, _reasoning, outputBlocks) => {
        if (outputBlocks) outputSnapshots.push(outputBlocks);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (outputBlocks) => outputSnapshots.push(outputBlocks),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat/generate-image");
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body.provider).toMatchObject({
      type: "OpenAI Compatible",
      baseUrl: "https://api.krill-ai.com/v1",
    });
    expect(body.modelName).toBe("gpt-image-2");
    expect(body.prompt).toContain("Draw a quiet dashboard.");
    expect(outputSnapshots[0]).toEqual([
      expect.objectContaining({
        type: "image_generation_status",
        status: "generating",
      }),
    ]);
    expect(outputSnapshots.at(-1)).toEqual([
      expect.objectContaining({
        type: "image",
        image: expect.objectContaining({ id: "img_1" }),
      }),
    ]);
  });

  it("removes the direct image loading block when image generation fails", async () => {
    mocks.coreState = {
      providers: [
        {
          id: "krill",
          enabled: true,
          type: "OpenAI Compatible",
          name: "Krill",
          baseUrl: "https://api.krill-ai.com/v1",
          apiKey: "test-key",
          models: ["gpt-image-2"],
        },
      ],
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      modelMetadata: {
        "gpt-image-2": {
          id: "gpt-image-2",
          modalities: { input: ["text", "image"], output: ["image"] },
        },
      },
    };
    mocks.supportsImageGeneration.mockImplementation(
      (metadata) =>
        Array.isArray(metadata?.modalities?.output) &&
        metadata.modalities.output.includes("image"),
    );
    mocks.supportsTextOutput.mockImplementation(
      (metadata) =>
        !Array.isArray(metadata?.modalities?.output) ||
        metadata.modalities.output.includes("text"),
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ error: "provider failed" }, { status: 502 }),
    );
    const outputSnapshots: MessageOutputBlock[][] = [];
    const { streamChatResponse } = await import("../services/api/chatService");

    await expect(
      streamChatResponse(
        "session-1",
        "krill:gpt-image-2",
        [],
        "Draw a quiet dashboard.",
        [],
        {},
        (_content, _reasoning, outputBlocks) => {
          if (outputBlocks) outputSnapshots.push(outputBlocks);
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (outputBlocks) => outputSnapshots.push(outputBlocks),
      ),
    ).rejects.toThrow("provider failed");

    expect(outputSnapshots[0]).toEqual([
      expect.objectContaining({
        type: "image_generation_status",
        status: "generating",
      }),
    ]);
    expect(outputSnapshots.at(-1)).toEqual([]);
  });

  it("uses a text fallback model for external search decisions when the selected model is image-only", async () => {
    mocks.coreState = {
      defaultModels: { promptOptimization: "openai:gpt-4o-mini" },
      providers: [
        {
          id: "krill",
          enabled: true,
          type: "OpenAI Compatible",
          name: "Krill",
          apiKey: "test-key",
          models: ["gpt-image-2"],
        },
        {
          id: "openai",
          enabled: true,
          type: "OpenAI",
          name: "OpenAI",
          apiKey: "test-key",
          models: ["gpt-4o-mini"],
        },
      ],
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: { provider: "tavily", configs: { tavily: { apiKey: "search" } } },
      modelMetadata: {
        "gpt-image-2": {
          id: "gpt-image-2",
          modalities: { input: ["text"], output: ["image"] },
        },
        "gpt-4o-mini": {
          id: "gpt-4o-mini",
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    };
    mocks.supportsImageGeneration.mockImplementation(
      (metadata) =>
        Array.isArray(metadata?.modalities?.output) &&
        metadata.modalities.output.includes("image"),
    );
    mocks.supportsTextOutput.mockImplementation(
      (metadata) =>
        !Array.isArray(metadata?.modalities?.output) ||
        metadata.modalities.output.includes("text"),
    );

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.modelName).toBe("gpt-task");
        return sseResponse([
          { type: "content", content: '{"shouldSearch":false}' },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async () =>
        Response.json({
          images: [{ id: "img_1", mimeType: "image/png", data: "aW1hZ2U=" }],
          message: "Generated image",
        }),
      );
    const { streamChatResponse } = await import("../services/api/chatService");

    await streamChatResponse(
      "session-1",
      "krill:gpt-image-2",
      [],
      "Draw current market mood.",
      [],
      { useSearch: true },
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat/generate");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/chat/generate-image");
  });

  it("stops generation when an explicit external search provider fails", async () => {
    mocks.searchCompatibility = { enabled: true, mode: "external" };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: { provider: "tavily", configs: { tavily: { apiKey: "search" } } },
    };
    vi.mocked(createSearchProvider).mockRejectedValue(new Error("search down"));
    const outputSnapshots: MessageOutputBlock[][] = [];
    const searchStatuses: Array<{ isSearching: boolean; hasResults: boolean }> =
      [];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "content",
            content: '{"shouldSearch":true,"query":"latest docs"}',
          },
          { type: "done" },
        ]),
      )
      .mockImplementation(async () =>
        sseResponse([
          { type: "content", content: "ordinary answer" },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");

    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Find current docs.",
        [],
        { useSearch: true },
        () => undefined,
        undefined,
        (isSearching, results) => {
          searchStatuses.push({
            isSearching,
            hasResults: Boolean(
              results?.sources.length || results?.images.length,
            ),
          });
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (outputBlocks) => outputSnapshots.push(outputBlocks),
      ),
    ).rejects.toThrow(/Search provider failed/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outputSnapshots.at(-1)).toEqual([
      expect.objectContaining({
        type: "search",
        isSearching: false,
        error: "Search provider failed",
      }),
    ]);
    expect(searchStatuses.at(-1)).toEqual({
      isSearching: false,
      hasResults: false,
    });
  });

  it("defers external search and disables native search flags in effective Agent mode", async () => {
    mocks.searchCompatibility = { enabled: true, mode: "external" };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: {
        provider: "tavily",
        configs: { tavily: { apiKey: "search" } },
      },
    };
    const searchStatuses: boolean[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.config.useAgentMode).toBe(true);
        expect(body.enableGoogleSearch).toBe(false);
        expect(body.enableOpenAIWebSearch).toBe(false);
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "start_long_text_output",
          "update_task_plan",
          "web_search",
          "run_javascript",
        ]);
        expect(body.systemInstruction).toContain("<agent-mode>");
        expect(body.systemInstruction).toContain("update_task_plan");
        return sseResponse([
          { type: "content", content: "Agent response" },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Find current docs.",
      [],
      { useSearch: true, useAgentMode: true },
      () => undefined,
      undefined,
      (isSearching) => searchStatuses.push(isSearching),
    );

    expect(result).toBe("Agent response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createSearchProvider).not.toHaveBeenCalled();
    expect(searchStatuses).toEqual([]);
  });

  it("clamps Agent mode when the selected model cannot call tools", async () => {
    mocks.supportsToolCalls.mockReturnValue(false);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.config.useAgentMode).toBe(false);
        expect(body.tools).toEqual([]);
        return sseResponse([
          { type: "content", content: "Ordinary response" },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Hello",
      [],
      { useAgentMode: true },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["writer"],
    );

    expect(result).toBe("Ordinary response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("auto-executes Agent task-plan updates through the shared tool loop", async () => {
    const outputSnapshots: MessageOutputBlock[][] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_plan",
              name: "update_task_plan",
              args: {
                steps: [
                  { title: "Inspect", status: "completed" },
                  { title: "Implement", status: "in_progress" },
                ],
              },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Working through the plan." },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Handle this multi-step task.",
      [],
      { useAgentMode: true },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (blocks) => outputSnapshots.push(blocks),
    );

    expect(result).toBe("Working through the plan.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outputSnapshots.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task_plan",
          steps: [
            { title: "Inspect", status: "completed" },
            { title: "Implement", status: "in_progress" },
          ],
        }),
        expect.objectContaining({
          type: "tool_group",
          toolCalls: [
            expect.objectContaining({
              name: "update_task_plan",
              status: "success",
              risk: "read",
            }),
          ],
        }),
      ]),
    );
  });

  it("captures the next model round as one long text block", async () => {
    const chunks: Array<{
      text: string;
      blocks?: MessageOutputBlock[];
    }> = [];
    const outputSnapshots: MessageOutputBlock[][] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools.map((tool: any) => tool.function.name)).toContain(
          "start_long_text_output",
        );
        return sseResponse([
          { type: "content", content: "I will prepare the report." },
          {
            type: "tool_call",
            toolCall: {
              id: "call-long-text",
              name: "start_long_text_output",
              args: { title: "Architecture report", format: "markdown" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools).toEqual([]);
        expect(body.newMessage).toContain("Output only the document body");
        return sseResponse([
          { type: "reasoning", content: "Outline first." },
          { type: "content", content: "# Architecture report\n\n" },
          { type: "content", content: "Complete document body." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Write a detailed architecture report.",
      [],
      {},
      (text, _reasoning, blocks) => chunks.push({ text, blocks }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (blocks) => outputSnapshots.push(blocks),
    );

    expect(result).toBe(
      "I will prepare the report.\n\n# Architecture report\n\nComplete document body.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const finalBlocks = chunks.at(-1)?.blocks || outputSnapshots.at(-1);
    expect(finalBlocks?.map((block) => block.type)).toEqual([
      "text",
      "tool_group",
      "reasoning",
      "text",
    ]);
    expect(finalBlocks?.at(-1)).toMatchObject({
      type: "text",
      content: "# Architecture report\n\nComplete document body.",
      presentation: {
        kind: "long_text",
        title: "Architecture report",
        format: "markdown",
        document: {
          fileName: "Architecture report.md",
          mimeType: "text/markdown",
        },
      },
    });
  });

  it("turns an empty long text follow-up into a recoverable tool failure", async () => {
    const outputSnapshots: MessageOutputBlock[][] = [];
    const toolSnapshots: ToolCall[][] = [];
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call-empty-long-text",
              name: "start_long_text_output",
              args: { title: "Empty report" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "\n  " }, { type: "done" }]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Write a report.",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      (toolCalls) => toolSnapshots.push(toolCalls),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (blocks) => outputSnapshots.push(blocks),
    );

    expect(result).toBe("\n  ");
    expect(
      outputSnapshots
        .at(-1)
        ?.some(
          (block) =>
            block.type === "text" && block.presentation?.kind === "long_text",
        ),
    ).toBe(false);
    expect(toolSnapshots.at(-1)?.[0]).toMatchObject({
      status: "error",
      isError: true,
      errorInfo: {
        code: "LONG_TEXT_OUTPUT_EMPTY_BODY",
        recoverable: true,
      },
    });
  });

  it("interrupts capture when the document body attempts another tool call", async () => {
    const outputSnapshots: MessageOutputBlock[][] = [];
    const toolSnapshots: ToolCall[][] = [];
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call-nested-long-text",
              name: "start_long_text_output",
              args: { title: "Partial report" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "# Partial report\n\nPreserved." },
          {
            type: "tool_call",
            toolCall: {
              id: "unexpected-tool",
              name: "start_long_text_output",
              args: { title: "Unexpected" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Write a report.",
        [],
        {},
        (_text, _reasoning, blocks) => {
          if (blocks) outputSnapshots.push(blocks);
        },
        undefined,
        undefined,
        (toolCalls) => toolSnapshots.push(toolCalls),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (blocks) => outputSnapshots.push(blocks),
      ),
    ).rejects.toMatchObject({
      code: "LONG_TEXT_OUTPUT_NESTED_TOOL_CALL",
    });

    expect(
      outputSnapshots
        .at(-1)
        ?.find(
          (block) =>
            block.type === "text" && block.presentation?.kind === "long_text",
        ),
    ).toMatchObject({ content: "# Partial report\n\nPreserved." });
    expect(toolSnapshots.at(-1)?.[0]).toMatchObject({
      status: "error",
      isError: true,
      errorInfo: {
        code: "LONG_TEXT_OUTPUT_NESTED_TOOL_CALL",
        recoverable: true,
      },
    });
  });

  it("falls back to ordinary text when the model cannot call tools", async () => {
    mocks.supportsToolCalls.mockReturnValue(false);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual([]);
      return sseResponse([
        { type: "content", content: "A long but ordinary response." },
        { type: "done" },
      ]);
    });

    const outputSnapshots: MessageOutputBlock[][] = [];
    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Write at length.",
      [],
      {},
      (_text, _reasoning, blocks) => {
        if (blocks) outputSnapshots.push(blocks);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (blocks) => outputSnapshots.push(blocks),
    );

    expect(result).toBe("A long but ordinary response.");
    expect(outputSnapshots.at(-1)).toEqual([
      expect.objectContaining({
        type: "text",
        content: "A long but ordinary response.",
      }),
    ]);
    expect(
      outputSnapshots
        .at(-1)
        ?.some(
          (block) =>
            block.type === "text" && block.presentation?.kind === "long_text",
        ),
    ).toBe(false);
  });

  it("streams Agent web-search results through the existing citation channel", async () => {
    mocks.searchCompatibility = { enabled: true, mode: "external" };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
      },
    };
    vi.mocked(createSearchProvider).mockResolvedValue({
      sources: [
        {
          title: "Release notes",
          url: "https://example.com/releases",
          content: "Current release details",
        },
      ],
      images: [],
    });
    const searchStatuses: Array<{
      active: boolean;
      sourceCount: number;
    }> = [];
    const outputSnapshots: MessageOutputBlock[][] = [];
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_search",
              name: "web_search",
              args: { query: "current release notes", max_results: 3 },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "See the release notes [^1]." },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Find current release notes.",
      [],
      { useAgentMode: true, useSearch: true },
      () => undefined,
      undefined,
      (active, results) =>
        searchStatuses.push({
          active,
          sourceCount: results?.sources.length || 0,
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (blocks) => outputSnapshots.push(blocks),
    );

    expect(createSearchProvider).toHaveBeenCalledWith(
      { query: "current release notes", maxResults: 3 },
      undefined,
    );
    expect(searchStatuses).toEqual([
      { active: true, sourceCount: 0 },
      { active: false, sourceCount: 1 },
    ]);
    expect(outputSnapshots.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "search",
          isSearching: false,
          sources: [
            expect.objectContaining({
              url: "https://example.com/releases",
            }),
          ],
        }),
      ]),
    );
  });

  it("keeps concurrent Agent search citations in provider tool-call order", async () => {
    mocks.searchCompatibility = { enabled: true, mode: "external" };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
      },
    };
    let resolveFirst:
      ((value: { sources: any[]; images: any[] }) => void) | undefined;
    let resolveSecond:
      ((value: { sources: any[]; images: any[] }) => void) | undefined;
    vi.mocked(createSearchProvider).mockImplementation(({ query }) => {
      return new Promise((resolve) => {
        if (query === "first") resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    const searchSnapshots: Array<{ active: boolean; titles: string[] }> = [];
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_first",
              name: "web_search",
              args: { query: "first" },
              status: "pending",
            },
          },
          {
            type: "tool_call",
            toolCall: {
              id: "call_second",
              name: "web_search",
              args: { query: "second" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Combined result." },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const responsePromise = streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Compare both searches.",
      [],
      { useAgentMode: true, useSearch: true },
      () => undefined,
      undefined,
      (active, results) => {
        searchSnapshots.push({
          active,
          titles: results?.sources.map((source) => source.title) || [],
        });
      },
    );
    await vi.waitFor(() => {
      expect(createSearchProvider).toHaveBeenCalledTimes(2);
    });
    resolveSecond?.({
      sources: [
        {
          title: "Second",
          url: "https://example.com/second",
          content: "Second result",
        },
      ],
      images: [],
    });
    await vi.waitFor(() => {
      expect(searchSnapshots.at(-1)).toEqual({
        active: true,
        titles: ["Second"],
      });
    });
    resolveFirst?.({
      sources: [
        {
          title: "First",
          url: "https://example.com/first",
          content: "First result",
        },
      ],
      images: [],
    });
    await responsePromise;

    expect(searchSnapshots.at(-1)).toEqual({
      active: false,
      titles: ["First", "Second"],
    });
  });

  it("keeps concurrent Agent knowledge citations in provider tool-call order", async () => {
    let resolveFirst: ((value: { sources: any[] }) => void) | undefined;
    let resolveSecond: ((value: { sources: any[] }) => void) | undefined;
    mocks.retrieveKnowledgeSources.mockImplementation(
      ({ queries }: { queries: string[] }) =>
        new Promise<{ sources: any[] }>((resolve) => {
          if (queries[0] === "first") resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    const knowledgeSnapshots: string[][] = [];
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "knowledge_first",
              name: "search_knowledge",
              args: { query: "first" },
              status: "pending",
            },
          },
          {
            type: "tool_call",
            toolCall: {
              id: "knowledge_second",
              name: "search_knowledge",
              args: { query: "second" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Combined knowledge." },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const responsePromise = streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Compare both knowledge searches.",
      [],
      { useAgentMode: true },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        knowledgeScope: {
          attachments: [
            createKnowledgeCollectionAttachment({
              collectionId: "collection-1",
              collectionName: "Docs",
            }),
          ],
          collections: [{ id: "collection-1" }] as any,
          ragConfig: { enabled: false },
        },
        onKnowledgeSources: (sources) => {
          knowledgeSnapshots.push(sources.map((source) => source.title));
        },
      },
    );
    await vi.waitFor(() => {
      expect(mocks.retrieveKnowledgeSources).toHaveBeenCalledTimes(2);
    });
    resolveSecond?.({
      sources: [
        {
          title: "Second",
          url: "knowledge://collection-1/second",
          content: "Second result",
        },
      ],
    });
    await vi.waitFor(() => {
      expect(knowledgeSnapshots.at(-1)).toEqual(["Second"]);
    });
    resolveFirst?.({
      sources: [
        {
          title: "First",
          url: "knowledge://collection-1/first",
          content: "First result",
        },
      ],
    });
    await responsePromise;

    expect(knowledgeSnapshots.at(-1)).toEqual(["First", "Second"]);
  });

  it("uses the centralized high tool-round limit before stopping recursive calls", async () => {
    expect(PLUGIN_EXECUTION_LIMITS.maxToolRounds).toBe(20);
    mocks.executePluginFunction.mockResolvedValue({ ok: true });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sseResponse([
        {
          type: "tool_call",
          toolCall: {
            id: `call_${Date.now()}`,
            name: "create_record",
            args: { title: "Loop" },
            status: "pending",
          },
        },
        { type: "done" },
      ]),
    );

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Keep calling",
      [],
      {},
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["writer"],
      undefined,
      undefined,
      createAllowOnceController(),
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(
      PLUGIN_EXECUTION_LIMITS.maxToolRounds + 1,
    );
    expect(result).toContain("20 tool-call rounds");
  });

  describe("stream termination contract", () => {
    it("resolves only after an explicit done event", async () => {
      const chunks: string[] = [];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Complete" },
          { type: "done" },
        ]),
      );

      const { streamChatResponse } =
        await import("../services/api/chatService");
      const result = await streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Answer",
        [],
        {},
        (content) => chunks.push(content),
      );

      expect(result).toBe("Complete");
      expect(chunks).toEqual(["Complete"]);
    });

    it("rejects an early EOF as a recoverable incomplete stream while preserving chunks", async () => {
      const chunks: string[] = [];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "Partial" }]),
      );

      const { streamChatResponse } =
        await import("../services/api/chatService");
      const response = streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Answer",
        [],
        {},
        (content) => chunks.push(content),
      );

      await expect(response).rejects.toMatchObject({
        name: "IncompleteChatStreamError",
        code: "INCOMPLETE_CHAT_STREAM",
        recoverable: true,
      });
      expect(chunks).toEqual(["Partial"]);
    });

    it("rejects an explicit stream error without treating it as done", async () => {
      const chunks: string[] = [];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Partial" },
          { type: "error", error: "Provider stream failed" },
          { type: "done" },
        ]),
      );

      const { streamChatResponse } =
        await import("../services/api/chatService");
      const response = streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Answer",
        [],
        {},
        (content) => chunks.push(content),
      );

      await expect(response).rejects.toMatchObject({
        name: "ChatStreamEventError",
        code: "CHAT_STREAM_ERROR",
        message: "Provider stream failed",
      });
      expect(chunks).toEqual(["Partial"]);
    });

    it("maps provider incomplete terminals to a recoverable stream error", async () => {
      const chunks: string[] = [];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Partial" },
          {
            type: "error",
            error: "Provider stream ended before its terminal event.",
            code: "INCOMPLETE_PROVIDER_STREAM",
          },
        ]),
      );

      const { streamChatResponse } =
        await import("../services/api/chatService");

      await expect(
        streamChatResponse(
          "session-1",
          "openai:gpt-4",
          [],
          "Answer",
          [],
          {},
          (content) => chunks.push(content),
        ),
      ).rejects.toMatchObject({
        name: "IncompleteChatStreamError",
        code: "INCOMPLETE_CHAT_STREAM",
        recoverable: true,
      });
      expect(chunks).toEqual(["Partial"]);
    });

    it("rejects a malformed chat event even when done follows", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        rawSseResponse(
          'data: {"type":"content","content":"Partial"}\n\n' +
            "data: {malformed\n\n" +
            'data: {"type":"done"}\n\n',
        ),
      );
      const { streamChatResponse } =
        await import("../services/api/chatService");

      await expect(
        streamChatResponse(
          "session-1",
          "openai:gpt-4",
          [],
          "Answer",
          [],
          {},
          () => {},
        ),
      ).rejects.toMatchObject({
        name: "ChatStreamEventError",
        code: "MALFORMED_CHAT_STREAM",
      });
    });

    it("rejects a malformed helper event even when done follows", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        rawSseResponse(
          'data: {"type":"content","content":"Partial"}\n\n' +
            "data: {malformed\n\n" +
            'data: {"type":"done"}\n\n',
        ),
      );
      const { streamGenerateContent } =
        await import("../services/api/chatService");

      await expect(
        streamGenerateContent("openai:gpt-task", "Prompt", () => {}),
      ).rejects.toMatchObject({
        name: "ChatStreamEventError",
        code: "MALFORMED_CHAT_STREAM",
      });
    });

    it("rejects a malformed tool-selection event instead of returning null", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        rawSseResponse("data: {malformed\n\n" + 'data: {"type":"done"}\n\n'),
      );
      const { streamGenerateToolCall } =
        await import("../services/api/chatService");

      await expect(
        streamGenerateToolCall("openai:gpt-task", "Prompt", [
          {
            type: "function",
            function: {
              name: "select_skill",
              description: "Select a skill",
              parameters: { type: "object", properties: {} },
            },
          },
        ]),
      ).rejects.toMatchObject({
        name: "ChatStreamEventError",
        code: "MALFORMED_CHAT_STREAM",
      });
    });

    it("preserves response timeout and size error types from SSE", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          sseResponse([
            {
              type: "error",
              error: "Upstream timed out",
              code: "RESPONSE_TIMEOUT",
            },
          ]),
        )
        .mockResolvedValueOnce(
          sseResponse([
            {
              type: "error",
              error: "Upstream was too large",
              code: "RESPONSE_SIZE_LIMIT",
            },
          ]),
        );
      const { streamChatResponse } =
        await import("../services/api/chatService");
      const run = () =>
        streamChatResponse(
          "session-1",
          "openai:gpt-4",
          [],
          "Answer",
          [],
          {},
          () => {},
        );

      await expect(run()).rejects.toMatchObject({
        name: "ChatStreamTimeoutError",
        code: "RESPONSE_TIMEOUT",
      });
      await expect(run()).rejects.toMatchObject({
        name: "ChatStreamSizeLimitError",
        code: "RESPONSE_SIZE_LIMIT",
      });
    });

    it("preserves AbortError identity when the active stream is cancelled", async () => {
      const controller = new AbortController();
      const chunks: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) =>
        abortableSseResponse(init?.signal as AbortSignal, [
          { type: "content", content: "Partial" },
        ]),
      );

      const { streamChatResponse } =
        await import("../services/api/chatService");
      const response = streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Answer",
        [],
        {},
        (content) => chunks.push(content),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller.signal,
      );

      await vi.waitFor(() => expect(chunks).toEqual(["Partial"]));
      controller.abort();

      await expect(response).rejects.toMatchObject({ name: "AbortError" });
    });

    it("rejects helper text generation when its stream ends before done", async () => {
      const chunks: string[] = [];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "Partial" }]),
      );
      const { streamGenerateContent } =
        await import("../services/api/chatService");

      await expect(
        streamGenerateContent("openai:gpt-task", "Prompt", (text) =>
          chunks.push(text),
        ),
      ).rejects.toMatchObject({
        name: "IncompleteChatStreamError",
        code: "INCOMPLETE_CHAT_STREAM",
      });
      expect(chunks).toEqual(["Partial"]);
    });

    it("waits for done before accepting a helper tool call", async () => {
      const toolCall = {
        id: "tool-1",
        name: "select_skill",
        args: { selectedSkillIds: ["skill-1"] },
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([{ type: "tool_call", toolCall }, { type: "done" }]),
      );
      const { streamGenerateToolCall } =
        await import("../services/api/chatService");

      await expect(
        streamGenerateToolCall("openai:gpt-task", "Prompt", [
          {
            type: "function",
            function: {
              name: "select_skill",
              description: "Select a skill",
              parameters: { type: "object", properties: {} },
            },
          },
        ]),
      ).resolves.toEqual(toolCall);
    });

    it("rejects a helper tool call that is not followed by done", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: { id: "tool-1", name: "select_skill", args: {} },
          },
        ]),
      );
      const { streamGenerateToolCall } =
        await import("../services/api/chatService");

      await expect(
        streamGenerateToolCall("openai:gpt-task", "Prompt", [
          {
            type: "function",
            function: {
              name: "select_skill",
              description: "Select a skill",
              parameters: { type: "object", properties: {} },
            },
          },
        ]),
      ).rejects.toMatchObject({ name: "IncompleteChatStreamError" });
    });
  });
});
