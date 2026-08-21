/**
 * 统一的聊天处理器
 */

import type { Message, ReasoningMode } from "@/types";
import { ProviderFactory, ProviderConfig } from "../providers/base";
import {
  createAnthropicMessageText,
  convertToolsToAnthropic,
  streamAnthropicMessages,
} from "../streaming/anthropic";
import { streamGeminiResponse } from "../streaming/gemini";
import {
  streamOpenAIChatCompletions,
  streamOpenAIResponses,
} from "../streaming/openai";
import {
  createStreamHandler,
  createStreamResponse,
  createSSESender,
} from "../streaming/sse";
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
  isOpenAIProviderType,
  isAnthropicProviderType,
  isGoogleProviderType,
} from "../providers/providerTypes";
import { safeServerLogError } from "../utils/safeServerLog";
import { ValidationError } from "../errors";
import {
  ANTHROPIC_FILES_BETA,
  hasUploadedImageFiles,
  uploadAnthropicImageFiles,
  uploadGoogleImageFiles,
  uploadOpenAIImageFiles,
} from "../providers/imageFiles";

export interface ChatHandlerOptions {
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
  tools?: any[];
  enableImageGeneration?: boolean;
  enableGoogleSearch?: boolean;
  enableOpenAIWebSearch?: boolean;
  signal?: AbortSignal;
}

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

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function logChatStreamError(error: unknown, options: ChatHandlerOptions): void {
  safeServerLogError("Chat stream error:", {
    providerType: options.provider.type,
    providerBaseUrlHost: getProviderBaseUrlHost(options.provider),
    modelName: options.modelName,
    error: getChatStreamErrorDetails(error),
  });
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

function getResponsesOutputText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;

  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) =>
      typeof content?.text === "string" ? content.text : "",
    )
    .join("");
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
 * 处理聊天请求（流式）
 */
export async function handleChatStream(options: ChatHandlerOptions) {
  const {
    provider,
    modelName,
    history,
    newMessage,
    attachments,
    config,
    systemInstruction,
    tools,
    enableImageGeneration,
    enableGoogleSearch,
    enableOpenAIWebSearch,
    signal,
  } = options;

  const stream = createStreamHandler(async (controller) => {
    try {
      const send = createSSESender(controller);

      if (provider.type === "OpenAI") {
        await ProviderFactory.assertProviderOutboundAllowed(provider, signal);
        const client = ProviderFactory.createOpenAIClient(provider);
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
      } else if (isOpenAIProviderType(provider.type)) {
        if (hasUploadedImageFiles(history, attachments || [])) {
          throw new ValidationError(
            "This OpenAI-compatible provider does not support file-based image inputs. Use a remote HTTPS image URL or a native OpenAI, Google, or Anthropic provider.",
          );
        }
        await ProviderFactory.assertProviderOutboundAllowed(provider, signal);
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

        const client = ProviderFactory.createOpenAIClient(provider);
        await streamOpenAIChatCompletions({
          client,
          model: modelName,
          messages,
          temperature: config?.temperature,
          tools,
          useReasoning: config?.useReasoning,
          reasoningMode: config?.reasoningMode,
          signal,
          onChunk: send,
        });
      } else if (isAnthropicProviderType(provider.type)) {
        await ProviderFactory.assertProviderOutboundAllowed(provider, signal);
        const client = ProviderFactory.createAnthropicClient(provider);
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
            content.push(
              ...convertAttachmentsToAnthropic(prepared.attachments),
            );
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
        await ProviderFactory.assertProviderOutboundAllowed(provider, signal);
        const client = ProviderFactory.createGoogleClient(provider);
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
      logChatStreamError(error, options);
      throw error;
    }
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
  await ProviderFactory.assertProviderOutboundAllowed(provider, signal);

  if (provider.type === "OpenAI") {
    const client = ProviderFactory.createOpenAIClient(provider);
    const request: any = {
      model: modelName,
      input: prompt,
      temperature: 0.7,
    };
    const response = signal
      ? await client.responses.create(request, { signal })
      : await client.responses.create(request);
    return getResponsesOutputText(response);
  }

  if (isOpenAIProviderType(provider.type)) {
    const client = ProviderFactory.createOpenAIClient(provider);
    const request: any = {
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    };
    const response = signal
      ? await client.chat.completions.create(request, { signal })
      : await client.chat.completions.create(request);
    return response.choices[0]?.message?.content || "";
  }

  if (isAnthropicProviderType(provider.type)) {
    const client = ProviderFactory.createAnthropicClient(provider);
    return createAnthropicMessageText({
      client,
      model: modelName,
      prompt,
      signal,
    });
  }

  if (isGoogleProviderType(provider.type)) {
    const client = ProviderFactory.createGoogleClient(provider);
    const request: any = {
      model: modelName,
      contents: { parts: [{ text: prompt }] },
    };
    if (signal) request.config = { abortSignal: signal };
    const result = await client.models.generateContent(request);
    return result.text || "";
  }

  throw new Error(`Unsupported provider type: ${provider.type}`);
}
