/**
 * 模型请求传输选择：服务端代理 vs 浏览器直连
 *
 * 直连仅对用户自建 provider 开放：服务端默认 provider 的密钥来自服务端环境变量，
 * 永远不会下发到浏览器，因此始终走代理。
 */

import type { Attachment, Message, ModelProvider } from "@/types";
import { SERVER_DEFAULT_PROVIDER_ID } from "@/lib/defaultConfig/shared";
import { resolveProviderApiKey } from "@/lib/security/localSecretResolvers";
import { base64ToBytes, bytesToArrayBuffer } from "@/lib/utils/binary";
import { isOPFSUrl, resolveOPFSBlob } from "@/utils/opfs";
import type { ProviderConfig, ProviderRuntime } from "@/lib/chat/runChatStream";
import type { ImageGenerationRuntime } from "@/lib/chat/generateImage";
import { logDevError } from "@/lib/utils/devLogger";

type DirectProviderImageAttachment = Attachment & { file?: File };
type ResolveOPFSBlob = (url: string) => Promise<Blob | null>;

interface DirectProviderImageFilesOptions {
  signal?: AbortSignal;
  resolveOPFSBlob?: ResolveOPFSBlob;
}

function createAttachmentFile(blob: Blob, attachment: Attachment): File {
  return new File([blob], attachment.fileName, {
    type: attachment.mimeType || blob.type,
  });
}

/**
 * Provider SDKs can upload File objects, but persisted browser images use
 * opfs:// URLs. Resolve only those local image sources at the direct-call
 * boundary; remote HTTPS image URLs remain unchanged.
 */
export async function hydrateDirectProviderImageFiles(
  history: Message[],
  attachments: Attachment[] = [],
  options: DirectProviderImageFilesOptions = {},
): Promise<{
  history: Message[];
  attachments: DirectProviderImageAttachment[];
}> {
  const readOPFSBlob = options.resolveOPFSBlob || resolveOPFSBlob;
  const filesByOpfsUrl = new Map<string, Promise<File>>();

  const hydrateAttachment = async (
    attachment: Attachment,
  ): Promise<DirectProviderImageAttachment> => {
    options.signal?.throwIfAborted();
    if (!attachment.mimeType.toLowerCase().startsWith("image/")) {
      return attachment;
    }

    const local = attachment as DirectProviderImageAttachment;
    if (local.file instanceof File) return local;

    if (attachment.data) {
      const bytes = base64ToBytes(attachment.data);
      return {
        ...attachment,
        file: createAttachmentFile(
          new Blob([bytesToArrayBuffer(bytes)], { type: attachment.mimeType }),
          attachment,
        ),
      };
    }

    if (!attachment.url || !isOPFSUrl(attachment.url)) return attachment;

    let filePromise = filesByOpfsUrl.get(attachment.url);
    if (!filePromise) {
      filePromise = (async () => {
        const blob = await readOPFSBlob(attachment.url || "");
        options.signal?.throwIfAborted();
        if (!blob) {
          throw new Error(
            `The local image "${attachment.fileName}" is no longer available. Please attach it again.`,
          );
        }
        return createAttachmentFile(blob, attachment);
      })();
      filesByOpfsUrl.set(attachment.url, filePromise);
    }

    return { ...attachment, file: await filePromise };
  };

  const hydratedHistory: Message[] = [];
  for (const message of history) {
    hydratedHistory.push({
      ...message,
      attachments: message.attachments
        ? await Promise.all(message.attachments.map(hydrateAttachment))
        : undefined,
    });
  }

  return {
    history: hydratedHistory,
    attachments: await Promise.all(attachments.map(hydrateAttachment)),
  };
}

/**
 * 该 provider 是否应由浏览器直接请求
 */
export function shouldUseDirectCall(provider: ModelProvider): boolean {
  if (provider.isServerDefault) return false;
  if (provider.id === SERVER_DEFAULT_PROVIDER_ID) return false;
  return provider.directCall === true;
}

/**
 * 构造直连用的 provider 配置：直接携带明文密钥，跳过 BYOK 加密与公钥请求
 */
