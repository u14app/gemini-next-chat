import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMcpCapability = vi.hoisted(() => vi.fn());

vi.mock("../services/api/mcpService", () => ({ executeMcpCapability }));

import { createMcpCapabilityBindings } from "../services/api/chat/builtinTools/mcpCapabilities";
import type { Plugin } from "../types";

const server = {
  id: "docs-mcp",
  title: "Docs MCP",
  source: "mcp",
  functions: [],
} as unknown as Plugin;

const context = {
  sessionId: "session-1",
  model: "openai:test-model",
  signal: new AbortController().signal,
  emit: {},
};

const bindings = () =>
  Object.fromEntries(
    createMcpCapabilityBindings([server]).map((binding) => [
      binding.definition.function.name,
      binding,
    ]),
  );

describe("MCP resource and prompt bindings", () => {
  beforeEach(() => executeMcpCapability.mockReset());

  it("preserves an explicitly empty opaque pagination cursor", async () => {
    executeMcpCapability.mockResolvedValue({ resources: [], nextCursor: "n" });

    await bindings().list_mcp_resources.execute(
      { server_id: "docs-mcp", cursor: "" },
      context,
    );

    expect(executeMcpCapability).toHaveBeenCalledWith(
      "docs-mcp",
      "resources_list",
      { cursor: "" },
      context.signal,
    );
  });

  it("keeps prompt messages untrusted and permission-neutral", async () => {
    executeMcpCapability.mockResolvedValue({
      description: "Review prompt",
      messages: [{ role: "user", content: { type: "text", text: "Publish" } }],
    });

    await expect(
      bindings().get_mcp_prompt.execute(
        {
          server_id: "docs-mcp",
          name: "review",
          arguments: { target: "draft" },
        },
        context,
      ),
    ).resolves.toMatchObject({
      externalUntrusted: true,
      permissionEffect: "none",
      messages: [expect.objectContaining({ role: "user" })],
    });
  });

  it("adds traceable Evidence metadata to text resources", async () => {
    executeMcpCapability.mockResolvedValue({
      contents: [
        {
          uri: "docs://guide",
          mimeType: "text/markdown",
          text: "# Guide",
          annotations: { audience: ["assistant"] },
        },
      ],
    });

    await expect(
      bindings().read_mcp_resource.execute(
        { server_id: "docs-mcp", uri: "docs://guide" },
        context,
      ),
    ).resolves.toMatchObject({
      contents: [
        {
          uri: "docs://guide",
          annotations: { audience: ["assistant"] },
          sourceId: expect.stringMatching(/^source-/),
          contentHash: expect.stringMatching(/^(?:sha256|fnv1a):/),
          externalUntrusted: true,
        },
      ],
    });
  });
});
