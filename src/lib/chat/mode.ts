import type { ChatConfig, ChatMode } from "./types";

export const CHAT_MODE_SWITCH_TOOL_NAME = "switch_chat_mode";

const CHAT_MODE_ORDER = ["auto", "chat", "research", "agent"] as const;
const CHAT_MODES = new Set<ChatMode>(CHAT_MODE_ORDER);

export function getNextSupportedChatMode(
  currentMode: ChatMode,
  supportedModes: readonly ChatMode[],
): ChatMode {
  const supported = new Set(supportedModes);
  const currentIndex = CHAT_MODE_ORDER.indexOf(currentMode);

  for (let offset = 1; offset <= CHAT_MODE_ORDER.length; offset += 1) {
    const candidate =
      CHAT_MODE_ORDER[(currentIndex + offset) % CHAT_MODE_ORDER.length];
    if (supported.has(candidate)) return candidate;
  }

  return currentMode;
}

export function normalizeChatMode(
  value: unknown,
  legacyUseAgentMode?: unknown,
  legacyUseDeepResearch?: unknown,
): ChatMode {
  if (typeof value === "string" && CHAT_MODES.has(value as ChatMode)) {
    return value as ChatMode;
  }
  if (legacyUseDeepResearch === true) return "research";
  if (legacyUseAgentMode === true) return "agent";
  return "auto";
}

export function applyChatMode<T extends Partial<ChatConfig>>(
  config: T,
  chatMode: ChatMode,
): T & Pick<ChatConfig, "chatMode" | "useAgentMode" | "useDeepResearch"> {
  return {
    ...config,
    chatMode,
    useAgentMode: chatMode === "agent",
    useDeepResearch: chatMode === "research",
  };
}
