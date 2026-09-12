import { RAG_LIMITS, SEARCH_CONFIG_LIMITS } from "@/config/limits";
import type {
  DocumentParseProvider,
  ProviderType,
  RAGConfig,
  SearchProviderID,
  SearchServiceConfig,
  SearchTimeRange,
} from "@/types";
import { isLocalEncryptedSecretEnvelope } from "../security/localSecrets";
import { hasSearchApiKey } from "../security/localSecretResolvers";
import { isGoogleProviderType } from "../providers/providerTypes";

const SEARCH_PROVIDERS = [
  "default",
  "google",
  "tavily",
  "firecrawl",
  "exa",
  "bocha",
  "searxng",
  "youcom",
] as const satisfies readonly SearchProviderID[];

const CONFIGURABLE_SEARCH_PROVIDERS = [
  "tavily",
  "firecrawl",
  "exa",
  "bocha",
  "searxng",
  "youcom",
] as const satisfies readonly Exclude<SearchProviderID, "default" | "google">[];

const DEFAULT_SEARCH_RESULTS_LIMIT = 5;
const DEFAULT_RAG_TOP_K = 10;
const DEFAULT_RAG_CHUNK_SIZE = 512;
const DEFAULT_SEARXNG_BASE_URL = "http://localhost:8080";
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_SEARCH_PROVIDER: SearchProviderID = "firecrawl";
const DEFAULT_DOCUMENT_PARSE_PROVIDER: DocumentParseProvider = "mineru";

export type SearchCompatibilityMode =
  "gemini-google" | "openai-web" | "external" | "unavailable";

export type SearchCompatibilityReason =
  | "missing_model_provider"
  | "google_requires_gemini"
  | "model_builtin_search_unsupported"
  | "missing_server_default"
  | "missing_search_api_key"
  | "missing_search_base_url";

export type SearchCapabilitySource =
  | "model_builtin"
  | "server_default"
  | "client_api_key"
  | "public_service"
  | "self_hosted";

export interface SearchCompatibilityResult {
  enabled: boolean;
  mode: SearchCompatibilityMode;
  provider: SearchProviderID;
  reason?: SearchCompatibilityReason;
  source?: SearchCapabilitySource;
}

const isExplicitFirecrawlBaseUrl = (baseUrl: unknown): boolean => {
  if (typeof baseUrl !== "string") return false;
  const normalized = baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  if (!normalized || normalized === DEFAULT_FIRECRAWL_BASE_URL.toLowerCase()) {
    return false;
  }
  return isValidHttpUrl(normalized);
};

const isValidHttpUrl = (value: unknown): boolean => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const clampInteger = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

const trimToLimit = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

export const isSearchProviderID = (
  provider: unknown,
): provider is SearchProviderID =>
  typeof provider === "string" &&
  SEARCH_PROVIDERS.includes(provider as SearchProviderID);

export const normalizeSearchProvider = (provider: unknown): SearchProviderID =>
  isSearchProviderID(provider) ? provider : DEFAULT_SEARCH_PROVIDER;

export const normalizeSearchTimeRange = (
  timeRange: unknown,
): SearchTimeRange =>
  timeRange === "day" ||
  timeRange === "week" ||
  timeRange === "month" ||
  timeRange === "year"
    ? timeRange
    : "any";

export const isDocumentParseProvider = (
  provider: unknown,
): provider is DocumentParseProvider =>
  provider === "mineru" || provider === "llamaParse";

export const normalizeDocumentParseProvider = (
  provider: unknown,
): DocumentParseProvider =>
  isDocumentParseProvider(provider)
    ? provider
    : DEFAULT_DOCUMENT_PARSE_PROVIDER;

export const getSearchProviderLabel = (provider: SearchProviderID): string => {
  switch (provider) {
    case "google":
      return "Google";
    case "default":
      return "Default";
    case "tavily":
      return "Tavily";
    case "firecrawl":
      return "Firecrawl";
    case "exa":
      return "Exa";
    case "bocha":
      return "Bocha";
    case "searxng":
      return "SearXNG";
    case "youcom":
      return "You.com";
  }
};

type SearchCapabilityBaseInput = {
  searchProvider: SearchProviderID;
  searchConfig?: SearchServiceConfig;
  modelProviderType?: ProviderType;
};

type SearchCapabilityInput = SearchCapabilityBaseInput & {
  selectedModel?: string;
};

