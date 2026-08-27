/**
 * 传输无关的聊天分发逻辑
 *
 * 由服务端路由（SSE 代理）和浏览器直连两条路径共用。
 * 该模块必须保持同构：不得引入 server-only 模块或 Node API。
 */

import type { GoogleGenAI } from "@google/genai";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { Message, ReasoningMode } from "@/types";
import type { ProviderRuntimeConfig } from "../security/urlPolicy";
import {
  convertToolsToAnthropic,
  streamAnthropicMessages,
} from "../streaming/anthropic";
import { streamGeminiResponse } from "../streaming/gemini";
import {
  streamOpenAIChatCompletions,
  streamOpenAIResponses,
} from "../streaming/openai";
import type { SSEMessage } from "../streaming/sse";
import {
  normalizeStructuredOutputCapabilityError,
  type StructuredResponseFormat,
} from "./responseFormat";
import {
  prepareGeminiHistory,
  prepareAnthropicMessages,
  prepareOpenAIHistory,
  prepareOpenAIResponsesInput,
} from "../utils/history";
import {
  convertAttachmentsToAnthropic,
  convertAttachmentsToGemini,
  convertAttachmentsToOpenAI,
  convertAttachmentsToOpenAIResponses,
} from "../utils/attachments";
import { convertSchemaToGemini } from "../utils/schema";
import {
  isAnthropicProviderType,
  isGoogleProviderType,
  OPENAI_COMPATIBLE_PROVIDER_TYPE,
} from "../providers/providerTypes";
import { ValidationError } from "../errors";
import {
  ANTHROPIC_FILES_BETA,
  hasUploadedImageFiles,
  uploadAnthropicImageFiles,
  uploadGoogleImageFiles,
  uploadOpenAIImageFiles,
} from "../providers/imageFiles";

export type ProviderConfig = ProviderRuntimeConfig;

/**
 * 由调用方注入的 provider 运行时。
 *
 * 服务端实现基于 `ProviderFactory`（safeFetch、SSRF 校验、响应上限）；
 * 浏览器实现使用平台 fetch 并跳过出站校验。
 */
export interface ProviderRuntime {
  assertOutboundAllowed: (
    provider: ProviderConfig,
    signal?: AbortSignal,
  ) => Promise<void>;
  createOpenAIClient: (provider: ProviderConfig) => OpenAI;
  createAnthropicClient: (provider: ProviderConfig) => Anthropic;
  createGoogleClient: (provider: ProviderConfig) => GoogleGenAI;
  logStreamError: (error: unknown, options: ChatStreamOptions) => void;
}

export interface ChatStreamOptions {
  provider: ProviderConfig;
  modelName: string;
  history: Message[];
  newMessage: string;
  attachments?: any[];
  config?: {
    temperature?: number;
    useReasoning?: boolean;
    reasoningMode?: ReasoningMode;
    imageCount?: number;
  };
  systemInstruction?: string;
  responseFormat?: StructuredResponseFormat;
  tools?: any[];
  enableImageGeneration?: boolean;
  enableGoogleSearch?: boolean;
  enableOpenAIWebSearch?: boolean;
  signal?: AbortSignal;
}

