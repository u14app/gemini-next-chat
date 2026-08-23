import { describe, expect, it } from "vitest";
import {
  buildMcpToolFunctionName,
  createMcpToolDescriptorV2,
  normalizeMcpRegistryServers,
  normalizeMcpToolFunctions,
} from "../lib/mcp/registry";

describe("MCP registry normalization", () => {
  it("prefers streamable HTTP when a server also declares legacy SSE", () => {
    const plugins = normalizeMcpRegistryServers({
      servers: [
        {
          server: {
            name: "io.github/context7",
            version: "1.2.3",
            description: "Context-aware docs lookup.",
            remotes: [
              { type: "sse", url: "https://mcp.example.com/sse" },
              {
                type: "streamable-http",
                url: "http://192.168.1.10/mcp",
              },
            ],
            repository: { url: "https://github.com/example/context7" },
          },
        },
        {
          server: {
            name: "local-only",
            version: "1.0.0",
            description: "No remote transport.",
            packages: [{ registryType: "npm", identifier: "local-only" }],
          },
        },
      ],
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      id: "mcp:io.github/context7:1.2.3",
      source: "mcp",
      title: "io.github/context7",
      description: "Context-aware docs lookup.",
      logoUrl: "/mcp-logo.svg",
      manifestUrl:
        "https://registry.modelcontextprotocol.io/v0.1/servers/io.github%2Fcontext7/versions/1.2.3",
      externalDocsUrl: "https://github.com/example/context7",
      category: "MCP",
      functions: [],
      auth: { type: "none", required: false },
      mcp: {
        transport: "streamable-http",
        serverUrl: "http://192.168.1.10/mcp",
        serverName: "io.github/context7",
        serverVersion: "1.2.3",
        toolNameMap: {},
      },
    });
  });

  it("maps legacy SSE-only remote servers to plugin cards", () => {
    const plugins = normalizeMcpRegistryServers({
      servers: [
        {
          server: {
            name: "io.github/legacy-search",
            version: "1.0.0",
            description: "Legacy SSE search.",
            remotes: [
              {
                type: "sse",
                url: "https://mcp.example.com/sse",
              },
            ],
          },
        },
      ],
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      id: "mcp:io.github/legacy-search:1.0.0",
      mcp: {
        transport: "sse",
        serverUrl: "https://mcp.example.com/sse",
      },
    });
  });

  it("preserves registry-provided MCP logos over the default", () => {
    const plugins = normalizeMcpRegistryServers({
      servers: [
        {
          server: {
            name: "io.github/branded",
            version: "1.0.0",
            iconUrl: "https://example.com/mcp.svg",
            remotes: [
              {
                type: "streamable-http",
                url: "https://mcp.example.com/mcp",
              },
            ],
          },
        },
      ],
    });

    expect(plugins[0]?.logoUrl).toBe("https://example.com/mcp.svg");
  });

  it("builds stable MCP tool names within the chat tool schema limit", () => {
    const shortName = buildMcpToolFunctionName(
      "io.github/context7",
      "resolve-library-id",
    );
    const longName = buildMcpToolFunctionName(
      "vendor/" + "x".repeat(120),
      "tool-" + "y".repeat(120),
    );

    expect(shortName).toBe("mcp_io_github_context7__resolve_library_id");
    expect(longName).toMatch(/^mcp_vendor_x+__tool_y+_[a-f0-9]{8}$/);
    expect(longName.length).toBeLessThanOrEqual(128);
    expect(longName).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("maps MCP tools to plugin functions and preserves original tool names", () => {
    const functions = normalizeMcpToolFunctions("io.github/context7", [
      {
        name: "resolve-library-id",
        description: "Resolve an npm package to a Context7 library id.",
        inputSchema: {
          type: "object",
          properties: { libraryName: { type: "string" } },
          required: ["libraryName"],
        },
      },
      {
        name: "resolve library id",
        description: "",
        inputSchema: { type: "object" },
      },
    ]);

    expect(functions).toEqual([
      {
        name: "mcp_io_github_context7__resolve_library_id",
        mcpToolName: "resolve-library-id",
        description: "Resolve an npm package to a Context7 library id.",
        parameters: {
          type: "object",
          properties: { libraryName: { type: "string" } },
          required: ["libraryName"],
        },
        mcpPolicyHint: {
          version: 2,
          effects: ["external_destructive"],
          idempotency: "unknown",
          sensitivity: "unknown",
          origin: "mcp",
        },
        risk: "external",
      },
      {
        name: expect.stringMatching(
          /^mcp_io_github_context7__resolve_library_id_[a-f0-9]{8}$/,
        ),
        mcpToolName: "resolve library id",
        description: "Call the MCP tool resolve library id.",
        parameters: { type: "object" },
        mcpPolicyHint: {
          version: 2,
          effects: ["external_destructive"],
          idempotency: "unknown",
          sensitivity: "unknown",
          origin: "mcp",
        },
        risk: "external",
      },
    ]);
  });

  it("preserves bounded MCP tool metadata as untrusted policy hints", () => {
    const [tool] = normalizeMcpToolFunctions("calendar", [
      {
        name: "list-events",
        title: "List events",
        description: "List calendar events.",
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          properties: { events: { type: "array" } },
        },
        icons: [
          {
            src: "https://example.com/calendar.svg",
            mimeType: "image/svg+xml",
            sizes: ["any"],
            theme: "light",
          },
        ],
        annotations: {
          title: "Calendar listing",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ]);

    expect(tool).toMatchObject({
      title: "List events",
      icons: [
        {
          src: "https://example.com/calendar.svg",
          mimeType: "image/svg+xml",
          sizes: ["any"],
          theme: "light",
        },
      ],
      annotations: {
        title: "Calendar listing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: {
        type: "object",
        properties: { events: { type: "array" } },
      },
      mcpPolicyHint: {
        version: 2,
        effects: ["network_read"],
        idempotency: "idempotent",
        sensitivity: "unknown",
        origin: "mcp",
        openWorld: false,
      },
      risk: "external",
    });
  });

  it("defaults absent or incomplete MCP hints to destructive", () => {
    expect(createMcpToolDescriptorV2()).toMatchObject({
      effects: ["external_destructive"],
      idempotency: "unknown",
      origin: "mcp",
    });
    expect(
      createMcpToolDescriptorV2({
        destructiveHint: false,
        openWorldHint: false,
      }),
    ).toMatchObject({
      effects: ["external_destructive"],
      openWorld: false,
    });
    expect(
      createMcpToolDescriptorV2({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      }),
    ).toMatchObject({
      effects: ["external_write"],
      idempotency: "non_idempotent",
    });
  });

  it("caps MCP tools to the plugin function limit", () => {
    const functions = normalizeMcpToolFunctions(
      "io.github/large",
      Array.from({ length: 25 }, (_, index) => ({
        name: `tool-${index}`,
        description: `Tool ${index}`,
        inputSchema: { type: "object" },
      })),
    );

    expect(functions).toHaveLength(20);
  });

  it("maps remote header auth and static headers from registry metadata", () => {
    const plugins = normalizeMcpRegistryServers({
      servers: [
        {
          server: {
            name: "io.github/private-docs",
            version: "1.0.0",
            description: "Private docs lookup.",
            remotes: [
              {
                type: "streamable-http",
                url: "https://mcp.example.com/mcp",
                headers: [
                  {
                    name: "Authorization",
                    isRequired: true,
                    isSecret: true,
                  },
                  {
                    name: "X-Client",
                    value: "neo-chat",
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(plugins[0]).toMatchObject({
      auth: {
        type: "bearer",
        name: "Authorization",
        in: "header",
        required: true,
      },
      mcp: {
        headers: {
          "X-Client": "neo-chat",
        },
      },
    });
  });

  it("skips remote MCP endpoints with unresolved URL variables", () => {
    const plugins = normalizeMcpRegistryServers({
      servers: [
        {
          server: {
            name: "io.github/tenant-docs",
            version: "1.0.0",
            description: "Tenant docs lookup.",
            remotes: [
              {
                type: "streamable-http",
                url: "https://mcp.example.com/{tenant}/mcp",
                variables: {
                  tenant: { isRequired: true },
                },
              },
            ],
          },
        },
      ],
    });

    expect(plugins).toEqual([]);
  });
});
