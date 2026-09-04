import { isResearchSourceProvider } from "../lib/plugin/researchSources/catalog";
import { useSettingsStore } from "../store/core/settingsStore";
import { UNSPLASH_PLUGIN } from "../config/plugins";
import {
  getPluginFunctionNameCollisions,
  resolvePluginFunction,
} from "../lib/plugin/resolve";
import { readJsonResponseOrThrow, signedApiFetch } from "../lib/api/client";
import {
  getPluginExecutionArgsError,
  getPluginExecutionFunctionNameError,
  serializePluginExecutionPayload,
  type PluginExecutionPayload,
  type PluginExecutionRequestPayload,
  type PluginExecutionAuthConfig,
} from "../lib/plugin/execution";
import { encryptSecret, fetchWithByokRetry } from "../lib/byok/client";
import { BYOK_CONTEXTS } from "../lib/byok/shared";
import type { Plugin, PluginConfig, PluginFunction } from "../types";
import {
  hasPluginAuthValue,
  resolvePluginAuthValue,
} from "../lib/security/localSecretResolvers";
import { createPluginFunctionFingerprint } from "../lib/plugin/confirmation";
import { getPluginFunctionRisk } from "../lib/plugin/risk";
import type { PluginFunctionRisk } from "../types";

export interface ExpectedPluginExecutionContract {
  pluginId: string;
  functionFingerprint: string;
  risk: PluginFunctionRisk;
}

type PluginExecutionResponse = {
  error?: string;
  code?: string;
  result?: any;
};

function pluginFailure(
  message: string,
  code = "PLUGIN_EXECUTION_FAILED",
  effectUnknown = false,
) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      recoverable: !effectUnknown,
      ...(effectUnknown ? { effectUnknown: true } : {}),
    },
  };
}

async function postPluginExecution(
  buildPayload: () => Promise<
    PluginExecutionPayload | PluginExecutionRequestPayload
  >,
  signal?: AbortSignal,
) {
  return fetchWithByokRetry(async () => {
    const payload = await buildPayload();
    return signedApiFetch("/api/plugins/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: serializePluginExecutionPayload(payload),
      signal,
    });
  });
}

async function postPluginExecutionWithLegacyFallback(
  buildPrimaryPayload: () => Promise<PluginExecutionRequestPayload>,
  buildLegacyPayload: () => Promise<PluginExecutionPayload>,
  signal?: AbortSignal,
  allowLegacyFallback = true,
) {
  const response = await postPluginExecution(buildPrimaryPayload, signal);
  if (response.status !== 404 || !allowLegacyFallback) return response;
  return postPluginExecution(buildLegacyPayload, signal);
}

