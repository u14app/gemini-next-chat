import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ModelMetadata,
  SearchProviderID,
  SearchServiceConfig,
  SearchTimeRange,
  Plugin,
  PluginConfig,
  LobeAgent,
  VoiceSettings,
  SystemSettings,
  RAGConfig,
  DefaultModels,
  TextSkill,
  SkillCatalog,
  SkillDataLocale,
  SkillBundle,
} from "@/types";
import { BUILT_IN_PLUGINS, UNSPLASH_PLUGIN } from "@/config/plugins";
import { DEFAULT_SYSTEM_SETTINGS } from "@/config/defaults";
import {
  PublicServerConfig,
  SERVER_DEFAULT_PROVIDER_ID,
} from "@/lib/defaultConfig/shared";
import {
  STORAGE_KEYS,
  STORAGE_VERSION,
  getAppDbStorage,
} from "../storage/storageConfig";
import { CACHE_CONFIG } from "@/config/api";
import { useCoreSettingsStore } from "./coreSettingsStore";
import { normalizeProviderBaseUrl } from "@/lib/security/urlPolicy";
import {
  normalizeAgentOverrides,
  normalizeLocalAgent,
  normalizeLocalAgents,
  normalizeMarketAgents,
} from "@/lib/market/agents";
import type { AgentMarketLocale } from "@/lib/market/agentLocale";
import { MARKET_LIMITS } from "@/config/limits";
import {
  extractKnownProviderModelMetadata,
  normalizeModelMetadata,
  normalizeModelMetadataMap,
} from "@/lib/providers/metadata";
import { logDevError } from "@/lib/utils/devLogger";
import { reportAppRestoreHydration } from "@/lib/data/appRestoreJournal";
import {
  normalizeRAGConfig,
  normalizeSearchConfig,
  normalizeSearchProvider,
  normalizeSearchSettings,
} from "@/lib/settings/searchRag";
import { getDefaultModelSelectValue } from "@/lib/utils/defaultModels";
import {
  getProviderModelMetadataKey,
  resolveProviderModelMetadata,
} from "@/lib/utils/model";
import { readJsonResponseOrThrow } from "@/lib/api/client";
import {
  isPluginAuthRequired,
  normalizeActivePluginIds,
  normalizePluginConfig,
  normalizePluginConfigs,
} from "@/lib/plugin/config";
import {
  normalizeCustomSkills,
  normalizeSkillCatalog,
  normalizeSkillBundles,
  normalizeTextSkill,
} from "@/lib/skills";
import { normalizeSystemSettings } from "@/lib/settings/appConfig";
import {
  clearBrowserAppData,
  clearBrowserAppDataSources,
  type BrowserAppDataSource,
} from "@/lib/data/clearAppData";
import {
  createBrowserAppBackup,
  inspectBrowserAppBackup,
  restoreBrowserAppBackup,
  type BrowserAppBackup,
  type AppBackupOperationOptions,
  type BrowserBackupInspection,
  type BrowserRestoreResult,
} from "@/lib/data/appBackup";
import {
  hasDocumentParseCredential,
  hasRagToken,
  hasPluginAuthValue,
} from "@/lib/security/localSecretResolvers";
import {
  migratePluginConfigLocalSecrets,
  migrateRAGLocalSecrets,
  migrateSearchLocalSecrets,
  migrateVoiceLocalSecrets,
  stripPluginConfigPlainSecrets,
  stripRAGPlainSecrets,
  stripSearchPlainSecrets,
  stripVoicePlainSecrets,
} from "@/lib/settings/localSecretMigration";

interface SettingsState {
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  serverConfig: PublicServerConfig | null;
  applyServerConfig: (config: PublicServerConfig) => void;

  // Market Cache
  marketPlugins: Plugin[];
  marketPluginsTimestamp: number;
  marketMcpServers: Plugin[];
  marketMcpServersTimestamp: number;
  marketAgents: LobeAgent[];
  marketAgentsTimestamp: number;
  marketAgentsLocale: AgentMarketLocale | "";
  skillCatalogs: Partial<Record<SkillDataLocale, SkillCatalog>>;
  skillCatalogTimestamps: Partial<Record<SkillDataLocale, number>>;
  skillDefinitions: Record<string, TextSkill>;
  skillDefinitionTimestamps: Record<string, number>;
  setMarketPlugins: (plugins: Plugin[]) => void;
  setMarketMcpServers: (plugins: Plugin[]) => void;
  setMarketAgents: (
    agents: LobeAgent[],
    locale?: AgentMarketLocale | "",
  ) => void;
  setSkillCatalog: (locale: SkillDataLocale, catalog: SkillCatalog) => void;
  setSkillDefinition: (cacheKey: string, skill: TextSkill) => void;

  // System Settings
  system: SystemSettings;
  updateSystemSettings: (settings: Partial<SystemSettings>) => void;

  // Model Metadata
  modelMetadata: Record<string, ModelMetadata>;
  modelMetadataTimestamp: number;
  customModelMetadata: Record<string, ModelMetadata>;
  setCustomModelMetadata: (
    providerId: string,
    id: string,
    meta: ModelMetadata,
  ) => void;
  fetchModelMetadata: (forceRefresh?: boolean) => Promise<void>;

  // Search Settings
  search: {
    provider: SearchProviderID;
    resultsLimit: number;
    timeRange: SearchTimeRange;
    configs: Record<string, SearchServiceConfig>;
  };
  setSearchProvider: (provider: SearchProviderID) => void;
  updateSearchConfig: (
    provider: string,
    config: Partial<SearchServiceConfig>,
  ) => void;
  setSearchResultsLimit: (limit: number) => void;
  setSearchTimeRange: (timeRange: SearchTimeRange) => void;

  // RAG Settings
  rag: RAGConfig;
  updateRAGConfig: (config: Partial<RAGConfig>) => void;

  // Voice Settings
  voice: VoiceSettings;
  updateVoiceSettings: (settings: Partial<VoiceSettings>) => void;

