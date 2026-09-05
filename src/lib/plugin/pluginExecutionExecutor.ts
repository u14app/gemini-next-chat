import { NextResponse } from "next/server";
import { BYOK_CONTEXTS, type EncryptedSecretEnvelope } from "../byok/shared";
import { decryptOptionalSecret } from "../byok/server";
import { isPluginAuthRequired } from "./config";
import {
  getPluginFunctionDefinitionError,
  getPluginFunctionPathError,
} from "./manifest";
import { safeFetchText } from "../security/safeFetch";
import { readJinaWebPage } from "./jinaReader";
import {
  getProviderGoogleSdkOptions,
  getSafeUrlPolicy,
  normalizeProviderBaseUrl,
  validateOutboundUrl,
} from "../security/urlPolicy";
import type { Plugin, PluginFunction } from "@/types";
import {
  AGNES_IMAGE_PLUGIN_ID,
  AGNES_VIDEO_PLUGIN_ID,
  GEMINI_IMAGE_PLUGIN_ID,
  OPENAI_IMAGE_PLUGIN_ID,
  OPENAI_RESPONSES_IMAGE_PLUGIN_ID,
  normalizePluginResponse,
} from "./responseNormalizers";

export interface PluginAuthConfig {
  type?: "bearer" | "apiKey" | "none" | "oauth2";
  valueSecret?: EncryptedSecretEnvelope;
  key?: string;
  addTo?: "header" | "query";
  baseUrl?: string;
  model?: string;
}

type PluginAuthType = NonNullable<Plugin["auth"]>["type"];
type DecryptOptionalSecret = typeof decryptOptionalSecret;
type SafeFetchText = typeof safeFetchText;

const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";
const AGNES_VIDEO_MODEL = "agnes-video-v2.0";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const OPENAI_RESPONSES_MODEL = "gpt-5.5";
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const AGNES_VIDEO_RESULT_FUNCTION = "get_video_result";
const OPENAI_RESPONSES_IMAGE_FUNCTION = "generate_image_with_responses";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getAuthType(
  plugin: Plugin,
  authConfig: PluginAuthConfig | undefined,
): PluginAuthConfig["type"] | PluginAuthType | undefined {
  if (plugin.auth?.type && plugin.auth.type !== "none") {
    return plugin.auth.type;
  }
  return authConfig?.type;
}

function prepareOutboundArgs(
  plugin: Plugin,
  functionDef: PluginFunction,
  args: Record<string, unknown>,
  authConfig?: PluginAuthConfig,
): Record<string, unknown> {
  if (plugin.id === AGNES_IMAGE_PLUGIN_ID) {
    const outbound = { ...args };
    outbound.model =
      typeof outbound.model === "string" && outbound.model.trim()
        ? outbound.model
        : getConfiguredModel(authConfig) || AGNES_IMAGE_MODEL;

    const extraBody = isRecord(outbound.extra_body)
      ? { ...outbound.extra_body }
      : {};
    if (Array.isArray(outbound.image)) {
      extraBody.image = outbound.image;
      delete outbound.image;
    }
    if (typeof outbound.response_format === "string") {
      extraBody.response_format = outbound.response_format;
      delete outbound.response_format;
    }
    if (Object.keys(extraBody).length > 0) {
      outbound.extra_body = extraBody;
    }
    return outbound;
  }

  if (
    plugin.id === AGNES_VIDEO_PLUGIN_ID &&
    functionDef.name === "create_video"
  ) {
    return {
      ...args,
      model:
        typeof args.model === "string" && args.model.trim()
          ? args.model
          : getConfiguredModel(authConfig) || AGNES_VIDEO_MODEL,
    };
  }

  return { ...args };
}

function getTrimmedStringArg(
  args: Record<string, unknown>,
  key: string,
): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getConfiguredModel(
  authConfig: PluginAuthConfig | undefined,
): string | null {
  return typeof authConfig?.model === "string" && authConfig.model.trim()
    ? authConfig.model.trim()
    : null;
}

