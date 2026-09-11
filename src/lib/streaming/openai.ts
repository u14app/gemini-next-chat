/**
 * OpenAI 流式响应处理器
 */

import OpenAI from "openai";
import { PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import { SSEMessage } from "./sse";
import {
  appendOpenAIToolCallDelta,
  createOpenAIToolCallAccumulator,
  finalizeOpenAIToolCalls,
  finalizeStreamedToolCall,
} from "./toolCalls";
import { normalizeSearchSources } from "../search/results";
import type { ReasoningMode } from "@/types";
import {
  isExplicitReasoningEffort,
  isReasoningEnabled,
  normalizeReasoningMode,
} from "../chat/reasoning";
import { normalizeGeneratedImageAttachment } from "../utils/generatedImages";
import { IncompleteProviderStreamError } from "../errors";
import type { StructuredResponseFormat } from "../chat/responseFormat";

export interface OpenAIStreamOptions {
  client: OpenAI;
  model: string;
  messages: any[];
  temperature?: number;
  responseFormat?: StructuredResponseFormat;
  tools?: any[];
  useReasoning?: boolean;
  reasoningMode?: ReasoningMode;
  signal?: AbortSignal;
  onChunk: (message: SSEMessage) => void;
}

function extractTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractTextValue).join("");
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return (
    extractTextValue(record.text) ||
    extractTextValue(record.content) ||
    extractTextValue(record.summary) ||
    extractTextValue(record.delta)
  );
}

function createSourceCandidate(
  value: unknown,
  fallbackTitle = "Search source",
  fallbackContent?: string,
) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url =
    extractTextValue(record.url) ||
    extractTextValue(record.uri) ||
    extractTextValue(record.link);
  if (!url) return null;

  const title =
    extractTextValue(record.title) ||
    extractTextValue(record.name) ||
    fallbackTitle;
  const content =
    extractTextValue(record.content) ||
    extractTextValue(record.snippet) ||
    extractTextValue(record.text) ||
    fallbackContent ||
    title;

  return { title, url, content };
}

function collectSourceCandidates(
  value: unknown,
  fallbackContent?: string,
): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        createSourceCandidate(item, "Search source", fallbackContent),
      )
      .filter(Boolean);
  }
  const candidate = createSourceCandidate(
    value,
    "Search source",
    fallbackContent,
  );
  return candidate ? [candidate] : [];
}

function extractWebSearchSources(item: any) {
  const rawSources = [
    ...collectSourceCandidates(item?.results),
    ...collectSourceCandidates(item?.action?.sources),
    ...collectSourceCandidates(item?.sources),
  ];
  return normalizeSearchSources(rawSources);
}

function extractUrlCitationSources(content: any) {
  const text = extractTextValue(content?.text);
  const annotations = Array.isArray(content?.annotations)
    ? content.annotations
    : [];
  const rawSources = annotations
    .filter((annotation: any) => annotation?.type === "url_citation")
    .map((annotation: any) =>
      createSourceCandidate(annotation, "Citation", text),
    )
    .filter(Boolean);

  return normalizeSearchSources(rawSources);
}

function extractReasoningSummary(item: any): string {
  return [
    extractTextValue(item?.summary),
    extractTextValue(item?.content),
    extractTextValue(item?.text),
  ]
    .filter(Boolean)
    .join("");
}

function extractImageDataValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const data = extractImageDataValue(item);
      if (data) return data;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return (
    extractImageDataValue(record.result) ||
    extractImageDataValue(record.image) ||
    extractImageDataValue(record.b64_json) ||
    extractImageDataValue(record.data) ||
    extractImageDataValue(record.partial_image_b64) ||
    extractImageDataValue(record.base64)
  );
}

function emitResponsesImageGeneration(
  event: any,
  onChunk: (message: SSEMessage) => void,
): void {
  const item = event?.item || event?.output || event;
  const data = extractImageDataValue([
    item?.result,
    item?.image,
    item?.b64_json,
    item?.data,
    item?.partial_image_b64,
    event?.result,
    event?.image,
    event?.b64_json,
    event?.data,
    event?.partial_image_b64,
  ]);
  const image = normalizeGeneratedImageAttachment({
    id: item?.id || event?.item_id || event?.id,
    mimeType: item?.mime_type || item?.mimeType || event?.mime_type,
    data,
    fileName: item?.file_name || item?.fileName || "generated-image.png",
  });

  if (image) onChunk({ type: "image", image });
}