const resolveSearchCapability = ({
  searchProvider,
  searchConfig,
  modelProviderType,
}: SearchCapabilityBaseInput): SearchCompatibilityResult => {
  if (!modelProviderType) {
    return {
      enabled: false,
      mode: "unavailable",
      provider: searchProvider,
      reason: "missing_model_provider",
    };
  }

  if (searchProvider === "google") {
    if (isGoogleProviderType(modelProviderType)) {
      return {
        enabled: true,
        mode: "gemini-google",
        provider: searchProvider,
        source: "model_builtin",
      };
    }

    if (modelProviderType === "OpenAI") {
      // The first-party OpenAI provider is routed through the Responses API in
      // chat-handler; "OpenAI Compatible" uses Chat Completions and is denied.
      return {
        enabled: true,
        mode: "openai-web",
        provider: searchProvider,
        source: "model_builtin",
      };
    }

    return {
      enabled: false,
      mode: "unavailable",
      provider: searchProvider,
      reason: "model_builtin_search_unsupported",
    };
  }

  if (searchProvider === "default") {
    return searchConfig?.serverAvailable
      ? {
          enabled: true,
          mode: "external",
          provider: searchProvider,
          source: "server_default",
        }
      : {
          enabled: false,
          mode: "unavailable",
          provider: searchProvider,
          reason: "missing_server_default",
        };
  }

  if (searchProvider === "searxng") {
    return isValidHttpUrl(searchConfig?.baseUrl)
      ? {
          enabled: true,
          mode: "external",
          provider: searchProvider,
          source: "self_hosted",
        }
      : {
          enabled: false,
          mode: "unavailable",
          provider: searchProvider,
          reason: "missing_search_base_url",
        };
  }

  if (searchProvider === "firecrawl") {
    if (isExplicitFirecrawlBaseUrl(searchConfig?.baseUrl)) {
      return {
        enabled: true,
        mode: "external",
        provider: searchProvider,
        source: "self_hosted",
      };
    }

    if (
      searchConfig?.baseUrl?.trim() &&
      !isValidHttpUrl(searchConfig.baseUrl)
    ) {
      return {
        enabled: false,
        mode: "unavailable",
        provider: searchProvider,
        reason: "missing_search_base_url",
      };
    }

    return {
      enabled: true,
      mode: "external",
      provider: searchProvider,
      source: hasSearchApiKey(searchConfig)
        ? "client_api_key"
        : "public_service",
    };
  }

  if (hasSearchApiKey(searchConfig)) {
    return {
      enabled: true,
      mode: "external",
      provider: searchProvider,
      source: "client_api_key",
    };
  }

  return {
    enabled: false,
    mode: "unavailable",
    provider: searchProvider,
    reason: "missing_search_api_key",
  };
};

export const resolveEffectiveSearchCapability = (
  input: SearchCapabilityInput,
): SearchCompatibilityResult => {
  if (!input.selectedModel?.trim()) {
    return {
      enabled: false,
      mode: "unavailable",
      provider: input.searchProvider,
      reason: "missing_model_provider",
    };
  }
  return resolveSearchCapability(input);
};

/** @deprecated Use resolveEffectiveSearchCapability at capability boundaries. */
export const getSearchCompatibility = resolveSearchCapability;

export const getSearchCompatibilityErrorMessage = (
  result: SearchCompatibilityResult,
): string => {
  switch (result.reason) {
    case "missing_model_provider":
      return "No active model provider is available for search.";
    case "google_requires_gemini":
      return "Google Search is only available with Google models. Choose an external search provider for this model.";
    case "model_builtin_search_unsupported":
      return "Model built-in search is only available with Google or OpenAI Responses models. Choose an external search provider for this model.";
    case "missing_server_default":
      return "Default search is not configured on this deployment.";
    case "missing_search_api_key":
      return `${getSearchProviderLabel(result.provider)} search requires an API key.`;
    case "missing_search_base_url":
      return `${getSearchProviderLabel(result.provider)} search requires a base URL.`;
    default:
      return "Search is not available with the current configuration.";
  }
};

export const normalizeSearchResultsLimit = (limit: unknown): number =>
  clampInteger(
    limit,
    SEARCH_CONFIG_LIMITS.minResultsLimit,
    SEARCH_CONFIG_LIMITS.maxResultsLimit,
    DEFAULT_SEARCH_RESULTS_LIMIT,
  );

export const normalizeSearchConfig = (
  provider: unknown,
  config: unknown,
): SearchServiceConfig | undefined => {
  if (
    typeof provider !== "string" ||
    !CONFIGURABLE_SEARCH_PROVIDERS.includes(
      provider as (typeof CONFIGURABLE_SEARCH_PROVIDERS)[number],
    )
  ) {
    return undefined;
  }

  const rawConfig =
    config && typeof config === "object"
      ? (config as Partial<SearchServiceConfig>)
      : {};

  if (provider === "searxng") {
    return {
      baseUrl:
        trimToLimit(rawConfig.baseUrl, SEARCH_CONFIG_LIMITS.maxBaseUrlChars) ||
        DEFAULT_SEARXNG_BASE_URL,
    };
  }

  const normalized: SearchServiceConfig = {
    apiKey: trimToLimit(rawConfig.apiKey, SEARCH_CONFIG_LIMITS.maxApiKeyChars),
  };
  if (isLocalEncryptedSecretEnvelope(rawConfig.apiKeySecret)) {
    normalized.apiKeySecret = rawConfig.apiKeySecret;
  }
  const baseUrl = trimToLimit(
    rawConfig.baseUrl,
    SEARCH_CONFIG_LIMITS.maxBaseUrlChars,
  );
  if (baseUrl) normalized.baseUrl = baseUrl;
  return normalized;
};

