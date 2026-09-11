import type { ChatConfig, SystemSettings } from "@/types";

/**
 * 默认配置值
 * 定义系统的默认设置和常量
 */

// ============================================================================
// 模型默认配置
// ============================================================================

/**
 * 默认模型配置
 */
export const DEFAULT_MODELS = {
  chat: "gemini-2.0-flash-exp",
  titleGeneration: "gemini-2.0-flash-exp",
  relatedQuestions: "gemini-2.0-flash-exp",
  contextCompression: "gemini-2.0-flash-exp",
  promptOptimization: "gemini-2.0-flash-exp",
  ragQuery: "gemini-2.0-flash-exp",
  memory: "gemini-2.0-flash-exp",
} as const;

/**
 * 模型参数默认值
 */
export const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
} as const;

// ============================================================================
// 聊天默认配置
// ============================================================================

/**
 * 聊天配置默认值
 */
export const DEFAULT_CHAT_CONFIG = {
  chatMode: "auto",
  useSearch: true,
  useReasoning: false,
  useAgentMode: false,
  useDeepResearch: false,
  reasoningMode: "off",
  useRAG: false,
  temperature: 0.7,
} as const satisfies ChatConfig;

/**
 * 系统提示词默认值
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. You support Markdown, LaTeX math, and coding artifacts.`;

// ============================================================================
// 系统设置默认值
// ============================================================================

/**
 * 系统设置默认值
 */
export const DEFAULT_SYSTEM_SETTINGS = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  personality: "default",
  enableAutoScroll: false,
  enableAutoTitle: true,
  enableRelatedQuestions: true,
  enableAutoCompression: true,
  compressionThreshold: 12, // 12 轮对话
  historyKeepCount: 4, // 保留最近 4 轮
  enableAutoImageCompression: true,
  imageCompressionMaxSizeMB: 1,
  imageCompressionMaxWidthOrHeight: 1024,
  enableCodeCollapse: false,
  enableHtmlVisualPrompt: true,
  enableDestructiveToolConfirmation: true,
  fontSize: "medium",
} as const satisfies SystemSettings;

// ============================================================================
// RAG 默认配置
// ============================================================================

/**
 * RAG 配置默认值
 */
export const DEFAULT_RAG_CONFIG = {
  enabled: false,
  url: "",
  token: "",
  topK: 5,
  chunkSize: 1000,
  llamaParseApiKey: "",
  namespace: "default",
} as const;

// ============================================================================
// 搜索默认配置
// ============================================================================

/**
 * 搜索配置默认值
 */
export const DEFAULT_SEARCH_CONFIG = {
  provider: "firecrawl" as const,
  resultsLimit: 5,
} as const;

// ============================================================================
// 语音默认配置
// ============================================================================

/**
 * 语音配置默认值
 */
export const DEFAULT_VOICE_SETTINGS = {
  sttProvider: "browser" as const,
  sttLanguage: "auto" as const,
  ttsProvider: "browser" as const,
  ttsVoiceId: "bIHbv24MWmeRgasZH58o" as const, // Will
  mimoTtsVoiceId: "mimo_default" as const,
  ttsLanguage: "auto" as const,
  elevenLabsApiKey: "",
  mimoApiKey: "",
  autoTranscribe: true,
} as const;

// ============================================================================
// UI 默认配置
// ============================================================================

/**
 * UI 配置默认值
 */
export const DEFAULT_UI_CONFIG = {
  theme: "system" as const,
  language: "auto" as const,
  sidebarWidth: 280,
  messageMaxWidth: 800,
} as const;

// ============================================================================
// 限制和约束
// ============================================================================

/**
 * 文件上传限制
 */
export const FILE_UPLOAD_LIMITS = {
  maxSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 10,
  allowedTypes: ["image/*", "text/*", "application/pdf", "application/json"],
} as const;

/**
 * 消息限制
 */
export const MESSAGE_LIMITS = {
  maxLength: 32000, // 最大字符数
  maxAttachments: 10,
  maxToolCalls: 20,
} as const;

/**
 * 会话限制
 */
export const SESSION_LIMITS = {
  maxSessions: 1000,
  maxMessagesPerSession: 10000,
  maxTitleLength: 100,
} as const;

// ============================================================================
// 时间常量
// ============================================================================

/**
 * 时间常量（毫秒）
 */
export const TIME_CONSTANTS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
} as const;

// ============================================================================
// 颜色主题
// ============================================================================

/**
 * 预设颜色
 */
export const PRESET_COLORS = [
  "bg-red-100 text-red-600",
  "bg-orange-100 text-orange-600",
  "bg-yellow-100 text-yellow-600",
  "bg-green-100 text-green-600",
  "bg-blue-100 text-blue-600",
  "bg-indigo-100 text-indigo-600",
  "bg-purple-100 text-purple-600",
  "bg-pink-100 text-pink-600",
  "bg-gray-100 text-gray-600",
] as const;

/**
 * 图标选项
 */
export const PRESET_ICONS = [
  "📊",
  "⚽",
  "💯",
  "🔠",
  "🎨",
  "🔧",
  "📚",
  "🎵",
  "🎮",
  "🌟",
  "🚀",
  "💡",
] as const;
