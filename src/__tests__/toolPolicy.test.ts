import { describe, expect, it } from "vitest";

import {
  canPersistInvocationApproval,
  createToolApprovalIdentity,
  evaluateToolInvocationApproval,
  matchesToolApprovalIdentity,
} from "../lib/plugin/confirmation";
import { getPluginFunctionInvocationPolicy } from "../lib/plugin/risk";
import { createFetchUrlBinding } from "../services/api/chat/builtinTools/fetchUrl";
import { createJavaScriptBinding } from "../services/api/chat/builtinTools/javascript";
import {
  resolveBuiltinToolInvocationPolicy,
  type BuiltinToolBinding,
} from "../services/api/chat/builtinTools/types";
import { createWorkspaceBindings } from "../services/api/chat/builtinTools/workspace";

function workspaceBinding(name: string): BuiltinToolBinding {
  const binding = createWorkspaceBindings().find(
    (candidate) => candidate.definition.function.name === name,
  );
  if (!binding) throw new Error(`Missing workspace binding: ${name}`);
  return binding;
}

describe("tool invocation policy", () => {
  it("maps plugin methods to V2 effects while preserving legacy semantics", () => {
    expect(
      getPluginFunctionInvocationPolicy(
        { name: "lookup", method: "GET", risk: "read" },
        { args: { query: "weather" } },
      ),
    ).toEqual({
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "plugin",
    });

    expect(
      getPluginFunctionInvocationPolicy(
        { name: "create_draft", method: "POST", risk: "read" },
        { args: { title: "Draft" } },
      ),
    ).toMatchObject({
      effects: ["external_write"],
      idempotency: "non_idempotent",
    });

    expect(
      getPluginFunctionInvocationPolicy({
        name: "remove_record",
        method: "DELETE",
        risk: "read",
      }),
    ).toMatchObject({
      effects: ["external_destructive"],
      idempotency: "idempotent",
    });
  });

  it("detects credentials in plugin invocation arguments", () => {
    expect(
      getPluginFunctionInvocationPolicy(
        { name: "lookup", method: "GET" },
        {
          args: {
            url: "https://example.com/data?api_key=secret",
          },
        },
      ).sensitivity,
    ).toBe("credentials");
  });

  it("keeps MCP hints conservative until independently verified", () => {
    expect(
      getPluginFunctionInvocationPolicy(
        { name: "unknown", mcpToolName: "unknown", risk: "external" },
        { origin: "mcp" },
      ),
    ).toEqual({
      effects: ["external_destructive"],
      idempotency: "unknown",
      sensitivity: "unknown",
      origin: "mcp",
    });
    expect(
      getPluginFunctionInvocationPolicy(
        {
          mcpToolName: "lookup",
          name: "lookup",
          risk: "external",
          mcpPolicyHint: {
            version: 2,
            effects: ["network_read"],
            idempotency: "idempotent",
            sensitivity: "unknown",
            origin: "mcp",
          },
        },
        { args: { query: "docs" }, origin: "mcp" },
      ),
    ).toEqual({
      effects: ["external_destructive"],
      idempotency: "unknown",
      sensitivity: "user_data",
      origin: "mcp",
    });
    expect(
      getPluginFunctionInvocationPolicy(
        {
          mcpToolName: "lookup",
          name: "lookup",
          risk: "external",
          mcpPolicyHint: {
            version: 2,
            effects: ["network_read"],
            idempotency: "idempotent",
            sensitivity: "unknown",
            origin: "mcp",
          },
        },
        {
          args: { query: "docs" },
          origin: "mcp",
          useVerifiedMcpPolicyHint: true,
        },
      ),
    ).toEqual({
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "mcp",
    });
  });

  it("classifies payment, publication, permission, and irreversible send operations conservatively", () => {
    for (const name of [
      "charge_card",
      "publish_post",
      "grant_role",
      "send_email",
    ]) {
      expect(
        getPluginFunctionInvocationPolicy({ name, method: "POST" }).effects,
      ).toEqual(["external_destructive"]);
    }
    expect(
      getPluginFunctionInvocationPolicy({
        name: "update_record",
        method: "PATCH",
        path: "/drafts/1",
      }).effects,
    ).toEqual(["external_write"]);
  });

  it("classifies dynamic built-in effects without changing legacy risk", () => {
    const javascript = createJavaScriptBinding();
    expect(javascript.risk).toBe("read");
    expect(
      resolveBuiltinToolInvocationPolicy(javascript, {
        code: "return 1",
      }),
    ).toMatchObject({ effects: ["local_read"], idempotency: "idempotent" });
    expect(
      resolveBuiltinToolInvocationPolicy(javascript, {
        code: "writeFile('out.txt', 'ok')",
        writeFiles: true,
      }),
    ).toMatchObject({
      effects: ["local_write"],
      idempotency: "unknown",
    });

    expect(
      resolveBuiltinToolInvocationPolicy(createFetchUrlBinding(), {
        url: "https://example.com",
        saveToPath: "sources/page.md",
      }).effects,
    ).toEqual(["network_read", "local_write"]);
    expect(
      resolveBuiltinToolInvocationPolicy(createFetchUrlBinding(), {
        url: "https://example.com/data?token=secret",
      }).sensitivity,
    ).toBe("credentials");
  });

  it("classifies append, overwrite-move, and delete workspace calls", () => {
    expect(
      resolveBuiltinToolInvocationPolicy(
        workspaceBinding("write_workspace_file"),
        { path: "notes.md", content: "next", mode: "append" },
      ).idempotency,
    ).toBe("non_idempotent");
    expect(
      resolveBuiltinToolInvocationPolicy(
        workspaceBinding("write_workspace_file"),
        { path: "notes.md", content: "replacement" },
      ).effects,
    ).toEqual(["local_write"]);

    expect(
      resolveBuiltinToolInvocationPolicy(
        workspaceBinding("move_workspace_file"),
        { from: "a.md", to: "b.md", overwrite: true },
      ).effects,
    ).toEqual(["local_write"]);

    expect(
      resolveBuiltinToolInvocationPolicy(
        workspaceBinding("delete_workspace_file"),
        { path: "notes.md" },
      ).effects,
    ).toEqual(["local_destructive"]);
  });
});

