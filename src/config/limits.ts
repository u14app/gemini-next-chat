import type { Attachment } from "@/types";

export const ATTACHMENT_LIMITS = {
  maxCount: 20,
  maxFileBytes: 10 * 1024 * 1024,
  maxBase64Chars: 30 * 1024 * 1024,
  maxTotalBase64Chars: 30 * 1024 * 1024,
  maxUrlChars: 4_096,
  maxFileNameChars: 512,
  maxMimeTypeChars: 200,
} as const;

export const IMAGE_ATTACHMENT_LIMITS = {
  compressionThresholdBytes: 10 * 1024 * 1024,
  maxSourceBytes: 20 * 1024 * 1024,
  maxCompressedBytes: 5 * 1024 * 1024,
  maxRequestFileBytes: 10 * 1024 * 1024,
} as const;

const MAX_ATTACHMENT_FILE_BYTES_ENV = "MAX_ATTACHMENT_FILE_BYTES";
const ATTACHMENT_BASE64_DECODE_RATIO = 3 / 4;

export const ATTACHMENT_LIMIT_HARD_MAX_FILE_BYTES = Math.floor(
  Math.min(
    ATTACHMENT_LIMITS.maxBase64Chars,
    ATTACHMENT_LIMITS.maxTotalBase64Chars,
  ) * ATTACHMENT_BASE64_DECODE_RATIO,
);

function getProcessEnv(): Record<string, string | undefined> {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return globalWithProcess.process?.env || {};
}

export function normalizeMaxAttachmentFileBytes(value: unknown): number {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Math.floor(Number(value))
      : NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ATTACHMENT_LIMITS.maxFileBytes;
  }

  return Math.min(parsed, ATTACHMENT_LIMIT_HARD_MAX_FILE_BYTES);
}

export function getRuntimeMaxAttachmentFileBytes(
  env: Record<string, string | undefined> = getProcessEnv(),
): number {
  return normalizeMaxAttachmentFileBytes(env[MAX_ATTACHMENT_FILE_BYTES_ENV]);
}

export const VOICE_LIMITS = {
  maxTranscriptionAudioBytes: 25 * 1024 * 1024,
} as const;

export const DOCUMENT_LIMITS = {
  maxParseFileBytes: 50 * 1024 * 1024,
  maxMineruAgentParseFileBytes: 10 * 1024 * 1024,
  maxMineruZipEntries: 100,
  maxMineruZipDecompressedBytes: 60 * 1024 * 1024,
  maxMineruZipCompressionRatio: 100,
  maxMineruFullMarkdownBytes: 20 * 1024 * 1024,
  maxMineruFullMarkdownChars: 20 * 1024 * 1024,
} as const;

export const KNOWLEDGE_LIMITS = {
  maxCollections: 100,
  maxCollectionIdChars: 120,
  maxCollectionNameChars: 120,
  maxCollectionDescriptionChars: 1_000,
  maxCollectionIconChars: 80,
  maxCollectionColorChars: 40,
  maxFilesPerCollection: 100,
  maxFileBytes: DOCUMENT_LIMITS.maxParseFileBytes,
  maxFileIdChars: 120,
  maxFileNameChars: 512,
  maxMimeTypeChars: 200,
  maxPathChars: 4_096,
  maxErrorChars: 1_000,
  maxRagIdChars: 160,
  maxRagChunkCount: 100_000,
} as const;

export const RAG_LIMITS = {
  maxItemsPerRequest: 1_000,
  minTopK: 1,
  maxTopK: 20,
  minChunkSize: 256,
  maxChunkSize: 8_192,
  maxBaseUrlChars: 2_048,
  maxTokenChars: 16_384,
  maxLlamaParseApiKeyChars: 16_384,
  maxMineruApiTokenChars: 16_384,
  maxNamespaceChars: 200,
} as const;

export const SEARCH_CONFIG_LIMITS = {
  minResultsLimit: 1,
  maxResultsLimit: 10,
  maxApiKeyChars: 16_384,
  maxBaseUrlChars: 2_048,
} as const;

export const SEARCH_RESULT_LIMITS = {
  maxSources: 20,
  maxImages: 20,
  maxTitleChars: 500,
  maxContentChars: 20_000,
  maxUrlChars: 4_096,
  maxImageDescriptionChars: 500,
} as const;

export const MEMORY_LIMITS = {
  maxMemories: 500,
  triggerCount: 100,
  targetCount: 50,
  defaultSearchResults: 5,
  maxSearchResults: 10,
  maxContentChars: 2_000,
  maxTagChars: 40,
  maxTags: 12,
  maxTypeChars: 40,
  maxToolResultContentChars: 700,
  maxExtractionContextChars: 12_000,
  maxDreamPromptChars: 80_000,
} as const;

export const PROVIDER_MODEL_LIMITS = {
  maxModels: 500,
  maxModelIdChars: 300,
} as const;

