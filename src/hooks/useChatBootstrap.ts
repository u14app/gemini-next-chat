"use client";
import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@/services/api/chatService";
import type {
  ChatConfig,
  ModelMetadata,
  ModelProvider,
  Session,
} from "@/types";
import { resolveSelectedModel } from "@/lib/utils/models";
import {
  buildProviderRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import {
  PublicServerConfig,
  SERVER_DEFAULT_PROVIDER_ID,
} from "@/lib/defaultConfig/shared";
import {
  shouldDisableSearchToggle,
  shouldCreateInitialChatSession,
  shouldResolveSelectedModelAfterBootstrap,
  shouldEnableReasoningByDefault,
  shouldRunSettingsStartupEffects,
} from "@/lib/app/startupEffects";
import type { resolveEffectiveSearchCapability } from "@/lib/settings/searchRag";
import {
  parseModelString,
  resolveProviderModelMetadata,
} from "@/lib/utils/model";
import { logDevError } from "@/lib/utils/devLogger";

const logChatAppError = logDevError;

type SearchCompatibility = ReturnType<typeof resolveEffectiveSearchCapability>;

interface UseChatBootstrapOptions {
  chatHasHydrated: boolean;
  settingsHasHydrated: boolean;
  coreHasHydrated: boolean;
  useSearch: boolean;
  useDeepResearch: boolean;
  useReasoning: boolean;
  reasoningMode: ChatConfig["reasoningMode"];
  currentSearchCompatibility: SearchCompatibility;
  setChatConfig: (
    config: Partial<
      Pick<
        ChatConfig,
        | "chatMode"
        | "useSearch"
        | "useAgentMode"
        | "useDeepResearch"
        | "useReasoning"
        | "reasoningMode"
      >
    >,
  ) => void;
  updateSessionConfig: (
    id: string,
    config: Partial<NonNullable<Session["config"]>>,
  ) => void;
  fetchModelMetadata: () => void;
  ensureBuiltInPlugins: () => void;
  applyCoreServerConfig: (config: PublicServerConfig) => void;
  applySettingsServerConfig: (config: PublicServerConfig) => void;
  providers: ModelProvider[];
  updateProvider: (id: string, updates: Partial<ModelProvider>) => void;
  availableModels: ModelInfo[];
  selectedModel: string;
  setModel: (model: string) => void;
  sessions: Session[];
  currentSessionId: string | null;
  createSession: () => void;
  modelMetadata: Record<string, ModelMetadata>;
  customModelMetadata: Record<string, ModelMetadata>;
}

/**
 * Startup sequence: server config -> default-provider models -> selected model,
 * plus the first-session guarantee. Exposes `serverModelBootstrapReady` so the
 * shell can hold model-dependent UI until the sequence settles.
 */
export function useChatBootstrap({
  chatHasHydrated,
  settingsHasHydrated,
  coreHasHydrated,
  useSearch,
  useDeepResearch,
  useReasoning,
  reasoningMode,
  currentSearchCompatibility,
  setChatConfig,
  updateSessionConfig,
  fetchModelMetadata,
  ensureBuiltInPlugins,
  applyCoreServerConfig,
  applySettingsServerConfig,
  providers,
  updateProvider,
  availableModels,
  selectedModel,
  setModel,
  sessions,
  currentSessionId,
  createSession,
  modelMetadata,
  customModelMetadata,
}: UseChatBootstrapOptions) {
  const [serverConfigResolved, setServerConfigResolved] = useState(false);
  const [serverModelBootstrapReady, setServerModelBootstrapReady] =
    useState(false);
  const defaultProviderFetchRef = useRef(false);
  const reasoningDefaultAppliedRef = useRef(false);

  // Fetch Metadata & Ensure Plugins on mount
  useEffect(() => {
    if (
      !shouldDisableSearchToggle({
        chatHydrated: chatHasHydrated,
        settingsHydrated: settingsHasHydrated,
        coreHydrated: coreHasHydrated,
        serverModelBootstrapReady,
        useSearch,
        searchCompatibility: currentSearchCompatibility,
      })
    ) {
      return;
    }

    if (!currentSearchCompatibility.enabled) {
      const nextConfig = useDeepResearch
        ? {
            chatMode: "chat" as const,
            useSearch: false,
            useAgentMode: false,
            useDeepResearch: false,
          }
        : { useSearch: false };
      setChatConfig(nextConfig);
      if (currentSessionId) {
        updateSessionConfig(currentSessionId, nextConfig);
      }
    }
  }, [
    useSearch,
    chatHasHydrated,
    settingsHasHydrated,
    coreHasHydrated,
    currentSearchCompatibility,
    currentSessionId,
    serverModelBootstrapReady,
    setChatConfig,
    updateSessionConfig,
    useDeepResearch,
  ]);

  useEffect(() => {
    if (!shouldRunSettingsStartupEffects(settingsHasHydrated)) return;
    fetchModelMetadata();
    ensureBuiltInPlugins();
  }, [settingsHasHydrated, fetchModelMetadata, ensureBuiltInPlugins]);

  useEffect(() => {
    if (!coreHasHydrated || !settingsHasHydrated) return;

    let active = true;
    defaultProviderFetchRef.current = false;
    setServerConfigResolved(false);
    setServerModelBootstrapReady(false);

    const loadServerConfig = async () => {
      try {
        const response = await fetch("/api/config", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            await getResponseErrorMessage(response, "Failed to load config"),
          );
        }

        const config = await readJsonResponseOrThrow<PublicServerConfig>(
          response,
          "Failed to load config",
        );
        if (!active) return;

        applyCoreServerConfig(config);
        applySettingsServerConfig(config);
        setServerConfigResolved(true);
        if (
          !config.modelProvider.available ||
          config.modelProvider.models.length > 0
        ) {
          setServerModelBootstrapReady(true);
        }
      } catch (error) {
        logChatAppError("Failed to load server config", error);
        if (!active) return;
        setServerConfigResolved(true);
        setServerModelBootstrapReady(true);
      }
    };

    loadServerConfig();

    return () => {
      active = false;
    };
  }, [
    settingsHasHydrated,
    applyCoreServerConfig,
    applySettingsServerConfig,
    coreHasHydrated,
  ]);

  useEffect(() => {
    if (
      !coreHasHydrated ||
      !serverConfigResolved ||
      serverModelBootstrapReady
    ) {
      return;
    }

    const defaultProvider = providers.find(
      (provider) =>
        provider.id === SERVER_DEFAULT_PROVIDER_ID && provider.isServerDefault,
    );
    if (!defaultProvider) {
      setServerModelBootstrapReady(true);
      return;
    }
    if (
      defaultProvider.modelsList?.length ||
      defaultProvider.models.length > 0
    ) {
      setServerModelBootstrapReady(true);
      return;
    }
    if (defaultProviderFetchRef.current) return;

    let active = true;
    defaultProviderFetchRef.current = true;
    const providerSnapshot = defaultProvider;

    fetchWithByokRetry(async () =>
      signedApiFetch("/api/providers/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(providerSnapshot),
        }),
      }),
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await getResponseErrorMessage(response, "Failed to fetch models"),
          );
        }
        return readJsonResponseOrThrow<{ models?: string[] }>(
          response,
          "Failed to fetch models",
        );
      })
      .then((data) => {
        const models = data.models || [];
        updateProvider(providerSnapshot.id, {
          models,
          modelsList: models,
        });
        if (active) {
          setServerModelBootstrapReady(true);
        }
      })
      .catch((error) => {
        logChatAppError("Failed to fetch default provider models", error);
        if (active) {
          setServerModelBootstrapReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [
    coreHasHydrated,
    providers,
    serverConfigResolved,
    serverModelBootstrapReady,
    updateProvider,
  ]);

  useEffect(() => {
    if (
      !shouldResolveSelectedModelAfterBootstrap({
        chatHydrated: chatHasHydrated,
        settingsHydrated: settingsHasHydrated,
        coreHydrated: coreHasHydrated,
        serverModelBootstrapReady,
      })
    ) {
      return;
    }

    const nextModel = resolveSelectedModel(
      availableModels,
      selectedModel,
      SERVER_DEFAULT_PROVIDER_ID,
    );

    if (selectedModel === nextModel) {
      return;
    }

    setModel(nextModel);
  }, [
    chatHasHydrated,
    settingsHasHydrated,
    coreHasHydrated,
    serverModelBootstrapReady,
    availableModels,
    selectedModel,
    setModel,
  ]);

  useEffect(() => {
    if (
      !shouldResolveSelectedModelAfterBootstrap({
        chatHydrated: chatHasHydrated,
        settingsHydrated: settingsHasHydrated,
        coreHydrated: coreHasHydrated,
        serverModelBootstrapReady,
      }) ||
      !selectedModel ||
      reasoningDefaultAppliedRef.current
    ) {
      return;
    }

    const { providerId, modelName } = parseModelString(selectedModel);
    const selectedModelMetadata = resolveProviderModelMetadata({
      providerId,
      modelName,
      modelMetadata,
      customModelMetadata,
    });
    if (selectedModelMetadata?.reasoning !== true) return;

    reasoningDefaultAppliedRef.current = true;
    const currentSession = sessions.find(
      (session) => session.id === currentSessionId,
    );
    if (
      !shouldEnableReasoningByDefault({
        selectedModel,
        modelSupportsReasoning: true,
        chatConfig: { useReasoning, reasoningMode },
        sessionConfig: currentSession?.config,
      })
    ) {
      return;
    }

    setChatConfig({ reasoningMode: "auto", useReasoning: true });
  }, [
    chatHasHydrated,
    coreHasHydrated,
    customModelMetadata,
    currentSessionId,
    modelMetadata,
    reasoningMode,
    selectedModel,
    serverModelBootstrapReady,
    sessions,
    settingsHasHydrated,
    setChatConfig,
    useReasoning,
  ]);

  // Create the first session on mount. Existing conversations stay available in
  // the sidebar, while a page reload remains on the welcome screen until the
  // user explicitly opens one or starts a message.
  useEffect(() => {
    // Wait for chat store to hydrate before creating the first session.
    if (!chatHasHydrated) return;

    const timer = setTimeout(() => {
      if (
        shouldCreateInitialChatSession({
          chatHydrated: chatHasHydrated,
          sessionCount: sessions.length,
        })
      ) {
        createSession();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [chatHasHydrated, sessions, createSession]);

  return { serverModelBootstrapReady };
}
