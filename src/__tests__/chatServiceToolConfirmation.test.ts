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
import type { BuiltinResearchHostContext } from "../services/api/chat/builtinTools";
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
  writeWorkspaceText: vi.fn(),
  readWorkspaceText: vi.fn(),
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

vi.mock("@/services/workspace/sessionWorkspace", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/workspace/sessionWorkspace")
  >()),
  writeWorkspaceText: mocks.writeWorkspaceText,
  readWorkspaceText: mocks.readWorkspaceText,
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
    mocks.writeWorkspaceText.mockReset();
    mocks.readWorkspaceText.mockReset();
    mocks.searchCompatibility = { enabled: true, mode: "native" };
    vi.mocked(createSearchProvider).mockReset();
  });

  it("sends responseFormat only for an explicitly constrained internal round", async () => {
    const requestBodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { type: "content", content: '{"packets":[]}' },
        { type: "done" },
      ]);
    });
    const { streamChatResponse } = await import("../services/api/chatService");
    const responseFormat = {
      name: "research_wave",
      schema: {
        type: "object",
        properties: { packets: { type: "array" } },
        required: ["packets"],
        additionalProperties: false,
      },
      strict: true,
    } as const;

    await streamChatResponse(
      "session-plain",
      "openai:gpt-4",
      [],
      "Ordinary chat",
      [],
      { useSearch: false },
      () => undefined,
    );
    await streamChatResponse(
      "session-structured",
      "openai:gpt-4",
      [],
      "Archive the wave",
      [],
      { useSearch: false },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      { responseFormat },
    );

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).not.toHaveProperty("responseFormat");
    expect(requestBodies[1].responseFormat).toEqual(responseFormat);
  });

  it("lets Auto mode switch the current request without a preflight classifier", async () => {
    mocks.searchCompatibility = { enabled: true, mode: "external" };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: { provider: "tavily", configs: { tavily: { apiKey: "search" } } },
    };
    const onChatModeChange = vi.fn();
    const onSearchStatus = vi.fn();
    const onToolUpdate = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.modelName).toBe("gpt-4");
        expect(body.config.useAgentMode).toBe(false);
        expect(body.config).not.toHaveProperty("chatMode");
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "switch_chat_mode",
          "start_long_text_output",
          "web_search",
        ]);
        expect(body.systemInstruction).toContain("CUSTOM AUTO SYSTEM");
        expect(body.systemInstruction).toContain("<auto-mode>");
        expect(
          body.systemInstruction.indexOf("CUSTOM AUTO SYSTEM"),
        ).toBeLessThan(body.systemInstruction.indexOf("<auto-mode>"));
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "switch-1",
              name: "switch_chat_mode",
              args: { mode: "research" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.modelName).toBe("gpt-4");
        expect(body.config).toMatchObject({
          useAgentMode: false,
          useDeepResearch: true,
          useSearch: false,
        });
        expect(body.config).not.toHaveProperty("chatMode");
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "start_deep_research",
        ]);
        expect(body.attachments).toEqual([]);
        expect(body.history).toEqual([]);
        expect(body.newMessage).not.toContain("SKILL INSTRUCTIONS");
        expect(body.newMessage).toBe("Clean research request.");
        expect(body.systemInstruction).not.toContain("<agent-mode>");
        expect(body.systemInstruction).not.toContain("<auto-mode>");
        expect(body.systemInstruction).toContain("CUSTOM AUTO SYSTEM");
        expect(body.systemInstruction).toContain(
          "first-class Deep Research workflow",
        );
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "research-start-1",
              name: "start_deep_research",
              args: {
                query: "Clean research request.",
                budgetPreset: "standard",
              },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const { registerResearchToolEmitters } =
      await import("../services/research/runtime");
    let startContext: BuiltinResearchHostContext | undefined;
    const start = vi.fn(
      async (_request: unknown, context: BuiltinResearchHostContext) => {
        startContext = context;
        return {
          taskId: "research-1",
          status: "draft" as const,
        };
      },
    );
    const unregister = registerResearchToolEmitters({
      start,
      adjustPlan: vi.fn(),
      confirmPlan: vi.fn(),
    });
    let result = "unreached";
    try {
      result = await streamChatResponse(
        "session-auto",
        "openai:gpt-4",
        [],
        "Research this topic thoroughly.",
        [],
        {
          chatMode: "auto",
          useSearch: true,
          useReasoning: false,
          useAgentMode: false,
          useDeepResearch: false,
          reasoningMode: "off",
          temperature: 0.7,
        },
        () => undefined,
        "CUSTOM AUTO SYSTEM",
        onSearchStatus,
        onToolUpdate,
        undefined,
        undefined,
        undefined,
        [],
        "SKILL INSTRUCTIONS MUST NOT LOAD",
        undefined,
        undefined,
        {
          agentRun: {
            id: "auto-run",
            userMessageId: "user-1",
            modelMessageId: "model-1",
          },
          researchLaunchMessage: "Clean research request.",
          researchBudgetPreset: "deep",
          onChatModeChange,
        },
      );
    } finally {
      unregister();
    }

    expect(result).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createSearchProvider).not.toHaveBeenCalled();
    expect(onSearchStatus).not.toHaveBeenCalled();
    expect(onChatModeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        chatMode: "research",
        useAgentMode: false,
        useDeepResearch: true,
        useSearch: true,
      }),
      undefined,
    );
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      query: "Clean research request.",
      budgetPreset: "deep",
    });
    expect(startContext).toMatchObject({
      sessionId: "session-auto",
      model: "openai:gpt-4",
      userMessageId: "user-1",
      modelMessageId: "model-1",
    });
    expect(startContext).not.toHaveProperty("agentRunId");
  });

  it("removes the Auto directive after switching to Agent", async () => {
    const onChatModeChange = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.systemInstruction).toContain("CUSTOM AUTO SYSTEM");
        expect(body.systemInstruction).toContain("<auto-mode>");
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "switch-agent-1",
              name: "switch_chat_mode",
              args: { mode: "agent" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.config).toMatchObject({
          useAgentMode: true,
          useDeepResearch: false,
        });
        expect(body.systemInstruction).toContain("CUSTOM AUTO SYSTEM");
        expect(body.systemInstruction).toContain("<agent-mode>");
        expect(body.systemInstruction).not.toContain("<auto-mode>");
        expect(body.tools.map((tool: any) => tool.function.name)).toContain(
          "update_task_plan",
        );
        return sseResponse([
          { type: "content", content: "Agent completed the task." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-auto-agent",
      "openai:gpt-4",
      [],
      "Process the uploaded files.",
      [],
      {
        chatMode: "auto",
        useSearch: false,
        useReasoning: false,
        useAgentMode: false,
        useDeepResearch: false,
        reasoningMode: "off",
        temperature: 0.7,
      },
      () => undefined,
      "CUSTOM AUTO SYSTEM",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      {
        agentRun: {
          id: "auto-agent-run",
          userMessageId: "user-agent-1",
          modelMessageId: "model-agent-1",
        },
        onChatModeChange,
      },
    );

    expect(result).toBe("Agent completed the task.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onChatModeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        chatMode: "agent",
        useAgentMode: true,
        useDeepResearch: false,
      }),
      "auto-agent-run",
    );
  });

  it("keeps ordinary search preflight for Auto models without tool calls", async () => {
    mocks.searchCompatibility = { enabled: true, mode: "external" };
    mocks.settingsState = {
      ...mocks.settingsState,
      search: { provider: "tavily", configs: { tavily: { apiKey: "search" } } },
    };
    mocks.supportsToolCalls.mockReturnValue(false);
    const onSearchStatus = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (url) => {
        expect(url).toBe("/api/chat/generate");
        return sseResponse([
          {
            type: "content",
            content: '{"shouldSearch":false,"query":"ordinary lookup"}',
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools).toEqual([]);
        expect(body.systemInstruction).toBeUndefined();
        return sseResponse([
          { type: "content", content: "Ordinary response." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-auto-no-tools",
      "openai:gpt-4",
      [],
      "Look this up.",
      [],
      { chatMode: "auto", useSearch: true },
      () => undefined,
      undefined,
      onSearchStatus,
    );

    expect(result).toBe("Ordinary response.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createSearchProvider).not.toHaveBeenCalled();
    expect(onSearchStatus).toHaveBeenCalledWith(false, {
      sources: [],
      images: [],
    });
  });

  it("starts Research deterministically when the model omits its start tool", async () => {
    const onChunk = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.modelName).toBe("gpt-4");
        expect(body.config).toMatchObject({
          useAgentMode: false,
          useDeepResearch: true,
          useSearch: false,
        });
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "start_deep_research",
        ]);
        expect(body.attachments).toEqual([]);
        expect(body.history).toEqual([]);
        expect(body.systemInstruction).not.toContain("<agent-mode>");
        return sseResponse([
          { type: "content", content: "An ordinary answer is not allowed." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const { registerResearchToolEmitters } =
      await import("../services/research/runtime");
    let startRequest: unknown;
    let startContext: BuiltinResearchHostContext | undefined;
    const start = vi.fn(
      async (request: unknown, context: BuiltinResearchHostContext) => {
        startRequest = request;
        startContext = context;
        return {
          taskId: "research-fallback",
          status: "draft" as const,
        };
      },
    );
    const unregister = registerResearchToolEmitters({
      start,
      adjustPlan: vi.fn(),
      confirmPlan: vi.fn(),
    });
    let result = "unreached";
    try {
      result = await streamChatResponse(
        "session-research",
        "openai:gpt-4",
        [],
        "Research this topic with augmented context.",
        [
          {
            id: "attachment-1",
            fileName: "private.txt",
            mimeType: "text/plain",
            data: "not read before approval",
          },
        ],
        {
          chatMode: "research",
          useSearch: false,
          useReasoning: false,
          useAgentMode: false,
          useDeepResearch: true,
          reasoningMode: "off",
          temperature: 0.7,
        },
        onChunk,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        {
          executionWorkflow: { kind: "research", phase: "start" },
          researchLaunchMessage: "Research this topic.",
          researchBudgetPreset: "quick",
        },
      );
    } finally {
      unregister();
    }

    expect(result).toBe("");
    expect(start).toHaveBeenCalledOnce();
    expect(startRequest).toEqual({
      query: "Research this topic.",
      budgetPreset: "quick",
    });
    expect(startContext).toMatchObject({
      sessionId: "session-research",
      model: "openai:gpt-4",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onChunk).not.toHaveBeenCalled();
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
        expect(body.modelName).toBe("gpt-4");
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

  it("turns committed read-only plugin output into Research evidence", async () => {
    const runId = "run-research-plugin-evidence";
    const onSourceBodiesRead = vi.fn();
    const researchSourceBudget = {
      remainingSourceBodies: 1,
      onSourceBodiesRead,
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [memoryNamedPlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({
      result: "Committed plugin evidence",
    });
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_research_plugin_evidence",
              name: "memory_search",
              args: {},
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const serializedHistory = JSON.stringify(body.history);
        expect(serializedHistory).toContain("_researchEvidence");
        expect(serializedHistory).toMatch(/source-[a-z0-9]+/i);
        return sseResponse([
          { type: "content", content: "Evidence recorded." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Read the approved plugin source",
      [],
      { useAgentMode: true, useDeepResearch: true },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["memory-plugin"],
      undefined,
      undefined,
      createAllowOnceController(),
      {
        executionWorkflow: { kind: "research", phase: "execute" },
        allowedToolIds: ["memory_search"],
        enforceAllowedToolIds: true,
        allowedToolEffects: ["local_read", "network_read"],
        researchSourceBudget,
        agentRun: { id: runId },
      },
    );

    expect(researchSourceBudget.remainingSourceBodies).toBe(0);
    expect(onSourceBodiesRead).toHaveBeenCalledWith([
      "plugin://memory-plugin/memory_search",
    ]);

    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    expect(useAgentRunStore.getState().runsById[runId]).toMatchObject({
      workflowKind: "research",
      evidence: [
        {
          sourceId: expect.stringMatching(/^source-/),
          url: "plugin://memory-plugin/memory_search",
          retrievalKind: "mcp",
          toolCallId: "call_research_plugin_evidence",
          contentHash: expect.any(String),
        },
      ],
    });
  });

  it("pages a newly compacted Research result without spending another source body", async () => {
    const runId = "run-research-internal-result";
    const resultPath = "tool-results/call_large_source.json";
    const onSourceBodiesRead = vi.fn();
    const researchSourceBudget = {
      remainingSourceBodies: 1,
      onSourceBodiesRead,
    };
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [memoryNamedPlugin],
    };
    mocks.executePluginFunction.mockResolvedValueOnce({
      result: "x".repeat(50_000),
    });
    mocks.writeWorkspaceText.mockResolvedValueOnce({
      ok: true,
      value: {
        path: resultPath,
        revision: "revision-large",
        contentHash: "sha256:large",
      },
    });
    mocks.readWorkspaceText.mockResolvedValueOnce({
      ok: true,
      value: {
        path: resultPath,
        content: '{"result":"paged content"}',
        offset: 0,
        limit: 200,
        totalLines: 1,
        truncated: false,
        revision: "revision-large",
        contentHash: "sha256:large",
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_large_source",
              name: "memory_search",
              args: {},
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(JSON.stringify(body.history)).toContain(resultPath);
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_read_large_source",
              name: "read_workspace_file",
              args: { path: resultPath, offset: 0, limit: 200 },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(JSON.stringify(body.history)).toContain("paged content");
        return sseResponse([
          { type: "content", content: "Internal result read." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Read and page the approved source",
        [],
        { useAgentMode: true, useDeepResearch: true },
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["memory-plugin"],
        undefined,
        undefined,
        createAllowOnceController(),
        {
          executionWorkflow: { kind: "research", phase: "execute" },
          allowedToolIds: ["memory_search", "read_workspace_file"],
          enforceAllowedToolIds: true,
          allowedToolEffects: ["local_read", "network_read"],
          workspaceReadScope: [],
          researchSourceBudget,
          agentRun: { id: runId },
        },
      ),
    ).resolves.toBe("Internal result read.");

    expect(mocks.writeWorkspaceText).toHaveBeenCalledWith(
      "session-1",
      resultPath,
      expect.any(String),
      "create",
    );
    expect(mocks.readWorkspaceText).toHaveBeenCalledWith(
      "session-1",
      resultPath,
      { offset: 0, limit: 200 },
    );
    expect(researchSourceBudget.remainingSourceBodies).toBe(0);
    expect(onSourceBodiesRead).toHaveBeenCalledTimes(1);
    expect(onSourceBodiesRead).toHaveBeenCalledWith([
      "plugin://memory-plugin/memory_search",
    ]);
    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    const evidence = useAgentRunStore.getState().runsById[runId]?.evidence;
    expect(evidence).toHaveLength(1);
    expect(evidence?.[0]).toMatchObject({
      url: "plugin://memory-plugin/memory_search",
      toolCallId: "call_large_source",
    });
  });

  it("commits the current Tool batch before honoring a safe-pause request", async () => {
    mocks.executePluginFunction.mockResolvedValueOnce({ saved: true });
    const phases: string[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_safe_pause",
              name: "create_record",
              args: { title: "Committed before pause" },
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
        "Create a record and then continue",
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
        undefined,
        undefined,
        createAllowOnceController(),
        {
          abortAgentRunAsInterrupted: true,
          forcedPluginIds: ["writer"],
          onAgentExecutionPhase: (phase) => phases.push(phase),
          shouldPauseAfterToolBatch: () => true,
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(phases).toContain("tool_execution");
    expect(phases.at(-1)).toBe("idle");
  });

  it("fails before requesting the model when a forced plugin has no available tool", async () => {
    mocks.settingsState = {
      ...mocks.settingsState,
      installedPlugins: [{ ...writePlugin, id: "empty-plugin", functions: [] }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { streamChatResponse } = await import("../services/api/chatService");

    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Use the plugin",
        [],
        {},
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        createAllowOnceController(),
        { forcedPluginIds: ["empty-plugin"] },
      ),
    ).rejects.toThrow(/forced plugin.*no enabled tools/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the model ignores a forced plugin", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Answered without the plugin." },
          { type: "done" },
        ]),
      );
    const { streamChatResponse } = await import("../services/api/chatService");

    await expect(
      streamChatResponse(
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
        [],
        undefined,
        undefined,
        createAllowOnceController(),
        { forcedPluginIds: ["writer"] },
      ),
    ).rejects.toThrow(/forced plugin.*Writer.*not called/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
  });

  it("accepts a response after the forced plugin tool was attempted", async () => {
    mocks.executePluginFunction.mockResolvedValueOnce({ id: "record-1" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools.map((tool: any) => tool.function.name)).toContain(
          "create_record",
        );
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "forced-writer-call",
              name: "create_record",
              args: { title: "Draft" },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "content", content: "Record created." },
          { type: "done" },
        ]),
      );
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
      [],
      undefined,
      undefined,
      createAllowOnceController(),
      { forcedPluginIds: ["writer"] },
    );

    expect(result).toBe("Record created.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(1);
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
            ok: true,
            data: {
              memories: [
                expect.objectContaining({
                  id: "mem_1",
                  content: "Keep Mineru as the default document parser.",
                }),
              ],
            },
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
          result: expect.objectContaining({
            ok: true,
            data: { id: "record-1" },
            receipt: {
              committedAt: expect.any(Number),
              effectId: "call_write",
              targetHash: expect.stringMatching(/^sha256:/),
              resultHash: expect.stringMatching(/^sha256:/),
              reversible: false,
            },
          }),
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

  it("requires one-time confirmation for destructive tools in permissive mode", async () => {
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
    expect(confirmationController.requestConfirmation).toHaveBeenCalledTimes(1);
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_delete",
          risk: "destructive",
          status: "success",
          confirmation: expect.objectContaining({
            required: true,
            decision: "allow_once",
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

  it("requires one-time confirmation for unknown external MCP tools", async () => {
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

    expect(confirmationController.requestConfirmation).toHaveBeenCalledTimes(1);
    expect(mocks.executePluginFunction).toHaveBeenCalledWith(
      "query_remote_tool",
      { query: "status" },
      undefined,
      ["mcp-tools"],
      undefined,
      expect.objectContaining({
        pluginId: "mcp-tools",
        risk: "destructive",
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

  it("never persists approval for credential-bearing external writes", async () => {
    mocks.executePluginFunction.mockResolvedValueOnce({ created: true });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_secret_write",
              name: "create_record",
              args: { title: "Draft", apiToken: "private-token" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Created." },
          { type: "done" },
        ]),
      );
    const updates: ToolCall[][] = [];
    const grantSessionApproval = vi.fn();
    const requestConfirmation = vi.fn(
      async (): Promise<ToolConfirmationDecision> => "allow_session",
    );

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
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
      { requestConfirmation, grantSessionApproval },
    );

    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { title: "Draft", apiToken: "[REDACTED]" },
      }),
      undefined,
    );
    expect(grantSessionApproval).not.toHaveBeenCalled();
    expect(updates.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "call_secret_write",
          status: "success",
          confirmation: expect.objectContaining({
            canPersist: false,
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
          result: expect.objectContaining({
            ok: false,
            error: expect.objectContaining({
              code: "AGENT_TOOL_CALL_BUDGET_EXHAUSTED",
              message: expect.stringMatching(/total Tool-call budget/i),
            }),
          }),
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
    expect(toolResult).toEqual(
      expect.objectContaining({
        ok: true,
        trust: "external_untrusted",
        data: {
          imageUrl: null,
          imageBase64: "[image omitted]",
          imageCount: 1,
          revisedPrompt: null,
        },
      }),
    );
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
    expect(body.systemInstruction).toContain("<auto-mode>");
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
      { chatMode: "chat", useSearch: true },
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
        { chatMode: "chat", useSearch: true },
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
        expect(body.modelName).toBe("gpt-4");
        expect(body.config.useAgentMode).toBe(true);
        expect(body.enableGoogleSearch).toBe(false);
        expect(body.enableOpenAIWebSearch).toBe(false);
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "start_long_text_output",
          "request_user_input",
          "update_task_plan",
          "web_search",
          "search_web",
          "run_javascript",
          "fetch_url",
          "fetch_urls",
          "inspect_attachment",
          "extract_document",
          "list_workspace_files",
          "stat_workspace_file",
          "diff_workspace_file",
          "search_workspace_files",
          "read_workspace_file",
          "write_workspace_file",
          "edit_workspace_file",
          "apply_workspace_patch",
          "move_workspace_file",
          "trash_workspace_file",
          "restore_workspace_file",
          "delete_workspace_file",
          "validate_workspace_file",
          "publish_artifact",
          "share_workspace_file",
          "create_archive",
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

  it("restricts registered schemas to the Agent Profile Tool allowlist", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "request_user_input",
          "fetch_url",
        ]);
        return sseResponse([
          { type: "content", content: "Restricted." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Use only approved tools.",
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
        { allowedToolIds: ["request_user_input", "fetch_url"] },
      ),
    ).resolves.toBe("Restricted.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can enforce an explicitly empty Tool allowlist for bounded workflows", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools).toEqual([]);
        return sseResponse([
          { type: "content", content: "No tools offered." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Use no tools.",
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
          allowedToolIds: [],
          enforceAllowedToolIds: true,
          allowedToolEffects: ["local_read", "network_read"],
        },
      ),
    ).resolves.toBe("No tools offered.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
            { title: "Implement", status: "completed" },
          ],
        }),
        expect.objectContaining({
          type: "tool_group",
          toolCalls: [
            expect.objectContaining({
              name: "update_task_plan",
              status: "success",
              risk: "write",
            }),
          ],
        }),
      ]),
    );
  });

  it("preserves unfinished task-plan steps when a later Agent round fails", async () => {
    const outputSnapshots: MessageOutputBlock[][] = [];
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_plan_failure",
              name: "update_task_plan",
              args: {
                steps: [{ title: "Investigate", status: "in_progress" }],
              },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async () =>
        sseResponse([{ type: "error", error: "Provider failed" }]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-plan-failure",
        "openai:gpt-4",
        [],
        "Investigate the failure.",
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
      ),
    ).rejects.toThrow("Provider failed");

    expect(outputSnapshots.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task_plan",
          steps: [{ title: "Investigate", status: "in_progress" }],
        }),
      ]),
    );
  });

  it("preserves unfinished task-plan steps when an Agent run is interrupted", async () => {
    const controller = new AbortController();
    const outputSnapshots: MessageOutputBlock[][] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_plan_interrupted",
              name: "update_task_plan",
              args: {
                steps: [{ title: "Wait for data", status: "in_progress" }],
              },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockImplementationOnce(async (_url, init) =>
        abortableSseResponse(init?.signal as AbortSignal, [
          { type: "content", content: "Still working" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    const response = streamChatResponse(
      "session-plan-interrupted",
      "openai:gpt-4",
      [],
      "Wait for the result.",
      [],
      { useAgentMode: true },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
      undefined,
      undefined,
      (blocks) => outputSnapshots.push(blocks),
      undefined,
      { abortAgentRunAsInterrupted: true },
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(response).rejects.toMatchObject({ name: "AbortError" });

    expect(outputSnapshots.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task_plan",
          steps: [{ title: "Wait for data", status: "in_progress" }],
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

  it("lets Auto run one focused external search without a search preflight", async () => {
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
          title: "Weather report",
          url: "https://example.com/weather",
          content: "Clear skies",
        },
      ],
      images: [],
    });
    const onChatModeChange = vi.fn();
    const searchStatuses: Array<{
      active: boolean;
      sourceCount: number;
    }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.systemInstruction).toContain("<auto-mode>");
        expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
          "switch_chat_mode",
          "start_long_text_output",
          "web_search",
        ]);
        return sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "auto-search-1",
              name: "web_search",
              args: { query: "today weather", max_results: 3 },
              status: "pending",
            },
          },
          { type: "done" },
        ]);
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.systemInstruction).toContain("<auto-mode>");
        return sseResponse([
          { type: "content", content: "The weather is clear [^1]." },
          { type: "done" },
        ]);
      });

    const { streamChatResponse } = await import("../services/api/chatService");
    const result = await streamChatResponse(
      "session-auto-search",
      "openai:gpt-4",
      [],
      "What is today's weather?",
      [],
      { chatMode: "auto", useSearch: true },
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
      [],
      undefined,
      undefined,
      undefined,
      { onChatModeChange },
    );

    expect(result).toBe("The weather is clear [^1].");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createSearchProvider).toHaveBeenCalledOnce();
    expect(createSearchProvider).toHaveBeenCalledWith(
      { query: "today weather", maxResults: 3 },
      undefined,
    );
    expect(searchStatuses).toEqual([
      { active: true, sourceCount: 0 },
      { active: false, sourceCount: 1 },
    ]);
    expect(onChatModeChange).not.toHaveBeenCalled();
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
    const runId = "run-tool-round-budget";
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
      { useAgentMode: true },
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
      { agentRun: { id: runId }, forcedPluginIds: ["writer"] },
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(
      PLUGIN_EXECUTION_LIMITS.maxToolRounds + 1,
    );
    expect(result).toBe("");
    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    expect(useAgentRunStore.getState().runsById[runId]).toMatchObject({
      status: "failed",
      stop: {
        reason: "budget_exhausted",
        budgetDimension: "tool_rounds",
      },
      usage: { toolRounds: PLUGIN_EXECUTION_LIMITS.maxToolRounds + 1 },
    });
  });

  it("aggregates Agent token usage across every model round", async () => {
    const runId = "run-aggregate-usage";
    mocks.executePluginFunction.mockResolvedValue({ ok: true });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call-usage",
              name: "create_record",
              args: { title: "Usage" },
              status: "pending",
            },
          },
          {
            type: "usage",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Done." },
          {
            type: "usage",
            usage: {
              prompt_tokens: 20,
              completion_tokens: 5,
              total_tokens: 25,
            },
          },
          { type: "done" },
        ]),
      );

    const { streamChatResponse } = await import("../services/api/chatService");
    await streamChatResponse(
      "session-1",
      "openai:gpt-4",
      [],
      "Create the record.",
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
      undefined,
      undefined,
      createAllowOnceController(),
      { agentRun: { id: runId }, forcedPluginIds: ["writer"] },
    );

    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    expect(useAgentRunStore.getState().runsById[runId]).toMatchObject({
      status: "completed",
      usage: {
        modelRounds: 2,
        toolRounds: 1,
        toolCalls: 1,
        promptTokens: 30,
        completionTokens: 7,
        totalTokens: 37,
      },
    });
  });

  it("stops an AgentRun when an external write result has an unknown effect", async () => {
    const runId = "run-effect-unknown";
    mocks.executePluginFunction.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "PLUGIN_EXECUTION_FAILED",
        message: "Connection closed before the write receipt arrived.",
        recoverable: false,
        effectUnknown: true,
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        {
          type: "tool_call",
          toolCall: {
            id: "call-unknown",
            name: "create_record",
            args: { title: "Uncertain" },
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
        "Create the record.",
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
        undefined,
        undefined,
        createAllowOnceController(),
        { agentRun: { id: runId }, forcedPluginIds: ["writer"] },
      ),
    ).rejects.toThrow("could not be confirmed");

    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    expect(useAgentRunStore.getState().runsById[runId]).toMatchObject({
      status: "failed",
      stop: { reason: "effect_unknown" },
      toolExecutions: [
        expect.objectContaining({
          callId: "call-unknown",
          status: "effect_unknown",
        }),
      ],
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("resumes an interrupted run without replaying a committed side effect", async () => {
    const runId = "run-resume-committed";
    const args = { title: "Existing" };
    const {
      commitToolExecution,
      createAgentRun,
      hashToolArguments,
      markToolExecutionRunning,
      prepareToolExecution,
      transitionAgentRunStatus,
    } = await import("../lib/agent");
    const { createPluginFunctionFingerprint } =
      await import("../lib/plugin/confirmation");
    const fingerprint = await createPluginFunctionFingerprint(
      writePlugin,
      writePlugin.functions[0],
    );
    const cachedResult = {
      ok: true,
      trust: "external_untrusted",
      provenance: {
        origin: "plugin",
        toolName: "create_record",
        retrievedAt: 130,
      },
      data: { id: "record-existing" },
      receipt: { committedAt: 130, effectId: "call-old", reversible: false },
    };
    let run = prepareToolExecution(
      createAgentRun({ id: runId, sessionId: "session-1", now: 100 }),
      {
        id: "execution-old",
        callId: "call-old",
        toolName: "create_record",
        pluginId: "writer",
        definitionFingerprint: fingerprint,
        argumentsHash: await hashToolArguments(args),
        targetSummary: "*",
        policy: {
          effects: ["external_write"],
          idempotency: "non_idempotent",
          sensitivity: "user_data",
          origin: "plugin",
        },
        at: 110,
      },
    );
    run = markToolExecutionRunning(run, "execution-old", 120);
    run = commitToolExecution(run, "execution-old", {
      at: 130,
      resultRefs: [
        {
          kind: "tool_cache",
          id: "call-old",
          contentHash: await hashToolArguments(cachedResult),
        },
      ],
      receipt: { committedAt: 130, effectId: "call-old", reversible: false },
    });
    run = transitionAgentRunStatus(run, "interrupted", {
      at: 140,
      stop: { reason: "page_interrupted" },
    });
    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    await useAgentRunStore.getState().upsertRun(run);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call-resumed",
              name: "create_record",
              args,
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Reused the committed result." },
          { type: "done" },
        ]),
      );
    const { streamChatResponse } = await import("../services/api/chatService");
    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [
          {
            id: "user-old",
            role: "user",
            content: "Create it",
            timestamp: 100,
          },
          {
            id: "model-old",
            role: "model",
            content: "",
            timestamp: 130,
            toolCalls: [
              {
                id: "call-old",
                name: "create_record",
                args,
                status: "success",
                result: cachedResult,
              },
            ],
          },
        ],
        "Continue safely.",
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
        undefined,
        undefined,
        createAllowOnceController(),
        {
          agentRun: { id: runId },
          forcedPluginIds: ["writer"],
          resumeAgentRun: true,
        },
      ),
    ).resolves.toBe("Reused the committed result.");

    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
    expect(useAgentRunStore.getState().runsById[runId]).toMatchObject({
      status: "completed",
      usage: { toolCalls: 1 },
      toolExecutions: [{ id: "execution-old", status: "committed" }],
    });
  });

  it("restores run-owned workspace result paths when Research resumes", async () => {
    const runId = "run-resume-research-result";
    const resultPath = "tool-results/call_previous_large_source.json";
    const {
      commitToolExecution,
      createAgentRun,
      hashToolArguments,
      markToolExecutionRunning,
      prepareToolExecution,
      transitionAgentRunStatus,
    } = await import("../lib/agent");
    let run = prepareToolExecution(
      createAgentRun({
        id: runId,
        sessionId: "session-1",
        workflowKind: "research",
        now: 100,
      }),
      {
        id: "execution-previous-source",
        callId: "call_previous_large_source",
        toolName: "memory_search",
        pluginId: "memory-plugin",
        definitionFingerprint: "fingerprint-previous-source",
        argumentsHash: await hashToolArguments({}),
        policy: {
          effects: ["network_read"],
          idempotency: "idempotent",
          sensitivity: "none",
          origin: "plugin",
        },
        at: 110,
      },
    );
    run = markToolExecutionRunning(run, "execution-previous-source", 120);
    run = commitToolExecution(run, "execution-previous-source", {
      at: 130,
      resultRefs: [
        {
          kind: "workspace_file",
          id: resultPath,
          contentHash: "sha256:previous-large-source",
        },
      ],
    });
    run = transitionAgentRunStatus(run, "interrupted", {
      at: 140,
      stop: { reason: "page_interrupted" },
    });
    const { useAgentRunStore } = await import("../store/core/agentRunStore");
    await useAgentRunStore.getState().upsertRun(run);
    mocks.readWorkspaceText.mockResolvedValueOnce({
      ok: true,
      value: {
        path: resultPath,
        content: '{"result":"resumed page"}',
        offset: 0,
        limit: 100,
        totalLines: 1,
        truncated: false,
        revision: "revision-resumed",
        contentHash: "sha256:previous-large-source",
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "call_read_resumed_source",
              name: "read_workspace_file",
              args: { path: resultPath, offset: 0, limit: 100 },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "content", content: "Resumed result read." },
          { type: "done" },
        ]),
      );
    const researchSourceBudget = { remainingSourceBodies: 0 };
    const { streamChatResponse } = await import("../services/api/chatService");

    await expect(
      streamChatResponse(
        "session-1",
        "openai:gpt-4",
        [],
        "Resume from the committed source result.",
        [],
        { useDeepResearch: true },
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
          executionWorkflow: { kind: "research", phase: "execute" },
          allowedToolIds: ["read_workspace_file"],
          enforceAllowedToolIds: true,
          allowedToolEffects: ["local_read"],
          workspaceReadScope: [],
          researchSourceBudget,
          agentRun: { id: runId },
          resumeAgentRun: true,
        },
      ),
    ).resolves.toBe("Resumed result read.");

    expect(mocks.readWorkspaceText).toHaveBeenCalledWith(
      "session-1",
      resultPath,
      { offset: 0, limit: 100 },
    );
    expect(researchSourceBudget.remainingSourceBodies).toBe(0);
    expect(useAgentRunStore.getState().runsById[runId]?.evidence).toEqual([]);
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
