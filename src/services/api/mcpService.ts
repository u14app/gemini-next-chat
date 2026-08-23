import { useSettingsStore } from "@/store/core/settingsStore";
import { signedApiFetch, readJsonResponseOrThrow } from "@/lib/api/client";
import { encryptSecret, fetchWithByokRetry } from "@/lib/byok/client";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import { resolvePluginAuthValue } from "@/lib/security/localSecretResolvers";

export type McpCapabilityOperation =
  | "inspect"
  | "resources_list"
  | "resource_templates_list"
  | "resource_read"
  | "prompts_list"
  | "prompt_get";

function mcpCapabilityFailure(code: string, message: string) {
  return {
    ok: false as const,
    error: { code, message, recoverable: true },
  };
}

export async function executeMcpCapability(
  pluginId: string,
  operation: McpCapabilityOperation,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const { installedPlugins, pluginConfigs } = useSettingsStore.getState();
  const plugin = installedPlugins.find(
    (candidate) => candidate.id === pluginId,
  );
  if (!plugin || plugin.source !== "mcp" || !plugin.mcp?.serverUrl) {
    return mcpCapabilityFailure(
      "MCP_SERVER_NOT_FOUND",
      "MCP server is unavailable.",
    );
  }
  const config = pluginConfigs[plugin.id];
  const value = config?.auth
    ? await resolvePluginAuthValue(plugin.id, config.auth)
    : undefined;
  const valueSecret =
    config?.auth || value
      ? await encryptSecret(value, BYOK_CONTEXTS.pluginAuth(plugin.id), signal)
      : undefined;
  const response = await fetchWithByokRetry(() =>
    signedApiFetch("/api/mcp/capabilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pluginId,
        operation,
        params,
        localPlugin: plugin,
        ...(config?.auth || value
          ? {
              authConfig: {
                type: config?.auth?.type || plugin.auth?.type,
                key: config?.auth?.key || plugin.auth?.name,
                addTo: config?.auth?.addTo || plugin.auth?.in,
                valueSecret,
              },
            }
          : {}),
      }),
      signal,
    }),
  );
  const data = await readJsonResponseOrThrow<{
    result?: unknown;
    error?: string;
    code?: string;
  }>(response, "MCP capability request failed");
  return data.error
    ? mcpCapabilityFailure(data.code || "MCP_CAPABILITY_FAILED", data.error)
    : data.result;
}
