/**
 * 传输无关的图片生成逻辑
 *
 * 由服务端路由和浏览器直连两条路径共用。
 * 该模块必须保持同构：不得引入 server-only 模块或 Node API。
 */

import type { GoogleGenAI } from "@google/genai";
import { v7 as uuidv7 } from "uuid";
import type { Attachment } from "@/types";
import type { ProviderRuntimeConfig } from "../security/urlPolicy";
import {
  getProviderApiKey,
  normalizeProviderBaseUrl,
} from "../security/urlPolicy";
import {
  isGoogleProviderType,
  isOpenAIProviderType,
} from "../providers/providerTypes";
import {
  type ProviderImageAttachment,
  uploadGoogleImageFiles,
} from "../providers/imageFiles";
import { convertAttachmentsToGemini } from "../utils/attachments";
import { normalizeGeneratedImageAttachments } from "../utils/generatedImages";

export interface GenerateImageOptions {
  provider: ProviderRuntimeConfig;
  modelName: string;
  prompt: string;
  imageCount?: number;
  attachments?: ProviderImageAttachment[];
  signal?: AbortSignal;
}

/**
 * 由调用方注入的运行时。
 *
 * 服务端使用 safeFetchJson 与 ProviderFactory；浏览器使用平台 fetch 并跳过出站校验。
 */
export interface ImageGenerationRuntime {
  assertOutboundAllowed: (
    provider: ProviderRuntimeConfig,
    signal?: AbortSignal,
  ) => Promise<void>;
  createGoogleClient: (provider: ProviderRuntimeConfig) => GoogleGenAI;
  fetchJson: (
    url: string,
    init: RequestInit,
  ) => Promise<{ response: Response; data: any }>;
}

export type GenerateImageResult =
  | { ok: true; images: Attachment[]; message: string }
  | { ok: false; status: number; error: string };

function appendOpenAIEditImages(
  formData: FormData,
  attachments: ProviderImageAttachment[],
) {
  const images = attachments.filter((attachment) =>
    attachment.mimeType.toLowerCase().startsWith("image/"),
  );
  if (images.length === 0) return false;

  for (const [index, attachment] of images.entries()) {
    if (!attachment.file) {
      throw new Error("Image editing requires uploaded image files.");
    }
    formData.append(
      "image",
      attachment.file,
      attachment.fileName || `edit-source-${index + 1}.png`,
    );
  }

  return true;
}

async function generateOpenAIImage(
  options: GenerateImageOptions,
  runtime: ImageGenerationRuntime,
): Promise<GenerateImageResult> {
  const { provider, modelName, prompt, imageCount, attachments, signal } =
    options;

  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      error: "OpenAI API key is not configured",
    };
  }

  const baseUrl = normalizeProviderBaseUrl(provider.baseUrl, provider.type);
  const isEditRequest = Boolean(attachments?.length);
  const url = `${baseUrl}/images/${isEditRequest ? "edits" : "generations"}`;
  const shouldRequestBase64Response = provider.type === "OpenAI";

  const { response, data } = isEditRequest
    ? await (async () => {
        const formData = new FormData();
        formData.append("model", modelName);
        formData.append("prompt", prompt);
        if (imageCount) formData.append("n", String(imageCount));
        formData.append("size", "1024x1024");
        if (shouldRequestBase64Response) {
          formData.append("response_format", "b64_json");
        }
        if (!appendOpenAIEditImages(formData, attachments || [])) {
          throw new Error("Image editing requires at least one image.");
        }
        return runtime.fetchJson(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal,
        });
      })()
    : await runtime.fetchJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          prompt: prompt,
          ...(imageCount ? { n: imageCount } : {}),
          size: "1024x1024",
          ...(shouldRequestBase64Response
            ? { response_format: "b64_json" }
            : {}),
        }),
        signal,
      });

  if (!response.ok) {
    throw new Error(
      `OpenAI Image Error: ${data.error?.message || response.statusText}`,
    );
  }

  if (data.data && data.data.length > 0) {
    const images = normalizeGeneratedImageAttachments(
      data.data.map((item: any) => ({
        id: uuidv7(),
        mimeType: "image/png",
        data: item.b64_json,
        url: item.url,
        fileName: `generated-${Date.now()}.png`,
      })),
    );

    if (images.length > 0) {
      return {
        ok: true,
        images,
        message: `${isEditRequest ? "Edited" : "Generated"} ${images.length} image(s) for prompt: "${prompt}"`,
      };
    }
  }

  return { ok: true, images: [], message: "No images generated." };
}

async function generateGoogleImage(
  options: GenerateImageOptions,
  runtime: ImageGenerationRuntime,
): Promise<GenerateImageResult> {
  const { provider, modelName, prompt, imageCount, attachments, signal } =
    options;

  await runtime.assertOutboundAllowed(provider, signal);
  const ai = runtime.createGoogleClient(provider);

  if (attachments?.length) {
    const prepared = await uploadGoogleImageFiles(ai, [], attachments, signal);
    try {
      const response: any = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            { text: prompt },
            ...(convertAttachmentsToGemini(prepared.attachments) as any[]),
          ],
        },
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          abortSignal: signal,
        },
      });
      const parts = response.candidates?.[0]?.content?.parts || [];
      const images = normalizeGeneratedImageAttachments(
        parts
          .filter((part: any) => part.inlineData)
          .map((part: any) => ({
            id: uuidv7(),
            mimeType: part.inlineData.mimeType || "image/png",
            data: part.inlineData.data,
            fileName: `gemini-edit-${Date.now()}.png`,
          })),
      );
      const text = parts
        .map((part: any) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();

      if (images.length > 0) {
        return {
          ok: true,
          images,
          message: text || `Generated image for: "${prompt}"`,
        };
      }

      return {
        ok: true,
        images: [],
        message: text || "No images generated.",
      };
    } finally {
      await prepared.cleanup();
    }
  }

  const response: any = await ai.models.generateImages({
    model: modelName,
    prompt: prompt,
    config: {
      ...(imageCount ? { numberOfImages: imageCount } : {}),
      aspectRatio: "1:1",
      abortSignal: signal,
    },
  });

  if (response.generatedImages && response.generatedImages.length > 0) {
    const images = normalizeGeneratedImageAttachments(
      response.generatedImages.map((img: any) => ({
        id: uuidv7(),
        mimeType: img.image?.mimeType || "image/png",
        data: img.image?.imageBytes,
        fileName: `imagen-${Date.now()}.png`,
      })),
    );

    if (images.length > 0) {
      return {
        ok: true,
        images,
        message: `Generated image for: "${prompt}"`,
      };
    }
  }

  return { ok: true, images: [], message: "No images generated." };
}

export async function generateImage(
  options: GenerateImageOptions,
  runtime: ImageGenerationRuntime,
): Promise<GenerateImageResult> {
  const { provider } = options;

  if (isOpenAIProviderType(provider.type)) {
    return generateOpenAIImage(options, runtime);
  }

  if (isGoogleProviderType(provider.type)) {
    return generateGoogleImage(options, runtime);
  }

  return {
    ok: false,
    status: 400,
    error: `${provider.type} does not support image generation`,
  };
}
