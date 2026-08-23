import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMcpToolRequestMock = vi.hoisted(() => vi.fn());
const decryptOptionalSecretMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/api/middleware", async () =>
  vi.importActual("../lib/api/middleware"),
);

vi.mock("@/lib/api/schemas", async () => vi.importActual("../lib/api/schemas"));

vi.mock("../lib/mcp/executor", () => ({
  executeMcpToolRequest: executeMcpToolRequestMock,
}));

vi.mock("@/lib/byok/server", () => ({
  decryptOptionalSecret: decryptOptionalSecretMock,
}));

vi.mock("@/lib/security/safeFetch", () => ({
  safeFetchText: vi.fn(),
}));

vi.mock("@/lib/security/deployment", async () =>
  vi.importActual("../lib/security/deployment"),
);

vi.mock("@/lib/utils/safeServerLog", () => ({
  safeServerLogError: vi.fn(),
}));

function createRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/plugins/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

describe("MCP plugin execute route", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMcpToolRequestMock.mockReset();
    decryptOptionalSecretMock.mockReset();
  });

  it("dispatches MCP plugin execution through the MCP executor", async () => {
    const controller = new AbortController();
    executeMcpToolRequestMock.mockResolvedValue({
      structuredContent: { answer: "ok" },
    });

    const { getServerPlugin, registerServerPlugin } =
      await import("../lib/plugin/serverRegistry");
    await registerServerPlugin({
      id: "mcp:io.github/context7:1.2.3",
      title: "io.github/context7",
      description: "",
      logoUrl: "",
      manifestUrl: "",
      source: "mcp",
      functions: [
        {
          name: "mcp_io_github_context7__resolve_library_id",
          mcpToolName: "resolve-library-id",
          description: "Resolve package docs.",
          parameters: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
          risk: "external",
        },
      ],
      auth: { type: "none", required: false },
      mcp: {
        transport: "streamable-http",
        serverUrl: "https://mcp.example.com/mcp",
        serverName: "io.github/context7",
        serverVersion: "1.2.3",
        headers: {
          "X-Client": "neo-chat",
        },
        toolNameMap: {
          mcp_io_github_context7__resolve_library_id: "resolve-library-id",
        },
      },
    });

    const registeredPlugin = await getServerPlugin(
      "mcp:io.github/context7:1.2.3",
    );
    const { createPluginFunctionFingerprint } =
      await import("../lib/plugin/confirmation");
    const expectedFingerprint = await createPluginFunctionFingerprint(
      registeredPlugin!,
      registeredPlugin!.functions[0],
    );
    const { POST } = await import("../app/api/plugins/execute/route");
    const request = createRequest(
      {
        pluginId: "mcp:io.github/context7:1.2.3",
        functionName: "mcp_io_github_context7__resolve_library_id",
        expectedFingerprint,
        args: { libraryName: "react" },
      },
      controller.signal,
    );
    const response = await POST(request as any);

    expect(response.status).toBe(200);
    expect(executeMcpToolRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://mcp.example.com/mcp",
        transport: "streamable-http",
        toolName: "resolve-library-id",
        args: { libraryName: "react" },
        signal: request.signal,
        staticHeaders: {
          "X-Client": "neo-chat",
        },
      }),
    );
    await expect(response.json()).resolves.toEqual({
      result: { structuredContent: { answer: "ok" } },
    });

    executeMcpToolRequestMock.mockResolvedValueOnce({
      structuredContent: { answer: 42 },
    });
    const invalidOutputResponse = await POST(
      createRequest({
        pluginId: "mcp:io.github/context7:1.2.3",
        functionName: "mcp_io_github_context7__resolve_library_id",
        expectedFingerprint,
        args: { libraryName: "react" },
      }) as any,
    );
    expect(invalidOutputResponse.status).toBe(502);
    await expect(invalidOutputResponse.json()).resolves.toMatchObject({
      code: "TOOL_OUTPUT_SCHEMA_INVALID",
    });

    const changedResponse = await POST(
      createRequest({
        pluginId: "mcp:io.github/context7:1.2.3",
        functionName: "mcp_io_github_context7__resolve_library_id",
        expectedFingerprint: "v1:outdated-confirmation",
        args: { libraryName: "react" },
      }) as any,
    );
    expect(changedResponse.status).toBe(409);
    await expect(changedResponse.json()).resolves.toMatchObject({
      code: "TOOL_DEFINITION_CHANGED",
    });
    expect(executeMcpToolRequestMock).toHaveBeenCalledTimes(2);
  });
});