type ThinkTagStreamEvent = {
  type: "content" | "reasoning";
  content: string;
};

const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";

function findTagIndex(value: string, tag: string): number {
  return value.toLowerCase().indexOf(tag);
}

function splitBeforePotentialTagPrefix(value: string, tag: string) {
  const lower = value.toLowerCase();
  for (
    let length = Math.min(tag.length - 1, lower.length);
    length > 0;
    length--
  ) {
    if (tag.startsWith(lower.slice(-length))) {
      return {
        ready: value.slice(0, -length),
        pending: value.slice(-length),
      };
    }
  }
  return { ready: value, pending: "" };
}

function pushThinkTagEvent(
  events: ThinkTagStreamEvent[],
  type: ThinkTagStreamEvent["type"],
  content: string,
) {
  if (content) events.push({ type, content });
}

function createThinkTagStreamParser() {
  let buffer = "";
  let insideThink = false;

  const consume = (input: string): ThinkTagStreamEvent[] => {
    buffer += input;
    const events: ThinkTagStreamEvent[] = [];

    while (buffer) {
      if (insideThink) {
        const closeIndex = findTagIndex(buffer, THINK_CLOSE_TAG);
        if (closeIndex !== -1) {
          pushThinkTagEvent(events, "reasoning", buffer.slice(0, closeIndex));
          buffer = buffer.slice(closeIndex + THINK_CLOSE_TAG.length);
          insideThink = false;
          continue;
        }

        const { ready, pending } = splitBeforePotentialTagPrefix(
          buffer,
          THINK_CLOSE_TAG,
        );
        pushThinkTagEvent(events, "reasoning", ready);
        buffer = pending;
        break;
      }

      const openIndex = findTagIndex(buffer, THINK_OPEN_TAG);
      if (openIndex !== -1) {
        pushThinkTagEvent(events, "content", buffer.slice(0, openIndex));
        buffer = buffer.slice(openIndex + THINK_OPEN_TAG.length);
        insideThink = true;
        continue;
      }

      const { ready, pending } = splitBeforePotentialTagPrefix(
        buffer,
        THINK_OPEN_TAG,
      );
      pushThinkTagEvent(events, "content", ready);
      buffer = pending;
      break;
    }

    return events;
  };

  const flush = (): ThinkTagStreamEvent[] => {
    const pending = buffer;
    buffer = "";
    return pending
      ? [{ type: insideThink ? "reasoning" : "content", content: pending }]
      : [];
  };

  return { consume, flush };
}

export interface OpenAIResponsesStreamOptions {
  client: OpenAI;
  model: string;
  input: any[];
  instructions?: string;
  temperature?: number;
  responseFormat?: StructuredResponseFormat;
  tools?: any[];
  useReasoning?: boolean;
  reasoningMode?: ReasoningMode;
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  signal?: AbortSignal;
  onChunk: (message: SSEMessage) => void;
}

interface ChatCompletionRequestOptions {
  model: string;
  messages: any[];
  temperature?: number;
  responseFormat?: StructuredResponseFormat;
  tools?: any[];
  useReasoning?: boolean;
  reasoningMode?: ReasoningMode;
}

function normalizeChatCompletionMessages(messages: any[]): any[] {
  return messages.map((message) => {
    const content = message?.content;
    if (!Array.isArray(content) || content.length !== 1) return message;

    const [onlyPart] = content;
    if (
      onlyPart?.type !== "text" ||
      typeof onlyPart.text !== "string" ||
      Object.keys(onlyPart).some((key) => key !== "type" && key !== "text")
    ) {
      return message;
    }

    return {
      ...message,
      content: onlyPart.text,
    };
  });
}

