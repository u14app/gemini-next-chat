import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function jsonRpcResponse(
  message: Record<string, unknown>,
  sessionId = "csp-test-session",
): Response {
  return new Response(JSON.stringify(message), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "mcp-session-id": sessionId,
    },
  });
}

function installStreamableHttpFixture(): typeof fetch {
  const fetchMock: typeof fetch = vi.fn(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        id?: number;
        method?: string;
      };

      if (request.method === "initialize") {
        return jsonRpcResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "csp-fixture", version: "1.0.0" },
          },
        });
      }

      if (request.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }

      if (request.method === "tools/list") {
        return jsonRpcResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [
              {
                name: "create-long-text",
                description: "Create a long-text content block.",
                inputSchema: {
                  type: "object",
                  properties: {
                    format: { type: "string" },
                    title: { type: "string" },
                  },
                  required: ["format", "title"],
                  additionalProperties: false,
                },
                outputSchema: {
                  type: "object",
                  properties: {
                    blockId: { type: "string" },
                  },
                  required: ["blockId"],
                  additionalProperties: false,
                },
              },
            ],
          },
        });
      }

      if (request.method === "tools/call") {
        return jsonRpcResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: "created" }],
            structuredContent: { blockId: 42 },
          },
        });
      }

      throw new Error(`Unexpected MCP request: ${request.method}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function blockDynamicCodeGeneration(): void {
  const nativeFunction = globalThis.Function;
  function blockedFunction() {
    throw new EvalError("Refused to evaluate a string as JavaScript");
  }
  blockedFunction.prototype = nativeFunction.prototype;
  vi.stubGlobal("Function", blockedFunction);
}

describe("MCP tool schema validation under CSP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("discovers tools with output schemas when Function is blocked", async () => {
    vi.resetModules();
    const fetchMock = installStreamableHttpFixture();
    blockDynamicCodeGeneration();

    const { discoverMcpTools } = await import("../lib/mcp/client");
    const result = await discoverMcpTools({
      serverUrl: "https://93.184.216.34/mcp",
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({
      transport: "streamable-http",
      tools: [
        {
          name: "create-long-text",
          outputSchema: {
            type: "object",
            required: ["blockId"],
          },
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects structured output that does not match the discovered schema", async () => {
    vi.resetModules();
    const fetchMock = installStreamableHttpFixture();
    blockDynamicCodeGeneration();

    const [
      { Client },
      { StreamableHTTPClientTransport },
      { CfWorkerJsonSchemaValidator },
    ] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
      import("@modelcontextprotocol/sdk/validation/cfworker"),
    ]);
    const client = new Client(
      { name: "csp-test-client", version: "1.0.0" },
      {
        capabilities: {},
        jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("https://93.184.216.34/mcp"),
      { fetch: fetchMock },
    );

    try {
      await client.connect(transport, { timeout: 5_000 });
      await client.listTools(undefined, { timeout: 5_000 });

      await expect(
        client.callTool(
          { name: "create-long-text", arguments: {} },
          undefined,
          { timeout: 5_000 },
        ),
      ).rejects.toThrow(/does not match the tool's output schema/i);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
