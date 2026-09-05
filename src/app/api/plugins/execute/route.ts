import { NextRequest, NextResponse } from "next/server";
import { isResearchSourceProvider } from "@/lib/plugin/researchSources/catalog";
import { executeResearchSourceRequest } from "@/lib/plugin/researchSources/server";
import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import {
  PluginExecutionRequestSchema,
  ToolExecutionSchema,
} from "@/lib/api/schemas";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import { executeMcpToolRequest } from "@/lib/mcp/executor";
import { isPluginAuthRequired } from "@/lib/plugin/config";
import { executePluginFunctionRequest } from "@/lib/plugin/pluginExecutionExecutor";
import {
  getServerPlugin,
  registerServerPlugin,
} from "@/lib/plugin/serverRegistry";
import { getDeploymentMode } from "@/lib/security/deployment";
import { decryptOptionalSecret } from "@/lib/byok/server";
import { safeFetchText } from "@/lib/security/safeFetch";
import { safeServerLogError } from "@/lib/utils/safeServerLog";
import type { Plugin, PluginFunction } from "@/types";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";
import {
  validateToolArguments,
  validateToolOutput,
} from "@/lib/agent/toolSchema";

function createInvalidToolArgumentsResponse(
  validation: Exclude<ReturnType<typeof validateToolArguments>, { ok: true }>,
) {
  return NextResponse.json(
    {
      error: validation.error.message,
      code: validation.error.code,
      issues: validation.error.issues,
      statusCode: 400,
    },
    { status: 400 },
  );
}

function getMcpAuthType(
  plugin: Plugin,
  authConfig: { type?: "bearer" | "apiKey" | "none" | "oauth2" } | undefined,
): "bearer" | "apiKey" | "none" | "oauth2" | undefined {
  if (authConfig?.type) return authConfig.type;
  if (
    plugin.auth?.type === "bearer" ||
    plugin.auth?.type === "apiKey" ||
    plugin.auth?.type === "oauth2" ||
    plugin.auth?.type === "none"
  ) {
    return plugin.auth.type;
  }
  return undefined;
}

