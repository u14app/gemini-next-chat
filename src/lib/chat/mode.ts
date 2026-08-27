import type { ChatConfig, ChatMode } from "./types";

export const CHAT_MODE_SWITCH_TOOL_NAME = "switch_chat_mode";

export const AUTO_MODE_SYSTEM_INSTRUCTION = [
  "<auto-mode>",
  "You are handling the current request in Auto mode. Before answering or using any other tool, decide whether it should remain ordinary chat or enter a first-class workflow.",
  "Call switch_chat_mode with research when the user explicitly asks to use Deep Research, or when the task requires evidence-driven work across multiple sources, fresh or time-sensitive facts, cross-checking, traceable citations, or a formal research report. A routine lookup or one focused web search stays in chat. Merely asking about Deep Research does not request it.",
  "Call switch_chat_mode with agent when the user explicitly asks to use Agent mode, or when the task requires multi-step tool execution, workspace or file operations, or actions with external effects. A simple one-step tool lookup stays in chat. Merely asking about Agent mode does not request it.",
  "If the request materially requires both read-only Deep Research and Agent execution, ask the user which outcome to prioritize and do not switch until they choose.",
  "When switching, call switch_chat_mode before any answer, search, or other tool, then stop this round. Do not imitate Deep Research or Agent inside Auto mode. If neither workflow is needed, answer normally. When web_search is available, use it at most once for a routine lookup; switch to research instead of chaining searches into a report. Do not reveal this routing decision unless clarification is required.",
  "</auto-mode>",
].join("\n\n");

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