export const normalizeSearchSettings = (
  search: unknown,
): {
  provider: SearchProviderID;
  resultsLimit: number;
  timeRange: SearchTimeRange;
  configs: Record<string, SearchServiceConfig>;
} => {
  const rawSearch =
    search && typeof search === "object"
      ? (search as {
          provider?: unknown;
          resultsLimit?: unknown;
          timeRange?: unknown;
          configs?: Record<string, unknown>;
        })
      : {};
  const rawDefaultConfig =
    rawSearch.configs?.default && typeof rawSearch.configs.default === "object"
      ? (rawSearch.configs.default as Partial<SearchServiceConfig>)
      : {};

  return {
    provider: normalizeSearchProvider(rawSearch.provider),
    resultsLimit: normalizeSearchResultsLimit(rawSearch.resultsLimit),
    timeRange: normalizeSearchTimeRange(rawSearch.timeRange),
    configs: {
      default: {
        serverAvailable: rawDefaultConfig.serverAvailable === true,
      },
      tavily: normalizeSearchConfig("tavily", rawSearch.configs?.tavily)!,
      firecrawl: normalizeSearchConfig(
        "firecrawl",
        rawSearch.configs?.firecrawl,
      )!,
      exa: normalizeSearchConfig("exa", rawSearch.configs?.exa)!,
      bocha: normalizeSearchConfig("bocha", rawSearch.configs?.bocha)!,
      searxng: normalizeSearchConfig("searxng", rawSearch.configs?.searxng)!,
      youcom: normalizeSearchConfig("youcom", rawSearch.configs?.youcom)!,
    },
  };
};

export const normalizeRAGConfig = (config: unknown): RAGConfig => {
  const rawConfig =
    config && typeof config === "object" ? (config as Partial<RAGConfig>) : {};

  const namespace = trimToLimit(
    rawConfig.namespace,
    RAG_LIMITS.maxNamespaceChars,
  );

  return {
    enabled: rawConfig.enabled === true,
    url: trimToLimit(rawConfig.url, RAG_LIMITS.maxBaseUrlChars),
    token: trimToLimit(rawConfig.token, RAG_LIMITS.maxTokenChars),
    ...(isLocalEncryptedSecretEnvelope(rawConfig.tokenSecret)
      ? { tokenSecret: rawConfig.tokenSecret }
      : {}),
    topK: clampInteger(
      rawConfig.topK,
      RAG_LIMITS.minTopK,
      RAG_LIMITS.maxTopK,
      DEFAULT_RAG_TOP_K,
    ),
    chunkSize: clampInteger(
      rawConfig.chunkSize,
      RAG_LIMITS.minChunkSize,
      RAG_LIMITS.maxChunkSize,
      DEFAULT_RAG_CHUNK_SIZE,
    ),
    documentParseProvider: normalizeDocumentParseProvider(
      rawConfig.documentParseProvider,
    ),
    mineruApiToken: trimToLimit(
      rawConfig.mineruApiToken,
      RAG_LIMITS.maxMineruApiTokenChars,
    ),
    ...(isLocalEncryptedSecretEnvelope(rawConfig.mineruApiTokenSecret)
      ? { mineruApiTokenSecret: rawConfig.mineruApiTokenSecret }
      : {}),
    llamaParseApiKey: trimToLimit(
      rawConfig.llamaParseApiKey,
      RAG_LIMITS.maxLlamaParseApiKeyChars,
    ),
    ...(isLocalEncryptedSecretEnvelope(rawConfig.llamaParseApiKeySecret)
      ? { llamaParseApiKeySecret: rawConfig.llamaParseApiKeySecret }
      : {}),
    ...(namespace ? { namespace } : {}),
    ...(rawConfig.useDefaultVectorStore !== undefined
      ? { useDefaultVectorStore: rawConfig.useDefaultVectorStore === true }
      : {}),
    ...(rawConfig.useDefaultDocumentProcessing !== undefined
      ? {
          useDefaultDocumentProcessing:
            rawConfig.useDefaultDocumentProcessing === true,
        }
      : {}),
    ...(rawConfig.serverVectorStoreAvailable !== undefined
      ? {
          serverVectorStoreAvailable:
            rawConfig.serverVectorStoreAvailable === true,
        }
      : {}),
    ...(rawConfig.serverDocumentProcessingAvailable !== undefined
      ? {
          serverDocumentProcessingAvailable:
            rawConfig.serverDocumentProcessingAvailable === true,
        }
      : {}),
  };
};
