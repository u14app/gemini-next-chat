import type { ChatConfig } from "./types";
import type { ModelMetadata } from "@/types";
import {
  parseModelString,
  resolveProviderModelMetadata,
  supportsToolCalls,
} from "../utils/model";
import { isReasoningEnabled, resolveReasoningModeForModel } from "./reasoning";
import { normalizeChatMode } from "./mode";

export function resolveEffectiveChatRequestConfig({
  chatConfig,
  selectedModel,
  modelMetadata,
  customModelMetadata,
  searchCompatibility,
}: {
  chatConfig: ChatConfig;
  selectedModel: string;
  modelMetadata: Record<string, ModelMetadata>;
  customModelMetadata: Record<string, ModelMetadata>;
  searchCompatibility?: { enabled: boolean };
}): ChatConfig {
  const { providerId, modelName } = parseModelString(selectedModel);
  const selectedModelMetadata = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const reasoningMode = resolveReasoningModeForModel(
    chatConfig.reasoningMode,
    selectedModelMetadata,
    chatConfig.useReasoning,
  );
  const chatMode = normalizeChatMode(
    chatConfig.chatMode,
    chatConfig.useAgentMode,
    chatConfig.useDeepResearch,
  );
  const toolCallsSupported = supportsToolCalls(selectedModelMetadata);
  const useAgentMode = chatMode === "agent" && toolCallsSupported;
  const useDeepResearch = chatMode === "research" && toolCallsSupported;

  return {
    chatMode,
    useSearch: chatConfig.useSearch && (searchCompatibility?.enabled ?? true),
    useAgentMode,
    useDeepResearch,
    reasoningMode,
    useReasoning: isReasoningEnabled(reasoningMode),
    useRAG: chatConfig.useRAG,
    temperature: chatConfig.temperature,
    imageCount: chatConfig.imageCount,
  };
}
