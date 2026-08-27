/**
 * Gemini 流式响应处理器
 */

import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentConfig,
} from "@google/genai";
import { PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import { SSEMessage } from "./sse";
import { finalizeStreamedToolCall } from "./toolCalls";
import { normalizeGeneratedImageAttachment } from "../utils/generatedImages";
import { normalizeSearchSources } from "../search/results";
import type { ReasoningMode } from "@/types";
import {
  isExplicitReasoningEffort,
  isReasoningEnabled,
  normalizeReasoningMode,
} from "../chat/reasoning";
import { IncompleteProviderStreamError } from "../errors";
import type { StructuredResponseFormat } from "../chat/responseFormat";

export interface GeminiStreamOptions {
  client: GoogleGenAI;
  model: string;
  contents: any[];
  systemInstruction?: string;
  temperature?: number;
  responseFormat?: StructuredResponseFormat;
  tools?: any[];
  enableGoogleSearch?: boolean;
  enableImageGeneration?: boolean;
  imageCount?: number;
  useReasoning?: boolean;
  reasoningMode?: ReasoningMode;
  signal?: AbortSignal;
  onChunk: (message: SSEMessage) => void;
}

const GEMINI_THINKING_BUDGETS: Record<
  Exclude<ReasoningMode, "off" | "auto">,
  number
> = {
  low: 1024,
  medium: 8192,
  high: 24576,
};

const GEMINI_THINKING_LEVELS: Record<
  Exclude<ReasoningMode, "off" | "auto">,
  ThinkingLevel
> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function isGemini3Model(modelName: string): boolean {
  return modelName.toLowerCase().startsWith("gemini-3");
}

function isGemini25Model(modelName: string): boolean {
  return modelName.toLowerCase().startsWith("gemini-2.5");
}

function canDisableGeminiThinking(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return (
    lower.startsWith("gemini-2.5") &&
    (lower.includes("flash") || lower.includes("lite")) &&
    !lower.includes("pro")
  );
}

function getGeminiThinkingConfig(
  modelName: string,
  reasoningMode: ReasoningMode,
): GenerateContentConfig["thinkingConfig"] | undefined {
  if (reasoningMode === "off") {
    return canDisableGeminiThinking(modelName)
      ? { thinkingBudget: 0 }
      : undefined;
  }

  if (reasoningMode === "auto") {
    return { includeThoughts: true };
  }

  if (!isExplicitReasoningEffort(reasoningMode)) return undefined;

  if (isGemini3Model(modelName)) {
    return {
      includeThoughts: true,
      thinkingLevel: GEMINI_THINKING_LEVELS[reasoningMode],
    };
  }

  if (isGemini25Model(modelName)) {
    return {
      includeThoughts: true,
      thinkingBudget: GEMINI_THINKING_BUDGETS[reasoningMode],
    };
  }

  return { includeThoughts: true };
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

function extractGeminiGroundingSources(groundingMetadata: any) {
  const chunks = Array.isArray(groundingMetadata?.groundingChunks)
    ? groundingMetadata.groundingChunks
    : [];
  const supports = Array.isArray(groundingMetadata?.groundingSupports)
    ? groundingMetadata.groundingSupports
    : [];

  const sources = chunks
    .map((chunk: any, index: number) => {
      const web = chunk?.web;
      const uri = web?.uri || web?.url;
      if (!uri) return null;

      const support = supports.find((item: any) => {
        const indexes = item?.groundingChunkIndices;
        return Array.isArray(indexes) ? indexes.includes(index) : index === 0;
      });
      const title = web?.title || uri;
      const content = support?.segment?.text || title;
      return {
        title,
        url: uri,
        content,
      };
    })
    .filter(Boolean);

  return normalizeSearchSources(sources);
}

function hasValidGeminiFinishReason(candidates: any): boolean {
  if (!Array.isArray(candidates)) return false;

  return candidates.some((candidate) => {
    if (typeof candidate?.finishReason !== "string") return false;
    const finishReason = candidate.finishReason.trim().toUpperCase();
    return (
      finishReason.length > 0 &&
      finishReason !== "FINISH_REASON_UNSPECIFIED" &&
      finishReason !== "UNSPECIFIED"
    );
  });
}

/**
 * 处理 Gemini 流式响应
 * 注意：由于 Gemini SDK 的限制，这里使用简化的实现
 * 完整的流式处理逻辑保留在原始的 API 路由中
 */
export async function streamGeminiResponse(options: GeminiStreamOptions) {
  const {
    client,
    model: modelName,
    contents,
    systemInstruction,
    temperature = 1,
    responseFormat,
    tools,
    enableGoogleSearch,
    enableImageGeneration,
    imageCount,
    useReasoning,
    reasoningMode: rawReasoningMode,
    signal,
    onChunk,
  } = options;
  const reasoningMode = normalizeReasoningMode(rawReasoningMode, useReasoning);

  const startTime = Date.now();

  // 构建请求参数
  const requestParams: GenerateContentParameters = {
    model: modelName,
    contents,
  };
  const config: GenerateContentConfig = {};

  const effectiveSystemInstruction = appendImageCountInstruction(
    systemInstruction,
    enableImageGeneration ? imageCount : undefined,
  );
  if (effectiveSystemInstruction) {
    config.systemInstruction = effectiveSystemInstruction;
  }

  if (temperature !== undefined) {
    config.temperature = temperature;
  }
  if (responseFormat) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = responseFormat.schema;
  }
  if (signal) {
    config.abortSignal = signal;
  }

  const thinkingConfig = getGeminiThinkingConfig(modelName, reasoningMode);
  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
  }

  const geminiTools: NonNullable<GenerateContentConfig["tools"]> = [];
  if (tools && tools.length > 0) {
    geminiTools.push({ functionDeclarations: tools });
  }
  if (enableGoogleSearch) {
    geminiTools.push({ googleSearch: {} });
  }
  if (geminiTools.length > 0) {
    config.tools = geminiTools;
  }
  if (enableImageGeneration) {
    config.responseModalities = [Modality.TEXT, Modality.IMAGE];
  }

  requestParams.config = config;

  // 调用流式 API
  const stream = await client.models.generateContentStream(requestParams);

  // let fullText = "";
  // let fullReasoning = "";
  let emittedToolCalls = 0;
  let receivedFinishReason = false;

  for await (const chunk of stream) {
    const candidates = (chunk as any).candidates;
    if (hasValidGeminiFinishReason(candidates)) {
      receivedFinishReason = true;
    }

    if (candidates && candidates[0] && candidates[0].content) {
      const candidate = candidates[0];
      const parts = candidate.content.parts;

      for (const part of parts) {
        // 处理思考过程
        if (part.thought && part.text) {
          if (isReasoningEnabled(reasoningMode)) {
            // fullReasoning += part.text;
            onChunk({ type: "reasoning", content: part.text });
          }
        }
        // 处理工具调用
        else if (part.functionCall) {
          if (
            emittedToolCalls >= PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls
          ) {
            continue;
          }

          const fc = part.functionCall;
          const toolCall = finalizeStreamedToolCall(
            {
              id: `call_${Date.now()}_${emittedToolCalls}`,
              name: fc.name,
              args: fc.args,
            },
            emittedToolCalls,
          );
          emittedToolCalls += 1;

          if (toolCall) {
            onChunk({
              type: "tool_call",
              toolCall,
            });
          }
        }
        // 处理文本内容
        else if (part.text) {
          // fullText += part.text;
          onChunk({ type: "content", content: part.text });
        }
        // 处理图片
        else if (part.inlineData) {
          const image = normalizeGeneratedImageAttachment({
            id: `img_${Date.now()}`,
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data,
            fileName: `generated-${Date.now()}.png`,
          });
          if (image) {
            onChunk({
              type: "image",
              image,
            });
          }
        }
      }

      const sources = extractGeminiGroundingSources(
        candidate.groundingMetadata,
      );
      if (sources.length > 0) {
        onChunk({
          type: "search",
          isSearching: false,
          results: { sources, images: [] },
        });
      }
    }

    // 处理使用统计
    if ((chunk as any).usageMetadata) {
      onChunk({
        type: "usage",
        usageMetadata: (chunk as any).usageMetadata,
      });
    }
  }

  if (!receivedFinishReason) {
    throw new IncompleteProviderStreamError(
      "Gemini stream ended before a valid candidate finishReason.",
    );
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
