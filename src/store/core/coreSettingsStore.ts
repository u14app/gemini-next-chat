import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  getBrowserLocalStorage,
  STORAGE_KEYS,
  STORAGE_VERSION,
} from "../storage/storageConfig";
import { ModelProvider, DefaultModels } from "@/types";
import { pruneUnavailableDefaultModels } from "@/lib/utils/defaultModels";
import {
  PublicServerConfig,
  SERVER_DEFAULT_PROVIDER_ID,
} from "@/lib/defaultConfig/shared";
import {
  migrateCoreSettingsState,
  normalizeModelProvider,
  normalizeModelProviders,
} from "@/lib/providers/config";
import {
  OPENAI_COMPATIBLE_PROVIDER_TYPE,
  normalizeProviderTypeValue,
} from "@/lib/providers/providerTypes";
import { logDevError } from "@/lib/utils/devLogger";
import { reportAppRestoreHydration } from "@/lib/data/appRestoreJournal";
import {
  migrateProviderLocalSecret,
  stripProviderPlainSecret,
} from "@/lib/settings/localSecretMigration";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTION_IDS,
  cloneShortcutBindings,
  findShortcutConflict,
  normalizeShortcutBindings,
  validateShortcutBinding,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutBindings,
} from "@/lib/shortcuts";

/**
 * Core Settings Store
 * Stores theme, language, providers, defaultModels, and shortcut bindings in
 * localStorage for fast synchronous access during initialization.
 */

const EMPTY_DEFAULT_MODELS: DefaultModels = {
  titleGeneration: "",
  relatedQuestions: "",
  contextCompression: "",
  promptOptimization: "",
  ragQuery: "",
  memory: "",
};

const LEGACY_GEMINI_PROVIDER = {
  id: "GEMINI",
  name: "Google Gemini",
  type: "Google",
  baseUrl: "https://generativelanguage.googleapis.com",
};

function isDeprecatedDefaultGeminiProvider(provider: ModelProvider): boolean {
  return (
    provider.id === LEGACY_GEMINI_PROVIDER.id &&
    provider.name === LEGACY_GEMINI_PROVIDER.name &&
    provider.type === LEGACY_GEMINI_PROVIDER.type &&
    provider.baseUrl === LEGACY_GEMINI_PROVIDER.baseUrl &&
    !provider.apiKey?.trim() &&
    !provider.apiKeySecret
  );
}

function getServerDefaultModels(
  defaultModels: Partial<DefaultModels>,
): DefaultModels {
  const next = { ...EMPTY_DEFAULT_MODELS };

  for (const [task, model] of Object.entries(defaultModels) as Array<
    [keyof DefaultModels, string]
  >) {
    next[task] = model ? `${SERVER_DEFAULT_PROVIDER_ID}:${model}` : "";
  }

  return next;
}

function mergeServerDefaultModels(
  currentDefaults: DefaultModels,
  serverDefaults: Partial<DefaultModels>,
  providers: ModelProvider[],
): DefaultModels {
  const prunedCurrent = pruneUnavailableDefaultModels(
    currentDefaults,
    providers,
  );
  const seededDefaults = getServerDefaultModels(serverDefaults);
  return (
    Object.keys(EMPTY_DEFAULT_MODELS) as Array<keyof DefaultModels>
  ).reduce<DefaultModels>(
    (next, task) => ({
      ...next,
      [task]: prunedCurrent[task] || seededDefaults[task] || "",
    }),
    { ...EMPTY_DEFAULT_MODELS },
  );
}

interface CoreSettingsState {
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;

  theme: "light" | "dark" | "system";
  language: string;
  providers: ModelProvider[];
  defaultModels: DefaultModels;
  shortcutBindings: ShortcutBindings;
  serverDefaultProviderEnabled?: boolean;

  // Actions
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLanguage: (lang: string) => void;

  // Provider Actions
  addProvider: () => string;
  updateProvider: (id: string, updates: Partial<ModelProvider>) => void;
  deleteProvider: (id: string) => void;
  toggleProviderEnabled: (id: string) => void;
  applyServerConfig: (config: PublicServerConfig) => void;

