/**
 * Anthropic Messages API 流式响应处理器
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import type { ReasoningMode } from "@/types";
import {
  isExplicitReasoningEffort,
  isReasoningEnabled,
  normalizeReasoningMode,
} from "../chat/reasoning";
import { SSEMessage } from "./sse";
import { finalizeStreamedToolCall } from "./toolCalls";
import { IncompleteProviderStreamError } from "../errors";
import type { StructuredResponseFormat } from "../chat/responseFormat";

const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const ANTHROPIC_THINKING_BUDGETS: Record<
  Exclude<ReasoningMode, "off" | "auto">,
  number
> = {
  low: 1024,
  medium: 2048,
  high: 3072,
};

export interface AnthropicMessagesStreamOptions {
  client: Anthropic;
  model: string;
  messages: MessageParam[];
  system?: string;
  temperature?: number;
  responseFormat?: StructuredResponseFormat;
  tools?: Tool[];
  useReasoning?: boolean;
  reasoningMode?: ReasoningMode;
  betas?: string[];
  signal?: AbortSignal;
  onChunk: (message: SSEMessage) => void;
}

interface PendingAnthropicToolUse {
  id: string;
  name: string;
  args?: unknown;
  argsText: string;
  error?: string;
}

function usageInputTokens(usage: any): number {
  return (
    Number(usage?.input_tokens || 0) +
    Number(usage?.cache_creation_input_tokens || 0) +
    Number(usage?.cache_read_input_tokens || 0)
  );
}

function extractContentText(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block?.type === "text" ? block.text || "" : ""))
    .join("");
}

function getAnthropicThinkingConfig(reasoningMode: ReasoningMode) {
  if (reasoningMode === "auto") {
    return { type: "adaptive" as const };
  }
  if (isExplicitReasoningEffort(reasoningMode)) {
    return {
      type: "enabled" as const,
      budget_tokens: ANTHROPIC_THINKING_BUDGETS[reasoningMode],
    };
  }
  return undefined;
}

export function convertToolsToAnthropic(tools?: any[]): Tool[] | undefined {
  const converted = tools
    ?.map((tool) => {
      const fn = tool?.function;
      if (tool?.type !== "function" || !fn?.name) return null;
      return {
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters || { type: "object", properties: {} },
      } satisfies Tool;
    })
    .filter(Boolean) as Tool[] | undefined;

  return converted && converted.length > 0 ? converted : undefined;
}

function emitAnthropicToolUse(
  pending: PendingAnthropicToolUse,
  position: number,
  onChunk: (message: SSEMessage) => void,
): void {
  const toolCall = finalizeStreamedToolCall(
    {
      id: pending.id,
      name: pending.name,
      args: pending.args,
      argsText: pending.argsText ? pending.argsText : undefined,
      error: pending.error,
    },
    position,
  );

  if (toolCall) {
    onChunk({ type: "tool_call", toolCall });
  }
}

export async function streamAnthropicMessages(
  options: AnthropicMessagesStreamOptions,
) {
  const {
    client,
    model,
    messages,
    system,
    temperature,
    responseFormat,
    tools,
    useReasoning,
    reasoningMode: rawReasoningMode,
    betas,
    signal,
    onChunk,
  } = options;
  const reasoningMode = normalizeReasoningMode(rawReasoningMode, useReasoning);
  const startTime = Date.now();
  const requestParams: any = {
    model,
    messages,
    max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
    stream: true,
  };

  const thinking = getAnthropicThinkingConfig(reasoningMode);
  if (system) requestParams.system = system;
  if (responseFormat) {
    requestParams.output_config = {
      format: {
        type: "json_schema",
        schema: responseFormat.schema,
      },
    };
  }
  if (thinking) {
    requestParams.thinking = thinking;
  } else if (temperature !== undefined) {
    requestParams.temperature = temperature;
  }
  if (tools && tools.length > 0) requestParams.tools = tools;
  if (betas && betas.length > 0) requestParams.betas = betas;

  const messagesClient =
    betas && betas.length > 0 ? (client as any).beta.messages : client.messages;
  const stream = (await (signal
    ? messagesClient.create(requestParams, { signal })
    : messagesClient.create(requestParams))) as any;
  const pendingToolUses = new Map<number, PendingAnthropicToolUse>();
  let inputTokens = 0;
  let emittedToolCalls = 0;
  let receivedMessageStop = false;

  for await (const event of stream) {
    switch (event?.type) {
      case "message_start":
        inputTokens = usageInputTokens(event.message?.usage);
        break;

      case "content_block_start":
        if (
          event.content_block?.type === "tool_use" &&
          emittedToolCalls < PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls
        ) {
          pendingToolUses.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            args: event.content_block.input,
            argsText: "",
          });
        }
        break;

      case "content_block_delta": {
        const delta = event.delta;
        if (delta?.type === "text_delta" && delta.text) {
          onChunk({ type: "content", content: delta.text });
          break;
        }

        if (delta?.type === "thinking_delta" && delta.thinking) {
          if (isReasoningEnabled(reasoningMode)) {
            onChunk({ type: "reasoning", content: delta.thinking });
          }
          break;
        }

        if (delta?.type === "input_json_delta") {
          const pending = pendingToolUses.get(event.index);
          if (!pending || pending.error) break;

          const fragment =
            typeof delta.partial_json === "string" ? delta.partial_json : "";
          if (!fragment) break;

          const nextLength = pending.argsText.length + fragment.length;
          if (nextLength > PLUGIN_EXECUTION_LIMITS.maxArgsJsonChars) {
            pending.error =
              "Tool call arguments are too large to process safely.";
            pending.argsText = pending.argsText.slice(
              0,
              PLUGIN_EXECUTION_LIMITS.maxArgsJsonChars,
            );
            break;
          }

          pending.argsText += fragment;
        }
        break;
      }

      case "content_block_stop": {
        const pending = pendingToolUses.get(event.index);
        if (!pending) break;
        emitAnthropicToolUse(pending, emittedToolCalls, onChunk);
        emittedToolCalls += 1;
        pendingToolUses.delete(event.index);
        break;
      }

      case "message_delta": {
        const outputTokens = Number(event.usage?.output_tokens || 0);
        if (outputTokens > 0) {
          onChunk({
            type: "usage",
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            },
          });
        }
        break;
      }

      case "error":
        throw new Error(
          `Anthropic stream failed: ${event.error?.message || "upstream terminal error"}`,
        );

      case "ping":
        break;

      case "message_stop":
        receivedMessageStop = true;
        break;

      default:
        break;
    }
  }

  if (!receivedMessageStop) {
    throw new IncompleteProviderStreamError(
      "Anthropic stream ended before message_stop.",
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

export async function createAnthropicMessageText({
  client,
  model,
  prompt,
  system,
  signal,
}: {
  client: Anthropic;
  model: string;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const requestParams: any = {
    model,
    max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) requestParams.system = system;

  const message = signal
    ? await client.messages.create(requestParams, { signal })
    : await client.messages.create(requestParams);
  return extractContentText(message.content);
}