export interface RunChatStreamOptions extends ChatStreamOptions {
  runtime: ProviderRuntime;
  send: (message: SSEMessage) => void;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function convertToolsToOpenAIResponses(tools?: any[]) {
  return tools
    ?.map((tool) => {
      const fn = tool?.function;
      if (tool?.type !== "function" || !fn?.name) return null;
      return {
        type: "function",
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters || { type: "object", properties: {} },
        strict: false,
      };
    })
    .filter(Boolean);
}

function appendImageCountInstruction(
  instruction: string | undefined,
  imageCount: number | undefined,
): string | undefined {
  if (!imageCount) return instruction;

  const imageInstruction = `When generating images for this request, create ${imageCount} separate image output${imageCount === 1 ? "" : "s"}.`;
  return instruction
    ? `${instruction}\n\n${imageInstruction}`
    : imageInstruction;
}

/**
 * 执行一轮聊天请求，并通过 `send` 输出 SSE 消息。
 *
 * 调用方负责将 `send` 接到具体传输上：服务端写入 SSE 流，浏览器直接消费消息对象。
 */
export async function runChatStream(
  options: RunChatStreamOptions,
): Promise<void> {
  const {
    provider,
    modelName,
    history,
    newMessage,
    attachments,
    config,
    systemInstruction,
    responseFormat,
    tools,
    enableImageGeneration,
    enableGoogleSearch,
    enableOpenAIWebSearch,
    signal,
    runtime,
    send,
  } = options;

  try {
    if (provider.type === "OpenAI") {
      await runtime.assertOutboundAllowed(provider, signal);
      const client = runtime.createOpenAIClient(provider);
      const prepared = await uploadOpenAIImageFiles(
        client,
        history,
        attachments || [],
        signal,
      );
      try {
        const input = prepareOpenAIResponsesInput(prepared.history);
        const content: any[] = [{ type: "input_text", text: newMessage }];
        if (prepared.attachments.length) {
          content.push(
            ...convertAttachmentsToOpenAIResponses(prepared.attachments),
          );
        }
        input.push({ role: "user", content });

        await streamOpenAIResponses({
          client,
          model: modelName,
          input,
          instructions: appendImageCountInstruction(
            systemInstruction,
            enableImageGeneration ? config?.imageCount : undefined,
          ),
          temperature: config?.temperature,
          ...(responseFormat ? { responseFormat } : {}),
          tools: convertToolsToOpenAIResponses(tools),
          useReasoning: config?.useReasoning,
          reasoningMode: config?.reasoningMode,
          enableImageGeneration,
          enableWebSearch: enableOpenAIWebSearch,
          signal,
          onChunk: send,
        });
      } finally {
        await prepared.cleanup();
      }
    } else if (provider.type === OPENAI_COMPATIBLE_PROVIDER_TYPE) {
      if (hasUploadedImageFiles(history, attachments || [])) {
        throw new ValidationError(
          "This OpenAI-compatible provider does not support file-based image inputs. Use a remote HTTPS image URL or a native OpenAI, Google, or Anthropic provider.",
        );
      }
      await runtime.assertOutboundAllowed(provider, signal);
      const messages = prepareOpenAIHistory(history);

      // 添加新消息
      const content: any[] = [{ type: "text", text: newMessage }];
      if (attachments?.length) {
        // 转换附件格式
        content.push(...convertAttachmentsToOpenAI(attachments));
      }
      messages.push({ role: "user", content });

      // 添加系统指令
      if (systemInstruction) {
        messages.unshift({ role: "system", content: systemInstruction });
      }

      const client = runtime.createOpenAIClient(provider);
      await streamOpenAIChatCompletions({
        client,
        model: modelName,
        messages,
        temperature: config?.temperature,
        ...(responseFormat ? { responseFormat } : {}),
        tools,
        useReasoning: config?.useReasoning,
        reasoningMode: config?.reasoningMode,
        signal,
        onChunk: send,
      });
    } else if (isAnthropicProviderType(provider.type)) {
      await runtime.assertOutboundAllowed(provider, signal);
      const client = runtime.createAnthropicClient(provider);
      const prepared = await uploadAnthropicImageFiles(
        client,
        history,
        attachments || [],
        signal,
      );
      try {
        const messages = prepareAnthropicMessages(prepared.history);
        const content: any[] = [];
        if (newMessage) content.push({ type: "text", text: newMessage });
        if (prepared.attachments.length) {
          content.push(...convertAttachmentsToAnthropic(prepared.attachments));
        }
        messages.push({
          role: "user",
          content: content.length > 0 ? content : " ",
        });

        await streamAnthropicMessages({
          client,
          model: modelName,
          messages,
          system: systemInstruction,
          temperature: config?.temperature,
          ...(responseFormat ? { responseFormat } : {}),
          tools: convertToolsToAnthropic(tools),
          useReasoning: config?.useReasoning,
          reasoningMode: config?.reasoningMode,
          betas: [ANTHROPIC_FILES_BETA],
          signal,
          onChunk: send,
        });
      } finally {
        await prepared.cleanup();
      }
    } else if (isGoogleProviderType(provider.type)) {
      // Google
      await runtime.assertOutboundAllowed(provider, signal);
      const client = runtime.createGoogleClient(provider);
      const prepared = await uploadGoogleImageFiles(
        client,
        history,
        attachments || [],
        signal,
      );
      try {
        const contents = prepareGeminiHistory(prepared.history);
        const parts: any[] = [{ text: newMessage }];
        if (prepared.attachments.length) {
          parts.push(...convertAttachmentsToGemini(prepared.attachments));
        }
        contents.push({ role: "user", parts });

        const geminiTools = tools?.map((tool: any) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: convertSchemaToGemini(tool.function.parameters),
        }));

        await streamGeminiResponse({
          client,
          model: modelName,
          contents,
          systemInstruction,
          temperature: config?.temperature,
          ...(responseFormat ? { responseFormat } : {}),
          tools: geminiTools,
          enableGoogleSearch,
          enableImageGeneration,
          imageCount: config?.imageCount,
          useReasoning: config?.useReasoning,
          reasoningMode: config?.reasoningMode,
          signal,
          onChunk: send,
        });
      } finally {
        await prepared.cleanup();
      }
    } else {
      throw new Error(`Unsupported provider type: ${provider.type}`);
    }

    signal?.throwIfAborted();
    send({ type: "done" });
  } catch (error) {
    if (isAbortError(error, signal)) {
      return;
    }
    const normalizedError = responseFormat
      ? normalizeStructuredOutputCapabilityError(error)
      : error;
    runtime.logStreamError(normalizedError, options);
    throw normalizedError;
  }
}