/**
 * Plugin Function Execution API.
 * New requests resolve pluginId/functionName from the server registry; legacy
 * requests with full plugin/functionDef are kept for local-first compatibility.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await readJsonRequestBody(request);
    const newBody = PluginExecutionRequestSchema.safeParse(rawBody);

    if (newBody.success) {
      const { pluginId, functionName, expectedFingerprint, args, authConfig } =
        newBody.data;
      const registeredPlugin = await getServerPlugin(pluginId);
      if (!registeredPlugin) {
        return NextResponse.json(
          {
            error: "Plugin is not registered on the server",
            code: "PLUGIN_NOT_REGISTERED",
            statusCode: 404,
          },
          { status: 404 },
        );
      }

      const functionDef = registeredPlugin.functions?.find(
        (fn) => fn.name === functionName,
      );
      if (!functionDef) {
        return NextResponse.json(
          {
            error: "Plugin function is not declared by this plugin",
            code: "PLUGIN_FUNCTION_NOT_FOUND",
            statusCode: 400,
          },
          { status: 400 },
        );
      }

      const argsValidation = validateToolArguments(
        functionDef.parameters,
        args,
      );
      if (!argsValidation.ok) {
        return createInvalidToolArgumentsResponse(argsValidation);
      }

      if (expectedFingerprint) {
        const currentFingerprint = await createPluginFunctionFingerprint(
          registeredPlugin,
          functionDef,
        );
        if (currentFingerprint !== expectedFingerprint) {
          return NextResponse.json(
            {
              error:
                "Plugin function definition changed before execution. Review the updated tool before trying again.",
              code: "TOOL_DEFINITION_CHANGED",
              statusCode: 409,
            },
            { status: 409 },
          );
        }
      }

      const plugin =
        pluginId === "unsplash" && !authConfig?.valueSecret
          ? { ...registeredPlugin, baseUrl: "https://unsplash.com/napi" }
          : registeredPlugin;

      if (plugin.source === "mcp") {
        if (!plugin.mcp?.serverUrl) {
          return NextResponse.json(
            {
              error: "MCP server metadata is missing",
              code: "MCP_SERVER_METADATA_MISSING",
              statusCode: 400,
            },
            { status: 400 },
          );
        }

        const mcpToolName =
          plugin.mcp.toolNameMap?.[functionName] || functionDef.mcpToolName;
        if (!mcpToolName) {
          return NextResponse.json(
            {
              error: "MCP tool mapping is missing",
              code: "MCP_TOOL_MAPPING_MISSING",
              statusCode: 400,
            },
            { status: 400 },
          );
        }

        const authValue = await decryptOptionalSecret(
          authConfig?.valueSecret,
          BYOK_CONTEXTS.pluginAuth(plugin.id),
        );
        if (isPluginAuthRequired(plugin) && !authValue) {
          return NextResponse.json(
            {
              error: "Plugin authentication is required",
              code: "PLUGIN_AUTH_REQUIRED",
              statusCode: 400,
            },
            { status: 400 },
          );
        }

        const result = await executeMcpToolRequest({
          serverUrl: plugin.mcp.serverUrl,
          transport: plugin.mcp.transport,
          toolName: mcpToolName,
          args,
          staticHeaders: plugin.mcp.headers,
          authValue,
          authConfig: {
            type: getMcpAuthType(plugin, authConfig),
            key: authConfig?.key || plugin.auth?.name,
            addTo: authConfig?.addTo || plugin.auth?.in,
          },
          signal: request.signal,
        });

        if (functionDef.outputSchema) {
          const output =
            result && typeof result === "object" && !Array.isArray(result)
              ? ((result as Record<string, unknown>).structuredContent ??
                result)
              : result;
          const outputValidation = validateToolOutput(
            functionDef.outputSchema,
            output,
          );
          if (!outputValidation.ok) {
            return NextResponse.json(
              {
                error: outputValidation.error.message,
                code: outputValidation.error.code,
                issues: outputValidation.error.issues,
                statusCode: 502,
              },
              { status: 502 },
            );
          }
        }

        return NextResponse.json({ result });
      }

      if (isResearchSourceProvider(pluginId)) {
        return await executeResearchSourceRequest({
          provider: pluginId,
          functionName,
          args,
          authConfig,
          signal: request.signal,
        });
      }

      return await executePluginFunctionRequest({
        plugin,
        functionDef,
        args,
        authConfig,
        decryptSecret: decryptOptionalSecret,
        fetchText: safeFetchText,
        signal: request.signal,
      });
    }

    if (
      getDeploymentMode() === "hosted" &&
      ToolExecutionSchema.safeParse(rawBody).success
    ) {
      return NextResponse.json(
        {
          error: "Legacy plugin execution payloads are disabled in hosted mode",
          code: "LEGACY_PLUGIN_PAYLOAD_DISABLED",
          statusCode: 403,
        },
        { status: 403 },
      );
    }

    const legacyBody = ToolExecutionSchema.parse(rawBody);
    const plugin = legacyBody.plugin as Plugin;
    const functionDef = legacyBody.functionDef as PluginFunction;
    // Never allow legacy caller-supplied manifests to impersonate a trusted source.
    if (isResearchSourceProvider(plugin.id)) {
      return NextResponse.json(
        {
          error: "Specialized sources require registered function execution.",
          code: "SOURCE_REGISTERED_EXECUTION_REQUIRED",
        },
        { status: 400 },
      );
    }
    // Legacy local-first manifests predate required JSON Schemas. Preserve
    // them with a bounded object contract; hosted execution never accepts
    // this payload shape.
    const legacyParameters =
      functionDef.parameters &&
      typeof functionDef.parameters === "object" &&
      !Array.isArray(functionDef.parameters)
        ? functionDef.parameters
        : { type: "object" as const };
    const legacyArgsValidation = validateToolArguments(
      legacyParameters,
      legacyBody.args,
    );
    if (!legacyArgsValidation.ok) {
      return createInvalidToolArgumentsResponse(legacyArgsValidation);
    }
    try {
      await registerServerPlugin(plugin);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/reserved built-in plugin id/i.test(error.message)
      ) {
        throw error;
      }
    }
    return await executePluginFunctionRequest({
      plugin,
      functionDef,
      args: legacyBody.args,
      authConfig: legacyBody.authConfig,
      decryptSecret: decryptOptionalSecret,
      fetchText: safeFetchText,
      signal: request.signal,
    });
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return new Response(null, { status: 499 });
    }
    safeServerLogError("Error executing plugin function:", error);
    return createApiErrorResponse(error, "Plugin execution failed");
  }
}
