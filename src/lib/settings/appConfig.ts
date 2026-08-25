import { CHAT_CONFIG_LIMITS, SYSTEM_SETTINGS_LIMITS } from "@/config/limits";
import {
  DEFAULT_CHAT_CONFIG,
  DEFAULT_SYSTEM_SETTINGS,
} from "@/config/defaults";
import type { ChatConfig, SystemSettings } from "@/types";
import { normalizeReasoningMode, isReasoningEnabled } from "../chat/reasoning";
import { normalizeChatMode } from "../chat/mode";

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function trimString(value: unknown, maxChars: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxChars);
}

function normalizeFontSize(
  value: unknown,
  fallback: SystemSettings["fontSize"],
): SystemSettings["fontSize"] {
  return value === "small" || value === "medium" || value === "large"
    ? value
    : fallback;
}

function normalizeSystemPersonality(
  value: unknown,
  fallback: SystemSettings["personality"],
): SystemSettings["personality"] {
  return value === "default" ||
    value === "professional" ||
    value === "friendly" ||
    value === "direct" ||
    value === "imaginative" ||
    value === "efficient" ||
    value === "snarky"
    ? value
    : fallback;
}

export function normalizeChatConfig(config: unknown): ChatConfig {
  const raw =
    config && typeof config === "object" ? (config as Partial<ChatConfig>) : {};
  const reasoningMode = normalizeReasoningMode(
    raw.reasoningMode,
    raw.useReasoning,
    DEFAULT_CHAT_CONFIG.reasoningMode,
  );
  const chatMode = normalizeChatMode(
    raw.chatMode,
    raw.useAgentMode,
    raw.useDeepResearch,
  );

  return {
    chatMode,
    useSearch:
      typeof raw.useSearch === "boolean"
        ? raw.useSearch
        : DEFAULT_CHAT_CONFIG.useSearch,
    useAgentMode: chatMode === "agent",
    useDeepResearch: chatMode === "research",
    useReasoning: isReasoningEnabled(reasoningMode),
    reasoningMode,
    useRAG:
      typeof raw.useRAG === "boolean" ? raw.useRAG : DEFAULT_CHAT_CONFIG.useRAG,
    temperature: clampNumber(
      raw.temperature,
      CHAT_CONFIG_LIMITS.minTemperature,
      CHAT_CONFIG_LIMITS.maxTemperature,
      DEFAULT_CHAT_CONFIG.temperature,
    ),
  };
}

export function normalizeSystemSettings(
  settings: unknown,
  defaults: SystemSettings = DEFAULT_SYSTEM_SETTINGS,
): SystemSettings {
  const raw =
    settings && typeof settings === "object"
      ? (settings as Partial<SystemSettings>)
      : {};

  return {
    systemPrompt: trimString(
      raw.systemPrompt,
      SYSTEM_SETTINGS_LIMITS.maxSystemPromptChars,
      defaults.systemPrompt,
    ),
    personality: normalizeSystemPersonality(
      raw.personality,
      defaults.personality,
    ),
    enableAutoScroll:
      typeof raw.enableAutoScroll === "boolean"
        ? raw.enableAutoScroll
        : defaults.enableAutoScroll,
    enableAutoTitle:
      typeof raw.enableAutoTitle === "boolean"
        ? raw.enableAutoTitle
        : defaults.enableAutoTitle,
    enableRelatedQuestions:
      typeof raw.enableRelatedQuestions === "boolean"
        ? raw.enableRelatedQuestions
        : defaults.enableRelatedQuestions,
    enableAutoCompression:
      typeof raw.enableAutoCompression === "boolean"
        ? raw.enableAutoCompression
        : defaults.enableAutoCompression,
    compressionThreshold: clampInteger(
      raw.compressionThreshold,
      SYSTEM_SETTINGS_LIMITS.minCompressionThreshold,
      SYSTEM_SETTINGS_LIMITS.maxCompressionThreshold,
      defaults.compressionThreshold,
    ),
    historyKeepCount: clampInteger(
      raw.historyKeepCount,
      SYSTEM_SETTINGS_LIMITS.minHistoryKeepCount,
      SYSTEM_SETTINGS_LIMITS.maxHistoryKeepCount,
      defaults.historyKeepCount,
    ),
    enableAutoImageCompression:
      typeof raw.enableAutoImageCompression === "boolean"
        ? raw.enableAutoImageCompression
        : defaults.enableAutoImageCompression,
    imageCompressionMaxSizeMB: clampNumber(
      raw.imageCompressionMaxSizeMB,
      SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxSizeMB,
      SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxSizeMB,
      defaults.imageCompressionMaxSizeMB,
    ),
    imageCompressionMaxWidthOrHeight: clampInteger(
      raw.imageCompressionMaxWidthOrHeight,
      SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxWidthOrHeight,
      SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxWidthOrHeight,
      defaults.imageCompressionMaxWidthOrHeight,
    ),
    enableCodeCollapse:
      typeof raw.enableCodeCollapse === "boolean"
        ? raw.enableCodeCollapse
        : defaults.enableCodeCollapse,
    enableHtmlVisualPrompt:
      typeof raw.enableHtmlVisualPrompt === "boolean"
        ? raw.enableHtmlVisualPrompt
        : defaults.enableHtmlVisualPrompt,
    enableDestructiveToolConfirmation:
      typeof raw.enableDestructiveToolConfirmation === "boolean"
        ? raw.enableDestructiveToolConfirmation
        : defaults.enableDestructiveToolConfirmation,
    fontSize: normalizeFontSize(raw.fontSize, defaults.fontSize),
  };
}
