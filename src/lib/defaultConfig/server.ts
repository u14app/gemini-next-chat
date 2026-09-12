import "server-only";
import { isSharingAvailable } from "@/lib/sharing/config";

import {
  RAG_LIMITS,
  SEARCH_CONFIG_LIMITS,
  SYSTEM_SETTINGS_LIMITS,
  getRuntimeMaxAttachmentFileBytes,
} from "@/config/limits";
import { DEFAULT_SYSTEM_SETTINGS } from "@/config/defaults";
import { normalizeProviderModelId } from "../providers/models";
import { normalizeSystemSettings } from "../settings/appConfig";
import type {
  DefaultModels,
  DocumentParseProvider,
  MimoVoiceID,
  ModelMetadata,
  ProviderType,
  SearchProviderID,
  ServerDefaultVoiceProvider,
  SystemSettings,
  VoiceSettings,
} from "@/types";
import {
  PublicServerConfig,
  PublicDeploymentStoreState,
  SERVER_DEFAULT_PROVIDER_ID,
} from "./shared";
import { normalizeProviderTypeValue } from "../providers/providerTypes";
import { normalizeModelMetadata } from "../providers/metadata";
import { getDeploymentMode } from "../security/deployment";
import { isAccessPasswordEnabled } from "../security/accessControl";
import {
  DEFAULT_ELEVENLABS_TTS_MODEL,
  isElevenLabsSTTModel,
  isElevenLabsTTSModel,
} from "../utils/voiceModels";
import { normalizeDocumentParseProvider } from "../settings/searchRag";
import { getApiProofPublicStatus } from "../security/requestProof";

const DEFAULT_PROVIDER_NAME = "Default";
const DEFAULT_ELEVENLABS_STT_MODEL = "scribe_v2";
const DEFAULT_ELEVENLABS_TTS_VOICE_ID: VoiceSettings["ttsVoiceId"] =
  "bIHbv24MWmeRgasZH58o";
const DEFAULT_MIMO_STT_MODEL = "mimo-v2.5-asr";
const DEFAULT_MIMO_TTS_MODEL = "mimo-v2.5-tts";
const DEFAULT_MIMO_TTS_VOICE_ID: MimoVoiceID = "mimo_default";
const MIMO_TTS_VOICE_IDS = new Set<MimoVoiceID>([
  "mimo_default",
  "冰糖",
  "茉莉",
  "苏打",
  "白桦",
  "Mia",
  "Chloe",
  "Milo",
  "Dean",
]);

type ConfigurableSearchProvider = Exclude<
  SearchProviderID,
  "default" | "google"
>;

const SEARCH_PROVIDERS = new Set<ConfigurableSearchProvider>([
  "tavily",
  "firecrawl",
  "exa",
  "bocha",
  "searxng",
]);

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

function envWithDefault(name: string, defaultValue: string): string {
  const value = process.env[name];
  return value === undefined ? defaultValue : value.trim();
}