function prepareAgnesVideoResultPath(
  outboundArgs: Record<string, unknown>,
  consumedArgs: Set<string>,
  authConfig?: PluginAuthConfig,
): string | null {
  const videoId = getTrimmedStringArg(outboundArgs, "video_id");
  const taskId = getTrimmedStringArg(outboundArgs, "task_id");

  if (videoId) {
    outboundArgs.video_id = videoId;
    delete outboundArgs.task_id;
    if (!getTrimmedStringArg(outboundArgs, "model_name")) {
      const configuredModel = getConfiguredModel(authConfig);
      if (configuredModel) {
        outboundArgs.model_name = configuredModel;
      }
    }
    return "/agnesapi";
  }

  if (taskId) {
    outboundArgs.task_id = taskId;
    consumedArgs.add("task_id");
    return `/v1/videos/${encodeURIComponent(taskId)}`;
  }

  return null;
}

function getAgnesVideoCreateError(
  args: Record<string, unknown>,
): string | null {
  const image = getTrimmedStringArg(args, "image");
  if (!image) return null;

  try {
    validateOutboundUrl(image, getSafeUrlPolicy("plugin"));
    return null;
  } catch {
    return "Agnes image-to-video currently requires a public HTTPS image URL";
  }
}

function getJinaReaderTargetError(
  args: Record<string, unknown>,
): string | null {
  const targetUrl = getTrimmedStringArg(args, "url");
  if (!targetUrl) return null;

  try {
    validateOutboundUrl(targetUrl, getSafeUrlPolicy("plugin"));
    return null;
  } catch {
    return "Jina reader URL is not allowed";
  }
}

function getPluginEndpointOverride(
  plugin: Plugin,
  authConfig: PluginAuthConfig | undefined,
): "invalid" | string | undefined {
  if (!authConfig?.baseUrl) {
    return undefined;
  }

  const providerType =
    plugin.id === GEMINI_IMAGE_PLUGIN_ID
      ? "Google"
      : plugin.id === OPENAI_IMAGE_PLUGIN_ID ||
          plugin.id === OPENAI_RESPONSES_IMAGE_PLUGIN_ID
        ? "OpenAI Compatible"
        : null;

  if (!providerType) return undefined;

  try {
    validateOutboundUrl(authConfig.baseUrl, getSafeUrlPolicy("plugin"));
    if (plugin.id === GEMINI_IMAGE_PLUGIN_ID) {
      return getProviderGoogleSdkOptions(authConfig.baseUrl).baseUrl;
    }
    return normalizeProviderBaseUrl(authConfig.baseUrl, providerType);
  } catch {
    return "invalid";
  }
}

function removeUndefinedFields(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

const FORBIDDEN_AUTH_HEADER_NAMES = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getPluginAuthTarget(
  plugin: Plugin,
  authConfig: PluginAuthConfig | undefined,
): {
  name: string;
  location?: "header" | "query";
  source: "manifest" | "runtime" | "default";
} {
  const manifestName = plugin.auth?.name?.trim();
  if (manifestName) {
    return {
      name: manifestName,
      location: plugin.auth?.in,
      source: "manifest",
    };
  }

  const runtimeName = authConfig?.key?.trim();
  if (runtimeName) {
    return {
      name: runtimeName,
      location: authConfig?.addTo,
      source: "runtime",
    };
  }

  return {
    name:
      plugin.auth?.type === "apiKey" || authConfig?.type === "apiKey"
        ? "X-API-Key"
        : "Authorization",
    location: plugin.auth?.in || authConfig?.addTo,
    source: "default",
  };
}

function getPluginAuthTargetError({
  name,
  location,
  source,
}: {
  name: string;
  location?: "header" | "query";
  source: "manifest" | "runtime" | "default";
}): string | null {
  if (!name) return "Plugin authentication parameter name is required";

  if (location === "header") {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      return "Plugin authentication header name is not allowed";
    }
    const normalized = name.toLowerCase();
    if (
      FORBIDDEN_AUTH_HEADER_NAMES.has(normalized) ||
      normalized.startsWith("sec-") ||
      normalized.startsWith("proxy-") ||
      (source !== "manifest" && normalized === "authorization")
    ) {
      return "Plugin authentication header name is not allowed";
    }
  }

  if (location === "query" && !/^[A-Za-z0-9._~-]{1,120}$/.test(name)) {
    return "Plugin authentication query parameter name is not allowed";
  }

  return null;
}

function getImageCountArg(args: Record<string, unknown>): number | undefined {
  const value = args.n;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 10
    ? value
    : undefined;
}