export async function buildDirectProviderConfig(
  provider: ModelProvider,
): Promise<ProviderConfig> {
  return {
    type: provider.type,
    baseUrl: provider.baseUrl,
    name: provider.name,
    apiKey: await resolveProviderApiKey(provider),
  };
}

/**
 * 浏览器 provider 运行时。SDK 体积较大，按需动态载入。
 */
export async function getBrowserProviderRuntime(): Promise<ProviderRuntime> {
  const {
    createBrowserAnthropicClient,
    createBrowserGoogleClient,
    createBrowserOpenAIClient,
  } = await import("@/lib/providers/browserClients");

  return {
    // 请求源自用户本机、目标由用户自行配置，浏览器侧无需 SSRF 校验
    assertOutboundAllowed: async () => undefined,
    createOpenAIClient: createBrowserOpenAIClient,
    createAnthropicClient: createBrowserAnthropicClient,
    createGoogleClient: createBrowserGoogleClient,
    logStreamError: (error) => logDevError("Direct chat stream error:", error),
  };
}

/**
 * 直连的简单文本生成器，可直接传给 `lib/chat/auxiliaryGeneration` 的 *With 函数
 */
export async function directSimpleGenerator(): Promise<
  (
    provider: ProviderConfig,
    modelName: string,
    prompt: string,
    signal?: AbortSignal,
  ) => Promise<string>
> {
  const [{ runSimpleGeneration }, runtime] = await Promise.all([
    import("@/lib/chat/runSimpleGeneration"),
    getBrowserProviderRuntime(),
  ]);

  return (provider, modelName, prompt, signal) =>
    runSimpleGeneration(provider, modelName, prompt, runtime, signal);
}

/**
 * 浏览器图片生成运行时（对应 /api/chat/generate-image 的服务端 runtime）
 */
export async function getBrowserImageRuntime(): Promise<ImageGenerationRuntime> {
  const { createBrowserGoogleClient, assertDirectProviderUrl } =
    await import("@/lib/providers/browserClients");

  return {
    assertOutboundAllowed: async () => undefined,
    createGoogleClient: createBrowserGoogleClient,
    fetchJson: async (url, init) => {
      assertDirectProviderUrl(url);
      const response = await fetch(url, init);
      let data: any;
      try {
        data = await response.json();
      } catch (error) {
        if (
          init.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        throw new Error("Expected a JSON response from upstream service");
      }
      return { response, data };
    },
  };
}

/**
 * 直连拉取模型列表（对应 /api/providers/models 的浏览器分支）
 */
export async function fetchDirectProviderModels(
  provider: ModelProvider,
  signal?: AbortSignal,
): Promise<string[]> {
  const [
    { getDirectProviderAuthHeaders, assertDirectProviderUrl },
    { extractProviderModelIds },
    { getProviderModelsUrl },
  ] = await Promise.all([
    import("@/lib/providers/browserClients"),
    import("@/lib/providers/models"),
    import("@/lib/security/urlPolicy"),
  ]);

  const directProvider = await buildDirectProviderConfig(provider);
  if (!directProvider.apiKey?.trim()) {
    throw new Error(`${provider.type} API key is not configured`);
  }

  const endpoint = getProviderModelsUrl(provider.baseUrl, provider.type);
  assertDirectProviderUrl(endpoint);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: getDirectProviderAuthHeaders(
      directProvider,
      directProvider.apiKey,
    ),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${provider.type} models`);
  }

  return extractProviderModelIds(provider.type, await response.json());
}

/**
 * 直连失败时给出可操作的提示。
 *
 * 浏览器对 CORS 预检失败不暴露状态码与响应体，`TypeError: Failed to fetch`
 * 几乎总是 CORS、混合内容或 CSP 拦截，而不是模型本身报错。
 */
export function describeDirectCallError(
  error: unknown,
  provider: ModelProvider,
): Error {
  const isNetworkFailure =
    error instanceof TypeError ||
    (error instanceof Error &&
      /fetch failed|Failed to fetch/i.test(error.message));

  if (!isNetworkFailure) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return new Error(
    `Direct browser request to ${provider.name} failed. The endpoint did not allow a direct browser request (CORS), or it was blocked as insecure content. Turn off direct calls for this provider, or configure the endpoint to allow this origin.`,
  );
}