async function buildPluginAuthConfig(
  pluginId: string,
  authConfig?: PluginExecutionAuthConfig | PluginConfig["auth"],
  baseUrl?: string,
  model?: string,
  signal?: AbortSignal,
): Promise<PluginExecutionAuthConfig | undefined> {
  if (!authConfig && !baseUrl && !model) return undefined;
  if (!authConfig) {
    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
    };
  }

  const value = await resolvePluginAuthValue(pluginId, authConfig);

  return {
    type: authConfig?.type,
    key: authConfig?.key,
    addTo: authConfig?.addTo,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    valueSecret: await encryptSecret(
      value,
      BYOK_CONTEXTS.pluginAuth(pluginId),
      signal,
    ),
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function executeBackendPluginFunction(
  plugin: Plugin,
  functionDef: PluginFunction,
  args: Record<string, unknown>,
  authConfig: PluginExecutionAuthConfig | undefined,
  signal?: AbortSignal,
  expectedFingerprint?: string,
): Promise<any> {
  const response = await postPluginExecutionWithLegacyFallback(
    async () => ({
      pluginId: plugin.id,
      functionName: functionDef.name,
      ...(expectedFingerprint ? { expectedFingerprint } : {}),
      args,
      authConfig,
    }),
    async () => ({
      plugin,
      functionDef,
      args,
      authConfig,
    }),
    signal,
    expectedFingerprint === undefined && !isResearchSourceProvider(plugin.id),
  );

  const data = await readJsonResponseOrThrow<PluginExecutionResponse>(
    response,
    "Plugin execution failed",
  );

  if (data.error) {
    return pluginFailure(data.error, data.code);
  }

  if (
    functionDef.mcpToolName &&
    data.result &&
    typeof data.result === "object" &&
    !Array.isArray(data.result) &&
    (data.result as Record<string, unknown>).isError === true
  ) {
    const result = data.result as Record<string, unknown>;
    return pluginFailure(
      typeof result.error === "string" && result.error.trim()
        ? result.error
        : "MCP Tool execution failed.",
      "MCP_TOOL_ERROR",
    );
  }

  return data.result;
}

/**
 * Executes a specific function from an installed plugin.
 * Uses backend API to avoid CORS issues.
 */
export const executePluginFunction = async (
  functionName: string,
  args: any,
  authOverride?: any,
  allowedPluginIds?: string[],
  signal?: AbortSignal,
  expectedContract?: ExpectedPluginExecutionContract,
): Promise<any> => {
  const functionNameError = getPluginExecutionFunctionNameError(functionName);
  if (functionNameError) {
    return pluginFailure(functionNameError, "PLUGIN_FUNCTION_INVALID");
  }

  const argsError = getPluginExecutionArgsError(args);
  if (argsError) {
    return pluginFailure(argsError, "PLUGIN_ARGUMENTS_INVALID");
  }
  const executionArgs = args as Record<string, unknown>;

  const { installedPlugins, pluginConfigs } = useSettingsStore.getState();
  const collision = getPluginFunctionNameCollisions(
    installedPlugins,
    allowedPluginIds,
    pluginConfigs,
  ).find((item) => item.name === functionName);
  if (collision) {
    return pluginFailure(
      `Function ${functionName} is provided by multiple active plugins: ${collision.pluginIds.join(", ")}.`,
      "PLUGIN_FUNCTION_AMBIGUOUS",
    );
  }

  const resolved = resolvePluginFunction(
    installedPlugins,
    functionName,
    allowedPluginIds,
  );

  if (!resolved) {
    return pluginFailure(
      `Function ${functionName} not found.`,
      "PLUGIN_FUNCTION_NOT_FOUND",
    );
  }

  const { plugin: foundPlugin, functionDef: foundFn } = resolved;
  if (expectedContract) {
    const currentFingerprint = await createPluginFunctionFingerprint(
      foundPlugin,
      foundFn,
    );
    if (
      foundPlugin.id !== expectedContract.pluginId ||
      currentFingerprint !== expectedContract.functionFingerprint ||
      getPluginFunctionRisk(foundFn) !== expectedContract.risk
    ) {
      return pluginFailure(
        "Plugin function definition changed before execution. Review the updated tool before trying again.",
        "TOOL_DEFINITION_CHANGED",
      );
    }
  }
  const config = pluginConfigs[foundPlugin.id];

  // --- Special Handling for Unsplash ---
  if (foundPlugin.id === UNSPLASH_PLUGIN.id) {
    if (functionName === "search_photos") {
      try {
        const hasAuth =
          !!authOverride?.value || hasPluginAuthValue(config?.auth);

        // Prepare modified args for Unsplash
        const modifiedArgs = { ...executionArgs };
        const modifiedPlugin = { ...foundPlugin };

        if (hasAuth) {
          modifiedPlugin.baseUrl = "https://api.unsplash.com";
          // Auth will be handled by backend
        } else {
          modifiedPlugin.baseUrl = "https://unsplash.com/napi";
        }

        const buildAuth = () =>
          buildPluginAuthConfig(
            modifiedPlugin.id,
            hasAuth ? authOverride || config?.auth : undefined,
            config?.baseUrl,
            config?.model,
            signal,
          );
        const response = await postPluginExecutionWithLegacyFallback(
          async () => ({
            pluginId: modifiedPlugin.id,
            functionName: foundFn.name,
            ...(expectedContract?.functionFingerprint
              ? { expectedFingerprint: expectedContract.functionFingerprint }
              : {}),
            args: modifiedArgs,
            authConfig: await buildAuth(),
          }),
          async () => ({
            plugin: modifiedPlugin,
            functionDef: foundFn,
            args: modifiedArgs,
            authConfig: await buildAuth(),
          }),
          signal,
          expectedContract?.functionFingerprint === undefined,
        );

        const data = await readJsonResponseOrThrow<PluginExecutionResponse>(
          response,
          "Plugin execution failed",
        );

        if (data.error) {
          return pluginFailure(data.error, data.code);
        }

        const json = data.result;

        if (json.results && Array.isArray(json.results)) {
          return json.results.map((item: any) => ({
            alt_description: item.alt_description,
            created_at: item.created_at,
            likes: item.likes,
            url: item.urls?.regular,
          }));
        }

        return json;
      } catch (e) {
        if (isAbortError(e, signal)) throw e;
        return pluginFailure(
          String(e),
          "PLUGIN_EXECUTION_FAILED",
          getPluginFunctionRisk(foundFn) !== "read",
        );
      }
    }
  }

  // --- Standard Generic Execution via Backend API ---
  try {
    const authConfig = await buildPluginAuthConfig(
      foundPlugin.id,
      authOverride || config?.auth,
      config?.baseUrl,
      config?.model,
      signal,
    );
    return await executeBackendPluginFunction(
      foundPlugin,
      foundFn,
      executionArgs,
      authConfig,
      signal,
      expectedContract?.functionFingerprint,
    );
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
    return pluginFailure(
      String(e),
      "PLUGIN_EXECUTION_FAILED",
      getPluginFunctionRisk(foundFn) !== "read",
    );
  }
};