describe("tool approval profiles", () => {
  const trustedExternalWrite = {
    effects: ["external_write"] as const,
    idempotency: "idempotent" as const,
    sensitivity: "user_data" as const,
    origin: "plugin" as const,
  };

  it("allows verified writes only in permissive mode", () => {
    const trusted = { originTrusted: true, policyVerified: true };
    expect(
      evaluateToolInvocationApproval(trustedExternalWrite, {
        profile: "permissive",
      }),
    ).toEqual({
      requiresConfirmation: true,
      canPersist: true,
      reason: "external_write",
    });
    expect(
      evaluateToolInvocationApproval(trustedExternalWrite, {
        profile: "permissive",
        ...trusted,
      }),
    ).toEqual({
      requiresConfirmation: false,
      canPersist: false,
      reason: "automatic",
    });
    expect(
      evaluateToolInvocationApproval(trustedExternalWrite, {
        profile: "balanced",
        ...trusted,
      }),
    ).toEqual({
      requiresConfirmation: true,
      canPersist: true,
      reason: "external_write",
    });
  });

  it("requires strict confirmation for local writes", () => {
    const localWrite = {
      ...trustedExternalWrite,
      effects: ["local_write"] as const,
      origin: "builtin" as const,
    };
    expect(
      evaluateToolInvocationApproval(localWrite, { profile: "balanced" })
        .requiresConfirmation,
    ).toBe(false);
    expect(
      evaluateToolInvocationApproval(localWrite, { profile: "strict" }),
    ).toEqual({
      requiresConfirmation: true,
      canPersist: true,
      reason: "local_write",
    });
    expect(
      evaluateToolInvocationApproval(
        {
          ...localWrite,
          effects: ["network_read"],
        },
        { profile: "strict" },
      ).requiresConfirmation,
    ).toBe(false);
  });

  it("always handles unknown MCP tools conservatively", () => {
    const unknownMcp = {
      ...trustedExternalWrite,
      idempotency: "unknown" as const,
      sensitivity: "unknown" as const,
      origin: "mcp" as const,
    };
    expect(
      evaluateToolInvocationApproval(unknownMcp, { profile: "permissive" }),
    ).toEqual({
      requiresConfirmation: true,
      canPersist: false,
      reason: "unknown_mcp",
    });
    expect(canPersistInvocationApproval(unknownMcp)).toBe(false);
  });

  it("never persists destructive or credential-bearing outbound approval", () => {
    expect(
      evaluateToolInvocationApproval({
        ...trustedExternalWrite,
        effects: ["external_destructive"],
      }),
    ).toEqual({
      requiresConfirmation: true,
      canPersist: false,
      reason: "destructive_effect",
    });
    expect(
      evaluateToolInvocationApproval({
        ...trustedExternalWrite,
        effects: ["network_read"],
        sensitivity: "credentials",
      }),
    ).toEqual({
      requiresConfirmation: true,
      canPersist: false,
      reason: "credential_exposure",
    });
  });
});

describe("tool approval identity", () => {
  it("is deterministic, target-scoped, and redacts URL credentials", () => {
    const identity = createToolApprovalIdentity({
      origin: "plugin",
      providerId: "calendar",
      toolName: "create_event",
      toolFingerprint: "v2:abc",
      effects: ["external_write", "network_read", "external_write"],
      targetScope:
        "https://example.com/calendar?token=secret&calendar=personal",
    });
    const same = createToolApprovalIdentity({
      origin: "plugin",
      providerId: "calendar",
      toolName: "create_event",
      toolFingerprint: "v2:abc",
      effects: ["network_read", "external_write"],
      targetScope:
        "https://example.com/calendar?token=secret&calendar=personal",
    });
    const anotherTarget = { ...same, targetScope: "calendar:work" };

    expect(identity.effects).toEqual(["network_read", "external_write"]);
    expect(identity.targetScope).not.toContain("secret");
    expect(matchesToolApprovalIdentity(identity, same)).toBe(true);
    expect(matchesToolApprovalIdentity(identity, anotherTarget)).toBe(false);
  });
});
