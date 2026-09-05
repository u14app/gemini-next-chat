import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGNES_VIDEO_PLUGIN, JINA_READER_PLUGIN } from "../config/plugins";
import { executePluginFunction } from "../utils/pluginUtils";
import { createPluginFunctionFingerprint } from "../lib/plugin/confirmation";
import { getPluginFunctionRisk } from "../lib/plugin/risk";
import type { Plugin } from "../types";
import { normalizeToolResultEnvelope } from "../lib/agent/toolResult";

const mockStore = vi.hoisted(() => ({
  state: {
    installedPlugins: [] as Plugin[],
    pluginConfigs: {},
  },
}));

vi.mock("../store/core/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mockStore.state,
  },
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

const plugin: Plugin = {
  id: "test-plugin",
  title: "Test Plugin",
  description: "",
  logoUrl: "",
  manifestUrl: "",
  baseUrl: "https://api.example.com",
  functions: [
    {
      name: "lookup",
      description: "Lookup",
      path: "/lookup",
      method: "GET",
      parameters: { type: "object", properties: {} },
    },
  ],
  auth: { type: "none" },
};

describe("plugin execution utility", () => {
  beforeEach(() => {
    mockStore.state = {
      installedPlugins: [plugin],
      pluginConfigs: {},
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns a stable error when plugin execution response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad Gateway</html>")),
    );

    await expect(executePluginFunction("lookup", {})).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_EXECUTION_FAILED",
        message: "Error: Plugin execution failed",
      },
    });
  });

  it("keeps Reader challenge failures out of successful Research tool results", async () => {
    mockStore.state.installedPlugins = [JINA_READER_PLUGIN];
    const fetch = vi.fn(async () =>
      Response.json(
        {
          error: "The webpage requires human verification.",
          code: "WEB_PAGE_CHALLENGE",
          statusCode: 502,
        },
        { status: 502 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await executePluginFunction("read_webpage", {
      url: "https://example.com/article",
    });
    expect(
      normalizeToolResultEnvelope(result, {
        trust: "external_untrusted",
        provenance: { origin: "plugin", toolName: "read_webpage" },
      }),
    ).toMatchObject({ ok: false, error: { code: "WEB_PAGE_CHALLENGE" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("marks a failed mutating dispatch as an unknown external effect", async () => {
    mockStore.state = {
      installedPlugins: [
        {
          ...plugin,
          functions: [{ ...plugin.functions[0], method: "POST" }],
        },
      ],
      pluginConfigs: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection reset");
      }),
    );

    await expect(executePluginFunction("lookup", {})).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_EXECUTION_FAILED",
        effectUnknown: true,
        recoverable: false,
      },
    });
  });

  it("maps MCP isError results to the explicit failure contract", async () => {
    mockStore.state = {
      installedPlugins: [
        {
          ...plugin,
          source: "mcp",
          functions: [
            {
              ...plugin.functions[0],
              method: undefined,
              mcpToolName: "lookup",
            },
          ],
          mcp: {
            transport: "streamable-http",
            serverUrl: "https://mcp.example.com/mcp",
            serverName: "Example MCP",
          },
        },
      ],
      pluginConfigs: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                isError: true,
                error: "No access",
                content: [{ type: "text", text: "No access" }],
              },
            }),
          ),
      ),
    );

    await expect(executePluginFunction("lookup", {})).resolves.toMatchObject({
      ok: false,
      error: { code: "MCP_TOOL_ERROR", message: "No access" },
    });
  });

  it("rejects unsafe plugin arguments before dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      executePluginFunction("lookup", circular),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_ARGUMENTS_INVALID",
        message: "Plugin arguments must not contain circular references.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects ambiguous function execution when multiple active plugins expose the same name", async () => {
    const duplicatePlugin: Plugin = {
      ...plugin,
      id: "duplicate-plugin",
      title: "Duplicate Plugin",
    };
    mockStore.state = {
      installedPlugins: [plugin, duplicatePlugin],
      pluginConfigs: {},
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executePluginFunction("lookup", {}, undefined, [
        plugin.id,
        duplicatePlugin.id,
      ]),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_FUNCTION_AMBIGUOUS",
        message:
          "Function lookup is provided by multiple active plugins: test-plugin, duplicate-plugin.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the expected function definition has changed", async () => {
    const confirmedFunction = plugin.functions[0];
    const functionFingerprint = await createPluginFunctionFingerprint(
      plugin,
      confirmedFunction,
    );
    mockStore.state = {
      installedPlugins: [
        {
          ...plugin,
          functions: [{ ...confirmedFunction, path: "/changed" }],
        },
      ],
      pluginConfigs: {},
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executePluginFunction("lookup", {}, undefined, [plugin.id], undefined, {
        pluginId: plugin.id,
        functionFingerprint,
        risk: getPluginFunctionRisk(confirmedFunction),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        message:
          "Plugin function definition changed before execution. Review the updated tool before trying again.",
        code: "TOOL_DEFINITION_CHANGED",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not bypass server confirmation checks after a primary 404", async () => {
    const confirmedFunction = plugin.functions[0];
    const functionFingerprint = await createPluginFunctionFingerprint(
      plugin,
      confirmedFunction,
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Plugin is not registered on the server.",
          code: "PLUGIN_NOT_REGISTERED",
        }),
        { status: 404 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executePluginFunction("lookup", {}, undefined, [plugin.id], undefined, {
        pluginId: plugin.id,
        functionFingerprint,
        risk: getPluginFunctionRisk(confirmedFunction),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        message: "Plugin is not registered on the server.",
        code: "PLUGIN_NOT_REGISTERED",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(
      expect.objectContaining({
        pluginId: plugin.id,
        functionName: confirmedFunction.name,
        expectedFingerprint: functionFingerprint,
      }),
    );
  });

  it("keeps the legacy 404 fallback for unconfirmed executions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Route not found" }), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { ok: true } })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(executePluginFunction("lookup", {})).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(
      expect.objectContaining({
        pluginId: plugin.id,
        functionName: "lookup",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual(
      expect.objectContaining({
        plugin: expect.objectContaining({ id: plugin.id }),
        functionDef: expect.objectContaining({ name: "lookup" }),
      }),
    );
  });

  it("passes saved plugin model defaults to backend execution", async () => {
    mockStore.state = {
      installedPlugins: [plugin],
      pluginConfigs: {
        [plugin.id]: {
          model: "provider-image-model",
        },
      },
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { ok: true },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(executePluginFunction("lookup", {})).resolves.toEqual({
      ok: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(
      expect.objectContaining({
        pluginId: plugin.id,
        functionName: "lookup",
        authConfig: {
          model: "provider-image-model",
        },
      }),
    );
  });

  it("returns Agnes video creation tasks without polling for the final result", async () => {
    mockStore.state = {
      installedPlugins: [AGNES_VIDEO_PLUGIN],
      pluginConfigs: {},
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            taskId: "task_1",
            videoId: null,
            status: "queued",
            generationStatus: "generating",
            progress: 0,
            videoUrl: null,
            error: null,
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const resultPromise = executePluginFunction(
      "create_video",
      {
        prompt: "A quiet neon control room",
      },
      undefined,
      undefined,
      controller.signal,
    );
    queueMicrotask(() => controller.abort());

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task_1",
      status: "queued",
      generationStatus: "generating",
      videoUrl: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
    ).toMatchObject({
      pluginId: AGNES_VIDEO_PLUGIN.id,
      functionName: "create_video",
      args: { prompt: "A quiet neon control room" },
    });
  });
});
