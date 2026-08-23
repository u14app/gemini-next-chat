import type { Message } from "@/types";
import { getTaskModel } from "@/store/core/settingsStore";
import { useMemoryStore } from "@/store/core/memoryStore";
import {
  parseMemoryDreamToolCall,
  parseMemoryRecordToolCall,
} from "@/lib/memory/entities";
import {
  createMemoryDreamPrompt,
  createMemoryExtractionPrompt,
  MEMORY_DREAM_TOOL,
  MEMORY_DREAM_TOOL_NAME,
  MEMORY_RECORD_TOOL,
  MEMORY_RECORD_TOOL_NAME,
} from "@/lib/memory/tools";
import { logDevWarn } from "@/lib/utils/devLogger";
import { MEMORY_LIMITS } from "@/config/limits";
import { isBrowserMemoryStorePendingHydration } from "./builtinTools/memorySearch";
import { coerceToolDefinition } from "./toolConfirmation";
import { createAbortError, isAbortError } from "./streamErrors";
import { streamGenerateToolCall } from "./simpleGeneration";

export const performBackgroundMemoryExtraction = async ({
  sessionId,
  userMessage,
  assistantMessage,
  signal,
}: {
  sessionId: string;
  userMessage: Pick<Message, "id" | "content">;
  assistantMessage: Pick<Message, "id" | "content">;
  signal?: AbortSignal;
}) => {
  if (signal?.aborted) throw createAbortError(signal);
  const state = useMemoryStore.getState();
  const { _hasHydrated, settings } = state;
  if (
    isBrowserMemoryStorePendingHydration(_hasHydrated) ||
    !settings.enabled ||
    !settings.autoRecordEnabled
  ) {
    return [];
  }
  if (!userMessage.content.trim() || !assistantMessage.content.trim()) {
    return [];
  }

  const toolCall = await streamGenerateToolCall(
    getTaskModel("memory"),
    createMemoryExtractionPrompt({
      userMessage: userMessage.content,
      assistantMessage: assistantMessage.content,
    }),
    [coerceToolDefinition(MEMORY_RECORD_TOOL)],
    signal,
  );
  if (signal?.aborted) throw createAbortError(signal);

  if (!toolCall || toolCall.name !== MEMORY_RECORD_TOOL_NAME) return [];

  const memories = parseMemoryRecordToolCall(toolCall.args, {
    source: "ai",
    sourceSessionId: sessionId,
    sourceMessageIds: [userMessage.id, assistantMessage.id],
  });
  if (memories.length === 0) return [];
  if (signal?.aborted) throw createAbortError(signal);

  const saved = useMemoryStore.getState().upsertMemories(memories);
  const nextState = useMemoryStore.getState();
  if (
    nextState.settings.enabled &&
    nextState.settings.dreamEnabled &&
    nextState.memories.length > nextState.settings.triggerCount
  ) {
    void performMemoryDream({ force: false, signal }).catch((error) => {
      if (!isAbortError(error, signal)) {
        logDevWarn("Memory dream failed:", error);
      }
    });
  }

  return saved;
};

export const performMemoryDream = async ({
  force = false,
  signal,
}: {
  force?: boolean;
  signal?: AbortSignal;
} = {}) => {
  if (signal?.aborted) throw createAbortError(signal);
  const state = useMemoryStore.getState();
  const { _hasHydrated, settings, memories, dreamStatus } = state;
  if (
    isBrowserMemoryStorePendingHydration(_hasHydrated) ||
    !settings.enabled ||
    !settings.dreamEnabled ||
    dreamStatus.isRunning
  ) {
    return null;
  }
  if (memories.length <= settings.targetCount) return null;
  if (!force && memories.length <= settings.triggerCount) return null;

  state.startDream();
  try {
    const targetCount = Math.min(
      settings.targetCount,
      MEMORY_LIMITS.targetCount,
    );
    const toolCall = await streamGenerateToolCall(
      getTaskModel("memory"),
      createMemoryDreamPrompt({ memories, targetCount }),
      [coerceToolDefinition(MEMORY_DREAM_TOOL)],
      signal,
    );

    if (!toolCall || toolCall.name !== MEMORY_DREAM_TOOL_NAME) {
      throw new Error("Memory dream did not return a valid tool call.");
    }

    const dreamed = parseMemoryDreamToolCall(toolCall.args, {
      targetCount,
    });

    if (dreamed.length === 0 || dreamed.length > targetCount) {
      throw new Error("Memory dream returned an invalid memory set.");
    }

    if (signal?.aborted) throw createAbortError(signal);
    useMemoryStore.getState().replaceMemories(dreamed);
    useMemoryStore.getState().finishDream();
    return dreamed;
  } catch (error) {
    if (isAbortError(error, signal)) {
      useMemoryStore.getState().finishDream();
      throw createAbortError(signal);
    }
    const message = error instanceof Error ? error.message : String(error);
    useMemoryStore.getState().finishDream(message);
    logDevWarn("Memory dream failed:", error);
    return null;
  }
};