  // Default Models Actions
  updateDefaultModels: (models: Partial<DefaultModels>) => void;

  // Shortcut Actions
  setShortcutBinding: (
    actionId: ShortcutActionId,
    binding: ShortcutBinding | null,
  ) => void;
  resetShortcutBinding: (actionId: ShortcutActionId) => void;
  resetShortcutBindings: () => void;
}

// Helper to generate random 6-letter ID
const generateProviderId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const useCoreSettingsStore = create<CoreSettingsState>()(
  persist(
    (set) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },

      theme: "system",
      language: "auto",
      providers: [],
      serverDefaultProviderEnabled: undefined,
      defaultModels: { ...EMPTY_DEFAULT_MODELS },
      shortcutBindings: cloneShortcutBindings(),

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),

      addProvider: () => {
        const id = generateProviderId();
        const newProvider: ModelProvider = {
          id: id,
          name: "New Provider",
          type: OPENAI_COMPATIBLE_PROVIDER_TYPE,
          baseUrl: "https://api.openai.com",
          apiKey: "",
          enabled: true,
          directCall: true,
          models: [],
          modelsList: [],
        };
        set((state) => ({
          providers: normalizeModelProviders([...state.providers, newProvider]),
        }));
        return id;
      },

      updateProvider: (id, updates) => {
        set((state) => {
          const safeUpdates =
            id === SERVER_DEFAULT_PROVIDER_ID
              ? { ...updates, enabled: true }
              : updates;
          const providers = state.providers.map((p) =>
            p.id === id
              ? normalizeModelProvider({ ...p, ...safeUpdates }, p) || p
              : p,
          );
          return {
            providers,
            defaultModels: pruneUnavailableDefaultModels(
              state.defaultModels,
              providers,
            ),
          };
        });
      },

      deleteProvider: (id) => {
        if (id === SERVER_DEFAULT_PROVIDER_ID) return;

        set((state) => {
          const providers = state.providers.filter((p) => p.id !== id);
          return {
            providers,
            defaultModels: pruneUnavailableDefaultModels(
              state.defaultModels,
              providers,
            ),
          };
        });
      },

      toggleProviderEnabled: (id) => {
        if (id === SERVER_DEFAULT_PROVIDER_ID) return;

        set((state) => {
          const providers = state.providers.map((p) => {
            if (p.id === id) {
              return { ...p, enabled: !p.enabled };
            }
            return p;
          });
          return {
            providers,
            defaultModels: pruneUnavailableDefaultModels(
              state.defaultModels,
              providers,
            ),
          };
        });
      },

      applyServerConfig: (config) =>
        set((state) => {
          const savedDefaultProvider = state.providers.find(
            (provider) =>
              provider.id === SERVER_DEFAULT_PROVIDER_ID ||
              provider.isServerDefault,
          );
          const userProviders = state.providers.filter(
            (provider) => !provider.isServerDefault,
          );
          const providerModels = config.modelProvider.models;
          const savedProviderType = normalizeProviderTypeValue(
            savedDefaultProvider?.type,
          );
          const serverProviderType = normalizeProviderTypeValue(
            config.modelProvider.type,
          );
          const canReuseSavedDefault =
            Boolean(savedDefaultProvider) &&
            savedProviderType !== null &&
            savedProviderType === serverProviderType;
          const defaultProviderModels =
            providerModels.length > 0
              ? providerModels
              : canReuseSavedDefault
                ? savedDefaultProvider?.models || []
                : [];
          const defaultProviderModelsList =
            providerModels.length > 0
              ? providerModels
              : canReuseSavedDefault
                ? savedDefaultProvider?.modelsList ||
                  savedDefaultProvider?.models ||
                  []
                : [];

          if (!config.modelProvider.available) {
            return {
              providers: userProviders,
              defaultModels: pruneUnavailableDefaultModels(
                state.defaultModels,
                userProviders,
              ),
            };
          }

          const defaultProvider = normalizeModelProvider({
            id: SERVER_DEFAULT_PROVIDER_ID,
            name: config.modelProvider.name,
            type: config.modelProvider.type,
            baseUrl: "default",
            apiKey: "",
            apiKeySecret: canReuseSavedDefault
              ? savedDefaultProvider?.apiKeySecret
              : undefined,
            enabled: true,
            models: defaultProviderModels,
            modelsList: defaultProviderModelsList,
            isServerDefault: true,
          });

          if (!defaultProvider) {
            return {
              providers: userProviders,
              defaultModels: pruneUnavailableDefaultModels(
                state.defaultModels,
                userProviders,
              ),
            };
          }

          const providers = [defaultProvider, ...userProviders];

          return {
            providers,
            defaultModels: mergeServerDefaultModels(
              state.defaultModels,
              config.modelProvider.defaultModels,
              providers,
            ),
          };
        }),

      updateDefaultModels: (models) =>
        set((state) => ({
          defaultModels: { ...state.defaultModels, ...models },
        })),

      setShortcutBinding: (actionId, binding) =>
        set((state) => {
          if (!SHORTCUT_ACTION_IDS.includes(actionId)) return state;
          if (binding && !validateShortcutBinding(binding).valid) return state;
          if (
            binding &&
            findShortcutConflict(state.shortcutBindings, binding, actionId)
          ) {
            return state;
          }

          return {
            shortcutBindings: {
              ...state.shortcutBindings,
              [actionId]: binding ? { ...binding } : null,
            },
          };
        }),

      resetShortcutBinding: (actionId) =>
        set((state) => {
          if (!SHORTCUT_ACTION_IDS.includes(actionId)) return state;
          const defaultBinding = DEFAULT_SHORTCUT_BINDINGS[actionId];
          const conflict = defaultBinding
            ? findShortcutConflict(
                state.shortcutBindings,
                defaultBinding,
                actionId,
              )
            : null;
          const shortcutBindings = { ...state.shortcutBindings };
          if (conflict) shortcutBindings[conflict] = null;
          shortcutBindings[actionId] = defaultBinding
            ? { ...defaultBinding }
            : null;
          return { shortcutBindings };
        }),

      resetShortcutBindings: () =>
        set({
          shortcutBindings: cloneShortcutBindings(),
        }),
    }),
    {
      name: STORAGE_KEYS.CORE_SETTINGS,
      storage: createJSONStorage(getBrowserLocalStorage),
      version: STORAGE_VERSION,
      migrate: async (persistedState) => {
        const state = migrateCoreSettingsState(
          persistedState as Partial<CoreSettingsState>,
        );
        const normalizedProviders = (state.providers || []).filter(
          (provider) => !isDeprecatedDefaultGeminiProvider(provider),
        );
        const providers = await Promise.all(
          normalizedProviders.map(migrateProviderLocalSecret),
        );
        return {
          ...state,
          theme: state.theme || "system",
          language: state.language || "auto",
          serverDefaultProviderEnabled: undefined,
          providers,
          shortcutBindings: normalizeShortcutBindings(state.shortcutBindings),
          defaultModels: pruneUnavailableDefaultModels(
            { ...EMPTY_DEFAULT_MODELS, ...state.defaultModels },
            providers,
          ),
        } as CoreSettingsState;
      },
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === "object"
            ? (persistedState as Partial<CoreSettingsState>)
            : {};
        return {
          ...currentState,
          ...persisted,
          shortcutBindings: normalizeShortcutBindings(
            persisted.shortcutBindings,
          ),
        };
      },
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        providers: state.providers.map(stripProviderPlainSecret),
        defaultModels: state.defaultModels,
        shortcutBindings: state.shortcutBindings,
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (typeof window === "undefined") return;
          if (error) logDevError("Core settings hydration failed:", error);
          void reportAppRestoreHydration("coreSettings", error).then(
            () => state?.setHasHydrated(true),
            (restoreError) => {
              logDevError(
                "Restored core settings failed startup validation:",
                restoreError,
              );
              window.location.reload();
            },
          );
        };
      },
    },
  ),
);
