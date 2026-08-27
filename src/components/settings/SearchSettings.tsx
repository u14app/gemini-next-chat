import React from "react";
import { Globe, Server, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  getSearchProviderLabel,
  resolveEffectiveSearchCapability,
} from "@/lib/settings/searchRag";
import { parseModelString } from "@/lib/utils/model";
import { useChatStore } from "@/store/core/chatStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { CustomSelect } from "@/components/ui/controls";
import { SearchProviderItem } from "./SearchProviderItem";
import { SEARCH_CONFIG_LIMITS } from "@/config/limits";
// Base URLs moved to API routes
const TAVILY_BASE_URL = "https://api.tavily.com";
const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const EXA_BASE_URL = "https://api.exa.ai";
const BOCHA_BASE_URL = "https://api.bochaai.com";
const SEARXNG_BASE_URL = "http://localhost:8080";
const TAVILY_KEY_URL = "https://app.tavily.com/";
const EXA_KEY_URL = "https://dashboard.exa.ai/api-keys";
const FIRECRAWL_KEY_URL = "https://www.firecrawl.dev/app";
const BOCHA_KEY_URL = "https://open.bochaai.com/";

const SearchSettings = () => {
  const t = useTranslations("Search");
  const selectedModel = useChatStore((state) => state.selectedModel);
  const providers = useCoreSettingsStore((state) => state.providers);
  const {
    search,
    serverConfig,
    setSearchProvider,
    updateSearchConfig,
    setSearchResultsLimit,
    setSearchTimeRange,
  } = useSettingsStore();
  const { providerId: selectedProviderId } = parseModelString(selectedModel);
  const selectedProvider = selectedProviderId
    ? providers.find((provider) => provider.id === selectedProviderId)
    : providers.find((provider) => provider.enabled);
  const compatibility = resolveEffectiveSearchCapability({
    searchProvider: search.provider,
    searchConfig:
      search.provider === "google"
        ? undefined
        : search.configs[search.provider],
    modelProviderType: selectedProvider?.type,
    selectedModel,
  });
  const providerLabel = getSearchProviderLabel(search.provider);
  const capabilityMessage = compatibility.enabled
    ? compatibility.source === "model_builtin"
      ? t("capabilityModel", { provider: providerLabel })
      : compatibility.source === "server_default"
        ? t("capabilityServer")
        : compatibility.source === "public_service"
          ? t("capabilityPublicService")
          : compatibility.source === "self_hosted"
            ? t("capabilitySelfHosted", { provider: providerLabel })
            : t("capabilityClient", { provider: providerLabel })
    : compatibility.reason === "missing_model_provider"
      ? t("capabilityMissingModel")
      : compatibility.reason === "missing_server_default"
        ? t("capabilityMissingServer")
        : compatibility.reason === "model_builtin_search_unsupported" ||
            compatibility.reason === "google_requires_gemini"
          ? t("capabilityUnsupportedModel")
          : compatibility.reason === "missing_search_base_url"
            ? t("capabilityMissingBaseUrl", { provider: providerLabel })
            : t("capabilityMissingKey", { provider: providerLabel });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-foreground">
            {t("title")}
          </h3>
        </div>

        <div
          role="status"
          className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
            compatibility.enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
          }`}
        >
          {capabilityMessage}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {serverConfig?.search.available && (
            <SearchProviderItem
              id="default"
              name={t("defaultService")}
              description={t("defaultServiceDesc")}
              icon={<Server size={18} />}
              isActive={search.provider === "default"}
              onActivate={() => setSearchProvider("default")}
              hasApiKey={false}
              hasBaseUrl={false}
            />
          )}
          <SearchProviderItem
            id="google"
            name={t("modelBuiltIn")}
            description={t("modelBuiltInDesc")}
            icon={<Zap size={18} />}
            isActive={search.provider === "google"}
            onActivate={() => setSearchProvider("google")}
            hasApiKey={false}
            hasBaseUrl={false}
          />
          <SearchProviderItem
            id="tavily"
            name="Tavily"
            icon={<Globe size={18} />}
            isActive={search.provider === "tavily"}
            onActivate={() => setSearchProvider("tavily")}
            defaultBaseUrl={TAVILY_BASE_URL}
            config={search.configs["tavily"]}
            onUpdateConfig={(c) => updateSearchConfig("tavily", c)}
            apiKeyMaxLength={SEARCH_CONFIG_LIMITS.maxApiKeyChars}
            baseUrlMaxLength={SEARCH_CONFIG_LIMITS.maxBaseUrlChars}
            apiKeyHelpUrl={TAVILY_KEY_URL}
          />
          <SearchProviderItem
            id="exa"
            name="Exa"
            icon={<Globe size={18} />}
            isActive={search.provider === "exa"}
            onActivate={() => setSearchProvider("exa")}
            defaultBaseUrl={EXA_BASE_URL}
            config={search.configs["exa"]}
            onUpdateConfig={(c) => updateSearchConfig("exa", c)}
            apiKeyMaxLength={SEARCH_CONFIG_LIMITS.maxApiKeyChars}
            baseUrlMaxLength={SEARCH_CONFIG_LIMITS.maxBaseUrlChars}
            apiKeyHelpUrl={EXA_KEY_URL}
          />
          <SearchProviderItem
            id="firecrawl"
            name="Firecrawl"
            icon={<Globe size={18} />}
            isActive={search.provider === "firecrawl"}
            onActivate={() => setSearchProvider("firecrawl")}
            defaultBaseUrl={FIRECRAWL_BASE_URL}
            config={search.configs["firecrawl"]}
            onUpdateConfig={(c) => updateSearchConfig("firecrawl", c)}
            apiKeyMaxLength={SEARCH_CONFIG_LIMITS.maxApiKeyChars}
            baseUrlMaxLength={SEARCH_CONFIG_LIMITS.maxBaseUrlChars}
            apiKeyHelpUrl={FIRECRAWL_KEY_URL}
          />
          <SearchProviderItem
            id="bocha"
            name="Bocha"
            icon={<Globe size={18} />}
            isActive={search.provider === "bocha"}
            onActivate={() => setSearchProvider("bocha")}
            defaultBaseUrl={BOCHA_BASE_URL}
            config={search.configs["bocha"]}
            onUpdateConfig={(c) => updateSearchConfig("bocha", c)}
            apiKeyMaxLength={SEARCH_CONFIG_LIMITS.maxApiKeyChars}
            baseUrlMaxLength={SEARCH_CONFIG_LIMITS.maxBaseUrlChars}
            apiKeyHelpUrl={BOCHA_KEY_URL}
          />
          <SearchProviderItem
            id="searxng"
            name="SearXNG"
            icon={<Server size={18} />}
            description={t("searxngDesc")}
            isActive={search.provider === "searxng"}
            onActivate={() => setSearchProvider("searxng")}
            defaultBaseUrl={SEARXNG_BASE_URL}
            hasApiKey={false}
            config={search.configs["searxng"]}
            onUpdateConfig={(c) => updateSearchConfig("searxng", c)}
            baseUrlMaxLength={SEARCH_CONFIG_LIMITS.maxBaseUrlChars}
          />
        </div>
      </div>

      <div className="space-y-2 pt-4 border-t border-gray-100 dark:border-border">
        <div className="flex justify-between text-sm text-gray-700 dark:text-foreground/85">
          <label htmlFor="search-results-limit" className="font-medium">
            {t("resultLimit")}
          </label>
          <span className="font-mono bg-gray-100 dark:bg-muted px-2 py-0.5 rounded text-xs">
            {search.resultsLimit}
          </span>
        </div>
        <input
          id="search-results-limit"
          name="searchResultsLimit"
          type="range"
          min="1"
          max="10"
          step="1"
          value={search.resultsLimit}
          onChange={(e) => setSearchResultsLimit(parseInt(e.target.value, 10))}
          aria-describedby="search-results-limit-bounds"
          className="w-full h-2 bg-gray-200 dark:bg-accent rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div
          id="search-results-limit-bounds"
          className="flex justify-between text-[10px] text-gray-400"
        >
          <span>1</span>
          <span>10</span>
        </div>
      </div>

      {search.provider === "firecrawl" ? (
        <div className="space-y-2 pt-4 border-t border-gray-100 dark:border-border">
          <label
            htmlFor="search-time-range"
            className="block text-sm font-medium text-gray-700 dark:text-foreground/85"
          >
            {t("timeRange")}
          </label>
          <CustomSelect
            id="search-time-range"
            value={search.timeRange}
            onChange={(value) =>
              setSearchTimeRange(value as typeof search.timeRange)
            }
            options={[
              { value: "any", label: t("timeRangeAny") },
              { value: "day", label: t("timeRangeDay") },
              { value: "week", label: t("timeRangeWeek") },
              { value: "month", label: t("timeRangeMonth") },
              { value: "year", label: t("timeRangeYear") },
            ]}
            ariaLabel={t("timeRange")}
            selectButtonClassName="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-background dark:text-foreground"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {t("timeRangeHint")}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default SearchSettings;
