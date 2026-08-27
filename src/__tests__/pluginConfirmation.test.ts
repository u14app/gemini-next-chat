import { describe, expect, it } from "vitest";

import { normalizeSessionConfig } from "../lib/chat/entities";
import {
  canPersistToolApproval,
  createPluginFunctionFingerprint,
  matchesToolSessionApproval,
  normalizeToolConfirmationDecision,
  redactSensitiveToolArgs,
  requiresToolConfirmation,
} from "../lib/plugin/confirmation";
import { getPluginFunctionRisk } from "../lib/plugin/risk";
import type { Plugin, ToolSessionApproval } from "../types";

const plugin: Plugin = {
  id: "writer",
  title: "Writer",
  description: "Writes records",
  logoUrl: "",
  manifestUrl: "https://example.com/plugin.json",
  baseUrl: "https://example.com",
  functions: [
    {
      name: "create_record",
      description: "Create a record",
      method: "POST",
      path: "/records",
      parameters: { type: "object", properties: { title: { type: "string" } } },
    },
  ],
};

describe("plugin confirmation policy", () => {
  it("treats the transport method as a minimum risk floor", () => {
    expect(getPluginFunctionRisk({ method: "POST", risk: "read" })).toBe(
      "write",
    );
    expect(getPluginFunctionRisk({ method: "DELETE", risk: "read" })).toBe(
      "destructive",
    );
    expect(getPluginFunctionRisk({ method: "GET", risk: "write" })).toBe(
      "write",
    );
    expect(getPluginFunctionRisk({ risk: "read" })).toBe("external");
  });
  it("requires opt-in confirmation only for destructive risks", () => {
    expect(requiresToolConfirmation("read")).toBe(false);
    expect(requiresToolConfirmation("write", true)).toBe(false);
    expect(requiresToolConfirmation("external", true)).toBe(false);
    expect(requiresToolConfirmation("destructive")).toBe(false);
    expect(requiresToolConfirmation("destructive", true)).toBe(true);
  });

  it("never persists destructive approval", () => {
    expect(canPersistToolApproval("write")).toBe(true);
    expect(canPersistToolApproval("external")).toBe(true);
    expect(canPersistToolApproval("destructive")).toBe(false);
    expect(
      normalizeToolConfirmationDecision("allow_session", "destructive"),
    ).toBe("allow_once");
  });

  it("builds a stable fingerprint that changes with the execution contract", async () => {
    const first = await createPluginFunctionFingerprint(
      plugin,
      plugin.functions[0],
    );
    const same = await createPluginFunctionFingerprint(
      { ...plugin },
      { ...plugin.functions[0] },
    );
    const changed = await createPluginFunctionFingerprint(plugin, {
      ...plugin.functions[0],
      path: "/records/v2",
    });

    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it("includes MCP output and policy contracts in the fingerprint", async () => {
    const mcpPlugin: Plugin = {
      ...plugin,
      id: "mcp-writer",
      source: "mcp",
      functions: [],
      mcp: {
        transport: "streamable-http",
        serverUrl: "https://example.com/mcp",
        serverName: "Writer MCP",
      },
    };
    const mcpFunction = {
      name: "mcp_writer__create_record",
      mcpToolName: "create_record",
      description: "Create a record",
      parameters: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      mcpPolicyHint: {
        version: 2 as const,
        effects: ["external_write"] as const,
        idempotency: "non_idempotent" as const,
        sensitivity: "unknown" as const,
        origin: "mcp" as const,
      },
      risk: "external" as const,
    };

    const first = await createPluginFunctionFingerprint(mcpPlugin, mcpFunction);
    const changed = await createPluginFunctionFingerprint(mcpPlugin, {
      ...mcpFunction,
      mcpPolicyHint: {
        ...mcpFunction.mcpPolicyHint,
        effects: ["external_destructive"] as const,
      },
    });

    expect(changed).not.toBe(first);
  });

  it("redacts sensitive fields without changing ordinary arguments", () => {
    expect(
      redactSensitiveToolArgs({
        title: "Draft",
        authToken: "secret-token",
        nested: { api_key: "secret-key", count: 2 },
      }),
    ).toEqual({
      title: "Draft",
      authToken: "[REDACTED]",
      nested: { api_key: "[REDACTED]", count: 2 },
    });
  });

  it("redacts auth containers and credentials embedded in URLs", () => {
    const redacted = redactSensitiveToolArgs({
      title: "Draft",
      auth: { value: "secret" },
      headers: { "X-Custom-Credential": "secret" },
      callbackUrl:
        "https://user:pass@example.com/callback?keep=1&X-Amz-Credential=aws&token=session&api_token=api&auth_token=auth&bearer_token=bearer&x-api-key=x-api&subscription-key=subscription#access_token=fragment",
    }) as Record<string, unknown>;

    expect(redacted.auth).toBe("[REDACTED]");
    expect(redacted.headers).toBe("[REDACTED]");
    expect(redacted.callbackUrl).toBe(
      "https://example.com/callback?keep=1&X-Amz-Credential=%5BREDACTED%5D&token=%5BREDACTED%5D&api_token=%5BREDACTED%5D&auth_token=%5BREDACTED%5D&bearer_token=%5BREDACTED%5D&x-api-key=%5BREDACTED%5D&subscription-key=%5BREDACTED%5D",
    );
  });

  it("normalizes, deduplicates, and limits session approvals to safe risks", () => {
    const approval: ToolSessionApproval = {
      pluginId: "writer",
      functionName: "create_record",
      functionFingerprint: "v1:abc",
      risk: "write",
      approvedAt: 123.9,
    };
    const normalized = normalizeSessionConfig({
      toolApprovals: [
        approval,
        { ...approval, approvedAt: 456 },
        { ...approval, risk: "destructive" },
      ],
    });

    expect(normalized?.toolApprovals).toEqual([
      { ...approval, approvedAt: 123 },
    ]);
    expect(
      matchesToolSessionApproval(normalized!.toolApprovals![0], {
        pluginId: "writer",
        functionName: "create_record",
        functionFingerprint: "v1:abc",
        risk: "write",
      }),
    ).toBe(true);
  });

  it("normalizes session research defaults within host limits", () => {
    const normalized = normalizeSessionConfig({
      researchBudgetPreset: "deep",
      researchStrategy: {
        initialBreadth: 99,
        maxDepth: 0,
        maxQueries: 24.9,
        resultsPerQuery: 2,
      },
    });

    expect(normalized?.researchBudgetPreset).toBe("deep");
    expect(normalized?.researchStrategy).toEqual({
      initialBreadth: 8,
      maxDepth: 1,
      maxQueries: 24,
      resultsPerQuery: 3,
    });
    expect(normalizeSessionConfig({})?.researchStrategy).toBeUndefined();
  });
});