  // Plugin Management
  activePlugins: string[];
  installedPlugins: Plugin[];
  pluginConfigs: Record<string, PluginConfig>;
  addInstalledPlugin: (plugin: Plugin) => void;
  removeInstalledPlugin: (pluginId: string) => void;
  setActivePlugins: (pluginIds: string[]) => void;
  togglePluginActive: (pluginId: string) => void;
  updatePluginConfig: (pluginId: string, config: Partial<PluginConfig>) => void;
  togglePluginFunction: (pluginId: string, functionName: string) => void;
  ensureBuiltInPlugins: () => void;

  // Skill Management
  installedSkills: TextSkill[];
  customSkills: TextSkill[];
  activeSkillIds: string[];
  skillAutoSelect: boolean;
  skillBundles: SkillBundle[];
  activeSkillBundleIds: string[];
  installSkill: (skill: TextSkill) => void;
  uninstallSkill: (skillId: string) => void;
  updateInstalledSkill: (skillId: string, skill: Partial<TextSkill>) => void;
  addCustomSkill: (skill: TextSkill) => void;
  updateCustomSkill: (skillId: string, skill: Partial<TextSkill>) => void;
  removeCustomSkill: (skillId: string) => void;
  setActiveSkillIds: (skillIds: string[]) => void;
  toggleSkillActive: (skillId: string) => void;
  setSkillAutoSelect: (enabled: boolean) => void;
  addSkillBundle: (bundle: SkillBundle) => void;
  updateSkillBundle: (bundleId: string, bundle: Partial<SkillBundle>) => void;
  removeSkillBundle: (bundleId: string) => void;
  setActiveSkillBundleIds: (bundleIds: string[]) => void;
  toggleSkillBundleActive: (bundleId: string) => void;

  // Agent Management
  customAgents: LobeAgent[];
  usedAgents: LobeAgent[];
  agentOverrides: Record<string, Partial<LobeAgent>>;
  addCustomAgent: (agent: LobeAgent) => void;
  updateAgent: (
    identifier: string,
    updates: Partial<LobeAgent>,
    isCustom: boolean,
  ) => void;
  removeLocalAgent: (identifier: string) => void;
  recordUsedAgent: (agent: LobeAgent) => void;
  resetAgent: (identifier: string) => void;

  // Data Management
  exportAllData: (
    options?: AppBackupOperationOptions,
  ) => Promise<BrowserAppBackup>;
  inspectBackupFile: (file: Blob) => Promise<BrowserBackupInspection>;
  restoreAllData: (
    file: Blob,
    options?: AppBackupOperationOptions,
  ) => Promise<BrowserRestoreResult>;
  clearDataSources: (sources: BrowserAppDataSource[]) => Promise<void>;
  clearAllData: () => Promise<void>;
}

const BUILT_IN_PLUGINS_BY_ID = new Map(
  BUILT_IN_PLUGINS.map((plugin) => [plugin.id, plugin]),
);
const REMOVED_BUILT_IN_PLUGIN_IDS = new Set([
  "image-generation",
  "deep-research",
]);
const SKILL_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const removeRemovedBuiltInPlugins = (plugins: readonly Plugin[]): Plugin[] =>
  plugins.filter(
    (plugin) => !plugin.builtIn || !REMOVED_BUILT_IN_PLUGIN_IDS.has(plugin.id),
  );

const refreshBuiltInPluginDefinitions = (
  plugins: readonly Plugin[],
): Plugin[] =>
  plugins.map((plugin) => {
    const currentBuiltIn = BUILT_IN_PLUGINS_BY_ID.get(plugin.id);
    if (!currentBuiltIn || !plugin.builtIn) {
      return plugin;
    }
    const refreshedPlugin = {
      ...currentBuiltIn,
      added: plugin.added || currentBuiltIn.added,
    };
    return JSON.stringify(plugin) === JSON.stringify(refreshedPlugin)
      ? plugin
      : refreshedPlugin;
  });

// 插件配置初始化
const initPluginConfig = (): PluginConfig => ({
  disabledFunctions: [],
});

const normalizeSkillIdRefsForStorage = (
  value: unknown,
  maxCount: number = MARKET_LIMITS.maxActiveSkills,
): string[] => {
  if (!Array.isArray(value)) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id =
      typeof item === "string"
        ? item.trim().slice(0, MARKET_LIMITS.maxSkillIdChars)
        : "";
    if (!id || !SKILL_ID_RE.test(id) || seen.has(id)) continue;
    refs.push(id);
    seen.add(id);
    if (refs.length >= maxCount) break;
  }
  return refs;
};

const normalizeInstalledSkills = (
  value: unknown,
  maxCount: number = MARKET_LIMITS.maxSkills,
): TextSkill[] => {
  if (!Array.isArray(value)) return [];
  const skills: TextSkill[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const skill = normalizeTextSkill(item);
    if (!skill || seen.has(skill.id)) continue;
    skills.push({
      ...skill,
      builtIn: skill.builtIn === true || undefined,
      isCustom: skill.isCustom === true || undefined,
    });
    seen.add(skill.id);
    if (skills.length >= maxCount) break;
  }

  return skills;
};

const syncCustomSkillsFromInstalled = (skills: readonly TextSkill[]) =>
  normalizeCustomSkills(
    skills.filter((skill) => skill.isCustom && !skill.builtIn),
    MARKET_LIMITS.maxCustomSkills,
  );

const SKILL_DATA_LOCALES: readonly SkillDataLocale[] = ["en", "zh-CN", "ja"];

const normalizeSkillCatalogCache = (
  value: unknown,
): Partial<Record<SkillDataLocale, SkillCatalog>> => {
  if (!value || typeof value !== "object") return {};
  const raw = value as Partial<Record<SkillDataLocale, unknown>>;
  const result: Partial<Record<SkillDataLocale, SkillCatalog>> = {};

  for (const locale of SKILL_DATA_LOCALES) {
    const catalog = normalizeSkillCatalog(raw[locale]);
    if (catalog.skills.length > 0) {
      result[locale] = { ...catalog, locale };
    }
  }

  return result;
};

const normalizeSkillDefinitionCache = (
  value: unknown,
): Record<string, TextSkill> => {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, TextSkill> = {};
  for (const [cacheKey, item] of Object.entries(value)) {
    const skill = normalizeTextSkill(item);
    if (!skill || cacheKey.length > 320) continue;
    result[cacheKey] = skill;
  }
  return result;
};

