import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_EXECUTION_LIMITS } from "../config/limits";

const callMcpToolMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/mcp/client", () => ({
  callMcpTool: callMcpToolMock,
}));

describe("MCP executor", () => {
  beforeEach(() => {
    callMcpToolMock.mockReset();
  });

  it("maps MCP tool-level errors to the existing plugin error shape", async () => {
    callMcpToolMock.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "No access" }],
    });

    const { executeMcpToolRequest } = await import("../lib/mcp/executor");
    const result = await executeMcpToolRequest({
      serverUrl: "https://mcp.example.com/mcp",
      transport: "sse",
      toolName: "private-search",
      args: {},
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "No access" }],
      isError: true,
      error: "No access",
    });
    expect(callMcpToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ transport: "sse" }),
    );
  });

  it("truncates oversized MCP success results without marking them as errors", async () => {
    callMcpToolMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "x".repeat(PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars),
        },
      ],
    });

    const { executeMcpToolRequest } = await import("../lib/mcp/executor");
    const result = await executeMcpToolRequest({
      serverUrl: "https://mcp.example.com/mcp",
      toolName: "large-result",
      args: {},
    });

    expect(result).toMatchObject({ truncated: true });
    expect(result).not.toMatchObject({ isError: true });
    expect(result).not.toHaveProperty("error");
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars,
    );
  });

  it("preserves structured content and supported MCP content blocks", async () => {
    callMcpToolMock.mockResolvedValue({
      content: [
        { type: "text", text: "Found one result." },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "audio", data: "aGVsbG8=", mimeType: "audio/mpeg" },
        {
          type: "resource",
          resource: {
            uri: "file:///report.md",
            mimeType: "text/markdown",
            text: "# Report",
          },
        },
        {
          type: "resource_link",
          uri: "https://example.com/report",
          name: "report",
          title: "Report",
          mimeType: "text/html",
        },
        { type: "unsupported", value: "drop me" },
      ],
      structuredContent: { answer: "ok", count: 1 },
      _meta: { traceId: "trace-1" },
    });

    const { executeMcpToolRequest } = await import("../lib/mcp/executor");
    const result = await executeMcpToolRequest({
      serverUrl: "https://mcp.example.com/mcp",
      toolName: "rich-result",
      args: {},
    });

    expect(result).toEqual({
      content: [
        { type: "text", text: "Found one result." },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "audio", data: "aGVsbG8=", mimeType: "audio/mpeg" },
        {
          type: "resource",
          resource: {
            uri: "file:///report.md",
            mimeType: "text/markdown",
            text: "# Report",
          },
        },
        {
          type: "resource_link",
          uri: "https://example.com/report",
          name: "report",
          title: "Report",
          mimeType: "text/html",
        },
      ],
      structuredContent: { answer: "ok", count: 1 },
      _meta: { traceId: "trace-1" },
    });
  });
});
