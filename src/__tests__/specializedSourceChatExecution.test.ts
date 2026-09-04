import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ModelMetadata,
  Plugin,
  ToolConfirmationController,
  ToolConfirmationDecision,
} from "../types";

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

import { RESEARCH_SOURCE_PLUGINS } from "@/lib/plugin/researchSources/catalog";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";
import { collectTaskEvidence } from "@/lib/research/runtime/evidenceCollection";
import type { ResearchTask } from "@/lib/research/types";

describe("specialized source chat execution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.executePluginFunction.mockReset();
    mocks.settingsState = {
      system: { enableDestructiveToolConfirmation: false },
      search: { provider: "google", configs: {} },
      installedPlugins: RESEARCH_SOURCE_PLUGINS,
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

  async function executeScenario({ empty = false, changed = false } = {}) {
    const plugin = RESEARCH_SOURCE_PLUGINS[0];
    const contracts = Object.fromEntries(
      await Promise.all(
        plugin.functions.map(async (fn) => [
          fn.name,
          {
            pluginId: plugin.id,
            functionFingerprint: changed
              ? "wrong"
              : await createPluginFunctionFingerprint(plugin, fn),
          },
        ]),
      ),
    );
    const document = {
      id: "2401.00001v2",
      title: "Evidence",
      url: "https://arxiv.org/abs/2401.00001v2",
      content: "A bounded abstract.",
      coverage: "abstract_and_metadata",
      missing: [],
      truncated: false,
      publishedAt: "2024-01-01",
    };
    mocks.executePluginFunction
      .mockResolvedValueOnce({
        provider: "arxiv",
        operation: "search",
        documents: empty ? [] : [document],
      })
      .mockResolvedValueOnce({
        provider: "arxiv",
        operation: "read",
        documents: [document],
      });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_call",
            toolCall: {
              id: "search",
              name: "search_arxiv",
              args: { query: "retrieval" },
              status: "pending",
            },
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse(
          empty || changed
            ? [{ type: "content", content: "No sources." }, { type: "done" }]
            : [
                {
                  type: "tool_call",
                  toolCall: {
                    id: "read",
                    name: "read_arxiv",
                    args: { id: document.id },
                    status: "pending",
                  },
                },
                { type: "done" },
              ],
        ),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "content", content: "Done." }, { type: "done" }]),
      );
    const { streamChatResponse } = await import("@/services/api/chatService");
    const runId = `specialized-${empty}-${changed}`;
    const researchSourceBudget = { remainingSourceBodies: 1 };
    const researchQueryBudget = {
      remainingQueries: 1,
      maxResultsPerQuery: 3,
      seenQueries: new Set<string>(),
    };
    await streamChatResponse(
      "specialized-session",
      "openai:gpt-4",
      [],
      "Research",
      [],
      { useDeepResearch: true },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [plugin.id],
      undefined,
      undefined,
      createAllowOnceController(),
      {
        executionWorkflow: { kind: "research", phase: "execute" },
        allowedToolIds: plugin.functions.map((fn) => fn.name),
        enforceAllowedToolIds: true,
        allowedToolEffects: ["local_read", "network_read"],
        researchSourceContracts: contracts,
        researchSourceBudget,
        researchQueryBudget,
        agentRun: { id: runId },
      },
    );
    const { useAgentRunStore } = await import("@/store/core/agentRunStore");
    return {
      runId,
      run: useAgentRunStore.getState().runsById[runId],
      researchSourceBudget,
      researchQueryBudget,
    };
  }
  it("uses query budget for discovery and body budget for formal reads", async () => {
    const { runId, run, researchSourceBudget, researchQueryBudget } =
      await executeScenario();
    expect(mocks.executePluginFunction).toHaveBeenCalledTimes(2);
    expect(researchQueryBudget.remainingQueries).toBe(0);
    expect(researchSourceBudget.remainingSourceBodies).toBe(0);
    // The same source identity may be upgraded to a read in the run ledger.
    expect(run.evidence.some((item) => item.retrievalKind === "fetch")).toBe(
      true,
    );
    const collected = await collectTaskEvidence({
      task: { evidence: [] } as unknown as ResearchTask,
      runIds: [runId],
      webSources: [],
      knowledgeSources: [],
      defaultStepId: "step",
      defaultNodeId: "node",
    });
    expect(collected.evidence).toHaveLength(1);
    expect(collected.evidence[0]).toMatchObject({
      sourceType: "plugin",
      locator: "https://arxiv.org/abs/2401.00001v2",
    });
  });
  it("never invents formal evidence or consumes a body for empty search", async () => {
    const { run, researchSourceBudget } = await executeScenario({
      empty: true,
    });
    expect(run.evidence).toEqual([]);
    expect(researchSourceBudget.remainingSourceBodies).toBe(1);
  });
  it("rejects changed definitions before dispatch and budget use", async () => {
    const { run, researchQueryBudget } = await executeScenario({
      changed: true,
    });
    expect(mocks.executePluginFunction).not.toHaveBeenCalled();
    expect(run.evidence).toEqual([]);
    expect(researchQueryBudget.remainingQueries).toBe(1);
  });
});