function createChatCompletionRequestParams({
  model,
  messages,
  temperature = 1,
  responseFormat,
  tools,
  useReasoning,
  reasoningMode: rawReasoningMode,
}: ChatCompletionRequestOptions): any {
  const reasoningMode = normalizeReasoningMode(rawReasoningMode, useReasoning);
  const requestParams: any = {
    model,
    messages: normalizeChatCompletionMessages(messages),
    stream: true,
  };

  if (responseFormat) {
    requestParams.response_format = {
      type: "json_schema",
      json_schema: {
        name: responseFormat.name,
        schema: responseFormat.schema,
        strict: responseFormat.strict,
      },
    };
  }

  // O1 models don't support temperature or tools
  const isO1Model = model.startsWith("o1-");

  if (!isO1Model) {
    requestParams.temperature = temperature;
    if (tools && tools.length > 0) {
      requestParams.tools = tools;
    }
  }

  if (isExplicitReasoningEffort(reasoningMode)) {
    requestParams.reasoning_effort = reasoningMode;
  }

  return requestParams;
}

function emitChatCompletionChunk(
  chunk: any,
  toolCalls: ReturnType<typeof createOpenAIToolCallAccumulator>,
  emitReasoning: boolean,
  thinkTagParser: ReturnType<typeof createThinkTagStreamParser>,
  onChunk: (message: SSEMessage) => void,
): void {
  const delta = chunk.choices?.[0]?.delta;

  // 处理文本内容
  if (delta?.content) {
    for (const event of thinkTagParser.consume(delta.content)) {
      if (event.type === "content") {
        onChunk({ type: "content", content: event.content });
      } else if (emitReasoning) {
        onChunk({ type: "reasoning", content: event.content });
      }
    }
  }

  const reasoningContent =
    extractTextValue(delta?.reasoning_content) ||
    extractTextValue(delta?.reasoning);
  if (emitReasoning && reasoningContent) {
    onChunk({ type: "reasoning", content: reasoningContent });
  }

  // 处理工具调用
  if (delta?.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      appendOpenAIToolCallDelta(toolCalls, toolCall);
    }
  }

  // 处理使用统计
  if (chunk.usage) {
    onChunk({
      type: "usage",
      usage: {
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
        total_tokens: chunk.usage.total_tokens,
      },
    });
  }
}

const OPENAI_COMPLETION_SENTINEL_LINE_LIMIT = 64;

async function responseHasOpenAICompletionSentinel(
  response: Response,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;

  const decoder = new TextDecoder();
  let pendingLine = "";
  let discardLine = false;

  const consumeText = (text: string): boolean => {
    let offset = 0;
    while (offset < text.length) {
      const newlineIndex = text.indexOf("\n", offset);
      const end = newlineIndex === -1 ? text.length : newlineIndex;

      if (!discardLine) {
        pendingLine += text.slice(offset, end);
        if (pendingLine.length > OPENAI_COMPLETION_SENTINEL_LINE_LIMIT) {
          pendingLine = "";
          discardLine = true;
        }
      }

      if (newlineIndex === -1) return false;
      if (!discardLine && /^data:\s*\[DONE\]\s*\r?$/.test(pendingLine)) {
        return true;
      }

      pendingLine = "";
      discardLine = false;
      offset = newlineIndex + 1;
    }

    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (consumeText(decoder.decode(value, { stream: true }))) {
        await reader.cancel().catch(() => undefined);
        return true;
      }
    }

    consumeText(decoder.decode());
    return !discardLine && /^data:\s*\[DONE\]\s*\r?$/.test(pendingLine);
  } finally {
    reader.releaseLock();
  }
}