export const PROVIDER_CONFIG_LIMITS = {
  maxProviders: 20,
  maxProviderIdChars: 40,
  maxProviderNameChars: 120,
  maxBaseUrlChars: 2_048,
  maxApiKeyChars: 8_192,
} as const;

export const MODEL_METADATA_LIMITS = {
  maxEntries: 1_000,
  maxIdChars: PROVIDER_MODEL_LIMITS.maxModelIdChars,
  maxNameChars: 200,
  maxFamilyChars: 120,
  maxKnowledgeChars: 500,
  maxDateChars: 80,
  maxModalities: 12,
  maxModalityChars: 40,
  maxContextTokens: 10_000_000,
  maxOutputTokens: 1_000_000,
} as const;

export const API_INPUT_LIMITS = {
  maxJsonBodyBytes: 36 * 1024 * 1024,
  maxMultipartOverheadBytes: 1024 * 1024,
  maxModelNameChars: 300,
  maxChatTextChars: 200_000,
  maxSystemInstructionChars: 200_000,
  maxSimplePromptChars: 200_000,
  maxAuxiliaryTextChars: 20_000,
  maxAuxiliaryPromptContextChars: 4_000,
} as const;

export const AUXILIARY_OUTPUT_LIMITS = {
  maxRelatedQuestions: 5,
  maxRelatedQuestionChars: 240,
  maxRagQueries: 3,
  maxRagQueryChars: 300,
} as const;

export const CONTEXT_COMPRESSION_LIMITS = {
  maxSummarySourceChars: 160_000,
  maxCompressedContentChars: 200_000,
  base64ChunkBytes: 24_576,
} as const;

export const PROMPT_CONTEXT_LIMITS = {
  maxConvertedContentChars: 160_000,
  maxSingleFileContentChars: 60_000,
  maxFileNameChars: 300,
  maxMimeTypeChars: 200,
  maxSourceTitleChars: 500,
  maxSourceContentChars: 20_000,
} as const;

export const CHAT_CONFIG_LIMITS = {
  minTemperature: 0,
  maxTemperature: 2,
  defaultTemperature: 0.7,
} as const;

export const SYSTEM_SETTINGS_LIMITS = {
  maxSystemPromptChars: API_INPUT_LIMITS.maxSystemInstructionChars,
  minCompressionThreshold: 4,
  maxCompressionThreshold: 20,
  defaultCompressionThreshold: 12,
  minHistoryKeepCount: 1,
  maxHistoryKeepCount: 10,
  defaultHistoryKeepCount: 4,
  minImageCompressionMaxSizeMB: 0.5,
  maxImageCompressionMaxSizeMB: 5,
  defaultImageCompressionMaxSizeMB: 1,
  imageCompressionMaxSizeMBStep: 0.5,
  minImageCompressionMaxWidthOrHeight: 512,
  maxImageCompressionMaxWidthOrHeight: 4_096,
  defaultImageCompressionMaxWidthOrHeight: 1_024,
  imageCompressionMaxWidthOrHeightStep: 256,
} as const;

export const CHAT_ENTITY_LIMITS = {
  maxSessionTitleChars: 120,
  maxSessionSystemInstructionChars: API_INPUT_LIMITS.maxSystemInstructionChars,
  maxWorkspaceNameChars: 120,
  maxWorkspaceSystemPromptChars: API_INPUT_LIMITS.maxSystemInstructionChars,
  maxWorkspaceColorChars: 40,
  maxWorkspaceKnowledgeCollections: 100,
  maxWorkspaceKnowledgeCollectionIdChars: 120,
} as const;

export const CLIENT_URL_LIMITS = {
  maxInlineImageDataUrlChars: 2 * 1024 * 1024,
} as const;

export const IMAGE_PREVIEW_LIMITS = {
  maxImages: 100,
  maxAltChars: 500,
  maxDescriptionChars: 500,
} as const;

export const IMAGE_GENERATION_LIMITS = {
  minCount: 1,
  maxCount: 4,
} as const;

export const HTML_PREVIEW_LIMITS = {
  maxSrcDocChars: 500_000,
} as const;

export const MARKDOWN_FILE_LIMITS = {
  maxFiles: 20,
  maxFileNameChars: 300,
  maxMimeTypeChars: 200,
  maxFileContentChars: 120_000,
} as const;

export const BROWSER_SANDBOX_LIMITS = {
  maxCodeChars: 100_000,
  maxOutputChars: 20_000,
  executionTimeoutMs: 10_000,
} as const;

export const AGENT_FETCH_URL_LIMITS = {
  maxResponseBytes: 2 * 1024 * 1024,
  maxContentChars: 40_000,
  timeoutMs: 15_000,
} as const;