const normalizeTimestampCache = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, number> = {};
  for (const [cacheKey, timestamp] of Object.entries(value)) {
    const normalizedTimestamp = Number(timestamp);
    if (
      !cacheKey ||
      cacheKey.length > 320 ||
      !Number.isFinite(normalizedTimestamp) ||
      normalizedTimestamp <= 0
    ) {
      continue;
    }
    result[cacheKey] = normalizedTimestamp;
  }
  return result;
};

// 检查插件是否需要认证
// 检查插件是否可以自动激活
const canAutoActivatePlugin = (
  plugin: Plugin,
  config: PluginConfig | undefined,
): boolean => {
  const needsAuth = isPluginAuthRequired(plugin);
  return (
    !needsAuth ||
    hasPluginAuthValue(config?.auth) ||
    plugin.id === UNSPLASH_PLUGIN.id
  );
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      serverConfig: null,
      applyServerConfig: (config) =>
        set((state) => {
          const hadDefaultSearch =
            state.search.configs.default?.serverAvailable !== undefined;
          const shouldUseDefaultSearch =
            config.search.available &&
            !hadDefaultSearch &&
            state.search.provider === "firecrawl";

          const hasLocalRagVectorStore =
            Boolean(state.rag.url?.trim()) || hasRagToken(state.rag);
          const shouldUseDefaultVectorStore =
            config.rag.vectorStoreAvailable &&
            state.rag.useDefaultVectorStore === undefined &&
            !hasLocalRagVectorStore;
          const shouldUseDefaultDocumentProcessing =
            config.rag.documentProcessingAvailable &&
            state.rag.useDefaultDocumentProcessing === undefined &&
            !hasDocumentParseCredential(state.rag);

          const hasServerVoiceConfig =
            state.voice.serverDefaultVoiceProvider !== undefined ||
            state.voice.serverDefaultSttAvailable !== undefined ||
            state.voice.serverDefaultTtsAvailable !== undefined ||
            state.voice.serverElevenLabsAvailable !== undefined ||
            state.voice.serverMimoAvailable !== undefined;
          const shouldUseDefaultStt =
            config.voice.defaultSttAvailable &&
            !hasServerVoiceConfig &&
            state.voice.sttProvider === "browser";
          const shouldUseDefaultTts =
            config.voice.defaultTtsAvailable &&
            !hasServerVoiceConfig &&
            state.voice.ttsProvider === "browser";
          const shouldFallbackDefaultStt =
            state.voice.sttProvider === "default" &&
            !config.voice.defaultSttAvailable;
          const shouldFallbackDefaultTts =
            state.voice.ttsProvider === "default" &&
            !config.voice.defaultTtsAvailable;

          const isSystemUnchanged =
            JSON.stringify(state.system) ===
            JSON.stringify(DEFAULT_SYSTEM_SETTINGS);
          const serverModelMetadata = normalizeModelMetadataMap(
            config.modelProvider.modelMetadata,
          );
          const nextCustomModelMetadata = { ...state.customModelMetadata };
          for (const [id, metadata] of Object.entries(serverModelMetadata)) {
            const qualifiedKey = getProviderModelMetadataKey(
              SERVER_DEFAULT_PROVIDER_ID,
              id,
            );
            if (
              !nextCustomModelMetadata[qualifiedKey] &&
              !nextCustomModelMetadata[id]
            ) {
              nextCustomModelMetadata[qualifiedKey] = metadata;
            }
          }

          return {
            serverConfig: config,
            customModelMetadata: nextCustomModelMetadata,
            search: normalizeSearchSettings({
              ...state.search,
              provider: shouldUseDefaultSearch
                ? "default"
                : state.search.provider,
              configs: {
                ...state.search.configs,
                default: { serverAvailable: config.search.available },
              },
            }),
            rag: normalizeRAGConfig({
              ...state.rag,
              serverVectorStoreAvailable: config.rag.vectorStoreAvailable,
              serverDocumentProcessingAvailable:
                config.rag.documentProcessingAvailable,
              ...(shouldUseDefaultVectorStore
                ? {
                    enabled: true,
                    useDefaultVectorStore: true,
                    ...(config.rag.topK !== undefined
                      ? { topK: config.rag.topK }
                      : {}),
                    ...(config.rag.chunkSize !== undefined
                      ? { chunkSize: config.rag.chunkSize }
                      : {}),
                    ...(config.rag.namespace
                      ? { namespace: config.rag.namespace }
                      : {}),
                  }
                : {}),
              ...(shouldUseDefaultDocumentProcessing
                ? {
                    documentParseProvider:
                      config.rag.documentProcessingProvider ||
                      state.rag.documentParseProvider,
                    useDefaultDocumentProcessing: true,
                  }
                : {}),
            }),
            voice: {
              ...state.voice,
              serverDefaultVoiceProvider: config.voice.defaultProvider,
              serverDefaultSttAvailable: config.voice.defaultSttAvailable,
              serverDefaultTtsAvailable: config.voice.defaultTtsAvailable,
              serverElevenLabsAvailable: config.voice.elevenLabsAvailable,
              serverElevenLabsTtsModel:
                config.voice.defaultProvider === "elevenlabs"
                  ? config.voice.ttsModel
                  : undefined,
              serverMimoAvailable: config.voice.mimoAvailable,
              serverMimoSttModel: config.voice.mimoSttModel,
              serverMimoTtsModel: config.voice.mimoTtsModel,
              serverMimoTtsVoiceId: config.voice.mimoTtsVoiceId,
              ...(shouldFallbackDefaultStt
                ? { sttProvider: "browser" as const, sttModel: "" }
                : {}),
              ...(shouldFallbackDefaultTts
                ? { ttsProvider: "browser" as const }
                : {}),
              ...(shouldUseDefaultStt
                ? {
                    sttProvider: "default" as const,
                    sttModel: config.voice.sttModel || "",
                  }
                : {}),
              ...(shouldUseDefaultTts
                ? {
                    ttsProvider: "default" as const,
                    ...(config.voice.defaultProvider === "elevenlabs" &&
                    config.voice.ttsModel
                      ? { ttsModel: config.voice.ttsModel }
                      : {}),
                    ...(config.voice.defaultProvider === "mimo"
                      ? {
                          mimoTtsVoiceId:
                            config.voice.mimoTtsVoiceId || "mimo_default",
                        }
                      : {}),
                    ...(config.voice.defaultProvider !== "mimo" &&
                    config.voice.ttsVoiceId
                      ? { ttsVoiceId: config.voice.ttsVoiceId }
                      : {}),
                  }
                : {}),
            },
            ...(config.system && isSystemUnchanged
              ? { system: normalizeSystemSettings(config.system) }
              : {}),
          };
        }),

      // Market Cache
      marketPlugins: [],
      marketPluginsTimestamp: 0,
      marketMcpServers: [],
      marketMcpServersTimestamp: 0,
      marketAgents: [],
      marketAgentsTimestamp: 0,
      marketAgentsLocale: "",
      skillCatalogs: {},
      skillCatalogTimestamps: {},
      skillDefinitions: {},
      skillDefinitionTimestamps: {},
      setMarketPlugins: (plugins) =>
        set({
          marketPlugins: plugins,
          marketPluginsTimestamp: Date.now(),
        }),
      setMarketMcpServers: (plugins) =>
        set({
          marketMcpServers: plugins,
          marketMcpServersTimestamp: Date.now(),
        }),
      setMarketAgents: (agents, locale = "") =>
        set({
          marketAgents: normalizeMarketAgents(agents),
          marketAgentsTimestamp: Date.now(),
          marketAgentsLocale: locale,
        }),
      setSkillCatalog: (locale, catalog) => {
        const normalizedCatalog = normalizeSkillCatalog(catalog);
        set((state) => ({
          skillCatalogs: {
            ...state.skillCatalogs,
            [locale]: { ...normalizedCatalog, locale },
          },
          skillCatalogTimestamps: {
            ...state.skillCatalogTimestamps,
            [locale]: Date.now(),
          },
        }));
      },
      setSkillDefinition: (cacheKey, skill) => {
        const normalizedSkill = normalizeTextSkill(skill);
        if (!normalizedSkill || !cacheKey || cacheKey.length > 320) return;
        set((state) => ({
          skillDefinitions: {
            ...state.skillDefinitions,
            [cacheKey]: normalizedSkill,
          },
          skillDefinitionTimestamps: {
            ...state.skillDefinitionTimestamps,
            [cacheKey]: Date.now(),
          },
        }));
      },

      // System Settings
      system: DEFAULT_SYSTEM_SETTINGS,
      updateSystemSettings: (settings) =>
        set((state) => ({
          system: normalizeSystemSettings(
            { ...state.system, ...settings },
            DEFAULT_SYSTEM_SETTINGS,
          ),
        })),

      // Model Metadata
      modelMetadata: {},
      modelMetadataTimestamp: 0,
      customModelMetadata: {},
      setCustomModelMetadata: (providerId, id, meta) =>
        set((state) => {
          const metadata = normalizeModelMetadata(meta, id);
          if (!metadata) return state;

          return {
            customModelMetadata: {
              ...state.customModelMetadata,
              [getProviderModelMetadataKey(providerId, metadata.id)]: metadata,
            },
          };
        }),

      fetchModelMetadata: async (forceRefresh = false) => {
        const { modelMetadata, modelMetadataTimestamp } = get();
        const now = Date.now();
        if (
          !forceRefresh &&
          Object.keys(modelMetadata).length > 0 &&
          modelMetadataTimestamp &&
          now - modelMetadataTimestamp < CACHE_CONFIG.modelMetadata
        ) {
          return;
        }

        try {
          const response = await fetch(
            "https://basellm.github.io/llm-metadata/api/all.json",
          );
          if (!response.ok) throw new Error("Failed to fetch model metadata");

          const data = await readJsonResponseOrThrow(
            response,
            "Failed to fetch model metadata",
          );
          const newMetadata = extractKnownProviderModelMetadata(data);

          set({ modelMetadata: newMetadata, modelMetadataTimestamp: now });
        } catch (e) {
          logDevError("Error fetching model metadata:", e);
        }
      },

      // Search Settings
      search: {
        provider: "firecrawl",
        resultsLimit: 5,
        timeRange: "any",
        configs: {
          tavily: { apiKey: "" },
          firecrawl: { apiKey: "" },
          exa: { apiKey: "" },
          bocha: { apiKey: "" },
          searxng: { baseUrl: "http://localhost:8080" },
        },
      },
      setSearchProvider: (provider) =>
        set((state) => ({
          search: {
            ...state.search,
            provider: normalizeSearchProvider(provider),
          },
        })),
      updateSearchConfig: (provider, config) =>
        set((state) => {
          const normalizedConfig = normalizeSearchConfig(provider, {
            ...state.search.configs[provider],
            ...config,
          });
          if (!normalizedConfig) return state;

          return {
            search: {
              ...state.search,
              configs: {
                ...state.search.configs,
                [provider]: normalizedConfig,
              },
            },
          };
        }),
      setSearchResultsLimit: (limit) =>
        set((state) => ({
          search: normalizeSearchSettings({
            ...state.search,
            resultsLimit: limit,
          }),
        })),
      setSearchTimeRange: (timeRange) =>
        set((state) => ({
          search: normalizeSearchSettings({
            ...state.search,
            timeRange,
          }),
        })),

      // RAG Settings
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      updateRAGConfig: (config) =>
        set((state) => ({
          rag: normalizeRAGConfig({ ...state.rag, ...config }),
        })),

      // Voice Settings
      voice: {
        sttProvider: "browser",
        sttModel: "",
        sttLanguage: "auto",
        ttsProvider: "browser",
        ttsModel: "",
        ttsVoiceId: "bIHbv24MWmeRgasZH58o",
        mimoTtsVoiceId: "mimo_default",
        ttsLanguage: "auto",
        elevenLabsApiKey: "",
        mimoApiKey: "",
        autoTranscribe: true,
      },
      updateVoiceSettings: (settings) =>
        set((state) => ({ voice: { ...state.voice, ...settings } })),

      // Plugin Management
      activePlugins: [],
      installedPlugins: [...BUILT_IN_PLUGINS],
      pluginConfigs: {},

      addInstalledPlugin: (plugin) =>
        set((state) => {
          if (state.installedPlugins.some((p) => p.id === plugin.id)) {
            return state;
          }

          const installedPlugins = [...state.installedPlugins, plugin];
          const config = normalizePluginConfig(
            state.pluginConfigs[plugin.id] || initPluginConfig(),
            plugin.functions?.map((fn) => fn.name),
          );
          const shouldActivate = canAutoActivatePlugin(plugin, config);
          const pluginConfigs = normalizePluginConfigs(
            {
              ...state.pluginConfigs,
              [plugin.id]: config,
            },
            installedPlugins,
          );

          return {
            installedPlugins,
            activePlugins: normalizeActivePluginIds(
              shouldActivate
                ? [...state.activePlugins, plugin.id]
                : state.activePlugins,
              installedPlugins,
              pluginConfigs,
              { unauthenticatedAllowedPluginIds: [UNSPLASH_PLUGIN.id] },
            ),
            pluginConfigs,
          };
        }),

      removeInstalledPlugin: (pluginId) =>
        set((state) => {
          const plugin = state.installedPlugins.find((p) => p.id === pluginId);
          if (plugin?.builtIn) return state;

          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [pluginId]: _removed, ...newConfigs } = state.pluginConfigs;
          return {
            installedPlugins: state.installedPlugins.filter(
              (p) => p.id !== pluginId,
            ),
            activePlugins: state.activePlugins.filter((id) => id !== pluginId),
            pluginConfigs: newConfigs,
          };
        }),

      setActivePlugins: (pluginIds) =>
        set((state) => ({
          activePlugins: normalizeActivePluginIds(
            pluginIds,
            state.installedPlugins,
            state.pluginConfigs,
            { unauthenticatedAllowedPluginIds: [UNSPLASH_PLUGIN.id] },
          ),
        })),

      togglePluginActive: (pluginId) =>
        set((state) => {
          const plugin = state.installedPlugins.find((p) => p.id === pluginId);
          if (!plugin) return state;

          const isActive = state.activePlugins.includes(pluginId);

          if (!isActive) {
            if (plugin && isPluginAuthRequired(plugin)) {
              const hasAuth = hasPluginAuthValue(
                state.pluginConfigs[pluginId]?.auth,
              );
              if (!hasAuth && pluginId !== UNSPLASH_PLUGIN.id) {
                return state;
              }
            }
          }

          return {
            activePlugins: normalizeActivePluginIds(
              isActive
                ? state.activePlugins.filter((id) => id !== pluginId)
                : [...state.activePlugins, pluginId],
              state.installedPlugins,
              state.pluginConfigs,
              { unauthenticatedAllowedPluginIds: [UNSPLASH_PLUGIN.id] },
            ),
          };
        }),

      updatePluginConfig: (pluginId, config) =>
        set((state) => {
          const plugin = state.installedPlugins.find((p) => p.id === pluginId);
          if (!plugin) return state;

          const pluginConfigs = normalizePluginConfigs(
            {
              ...state.pluginConfigs,
              [pluginId]: normalizePluginConfig(
                { ...state.pluginConfigs[pluginId], ...config },
                plugin.functions?.map((fn) => fn.name),
              ),
            },
            state.installedPlugins,
          );

          return {
            pluginConfigs,
            activePlugins: normalizeActivePluginIds(
              state.activePlugins,
              state.installedPlugins,
              pluginConfigs,
              { unauthenticatedAllowedPluginIds: [UNSPLASH_PLUGIN.id] },
            ),
          };
        }),

      togglePluginFunction: (pluginId, functionName) =>
        set((state) => {
          const plugin = state.installedPlugins.find((p) => p.id === pluginId);
          if (!plugin?.functions?.some((fn) => fn.name === functionName)) {
            return state;
          }

          const currentConfig =
            state.pluginConfigs[pluginId] || initPluginConfig();
          const currentDisabled = currentConfig.disabledFunctions || [];
          const newDisabled = currentDisabled.includes(functionName)
            ? currentDisabled.filter((f) => f !== functionName)
            : [...currentDisabled, functionName];

          return {
            pluginConfigs: {
              ...state.pluginConfigs,
              [pluginId]: normalizePluginConfig(
                { ...currentConfig, disabledFunctions: newDisabled },
                plugin.functions.map((fn) => fn.name),
              ),
            },
          };
        }),

      ensureBuiltInPlugins: () =>
        set((state) => {
          const retainedPlugins = refreshBuiltInPluginDefinitions(
            removeRemovedBuiltInPlugins(state.installedPlugins),
          );
          const missingPlugins = BUILT_IN_PLUGINS.filter(
            (plugin) => !retainedPlugins.some((p) => p.id === plugin.id),
          );
          const builtInDefinitionsChanged =
            retainedPlugins.length !== state.installedPlugins.length ||
            retainedPlugins.some(
              (plugin, index) => plugin !== state.installedPlugins[index],
            );

          if (missingPlugins.length === 0 && !builtInDefinitionsChanged) {
            return state;
          }

          const newConfigs = normalizePluginConfigs(
            state.pluginConfigs,
            retainedPlugins,
          );
          missingPlugins.forEach((plugin) => {
            if (!newConfigs[plugin.id]) {
              newConfigs[plugin.id] = initPluginConfig();
            }
          });
          const installedPlugins = [...retainedPlugins, ...missingPlugins];
          const pluginConfigs = normalizePluginConfigs(
            newConfigs,
            installedPlugins,
          );

          return {
            installedPlugins,
            pluginConfigs,
            activePlugins: normalizeActivePluginIds(
              state.activePlugins,
              installedPlugins,
              pluginConfigs,
              { unauthenticatedAllowedPluginIds: [UNSPLASH_PLUGIN.id] },
            ),
          };
        }),

      // Skill Management
      installedSkills: [],
      customSkills: [],
      activeSkillIds: [],
      skillAutoSelect: true,
      skillBundles: [],
      activeSkillBundleIds: [],

      installSkill: (skill) =>
        set((state) => {
          const normalizedSkill = normalizeTextSkill({
            ...skill,
            builtIn: skill.builtIn === true,
            isCustom: skill.isCustom === true || undefined,
            createdAt: skill.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (!normalizedSkill) return state;

          const installedSkills = normalizeInstalledSkills([
            normalizedSkill,
            ...state.installedSkills.filter(
              (item) => item.id !== normalizedSkill.id,
            ),
          ]);

          return {
            installedSkills,
            customSkills: syncCustomSkillsFromInstalled(installedSkills),
          };
        }),

      uninstallSkill: (skillId) =>
        set((state) => {
          const normalizedId = normalizeSkillIdRefsForStorage([skillId], 1)[0];
          if (!normalizedId) return state;
          const installedSkills = state.installedSkills.filter(
            (skill) => skill.id !== normalizedId,
          );

          return {
            installedSkills,
            customSkills: syncCustomSkillsFromInstalled(installedSkills),
            activeSkillIds: state.activeSkillIds.filter(
              (id) => id !== normalizedId,
            ),
          };
        }),

      updateInstalledSkill: (skillId, skill) =>
        set((state) => {
          const normalizedId = normalizeSkillIdRefsForStorage([skillId], 1)[0];
          if (!normalizedId) return state;
          let changed = false;
          const installedSkills = state.installedSkills.map((current) => {
            if (current.id !== normalizedId) return current;
            const normalizedSkill = normalizeTextSkill({
              ...current,
              ...skill,
              id: current.id,
              name: skill.name || current.name,
              activation: { ...current.activation, ...skill.activation },
              risk: { ...current.risk, ...skill.risk },
              builtIn: current.builtIn === true,
              isCustom: true,
              updatedAt: new Date().toISOString(),
            });
            if (!normalizedSkill) return current;
            changed = true;
            return {
              ...normalizedSkill,
              builtIn: current.builtIn === true || undefined,
              isCustom: true,
            };
          });
          if (!changed) return state;

          const normalizedInstalledSkills =
            normalizeInstalledSkills(installedSkills);
          return {
            installedSkills: normalizedInstalledSkills,
            customSkills: syncCustomSkillsFromInstalled(
              normalizedInstalledSkills,
            ),
          };
        }),

      addCustomSkill: (skill) =>
        set((state) => {
          const normalizedSkill = normalizeTextSkill({
            ...skill,
            builtIn: false,
            isCustom: true,
            createdAt: skill.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (!normalizedSkill) return state;

          const installedSkills = normalizeInstalledSkills([
            { ...normalizedSkill, builtIn: false, isCustom: true },
            ...state.installedSkills.filter(
              (item) => item.id !== normalizedSkill.id,
            ),
          ]);

          return {
            installedSkills,
            customSkills: normalizeCustomSkills(
              [
                { ...normalizedSkill, builtIn: false, isCustom: true },
                ...state.customSkills.filter(
                  (item) => item.id !== normalizedSkill.id,
                ),
              ],
              MARKET_LIMITS.maxCustomSkills,
            ),
          };
        }),

      updateCustomSkill: (skillId, skill) =>
        set((state) => {
          let changed = false;
          const installedSkills = state.installedSkills.map((current) => {
            if (current.id !== skillId || current.builtIn) return current;
            const normalizedSkill = normalizeTextSkill({
              ...current,
              ...skill,
              id: current.id,
              name: skill.name || current.name,
              activation: { ...current.activation, ...skill.activation },
              risk: { ...current.risk, ...skill.risk },
              builtIn: false,
              isCustom: true,
              updatedAt: new Date().toISOString(),
            });
            if (!normalizedSkill) return current;
            changed = true;
            return { ...normalizedSkill, builtIn: false, isCustom: true };
          });
          const customSkills = state.customSkills.map((current) => {
            if (current.id !== skillId) return current;
            const normalizedSkill = normalizeTextSkill({
              ...current,
              ...skill,
              id: current.id,
              name: skill.name || current.name,
              activation: { ...current.activation, ...skill.activation },
              risk: { ...current.risk, ...skill.risk },
              builtIn: false,
              isCustom: true,
              updatedAt: new Date().toISOString(),
            });
            if (!normalizedSkill) return current;
            changed = true;
            return { ...normalizedSkill, builtIn: false, isCustom: true };
          });
          if (!changed) return state;

          const normalizedInstalledSkills =
            normalizeInstalledSkills(installedSkills);
          return {
            installedSkills: normalizedInstalledSkills,
            customSkills: normalizeCustomSkills(
              customSkills,
              MARKET_LIMITS.maxCustomSkills,
            ),
          };
        }),

      removeCustomSkill: (skillId) =>
        set((state) => {
          const installedSkills = state.installedSkills.filter(
            (skill) => skill.id !== skillId || skill.builtIn,
          );
          return {
            installedSkills,
            customSkills: state.customSkills.filter(
              (skill) => skill.id !== skillId,
            ),
            activeSkillIds: state.activeSkillIds.filter((id) => id !== skillId),
          };
        }),

      setActiveSkillIds: (skillIds) =>
        set({
          activeSkillIds: normalizeSkillIdRefsForStorage(skillIds),
        }),

      toggleSkillActive: (skillId) =>
        set((state) => {
          const normalizedId = normalizeSkillIdRefsForStorage([skillId], 1)[0];
          if (!normalizedId) return state;
          const isActive = state.activeSkillIds.includes(normalizedId);
          return {
            activeSkillIds: normalizeSkillIdRefsForStorage(
              isActive
                ? state.activeSkillIds.filter((id) => id !== normalizedId)
                : [...state.activeSkillIds, normalizedId],
            ),
          };
        }),

      setSkillAutoSelect: (enabled) => set({ skillAutoSelect: enabled }),

      addSkillBundle: (bundle) =>
        set((state) => ({
          skillBundles: normalizeSkillBundles(
            [
              {
                ...bundle,
                createdAt: bundle.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...state.skillBundles.filter((item) => item.id !== bundle.id),
            ],
            MARKET_LIMITS.maxCustomSkills,
          ),
        })),

      updateSkillBundle: (bundleId, bundle) =>
        set((state) => ({
          skillBundles: normalizeSkillBundles(
            state.skillBundles.map((current) =>
              current.id === bundleId
                ? {
                    ...current,
                    ...bundle,
                    id: current.id,
                    updatedAt: new Date().toISOString(),
                  }
                : current,
            ),
            MARKET_LIMITS.maxCustomSkills,
          ),
        })),

      removeSkillBundle: (bundleId) =>
        set((state) => ({
          skillBundles: state.skillBundles.filter(
            (bundle) => bundle.id !== bundleId,
          ),
          activeSkillBundleIds: state.activeSkillBundleIds.filter(
            (id) => id !== bundleId,
          ),
        })),

      setActiveSkillBundleIds: (bundleIds) =>
        set((state) => {
          const validIds = new Set(
            state.skillBundles.map((bundle) => bundle.id),
          );
          return {
            activeSkillBundleIds: normalizeSkillIdRefsForStorage(
              bundleIds,
              20,
            ).filter((id) => validIds.has(id)),
          };
        }),

      toggleSkillBundleActive: (bundleId) =>
        set((state) => {
          if (!state.skillBundles.some((bundle) => bundle.id === bundleId)) {
            return state;
          }
          return {
            activeSkillBundleIds: state.activeSkillBundleIds.includes(bundleId)
              ? state.activeSkillBundleIds.filter((id) => id !== bundleId)
              : [...state.activeSkillBundleIds, bundleId],
          };
        }),

      // Agent Management
      customAgents: [],
      usedAgents: [],
      agentOverrides: {},

      addCustomAgent: (agent) =>
        set((state) => {
          const normalizedAgent = normalizeLocalAgent({
            ...agent,
            isCustom: true,
          });
          if (!normalizedAgent) return state;

          return {
            customAgents: normalizeLocalAgents(
              [normalizedAgent, ...state.customAgents],
              MARKET_LIMITS.maxCustomAgents,
            ),
          };
        }),

      updateAgent: (identifier, updates, isCustom) =>
        set((state) => {
          if (isCustom) {
            let changed = false;
            const customAgents = state.customAgents.map((a) => {
              if (a.identifier !== identifier) return a;

              const normalizedAgent = normalizeLocalAgent({
                ...a,
                ...updates,
                meta: { ...a.meta, ...updates.meta },
                isCustom: true,
              });
              if (!normalizedAgent) return a;
              changed = true;
              return normalizedAgent;
            });

            if (!changed) return state;

            return {
              customAgents: normalizeLocalAgents(
                customAgents,
                MARKET_LIMITS.maxCustomAgents,
              ),
            } as Partial<SettingsState>;
          }

          const currentOverride = state.agentOverrides[identifier] || {};
          const newUsedAgents = state.usedAgents.map((a) =>
            a.identifier === identifier
              ? normalizeLocalAgent({
                  ...a,
                  ...updates,
                  meta: { ...a.meta, ...updates.meta },
                }) || a
              : a,
          );
          const normalizedOverride = normalizeLocalAgent({
            identifier,
            ...currentOverride,
            ...updates,
            meta: { ...currentOverride.meta, ...updates.meta },
          });

          return {
            agentOverrides: {
              ...state.agentOverrides,
              ...(normalizedOverride
                ? { [identifier]: normalizedOverride }
                : {}),
            },
            usedAgents: normalizeLocalAgents(
              newUsedAgents,
              MARKET_LIMITS.maxUsedAgents,
            ),
          } as Partial<SettingsState>;
        }),

      removeLocalAgent: (identifier) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [identifier]: _removed, ...newOverrides } =
            state.agentOverrides;
          return {
            customAgents: state.customAgents.filter(
              (a) => a.identifier !== identifier,
            ),
            usedAgents: state.usedAgents.filter(
              (a) => a.identifier !== identifier,
            ),
            agentOverrides: newOverrides,
          };
        }),

      recordUsedAgent: (agent) =>
        set((state) => {
          const normalizedAgent = normalizeLocalAgent(agent);
          if (!normalizedAgent) return state;

          if (
            state.customAgents.some(
              (a) => a.identifier === normalizedAgent.identifier,
            )
          ) {
            return state;
          }

          const others = state.usedAgents.filter(
            (a) => a.identifier !== normalizedAgent.identifier,
          );
          return {
            usedAgents: normalizeLocalAgents(
              [normalizedAgent, ...others],
              MARKET_LIMITS.maxUsedAgents,
            ),
          };
        }),

      resetAgent: (identifier) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [identifier]: _removed, ...newOverrides } =
            state.agentOverrides;
          return { agentOverrides: newOverrides };
        }),

      // Data Management
      exportAllData: async (options) => createBrowserAppBackup(options),
      inspectBackupFile: async (file) => inspectBrowserAppBackup(file),
      restoreAllData: async (file, options) =>
        restoreBrowserAppBackup(file, options),
      clearDataSources: async (sources) => {
        await clearBrowserAppDataSources({ sources, rag: get().rag });
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      },
      clearAllData: async () => {
        await clearBrowserAppData(get().rag);
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      },
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(getAppDbStorage),
      version: STORAGE_VERSION,
      migrate: async (persistedState) => {
        const state = persistedState as Partial<SettingsState>;
        const installedPlugins = refreshBuiltInPluginDefinitions(
          removeRemovedBuiltInPlugins(
            state.installedPlugins || [...BUILT_IN_PLUGINS],
          ),
        );
        const pluginConfigs = await migratePluginConfigLocalSecrets(
          normalizePluginConfigs(state.pluginConfigs, installedPlugins),
        );
        const search = await migrateSearchLocalSecrets(state.search);
        const rag = await migrateRAGLocalSecrets(state.rag);
        const voice = await migrateVoiceLocalSecrets(state.voice);
        return {
          ...state,
          marketPlugins: state.marketPlugins || [],
          marketPluginsTimestamp: state.marketPluginsTimestamp || 0,
          marketMcpServers: state.marketMcpServers || [],
          marketMcpServersTimestamp: state.marketMcpServersTimestamp || 0,
          marketAgents: normalizeMarketAgents(state.marketAgents),
          marketAgentsTimestamp: state.marketAgentsTimestamp || 0,
          marketAgentsLocale: state.marketAgentsLocale || "",
          skillCatalogs: normalizeSkillCatalogCache(state.skillCatalogs),
          skillCatalogTimestamps: normalizeTimestampCache(
            state.skillCatalogTimestamps,
          ),
          skillDefinitions: normalizeSkillDefinitionCache(
            state.skillDefinitions,
          ),
          skillDefinitionTimestamps: normalizeTimestampCache(
            state.skillDefinitionTimestamps,
          ),
          system: normalizeSystemSettings(
            state.system,
            DEFAULT_SYSTEM_SETTINGS,
          ),
          modelMetadata: normalizeModelMetadataMap(state.modelMetadata),
          modelMetadataTimestamp: state.modelMetadataTimestamp || 0,
          customModelMetadata: normalizeModelMetadataMap(
            state.customModelMetadata,
            { preserveKeys: true },
          ),
          search,
          rag,
          voice,
          activePlugins: normalizeActivePluginIds(
            state.activePlugins,
            installedPlugins,
            pluginConfigs,
            { unauthenticatedAllowedPluginIds: [UNSPLASH_PLUGIN.id] },
          ),
          installedPlugins,
          pluginConfigs,
          installedSkills: normalizeInstalledSkills(
            state.installedSkills && state.installedSkills.length > 0
              ? state.installedSkills
              : state.customSkills,
          ),
          customSkills: normalizeCustomSkills(
            state.customSkills,
            MARKET_LIMITS.maxCustomSkills,
          ),
          activeSkillIds: normalizeSkillIdRefsForStorage(state.activeSkillIds),
          skillAutoSelect:
            typeof state.skillAutoSelect === "boolean"
              ? state.skillAutoSelect
              : true,
          skillBundles: normalizeSkillBundles(
            state.skillBundles,
            MARKET_LIMITS.maxCustomSkills,
          ),
          activeSkillBundleIds: normalizeSkillIdRefsForStorage(
            state.activeSkillBundleIds,
            20,
          ),
          customAgents: normalizeLocalAgents(
            state.customAgents,
            MARKET_LIMITS.maxCustomAgents,
          ),
          usedAgents: normalizeLocalAgents(
            state.usedAgents,
            MARKET_LIMITS.maxUsedAgents,
          ),
          agentOverrides: normalizeAgentOverrides(state.agentOverrides),
        } as SettingsState;
      },
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === "object"
            ? (persistedState as Partial<SettingsState>)
            : {};

        return {
          ...currentState,
          ...persisted,
          system: normalizeSystemSettings(
            persisted.system,
            DEFAULT_SYSTEM_SETTINGS,
          ),
        };
      },
      partialize: (state) => ({
        marketPlugins: state.marketPlugins,
        marketPluginsTimestamp: state.marketPluginsTimestamp,
        marketMcpServers: state.marketMcpServers,
        marketMcpServersTimestamp: state.marketMcpServersTimestamp,
        marketAgents: state.marketAgents,
        marketAgentsTimestamp: state.marketAgentsTimestamp,
        marketAgentsLocale: state.marketAgentsLocale,
        skillCatalogs: state.skillCatalogs,
        skillCatalogTimestamps: state.skillCatalogTimestamps,
        skillDefinitions: state.skillDefinitions,
        skillDefinitionTimestamps: state.skillDefinitionTimestamps,
        system: state.system,
        modelMetadata: state.modelMetadata,
        modelMetadataTimestamp: state.modelMetadataTimestamp,
        customModelMetadata: state.customModelMetadata,
        search: stripSearchPlainSecrets(state.search),
        rag: stripRAGPlainSecrets(state.rag),
        voice: stripVoicePlainSecrets(state.voice),
        activePlugins: state.activePlugins,
        installedPlugins: state.installedPlugins,
        pluginConfigs: stripPluginConfigPlainSecrets(state.pluginConfigs),
        installedSkills: state.installedSkills,
        customSkills: state.customSkills,
        activeSkillIds: state.activeSkillIds,
        skillAutoSelect: state.skillAutoSelect,
        skillBundles: state.skillBundles,
        activeSkillBundleIds: state.activeSkillBundleIds,
        customAgents: state.customAgents,
        usedAgents: state.usedAgents,
        agentOverrides: state.agentOverrides,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (typeof window === "undefined") return;
        if (error) logDevError("Settings hydration failed:", error);
        void reportAppRestoreHydration("settings", error).then(
          () => state?.setHasHydrated(true),
          (restoreError) => {
            logDevError(
              "Restored settings failed startup validation:",
              restoreError,
            );
            window.location.reload();
          },
        );
      },
    },
  ),
);

// Utility Functions
export const formatModelName = (
  id: string,
  metadata?: Record<string, ModelMetadata>,
  customMetadata?: Record<string, ModelMetadata>,
  providerId?: string,
): string => {
  if (!id) return "";

  // Priority: custom metadata > fetched metadata > fallback formatting
  const name = resolveProviderModelMetadata({
    providerId,
    modelName: id,
    modelMetadata: metadata || {},
    customModelMetadata: customMetadata || {},
  })?.name;
  if (name) return name;

  // Fallback: format the ID
  return id
    .replace(/[-_]/g, (match, offset, str) => {
      // Keep hyphen if surrounded by digits (e.g., 06-05)
      if (
        match === "-" &&
        offset > 0 &&
        offset < str.length - 1 &&
        /\d/.test(str[offset - 1]) &&
        /\d/.test(str[offset + 1])
      ) {
        return match;
      }
      return " ";
    })
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

export const getEffectiveBaseUrl = (baseUrl: string, type: string): string => {
  return normalizeProviderBaseUrl(baseUrl, type);
};

export const getTaskModel = (task: keyof DefaultModels): string => {
  const { defaultModels, providers } = useCoreSettingsStore.getState();
  return getDefaultModelSelectValue(defaultModels, task, providers);
};