async function finishChatCompletionStream(
  chunks: AsyncIterable<any>,
  startTime: number,
  emitReasoning: boolean,
  onChunk: (message: SSEMessage) => void,
  completionSentinel?: Promise<boolean>,
): Promise<void> {
  const toolCalls = createOpenAIToolCallAccumulator();
  const thinkTagParser = createThinkTagStreamParser();
  let receivedTerminalFinishReason = false;

  for await (const chunk of chunks) {
    if (
      chunk.choices?.some(
        (choice: any) =>
          typeof choice?.finish_reason === "string" &&
          choice.finish_reason.length > 0,
      )
    ) {
      receivedTerminalFinishReason = true;
    }
    emitChatCompletionChunk(
      chunk,
      toolCalls,
      emitReasoning,
      thinkTagParser,
      onChunk,
    );
  }

  for (const event of thinkTagParser.flush()) {
    if (event.type === "content") {
      onChunk({ type: "content", content: event.content });
    } else if (emitReasoning) {
      onChunk({ type: "reasoning", content: event.content });
    }
  }

  const receivedCompletionSentinel = completionSentinel
    ? await completionSentinel
    : false;
  if (!receivedTerminalFinishReason && !receivedCompletionSentinel) {
    throw new IncompleteProviderStreamError(
      "OpenAI Chat Completions stream ended without a terminal finish_reason or [DONE] sentinel.",
    );
  }

  // 发送完整的工具调用
  for (const toolCall of finalizeOpenAIToolCalls(toolCalls)) {
    onChunk({ type: "tool_call", toolCall });
  }

  // 发送时间统计
  const endTime = Date.now();
  onChunk({
    type: "timing",
    timing: {
      startTime,
      endTime,
      duration: endTime - startTime,
    },
  });
}

/**
 * 处理 OpenAI Chat Completions 流式响应
 */
export async function streamOpenAIChatCompletions(
  options: OpenAIStreamOptions,
) {
  const {
    client,
    model,
    messages,
    temperature = 1,
    responseFormat,
    tools,
    useReasoning,
    reasoningMode: rawReasoningMode,
    signal,
    onChunk,
  } = options;
  const reasoningMode = normalizeReasoningMode(rawReasoningMode, useReasoning);

  const startTime = Date.now();
  const requestParams = createChatCompletionRequestParams({
    model,
    messages,
    temperature,
    responseFormat,
    tools,
    useReasoning,
    reasoningMode,
  });

  const streamRequest = (
    signal
      ? client.chat.completions.create(requestParams, { signal })
      : client.chat.completions.create(requestParams)
  ) as PromiseLike<any> & {
    asResponse?: () => Promise<Response>;
  };
  let completionSentinel: Promise<boolean> | undefined;
  if (typeof streamRequest.asResponse === "function") {
    const response = await streamRequest.asResponse();
    if (response.body && !response.bodyUsed) {
      try {
        completionSentinel = responseHasOpenAICompletionSentinel(
          response.clone(),
        ).catch(() => false);
      } catch {
        // Fall back to finish_reason validation when a runtime cannot clone.
      }
    }
  }

  const stream = (await streamRequest) as AsyncIterable<any>;
  await finishChatCompletionStream(
    stream,
    startTime,
    isReasoningEnabled(reasoningMode),
    onChunk,
    completionSentinel,
  );
}

/**
 * Backward-compatible alias for the legacy chat-completions stream.
 */
export const streamOpenAIResponse = streamOpenAIChatCompletions;

/**
 * 处理 OpenAI Responses API 流式响应
 */
