/**
 * 统一的聊天处理器
 */

import { ProviderFactory, ProviderConfig } from "../providers/base";
import {
  runChatStream,
  type ChatStreamOptions,
  type ProviderRuntime,
} from "../chat/runChatStream";
import { runSimpleGeneration } from "../chat/runSimpleGeneration";
import {
  createStreamHandler,
  createStreamResponse,
  createSSESender,
} from "../streaming/sse";
import { safeServerLogError } from "../utils/safeServerLog";

export type ChatHandlerOptions = ChatStreamOptions;

function getProviderBaseUrlHost(provider: ProviderConfig): string | undefined {
  const baseUrl = getProviderBaseUrl(provider);
  if (!baseUrl) return undefined;

  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

function getProviderBaseUrl(provider: ProviderConfig): string | undefined {
  return ProviderFactory.getEffectiveBaseUrl(provider.baseUrl, provider.type);
}

function getErrorStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getErrorNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getChatStreamErrorDetails(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};

  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    status:
      getErrorNumberField(record, "status") ||
      getErrorNumberField(record, "statusCode"),
    code: getErrorStringField(record, "code"),
    type: getErrorStringField(record, "type"),
  };
}

function logChatStreamError(error: unknown, options: ChatHandlerOptions): void {
  safeServerLogError("Chat stream error:", {
    providerType: options.provider.type,
    providerBaseUrlHost: getProviderBaseUrlHost(options.provider),
    modelName: options.modelName,
    error: getChatStreamErrorDetails(error),
  });
}

/**
 * 服务端 provider 运行时：safeFetch、SSRF 校验、响应上限均由 ProviderFactory 提供
 */
const serverProviderRuntime: ProviderRuntime = {
  assertOutboundAllowed: (provider, signal) =>
    ProviderFactory.assertProviderOutboundAllowed(provider, signal),
  createOpenAIClient: (provider) =>
    ProviderFactory.createOpenAIClient(provider),
  createAnthropicClient: (provider) =>
    ProviderFactory.createAnthropicClient(provider),
  createGoogleClient: (provider) =>
    ProviderFactory.createGoogleClient(provider),
  logStreamError: logChatStreamError,
};

/**
 * 处理聊天请求（流式）
 */
export async function handleChatStream(options: ChatHandlerOptions) {
  const stream = createStreamHandler(async (controller) => {
    await runChatStream({
      ...options,
      runtime: serverProviderRuntime,
      send: createSSESender(controller),
    });
  });

  return createStreamResponse(stream);
}

/**
 * 简单的文本生成（用于标题、问题等）
 */
export async function handleSimpleGeneration(
  provider: ProviderConfig,
  modelName: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  return runSimpleGeneration(
    provider,
    modelName,
    prompt,
    serverProviderRuntime,
    signal,
  );
}