export const AGENT_WORKSPACE_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxPathChars: 256,
  maxPathSegmentChars: 120,
  maxPathDepth: 6,
  /** Cap on the text returned by a single read_workspace_file call. */
  maxReadChars: 60_000,
  maxListEntries: 50,
  /** Files that a single run_javascript call may load into the sandbox. */
  maxSandboxReadFiles: 10,
  /** Total characters injected into, or captured out of, one sandbox run. */
  maxSandboxFileChars: 200_000,
  maxSandboxWriteFiles: 10,
  /** Caps on a single search_workspace_files call. */
  maxSearchMatches: 50,
  maxSearchLineChars: 200,
  maxSearchScanChars: 2_000_000,
} as const;

/**
 * Archives live outside the workspace quota, in their own OPFS root, so
 * bundling a nearly-full workspace never fails on quota. They therefore need
 * their own independent caps.
 */
export const AGENT_ARCHIVE_LIMITS = {
  maxEntries: 50,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxArchiveBytes: 25 * 1024 * 1024,
  maxArchivesPerSession: 5,
  maxArchiveNameChars: 80,
} as const;

export const TASK_PLAN_LIMITS = {
  maxSteps: 20,
  maxTitleChars: 200,
  maxNoteChars: 500,
} as const;

export const TOOL_DISPLAY_LIMITS = {
  maxRenderedChars: 30_000,
  maxStringChars: 4_000,
  maxDepth: 6,
  maxArrayItems: 80,
  maxObjectEntries: 80,
  maxToolNameChars: 160,
} as const;

export const REASONING_UI_LIMITS = {
  maxTitleScanChars: 20_000,
  maxTranslationInputChars: 40_000,
} as const;

export const ARTIFACT_PROMPT_LIMITS = {
  maxArtifactContentChars: 80_000,
  maxSystemInstructionChars: 40_000,
  maxPromptChars: API_INPUT_LIMITS.maxSimplePromptChars,
} as const;

export const DOWNLOAD_LIMITS = {
  maxFileNameChars: 180,
} as const;

export const MARKET_LIMITS = {
  maxAgents: 500,
  maxPluginListResponseBytes: 16 * 1024 * 1024,
  maxAgentIdentifierChars: 120,
  maxAgentTitleChars: 160,
  maxAgentDescriptionChars: 1_000,
  maxAgentAvatarChars: 4_096,
  maxAgentCategoryChars: 80,
  maxAgentAuthorChars: 120,
  maxAgentHomepageChars: 4_096,
  maxAgentCreatedAtChars: 80,
  maxAgentTags: 12,
  maxAgentTagChars: 60,
  maxAgentSystemRoleChars: 200_000,
  maxCustomAgents: 100,
  maxUsedAgents: 50,
  maxPlugins: 100,
  maxPluginIdChars: 160,
  maxPluginTitleChars: 160,
  maxPluginDescriptionChars: 1_000,
  maxPluginLogoUrlChars: 4_096,
  maxPluginManifestUrlChars: 4_096,
  maxPluginDocsUrlChars: 4_096,
  maxPluginCategoryChars: 80,
  maxPluginCategories: 8,
  maxSkills: 500,
  maxSkillIdChars: 160,
  maxSkillTitleChars: 160,
  maxSkillDescriptionChars: 1_000,
  maxSkillCategoryChars: 80,
  maxSkillTags: 12,
  maxSkillTagChars: 60,
  maxSkillContentChars: 200_000,
  maxCustomSkills: 100,
  maxActiveSkills: 20,
} as const;

export const PLUGIN_CONFIG_LIMITS = {
  maxPluginConfigs: MARKET_LIMITS.maxPlugins,
  maxActivePlugins: MARKET_LIMITS.maxPlugins,
  maxFunctionRefs: 100,
  maxFunctionNameChars: 160,
  maxModelNameChars: API_INPUT_LIMITS.maxModelNameChars,
  maxAuthValueChars: 16_384,
  maxAuthKeyChars: 200,
  maxBaseUrlChars: 2_048,
} as const;

export const PLUGIN_EXECUTION_LIMITS = {
  maxFunctionNameChars: 128,
  maxArgsJsonChars: 256 * 1024,
  maxRequestBodyChars: 512 * 1024,
  maxArgDepth: 20,
  maxArgEntries: 5_000,
  maxToolRounds: 20,
  maxStreamedToolCalls: 100,
  maxToolConcurrency: 4,
  maxTotalToolCalls: 100,
  maxToolCallIdChars: 200,
} as const;

export const GLOBAL_SEARCH_LIMITS = {
  maxDocuments: 50_000,
  maxMetadataDocuments: 100_000,
  maxSingleContentChars: 100_000,
  maxTotalContentChars: 5_000_000,
  yieldEveryDocuments: 25,
  maxResults: 100,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function getAttachmentPayloadChars(attachment: Attachment): number {
  return attachment.data?.length || 0;
}

export function getAttachmentPayloadBytes(attachment: Attachment): number {
  const data = attachment.data?.trim();
  if (!data) return 0;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export function getAttachmentsPayloadChars(attachments: Attachment[]): number {
  return attachments.reduce(
    (total, attachment) => total + getAttachmentPayloadChars(attachment),
    0,
  );
}