function prepareGeminiImageRequest(
  args: Record<string, unknown>,
  authConfig?: PluginAuthConfig,
) {
  const prompt = getTrimmedStringArg(args, "prompt");
  if (!prompt) {
    return { error: "Image generation prompt is required" };
  }

  const model =
    getTrimmedStringArg(args, "model") ||
    getConfiguredModel(authConfig) ||
    GEMINI_IMAGE_MODEL;
  const imageConfig = removeUndefinedFields({
    aspect_ratio: getTrimmedStringArg(args, "aspect_ratio") || undefined,
    image_size: getTrimmedStringArg(args, "image_size") || undefined,
  });
  const generationConfig = removeUndefinedFields({
    candidate_count: getImageCountArg(args),
    image_config: Object.keys(imageConfig).length > 0 ? imageConfig : undefined,
  });
  const inputImages = Array.isArray(args.image)
    ? args.image.filter((item): item is string => typeof item === "string")
    : [];
  const input =
    inputImages.length > 0
      ? [
          { type: "text", text: prompt },
          ...inputImages.map((image) => ({
            type: "image",
            uri: image.startsWith("data:") ? undefined : image,
            data: image.startsWith("data:")
              ? image.split(",").pop()
              : undefined,
          })),
        ]
      : prompt;

  return {
    body: removeUndefinedFields({
      model,
      input,
      response_modalities: ["image"],
      generation_config:
        Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    }),
  };
}

function prepareOpenAIResponsesImageRequest(
  args: Record<string, unknown>,
  authConfig?: PluginAuthConfig,
) {
  const prompt = getTrimmedStringArg(args, "prompt");
  if (!prompt) {
    return { error: "Image generation prompt is required" };
  }

  const imageTool = removeUndefinedFields({
    type: "image_generation",
    model:
      getTrimmedStringArg(args, "image_model") ||
      getConfiguredModel(authConfig) ||
      undefined,
    action: getTrimmedStringArg(args, "action") || undefined,
    quality: getTrimmedStringArg(args, "quality") || undefined,
    size: getTrimmedStringArg(args, "size") || undefined,
    background: getTrimmedStringArg(args, "background") || undefined,
  });
  const inputImages = Array.isArray(args.image)
    ? args.image.filter((item): item is string => typeof item === "string")
    : [];
  const input =
    inputImages.length > 0
      ? [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              ...inputImages.map((image) => ({
                type: "input_image",
                image_url: image,
              })),
            ],
          },
        ]
      : prompt;

  return {
    body: {
      model: getTrimmedStringArg(args, "model") || OPENAI_RESPONSES_MODEL,
      input,
      tools: [imageTool],
    },
  };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) {
    throw new Error("Image edits require data URL image inputs");
  }
  const mimeType = match[1] || "image/png";
  const data = match[2] || "";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function prepareOpenAICompatibleImageRequest(
  args: Record<string, unknown>,
  authConfig?: PluginAuthConfig,
) {
  const prompt = getTrimmedStringArg(args, "prompt");
  if (!prompt) {
    return { error: "Image generation prompt is required" };
  }

  const imageInputs = Array.isArray(args.image)
    ? args.image.filter((item): item is string => typeof item === "string")
    : [];
  const isEditRequest = imageInputs.length > 0;
  const model =
    getTrimmedStringArg(args, "model") ||
    getConfiguredModel(authConfig) ||
    OPENAI_IMAGE_MODEL;

  if (isEditRequest) {
    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", prompt);
    const size = getTrimmedStringArg(args, "size");
    const responseFormat = getTrimmedStringArg(args, "response_format");
    if (size) formData.append("size", size);
    if (responseFormat) formData.append("response_format", responseFormat);
    const imageCount = getImageCountArg(args);
    if (imageCount) {
      formData.append("n", String(imageCount));
    }
    imageInputs.forEach((image, index) => {
      formData.append("image", dataUrlToBlob(image), `image-${index + 1}.png`);
    });
    return { body: formData, isEditRequest };
  }

  return {
    body: removeUndefinedFields({
      model,
      prompt,
      size: getTrimmedStringArg(args, "size") || undefined,
      response_format:
        getTrimmedStringArg(args, "response_format") || undefined,
      n: getImageCountArg(args),
    }),
    isEditRequest,
  };
}

function joinPluginUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function executePluginFunctionRequest({
  plugin,
  functionDef,
  args,
  authConfig,
  decryptSecret = decryptOptionalSecret,
  fetchText = safeFetchText,
  signal,
}: {
  plugin: Plugin;
  functionDef: PluginFunction;
  args: Record<string, unknown>;
  authConfig?: PluginAuthConfig;
  decryptSecret?: DecryptOptionalSecret;
  fetchText?: SafeFetchText;
  signal?: AbortSignal;
}) {
  if (!plugin.baseUrl) {
    return NextResponse.json(
      { error: "Plugin base URL is missing" },
      { status: 400 },
    );
  }

  const functionDefinitionError = getPluginFunctionDefinitionError(
    plugin,
    functionDef,
  );
  if (functionDefinitionError) {
    return NextResponse.json(
      { error: functionDefinitionError },
      { status: 400 },
    );
  }

  const functionPathError = getPluginFunctionPathError(functionDef);
  if (functionPathError) {
    return NextResponse.json({ error: functionPathError }, { status: 400 });
  }

  if (!functionDef.method || !functionDef.path) {
    return NextResponse.json(
      { error: "Plugin function path or method is missing" },
      { status: 400 },
    );
  }

  const method = functionDef.method.toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return NextResponse.json(
      { error: `Plugin method ${method} is not supported` },
      { status: 400 },
    );
  }

  const outboundArgs = prepareOutboundArgs(
    plugin,
    functionDef,
    args,
    authConfig,
  );
  if (plugin.id === "jina-web-reader") {
    const jinaTargetError = getJinaReaderTargetError(outboundArgs);
    if (jinaTargetError) {
      return NextResponse.json({ error: jinaTargetError }, { status: 400 });
    }
  }
  if (
    plugin.id === AGNES_VIDEO_PLUGIN_ID &&
    functionDef.name === "create_video"
  ) {
    const agnesVideoCreateError = getAgnesVideoCreateError(outboundArgs);
    if (agnesVideoCreateError) {
      return NextResponse.json(
        { error: agnesVideoCreateError },
        { status: 400 },
      );
    }
  }
  let baseUrl = plugin.baseUrl;
  let requestBody: BodyInit | undefined;
  let usesFormDataBody = false;
  let path = functionDef.path.startsWith("/")
    ? functionDef.path
    : `/${functionDef.path}`;
  const consumedArgs = new Set<string>();
  const endpointOverride = getPluginEndpointOverride(plugin, authConfig);
  if (endpointOverride === "invalid") {
    return NextResponse.json(
      { error: "Plugin endpoint URL is not allowed" },
      { status: 400 },
    );
  }
  if (endpointOverride) baseUrl = endpointOverride;

  if (plugin.id === GEMINI_IMAGE_PLUGIN_ID) {
    const prepared = prepareGeminiImageRequest(outboundArgs, authConfig);
    if ("error" in prepared) {
      return NextResponse.json({ error: prepared.error }, { status: 400 });
    }
    requestBody = JSON.stringify(prepared.body);
  }

  if (
    plugin.id === OPENAI_RESPONSES_IMAGE_PLUGIN_ID &&
    functionDef.name === OPENAI_RESPONSES_IMAGE_FUNCTION
  ) {
    const prepared = prepareOpenAIResponsesImageRequest(
      outboundArgs,
      authConfig,
    );
    if ("error" in prepared) {
      return NextResponse.json({ error: prepared.error }, { status: 400 });
    }
    requestBody = JSON.stringify(prepared.body);
  }

  if (
    plugin.id === OPENAI_IMAGE_PLUGIN_ID &&
    functionDef.name !== OPENAI_RESPONSES_IMAGE_FUNCTION
  ) {
    try {
      const prepared = prepareOpenAICompatibleImageRequest(
        outboundArgs,
        authConfig,
      );
      if ("error" in prepared) {
        return NextResponse.json({ error: prepared.error }, { status: 400 });
      }
      if (prepared.isEditRequest) path = "/images/edits";
      requestBody =
        prepared.body instanceof FormData
          ? prepared.body
          : JSON.stringify(prepared.body);
      usesFormDataBody = prepared.body instanceof FormData;
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Image request could not be prepared",
        },
        { status: 400 },
      );
    }
  }

  if (
    plugin.id === AGNES_VIDEO_PLUGIN_ID &&
    functionDef.name === AGNES_VIDEO_RESULT_FUNCTION
  ) {
    const resultPath = prepareAgnesVideoResultPath(
      outboundArgs,
      consumedArgs,
      authConfig,
    );
    if (!resultPath) {
      return NextResponse.json(
        { error: "Agnes video result lookup requires video_id or task_id" },
        { status: 400 },
      );
    }
    path = resultPath;
  }

  for (const key in outboundArgs) {
    const val = outboundArgs[key];
    const nextPath = path.replace(`{${key}}`, encodeURIComponent(String(val)));
    if (nextPath !== path) consumedArgs.add(key);
    path = nextPath;
    const dashedPath = path.replace(
      `{${key.replace(/_/g, "-")}}`,
      encodeURIComponent(String(val)),
    );
    if (dashedPath !== path) consumedArgs.add(key);
    path = dashedPath;
  }

  if (/{[^}/]+}/.test(path)) {
    return NextResponse.json(
      { error: "Plugin path parameters are missing" },
      { status: 400 },
    );
  }

  const urlObj = new URL(joinPluginUrl(baseUrl, path));
  if (method === "GET") {
    for (const key in outboundArgs) {
      if (!consumedArgs.has(key)) {
        urlObj.searchParams.append(key, String(outboundArgs[key]));
      }
    }
  }

  const headers: Record<string, string> = usesFormDataBody
    ? {}
    : {
        "Content-Type": "application/json",
      };
  const authValue = await decryptSecret(
    authConfig?.valueSecret,
    BYOK_CONTEXTS.pluginAuth(plugin.id),
  );
  if (isPluginAuthRequired(plugin) && plugin.id !== "unsplash" && !authValue) {
    return NextResponse.json(
      { error: "Plugin authentication is required" },
      { status: 400 },
    );
  }

  if (plugin.id === "jina-web-reader") {
    headers.Accept = "application/json";
  }

  if (authValue) {
    const authTarget = getPluginAuthTarget(plugin, authConfig);
    const authName = authTarget.name;
    const authIn = authTarget.location;
    const authType = getAuthType(plugin, authConfig);

    if (authType === "bearer" || authType === "oauth2") {
      headers.Authorization = `Bearer ${authValue}`;
    } else if (authType === "apiKey" || authConfig?.type === "apiKey") {
      const authTargetError = getPluginAuthTargetError(authTarget);
      if (authTargetError) {
        return NextResponse.json({ error: authTargetError }, { status: 400 });
      }
      if (authIn === "header") {
        headers[authName] = authValue;
      } else if (authIn === "query") {
        urlObj.searchParams.append(authName, authValue);
      } else if (["POST", "PUT", "PATCH"].includes(method)) {
        outboundArgs[authName] = authValue;
      } else {
        headers[authName] = authValue;
      }
    }
  }

  if (plugin.id === "jina-web-reader") {
    return NextResponse.json({
      result: await readJinaWebPage({
        readerUrl: urlObj.toString(),
        targetUrl: getTrimmedStringArg(outboundArgs, "url")!,
        headers,
        signal,
        fetchText,
      }),
    });
  }

  const { response: res, text } = await fetchText(
    urlObj.toString(),
    {
      method,
      headers,
      body:
        method !== "GET"
          ? (requestBody ?? JSON.stringify(outboundArgs))
          : undefined,
      signal,
    },
    {
      policy: getSafeUrlPolicy("plugin"),
      timeoutMs:
        plugin.id === AGNES_IMAGE_PLUGIN_ID ||
        plugin.id === AGNES_VIDEO_PLUGIN_ID ||
        plugin.id === GEMINI_IMAGE_PLUGIN_ID ||
        plugin.id === OPENAI_IMAGE_PLUGIN_ID ||
        plugin.id === OPENAI_RESPONSES_IMAGE_PLUGIN_ID
          ? 120_000
          : 30_000,
      maxResponseBytes:
        plugin.id === AGNES_IMAGE_PLUGIN_ID ||
        plugin.id === GEMINI_IMAGE_PLUGIN_ID ||
        plugin.id === OPENAI_IMAGE_PLUGIN_ID ||
        plugin.id === OPENAI_RESPONSES_IMAGE_PLUGIN_ID
          ? 36 * 1024 * 1024
          : 2 * 1024 * 1024,
    },
  );

  if (!res.ok) {
    return NextResponse.json(
      {
        error: `Plugin request failed with status ${res.status}`,
        status: res.status,
      },
      { status: 502 },
    );
  }

  let responseData;
  try {
    responseData = JSON.parse(text);
  } catch {
    responseData = text;
  }

  return NextResponse.json({
    result: normalizePluginResponse(plugin, responseData),
  });
}