function dedupeModels(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function envList(name: string): string[] {
  return dedupeModels(
    env(name)
      .split(",")
      .map((item) => normalizeProviderModelId(item))
      .filter((item): item is string => Boolean(item)),
  );
}

function readProviderModelCapability(
  capabilities: unknown,
  key: string,
): boolean | undefined {
  const aliases = new Set(
    key === "image_generation"
      ? ["image_generation", "image_output"]
      : key === "image_editing"
        ? ["image_editing", "image_edit"]
        : [key],
  );

  if (Array.isArray(capabilities)) {
    return capabilities.some(
      (item) =>
        typeof item === "string" && aliases.has(item.trim().toLowerCase()),
    )
      ? true
      : undefined;
  }

  if (!capabilities || typeof capabilities !== "object") return undefined;
  const record = capabilities as Record<string, unknown>;
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readEnvModalities(value: Record<string, unknown>) {
  const modalities =
    value.modalities && typeof value.modalities === "object"
      ? (value.modalities as Record<string, unknown>)
      : {};
  return {
    input: Array.isArray(modalities.input) ? modalities.input : undefined,
    output: Array.isArray(modalities.output) ? modalities.output : undefined,
  };
}

function modelMetadataFromEnvObject(
  value: Record<string, unknown>,
  modelId: string,
): ModelMetadata | null {
  const capabilities = value.capabilities;
  const explicitModalities = readEnvModalities(value);
  const inputModalities = explicitModalities.input
    ? [...explicitModalities.input]
    : [
        ...(readProviderModelCapability(capabilities, "vision") === true
          ? ["image"]
          : []),
        ...(readProviderModelCapability(capabilities, "image_editing") === true
          ? ["image"]
          : []),
        ...(readProviderModelCapability(capabilities, "audio") === true
          ? ["audio"]
          : []),
      ];
  if (inputModalities.length > 0) inputModalities.push("text");
  const outputModalities = explicitModalities.output
    ? [...explicitModalities.output]
    : [
        ...(readProviderModelCapability(capabilities, "image_generation") ===
        true
          ? ["image"]
          : []),
        ...(readProviderModelCapability(capabilities, "image_editing") === true
          ? ["image"]
          : []),
      ];

  return normalizeModelMetadata(
    {
      id: modelId,
      name: value.name,
      attachment: readProviderModelCapability(capabilities, "attachment"),
      reasoning: readProviderModelCapability(capabilities, "reasoning"),
      reasoning_options: value.reasoning_options,
      tool_call: readProviderModelCapability(capabilities, "tool_call"),
      ...(inputModalities.length > 0 || outputModalities.length > 0
        ? {
            modalities: {
              ...(inputModalities.length > 0 ? { input: inputModalities } : {}),
              ...(outputModalities.length > 0
                ? { output: outputModalities }
                : {}),
            },
          }
        : {}),
    },
    modelId,
  );
}

function getDefaultProviderModels(): {
  models: string[];
  modelMetadata: Record<string, ModelMetadata>;
} {
  const raw = env("DEFAULT_PROVIDER_MODELS");
  if (!raw) return { models: [], modelMetadata: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { models: envList("DEFAULT_PROVIDER_MODELS"), modelMetadata: {} };
  }

  if (!Array.isArray(parsed)) {
    return { models: envList("DEFAULT_PROVIDER_MODELS"), modelMetadata: {} };
  }

  const models: string[] = [];
  const modelMetadata: Record<string, ModelMetadata> = {};
  const seen = new Set<string>();

  for (const item of parsed) {
    const modelId =
      typeof item === "string"
        ? normalizeProviderModelId(item)
        : item && typeof item === "object"
          ? normalizeProviderModelId((item as Record<string, unknown>).id)
          : null;
    if (!modelId || seen.has(modelId)) continue;

    models.push(modelId);
    seen.add(modelId);

    if (item && typeof item === "object" && !Array.isArray(item)) {
      const metadata = modelMetadataFromEnvObject(
        item as Record<string, unknown>,
        modelId,
      );
      if (metadata) modelMetadata[metadata.id] = metadata;
    }
  }

  return { models, modelMetadata };
}

function envBool(name: string): boolean | undefined {
  const value = env(name).toLowerCase();
  if (!value) return undefined;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return undefined;
}

function clampInteger(
  value: string,
  min: number,
  max: number,
): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function getDefaultProviderType(): ProviderType {
  const configured = env("DEFAULT_PROVIDER_TYPE");
  return normalizeProviderTypeValue(configured) || "Google";
}

export function getDefaultProviderApiKey(): string {
  return env("DEFAULT_PROVIDER_API_KEY");
}

function isDefaultProviderConfigured(): boolean {
  return [
    "DEFAULT_PROVIDER_TYPE",
    "DEFAULT_PROVIDER_NAME",
    "DEFAULT_PROVIDER_BASE_URL",
    "DEFAULT_PROVIDER_API_KEY",
    "DEFAULT_PROVIDER_MODELS",
    "DEFAULT_MODEL_TITLE_GENERATION",
    "DEFAULT_MODEL_RELATED_QUESTIONS",
    "DEFAULT_MODEL_CONTEXT_COMPRESSION",
    "DEFAULT_MODEL_PROMPT_OPTIMIZATION",
    "DEFAULT_MODEL_RAG_QUERY",
    "DEFAULT_MODEL_MEMORY",
  ].some((name) => Boolean(env(name)));
}

export function getDefaultProviderRuntimeConfig() {
  if (!isDefaultProviderConfigured()) return null;

  const type = getDefaultProviderType();
  const apiKey = getDefaultProviderApiKey();

  return {
    type,
    name: env("DEFAULT_PROVIDER_NAME") || DEFAULT_PROVIDER_NAME,
    baseUrl: env("DEFAULT_PROVIDER_BASE_URL") || undefined,
    ...(apiKey ? { apiKey } : {}),
  };
}

function getDefaultModelEnv(): Partial<DefaultModels> {
  return {
    titleGeneration: env("DEFAULT_MODEL_TITLE_GENERATION"),
    relatedQuestions: env("DEFAULT_MODEL_RELATED_QUESTIONS"),
    contextCompression: env("DEFAULT_MODEL_CONTEXT_COMPRESSION"),
    promptOptimization: env("DEFAULT_MODEL_PROMPT_OPTIMIZATION"),
    ragQuery: env("DEFAULT_MODEL_RAG_QUERY"),
    memory: env("DEFAULT_MODEL_MEMORY"),
  };
}

function normalizeDefaultModels(
  models: Partial<DefaultModels>,
): Partial<DefaultModels> {
  return Object.fromEntries(
    Object.entries(models)
      .map(([key, value]) => [key, normalizeProviderModelId(value)])
      .filter((entry): entry is [keyof DefaultModels, string] =>
        Boolean(entry[1]),
      ),
  ) as Partial<DefaultModels>;
}

export function getDefaultSearchRuntimeConfig(): {
  provider: ConfigurableSearchProvider;
  apiKey?: string;
  baseUrl?: string;
} | null {
  const provider = env("DEFAULT_SEARCH_PROVIDER").toLowerCase();
  if (!SEARCH_PROVIDERS.has(provider as ConfigurableSearchProvider)) {
    return null;
  }

  const typedProvider = provider as ConfigurableSearchProvider;
  const baseUrl = env("DEFAULT_SEARCH_BASE_URL").slice(
    0,
    SEARCH_CONFIG_LIMITS.maxBaseUrlChars,
  );
  if (typedProvider === "searxng") {
    return baseUrl ? { provider: typedProvider, baseUrl } : null;
  }

  const apiKey = env("DEFAULT_SEARCH_API_KEY");
  if (typedProvider === "firecrawl") {
    return {
      provider: typedProvider,
      ...(apiKey
        ? { apiKey: apiKey.slice(0, SEARCH_CONFIG_LIMITS.maxApiKeyChars) }
        : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  if (!apiKey) return null;

  return {
    provider: typedProvider,
    apiKey: apiKey.slice(0, SEARCH_CONFIG_LIMITS.maxApiKeyChars),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function getDefaultRagRuntimeConfig(): {
  url: string;
  token: string;
  topK?: number;
  chunkSize?: number;
  namespace?: string;
} | null {
  const url = env("DEFAULT_RAG_BASE_URL").slice(0, RAG_LIMITS.maxBaseUrlChars);
  const token = env("DEFAULT_RAG_TOKEN").slice(0, RAG_LIMITS.maxTokenChars);
  if (!url || !token) return null;

  const topK = clampInteger(
    env("DEFAULT_RAG_TOP_K"),
    RAG_LIMITS.minTopK,
    RAG_LIMITS.maxTopK,
  );
  const chunkSize = clampInteger(
    env("DEFAULT_RAG_CHUNK_SIZE"),
    RAG_LIMITS.minChunkSize,
    RAG_LIMITS.maxChunkSize,
  );
  const namespace = env("DEFAULT_RAG_NAMESPACE").slice(
    0,
    RAG_LIMITS.maxNamespaceChars,
  );

  return {
    url,
    token,
    ...(topK !== undefined ? { topK } : {}),
    ...(chunkSize !== undefined ? { chunkSize } : {}),
    ...(namespace ? { namespace } : {}),
  };
}

export function getDefaultLlamaParseApiKey(): string {
  return env("DEFAULT_LLAMA_PARSE_API_KEY").slice(
    0,
    RAG_LIMITS.maxLlamaParseApiKeyChars,
  );
}

export function getDefaultDocumentParseProvider(): DocumentParseProvider {
  return normalizeDocumentParseProvider(env("DEFAULT_DOCUMENT_PARSE_PROVIDER"));
}

export function getDefaultMineruApiToken(): string {
  return env("DEFAULT_MINERU_API_TOKEN").slice(
    0,
    RAG_LIMITS.maxMineruApiTokenChars,
  );
}

export function getDefaultDocumentParseToken(
  provider: DocumentParseProvider,
): string {
  return provider === "mineru"
    ? getDefaultMineruApiToken()
    : getDefaultLlamaParseApiKey();
}

export function isDefaultDocumentProcessingAvailable(
  provider = getDefaultDocumentParseProvider(),
): boolean {
  return provider === "mineru" || Boolean(getDefaultLlamaParseApiKey());
}

export function getDefaultElevenLabsApiKey(): string {
  return env("DEFAULT_ELEVENLABS_API_KEY");
}

export function getDefaultMimoApiKey(): string {
  return env("DEFAULT_MIMO_API_KEY");
}

export function getDefaultElevenLabsSttModel(): string {
  const model = envWithDefault(
    "DEFAULT_ELEVENLABS_STT_MODEL",
    DEFAULT_ELEVENLABS_STT_MODEL,
  );
  if (!model) return "";
  return isElevenLabsSTTModel(model) ? model : DEFAULT_ELEVENLABS_STT_MODEL;
}

export function getDefaultElevenLabsTtsModel(): string {
  const model = envWithDefault(
    "DEFAULT_ELEVENLABS_TTS_MODEL",
    DEFAULT_ELEVENLABS_TTS_MODEL,
  );
  if (!model) return "";
  return isElevenLabsTTSModel(model) ? model : DEFAULT_ELEVENLABS_TTS_MODEL;
}

export function getDefaultElevenLabsTtsVoiceId(): VoiceSettings["ttsVoiceId"] {
  const voiceId = env("DEFAULT_ELEVENLABS_TTS_VOICE_ID");
  return voiceId === "SAz9YHcvj6GT2YYXdXww" ||
    voiceId === "bIHbv24MWmeRgasZH58o"
    ? voiceId
    : DEFAULT_ELEVENLABS_TTS_VOICE_ID;
}

export function getDefaultMimoSttModel(): string {
  const model = envWithDefault(
    "DEFAULT_MIMO_STT_MODEL",
    DEFAULT_MIMO_STT_MODEL,
  );
  if (!model) return "";
  return model === DEFAULT_MIMO_STT_MODEL
    ? DEFAULT_MIMO_STT_MODEL
    : DEFAULT_MIMO_STT_MODEL;
}

export function getDefaultMimoTtsModel(): string {
  const model = envWithDefault(
    "DEFAULT_MIMO_TTS_MODEL",
    DEFAULT_MIMO_TTS_MODEL,
  );
  if (!model) return "";
  return model === DEFAULT_MIMO_TTS_MODEL
    ? DEFAULT_MIMO_TTS_MODEL
    : DEFAULT_MIMO_TTS_MODEL;
}

export function getDefaultMimoTtsVoiceId(): MimoVoiceID {
  const voiceId = env("DEFAULT_MIMO_TTS_VOICE_ID");
  return MIMO_TTS_VOICE_IDS.has(voiceId as MimoVoiceID)
    ? (voiceId as MimoVoiceID)
    : DEFAULT_MIMO_TTS_VOICE_ID;
}

export function getDefaultVoiceProvider():
  ServerDefaultVoiceProvider | undefined {
  const configured = env("DEFAULT_VOICE_PROVIDER").toLowerCase();
  const elevenLabsAvailable = Boolean(getDefaultElevenLabsApiKey());
  const mimoAvailable = Boolean(getDefaultMimoApiKey());

  if (configured === "mimo") return mimoAvailable ? "mimo" : undefined;
  if (configured === "elevenlabs") {
    return elevenLabsAvailable ? "elevenlabs" : undefined;
  }
  return undefined;
}

function getDefaultSystemSettings(): SystemSettings | undefined {
  const hasSystemEnv = [
    "DEFAULT_SYSTEM_PROMPT",
    "DEFAULT_ENABLE_AUTO_TITLE",
    "DEFAULT_ENABLE_RELATED_QUESTIONS",
    "DEFAULT_ENABLE_AUTO_COMPRESSION",
    "DEFAULT_COMPRESSION_THRESHOLD",
    "DEFAULT_HISTORY_KEEP_COUNT",
    "DEFAULT_ENABLE_CODE_COLLAPSE",
    "DEFAULT_ENABLE_HTML_VISUAL_PROMPT",
  ].some((name) => env(name));

  if (!hasSystemEnv) return undefined;

  return normalizeSystemSettings(
    {
      systemPrompt:
        env("DEFAULT_SYSTEM_PROMPT") || DEFAULT_SYSTEM_SETTINGS.systemPrompt,
      enableAutoTitle: envBool("DEFAULT_ENABLE_AUTO_TITLE"),
      enableRelatedQuestions: envBool("DEFAULT_ENABLE_RELATED_QUESTIONS"),
      enableAutoCompression: envBool("DEFAULT_ENABLE_AUTO_COMPRESSION"),
      compressionThreshold: clampInteger(
        env("DEFAULT_COMPRESSION_THRESHOLD"),
        SYSTEM_SETTINGS_LIMITS.minCompressionThreshold,
        SYSTEM_SETTINGS_LIMITS.maxCompressionThreshold,
      ),
      historyKeepCount: clampInteger(
        env("DEFAULT_HISTORY_KEEP_COUNT"),
        SYSTEM_SETTINGS_LIMITS.minHistoryKeepCount,
        SYSTEM_SETTINGS_LIMITS.maxHistoryKeepCount,
      ),
      enableCodeCollapse: envBool("DEFAULT_ENABLE_CODE_COLLAPSE"),
      enableHtmlVisualPrompt: envBool("DEFAULT_ENABLE_HTML_VISUAL_PROMPT"),
    },
    DEFAULT_SYSTEM_SETTINGS,
  );
}

function getPublicStoreState(
  storeEnvName:
    "RATE_LIMIT_STORE" | "DOCUMENT_PARSE_JOB_STORE" | "PLUGIN_REGISTRY_STORE",
): PublicDeploymentStoreState {
  const mode = getDeploymentMode();
  const store = env(storeEnvName).toLowerCase();
  const upstashConfigured = Boolean(
    env("UPSTASH_REDIS_REST_URL") && env("UPSTASH_REDIS_REST_TOKEN"),
  );
  const wantsSharedStore =
    store === "upstash" || store === "redis" || store === "kv";

  if (wantsSharedStore && upstashConfigured) return "shared";
  if (storeEnvName === "RATE_LIMIT_STORE") return "memory";
  if (mode === "hosted" || wantsSharedStore) return "missing";
  return "memory";
}

export function getPublicServerConfig(): PublicServerConfig {
  const defaultProvider = getDefaultProviderRuntimeConfig();
  const defaultProviderModels = getDefaultProviderModels();
  const rag = getDefaultRagRuntimeConfig();
  const documentProcessingProvider = getDefaultDocumentParseProvider();
  const documentProcessingAvailable = isDefaultDocumentProcessingAvailable(
    documentProcessingProvider,
  );
  const defaultElevenLabsApiKey = getDefaultElevenLabsApiKey();
  const defaultMimoApiKey = getDefaultMimoApiKey();
  const defaultVoiceProvider = getDefaultVoiceProvider();
  const defaultVoiceSttModel =
    defaultVoiceProvider === "mimo"
      ? getDefaultMimoSttModel()
      : defaultVoiceProvider === "elevenlabs"
        ? getDefaultElevenLabsSttModel()
        : "";
  const defaultVoiceTtsModel =
    defaultVoiceProvider === "mimo"
      ? getDefaultMimoTtsModel()
      : defaultVoiceProvider === "elevenlabs"
        ? getDefaultElevenLabsTtsModel()
        : "";
  const defaultVoiceSttAvailable = Boolean(
    defaultVoiceProvider && defaultVoiceSttModel,
  );
  const defaultVoiceTtsAvailable = Boolean(
    defaultVoiceProvider && defaultVoiceTtsModel,
  );
  const mimoSttModel = getDefaultMimoSttModel();
  const mimoTtsModel = getDefaultMimoTtsModel();
  const system = getDefaultSystemSettings();
  const deploymentMode = getDeploymentMode();

  return {
    sharing: { available: isSharingAvailable() },
    modelProvider: {
      available: Boolean(defaultProvider),
      id: SERVER_DEFAULT_PROVIDER_ID,
      name:
        defaultProvider?.name ||
        env("DEFAULT_PROVIDER_NAME") ||
        DEFAULT_PROVIDER_NAME,
      type: defaultProvider?.type || getDefaultProviderType(),
      models: defaultProvider ? defaultProviderModels.models : [],
      modelMetadata: defaultProvider ? defaultProviderModels.modelMetadata : {},
      defaultModels: defaultProvider
        ? normalizeDefaultModels(getDefaultModelEnv())
        : {},
    },
    search: {
      available: Boolean(getDefaultSearchRuntimeConfig()),
    },
    rag: {
      vectorStoreAvailable: Boolean(rag),
      documentProcessingAvailable,
      ...(documentProcessingAvailable ? { documentProcessingProvider } : {}),
      ...(rag?.topK !== undefined ? { topK: rag.topK } : {}),
      ...(rag?.chunkSize !== undefined ? { chunkSize: rag.chunkSize } : {}),
      ...(rag?.namespace ? { namespace: rag.namespace } : {}),
    },
    voice: {
      ...(defaultVoiceProvider
        ? { defaultProvider: defaultVoiceProvider }
        : {}),
      elevenLabsAvailable: Boolean(defaultElevenLabsApiKey),
      mimoAvailable: Boolean(defaultMimoApiKey),
      defaultSttAvailable: defaultVoiceSttAvailable,
      defaultTtsAvailable: defaultVoiceTtsAvailable,
      ...(defaultVoiceSttAvailable
        ? {
            sttModel: defaultVoiceSttModel,
          }
        : {}),
      ...(defaultVoiceTtsAvailable
        ? {
            ttsModel: defaultVoiceTtsModel,
          }
        : {}),
      ...(defaultVoiceTtsAvailable && defaultVoiceProvider === "elevenlabs"
        ? {
            ttsVoiceId: getDefaultElevenLabsTtsVoiceId(),
          }
        : {}),
      ...(defaultMimoApiKey
        ? {
            ...(mimoSttModel ? { mimoSttModel } : {}),
            ...(mimoTtsModel
              ? {
                  mimoTtsModel,
                  mimoTtsVoiceId: getDefaultMimoTtsVoiceId(),
                }
              : {}),
          }
        : {}),
    },
    deployment: {
      mode: deploymentMode,
      accessPasswordEnabled: isAccessPasswordEnabled(),
      trustedProxyHeaders: envBool("TRUST_PROXY_HEADERS") === true,
      byokStableKeyConfigured: Boolean(env("BYOK_PRIVATE_KEY_PEM")),
      byokEphemeralAllowed:
        deploymentMode === "hosted" ||
        envBool("BYOK_ALLOW_EPHEMERAL_KEY") === true ||
        process.env.NODE_ENV !== "production",
      apiProof: getApiProofPublicStatus(),
      rateLimitStore: getPublicStoreState("RATE_LIMIT_STORE"),
      documentParseJobStore: getPublicStoreState("DOCUMENT_PARSE_JOB_STORE"),
      pluginRegistryStore: getPublicStoreState("PLUGIN_REGISTRY_STORE"),
    },
    limits: {
      attachments: {
        maxFileBytes: getRuntimeMaxAttachmentFileBytes(),
      },
    },
    ...(system ? { system } : {}),
  };
}