export async function streamOpenAIResponses(
  options: OpenAIResponsesStreamOptions,
) {
  const {
    client,
    model,
    input,
    instructions,
    temperature,
    responseFormat,
    tools,
    useReasoning,
    reasoningMode: rawReasoningMode,
    enableWebSearch,
    enableImageGeneration,
    signal,
    onChunk,
  } = options;
  const reasoningMode = normalizeReasoningMode(rawReasoningMode, useReasoning);

  const startTime = Date.now();
  const requestParams: any = {
    model,
    input,
    stream: true,
  };

  if (instructions) requestParams.instructions = instructions;
  if (temperature !== undefined) requestParams.temperature = temperature;
  if (responseFormat) {
    requestParams.text = {
      format: {
        type: "json_schema",
        name: responseFormat.name,
        schema: responseFormat.schema,
        strict: responseFormat.strict,
      },
    };
  }
  const requestTools = tools ? [...tools] : [];
  if (enableWebSearch) {
    requestTools.push({ type: "web_search_preview" });
    requestParams.include = [
      "web_search_call.results",
      "web_search_call.action.sources",
    ];
  }
  if (
    enableImageGeneration &&
    !requestTools.some((tool) => tool?.type === "image_generation")
  ) {
    requestTools.push({ type: "image_generation" });
  }
  if (requestTools.length > 0) requestParams.tools = requestTools;
  if (reasoningMode === "auto") {
    requestParams.reasoning = { summary: "auto" };
  } else if (isExplicitReasoningEffort(reasoningMode)) {
    requestParams.reasoning = { effort: reasoningMode, summary: "auto" };
  }

  const stream = (await (signal
    ? client.responses.create(requestParams, { signal })
    : client.responses.create(requestParams))) as any;
  let toolCallPosition = 0;
  let hasStreamedOutputText = false;
  let hasStreamedReasoning = false;
  let receivedCompletedEvent = false;

  for await (const event of stream) {
    switch (event?.type) {
      case "response.output_text.delta":
        if (event.delta) {
          hasStreamedOutputText = true;
          onChunk({ type: "content", content: event.delta });
        }
        break;

      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta": {
        const reasoningContent = extractTextValue(event.delta);
        if (isReasoningEnabled(reasoningMode) && reasoningContent) {
          hasStreamedReasoning = true;
          onChunk({ type: "reasoning", content: reasoningContent });
        }
        break;
      }

      case "response.output_text.annotation.added": {
        const sources = normalizeSearchSources(
          collectSourceCandidates(event.annotation),
        );
        if (sources.length > 0) {
          onChunk({
            type: "search",
            isSearching: false,
            results: { sources, images: [] },
          });
        }
        break;
      }

      case "response.output_item.done": {
        const item = event.item;
        if (item?.type === "web_search_call") {
          const sources = extractWebSearchSources(item);
          if (sources.length > 0) {
            onChunk({
              type: "search",
              isSearching: false,
              results: { sources, images: [] },
            });
          }
          break;
        }

        if (item?.type === "reasoning") {
          if (!hasStreamedReasoning) {
            const reasoningContent = extractReasoningSummary(item);
            if (isReasoningEnabled(reasoningMode) && reasoningContent) {
              onChunk({ type: "reasoning", content: reasoningContent });
            }
          }
          break;
        }

        if (item?.type === "message") {
          const contentItems = Array.isArray(item.content) ? item.content : [];
          for (const content of contentItems) {
            if (!hasStreamedOutputText) {
              const text = extractTextValue(content?.text);
              if (text) {
                onChunk({ type: "content", content: text });
              }
            }

            const sources = extractUrlCitationSources(content);
            if (sources.length > 0) {
              onChunk({
                type: "search",
                isSearching: false,
                results: { sources, images: [] },
              });
            }
          }
          break;
        }

        if (item?.type !== "function_call") break;
        if (toolCallPosition >= PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls) {
          break;
        }

        const toolCall = finalizeStreamedToolCall(
          {
            id: item.call_id || item.id,
            name: item.name,
            argsText: item.arguments,
          },
          toolCallPosition,
        );
        toolCallPosition += 1;
        if (toolCall) {
          onChunk({ type: "tool_call", toolCall });
        }
        break;
      }

      case "response.image_generation_call.completed":
        emitResponsesImageGeneration(event, onChunk);
        break;

      case "response.image_generation_call.partial_image":
        break;

      case "response.completed": {
        receivedCompletedEvent = true;
        const usage = event.response?.usage;
        if (usage) {
          onChunk({
            type: "usage",
            usage: {
              prompt_tokens: usage.input_tokens ?? 0,
              completion_tokens: usage.output_tokens ?? 0,
              total_tokens: usage.total_tokens ?? 0,
            },
          });
        }
        break;
      }

      case "response.failed":
      case "response.error":
      case "response.incomplete":
      case "error": {
        const errorMessage =
          event.error?.message ||
          event.response?.error?.message ||
          event.message ||
          event.response?.incomplete_details?.reason ||
          "upstream terminal error";
        throw new Error(`OpenAI Responses stream failed: ${errorMessage}`);
      }
    }
  }

  if (!receivedCompletedEvent) {
    throw new IncompleteProviderStreamError(
      "OpenAI Responses stream ended before response.completed.",
    );
  }

  const endTime = Date.now();
  onChunk({
    type: "timing",
    timing: {
      startTime,
      endTime,
      duration: endTime - startTime,
    },
  });
}
