import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { EncryptedSecretEnvelopeSchema } from "@/lib/api/schemas";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import {
  getMcpPrompt,
  inspectMcpServer,
  listMcpPrompts,
  listMcpResources,
  listMcpResourceTemplates,
  readMcpResource,
} from "@/lib/mcp/client";
import { isPluginAuthRequired } from "@/lib/plugin/config";
import {
  getServerPlugin,
  registerServerPlugin,
} from "@/lib/plugin/serverRegistry";
import { decryptOptionalSecret } from "@/lib/byok/server";
import { getDeploymentMode } from "@/lib/security/deployment";
import { safeServerLogError } from "@/lib/utils/safeServerLog";
import type { Plugin } from "@/types";

const AuthSchema = z
  .object({
    type: z.enum(["bearer", "apiKey", "none", "oauth2"]).optional(),
    valueSecret: EncryptedSecretEnvelopeSchema.optional(),
    key: z.string().max(120).optional(),
    addTo: z.enum(["header", "query"]).optional(),
  })
  .strict()
  .optional();

const RequestSchema = z
  .object({
    pluginId: z.string().min(1).max(160),
    operation: z.enum([
      "inspect",
      "resources_list",
      "resource_templates_list",
      "resource_read",
      "prompts_list",
      "prompt_get",
    ]),
    params: z
      .object({
        cursor: z.string().max(4_096).optional(),
        uri: z.string().max(8_192).optional(),
        name: z.string().max(256).optional(),
        arguments: z.record(z.string(), z.string().max(20_000)).optional(),
      })
      .strict()
      .default({}),
    authConfig: AuthSchema,
    localPlugin: z.unknown().optional(),
  })
  .strict();

function getAuthType(plugin: Plugin, authConfig: z.infer<typeof AuthSchema>) {
  if (authConfig?.type) return authConfig.type;
  const type = plugin.auth?.type;
  return type === "bearer" ||
    type === "apiKey" ||
    type === "oauth2" ||
    type === "none"
    ? type
    : undefined;
}

function isLocalMcpPlugin(value: unknown): value is Plugin {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plugin = value as Partial<Plugin>;
  return (
    typeof plugin.id === "string" &&
    plugin.source === "mcp" &&
    typeof plugin.mcp?.serverUrl === "string" &&
    Array.isArray(plugin.functions)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = RequestSchema.parse(await readJsonRequestBody(request));
    let plugin = await getServerPlugin(body.pluginId);
    if (
      !plugin &&
      getDeploymentMode() !== "hosted" &&
      isLocalMcpPlugin(body.localPlugin) &&
      body.localPlugin.id === body.pluginId
    ) {
      await registerServerPlugin(body.localPlugin);
      plugin = body.localPlugin;
    }
    if (!plugin || plugin.source !== "mcp" || !plugin.mcp?.serverUrl) {
      return NextResponse.json(
        {
          error: "MCP server is not registered",
          code: "MCP_SERVER_NOT_REGISTERED",
        },
        { status: 404 },
      );
    }
    const authValue = await decryptOptionalSecret(
      body.authConfig?.valueSecret,
      BYOK_CONTEXTS.pluginAuth(plugin.id),
    );
    if (isPluginAuthRequired(plugin) && !authValue) {
      return NextResponse.json(
        {
          error: "Plugin authentication is required",
          code: "MCP_AUTH_REQUIRED",
        },
        { status: 400 },
      );
    }
    const common = {
      serverUrl: plugin.mcp.serverUrl,
      transport: plugin.mcp.transport,
      staticHeaders: plugin.mcp.headers,
      authConfig: {
        type: getAuthType(plugin, body.authConfig),
        value: authValue,
        key: body.authConfig?.key || plugin.auth?.name,
        addTo: body.authConfig?.addTo || plugin.auth?.in,
      },
      signal: request.signal,
    };
    let result: unknown;
    switch (body.operation) {
      case "inspect":
        result = await inspectMcpServer(common);
        break;
      case "resources_list":
        result = await listMcpResources({
          ...common,
          ...(body.params.cursor !== undefined
            ? { cursor: body.params.cursor }
            : {}),
        });
        break;
      case "resource_templates_list":
        result = await listMcpResourceTemplates({
          ...common,
          ...(body.params.cursor !== undefined
            ? { cursor: body.params.cursor }
            : {}),
        });
        break;
      case "resource_read":
        if (!body.params.uri) {
          return NextResponse.json(
            { error: "Resource URI is required", code: "MCP_URI_REQUIRED" },
            { status: 400 },
          );
        }
        result = await readMcpResource({ ...common, uri: body.params.uri });
        break;
      case "prompts_list":
        result = await listMcpPrompts({
          ...common,
          ...(body.params.cursor !== undefined
            ? { cursor: body.params.cursor }
            : {}),
        });
        break;
      case "prompt_get":
        if (!body.params.name) {
          return NextResponse.json(
            { error: "Prompt name is required", code: "MCP_PROMPT_REQUIRED" },
            { status: 400 },
          );
        }
        result = await getMcpPrompt({
          ...common,
          name: body.params.name,
          args: body.params.arguments,
        });
        break;
    }
    return NextResponse.json({ result });
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return new Response(null, { status: 499 });
    }
    safeServerLogError("MCP capability request failed", error);
    return createApiErrorResponse(error, "MCP capability request failed");
  }
}
