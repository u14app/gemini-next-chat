import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicServerConfig } from "../lib/defaultConfig/shared";
import { SERVER_DEFAULT_PROVIDER_ID } from "../lib/defaultConfig/shared";
import type { Plugin } from "../types";

vi.mock("server-only", () => ({}));

vi.mock("@/config/api", async () => vi.importActual("../config/api"));
vi.mock("@/config/defaults", async () => vi.importActual("../config/defaults"));
vi.mock("@/config/limits", async () => vi.importActual("../config/limits"));
vi.mock("@/config/plugins", async () => vi.importActual("../config/plugins"));
vi.mock("@/lib/defaultConfig/shared", async () =>
  vi.importActual("../lib/defaultConfig/shared"),
);
vi.mock("@/lib/market/agents", async () =>
  vi.importActual("../lib/market/agents"),
);
vi.mock("@/lib/providers/config", async () =>
  vi.importActual("../lib/providers/config"),
);
vi.mock("@/lib/providers/providerTypes", async () =>
  vi.importActual("../lib/providers/providerTypes"),
);
vi.mock("@/lib/providers/metadata", async () =>
  vi.importActual("../lib/providers/metadata"),
);
vi.mock("@/lib/security/urlPolicy", async () =>
  vi.importActual("../lib/security/urlPolicy"),
);
vi.mock("@/lib/utils/defaultModels", async () =>
  vi.importActual("../lib/utils/defaultModels"),
);

const serverConfig: PublicServerConfig = {
  modelProvider: {
    available: true,
    id: SERVER_DEFAULT_PROVIDER_ID,
    name: "Hosted Default",
    type: "Google",
    models: ["gemini-default"],
    defaultModels: {
      titleGeneration: "gemini-default",
      relatedQuestions: "gemini-default",
      memory: "gemini-default",
    },
    modelMetadata: {},
  },
  search: {
    available: true,
  },
  rag: {
    vectorStoreAvailable: false,
    documentProcessingAvailable: true,
    documentProcessingProvider: "mineru",
  },
  voice: {
    elevenLabsAvailable: false,
    mimoAvailable: false,
    defaultSttAvailable: false,
    defaultTtsAvailable: false,
  },
  limits: {
    attachments: {
      maxFileBytes: 10 * 1024 * 1024,
    },
  },
};

describe("server default store injection", () => {
  beforeEach(async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");

    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    useCoreSettingsStore.setState(useCoreSettingsStore.getInitialState(), true);
  });

  it("creates new model providers as OpenAI Compatible with direct calls enabled", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");

    const providerId = useCoreSettingsStore.getState().addProvider();

    expect(
      useCoreSettingsStore
        .getState()
        .providers.find((provider) => provider.id === providerId),
    ).toMatchObject({
      type: "OpenAI Compatible",
      directCall: true,
    });
  });

  it("selects default search for fresh settings but preserves persisted search choices", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");

    useSettingsStore.getState().applyServerConfig(serverConfig);
    expect(useSettingsStore.getState().search.provider).toBe("default");

    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    useSettingsStore.setState((state) => ({
      search: {
        ...state.search,
        provider: "google",
        configs: {
          ...state.search.configs,
          default: { serverAvailable: false },
        },
      },
    }));

    useSettingsStore.getState().applyServerConfig(serverConfig);
    expect(useSettingsStore.getState().search.provider).toBe("google");
  });

  it("enables default document processing when local credentials belong to another parser", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");

    useSettingsStore.setState((state) => ({
      ...state,
      rag: {
        ...state.rag,
        documentParseProvider: "llamaParse",
        mineruApiToken: "mineru-token",
        llamaParseApiKey: "",
        useDefaultDocumentProcessing: undefined,
      },
    }));

    useSettingsStore.getState().applyServerConfig({
      ...serverConfig,
      rag: {
        ...serverConfig.rag,
        documentProcessingAvailable: true,
        documentProcessingProvider: "llamaParse",
      },
    });

    expect(useSettingsStore.getState().rag).toMatchObject({
      documentParseProvider: "llamaParse",
      useDefaultDocumentProcessing: true,
      serverDocumentProcessingAvailable: true,
    });
  });

  it("seeds missing task-model defaults without overwriting persisted user choices", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");

    useCoreSettingsStore.setState((state) => ({
      ...state,
      serverDefaultProviderEnabled: false,
      providers: [
        {
          id: "GEMINI",
          name: "Google Gemini",
          type: "Google",
          baseUrl: "https://generativelanguage.googleapis.com",
          apiKey: "user-key",
          enabled: true,
          models: ["gemini-flash-latest"],
          modelsList: ["gemini-flash-latest"],
        },
        {
          id: "CUSTOM",
          name: "Custom",
          type: "OpenAI",
          baseUrl: "https://api.example.com",
          apiKey: "user-key",
          enabled: true,
          models: ["custom-model"],
          modelsList: ["custom-model"],
        },
      ],
      defaultModels: {
        titleGeneration: "GEMINI:gemini-flash-latest",
        relatedQuestions: "",
        contextCompression: "GEMINI:gemini-flash-latest",
        promptOptimization: "",
        ragQuery: "CUSTOM:custom-model",
        memory: "GEMINI:gemini-flash-latest",
      },
    }));

    useCoreSettingsStore.getState().applyServerConfig(serverConfig);

    const provider = useCoreSettingsStore
      .getState()
      .providers.find((item) => item.id === SERVER_DEFAULT_PROVIDER_ID);
    expect(provider?.enabled).toBe(true);
    expect(useCoreSettingsStore.getState().defaultModels).toEqual({
      titleGeneration: "GEMINI:gemini-flash-latest",
      relatedQuestions: "SERVER_DEFAULT:gemini-default",
      contextCompression: "GEMINI:gemini-flash-latest",
      promptOptimization: "",
      ragQuery: "CUSTOM:custom-model",
      memory: "GEMINI:gemini-flash-latest",
    });
  });

  it("preserves the default provider local key when server config is reapplied", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");
    const { encryptLocalSecret, LOCAL_SECRET_CONTEXTS } =
      await import("../lib/security/localSecrets");
    const apiKeySecret = await encryptLocalSecret(
      "browser-key",
      LOCAL_SECRET_CONTEXTS.providerApiKey(SERVER_DEFAULT_PROVIDER_ID),
    );

    useCoreSettingsStore.setState((state) => ({
      ...state,
      providers: [
        {
          id: SERVER_DEFAULT_PROVIDER_ID,
          name: "Hosted Default",
          type: "Google",
          baseUrl: "default",
          apiKey: "",
          apiKeySecret,
          enabled: true,
          models: ["gemini-default"],
          modelsList: ["gemini-default"],
          isServerDefault: true,
        },
      ],
    }));

    useCoreSettingsStore.getState().applyServerConfig(serverConfig);

    expect(
      useCoreSettingsStore
        .getState()
        .providers.find(
          (provider) => provider.id === SERVER_DEFAULT_PROVIDER_ID,
        )?.apiKeySecret,
    ).toEqual(apiKeySecret);
  });

  it("preserves dynamic default-provider models and task defaults across config refreshes", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");
    const { encryptLocalSecret, LOCAL_SECRET_CONTEXTS } =
      await import("../lib/security/localSecrets");
    const apiKeySecret = await encryptLocalSecret(
      "browser-key",
      LOCAL_SECRET_CONTEXTS.providerApiKey(SERVER_DEFAULT_PROVIDER_ID),
    );

    useCoreSettingsStore.setState((state) => ({
      ...state,
      providers: [
        {
          id: SERVER_DEFAULT_PROVIDER_ID,
          name: "Hosted Default",
          type: "Google",
          baseUrl: "default",
          apiKey: "",
          apiKeySecret,
          enabled: true,
          models: ["gemini-dynamic"],
          modelsList: ["gemini-dynamic"],
          isServerDefault: true,
        },
      ],
      defaultModels: {
        ...state.defaultModels,
        titleGeneration: "SERVER_DEFAULT:gemini-dynamic",
      },
    }));

    useCoreSettingsStore.getState().applyServerConfig({
      ...serverConfig,
      modelProvider: {
        ...serverConfig.modelProvider,
        models: [],
        defaultModels: {},
      },
    });

    expect(
      useCoreSettingsStore
        .getState()
        .providers.find(
          (provider) => provider.id === SERVER_DEFAULT_PROVIDER_ID,
        ),
    ).toMatchObject({
      apiKeySecret,
      models: ["gemini-dynamic"],
      modelsList: ["gemini-dynamic"],
    });
    expect(useCoreSettingsStore.getState().defaultModels.titleGeneration).toBe(
      "SERVER_DEFAULT:gemini-dynamic",
    );

    useCoreSettingsStore.getState().updateProvider(SERVER_DEFAULT_PROVIDER_ID, {
      models: ["gemini-dynamic", "gemini-new"],
      modelsList: ["gemini-dynamic", "gemini-new"],
    });

    expect(useCoreSettingsStore.getState().defaultModels.titleGeneration).toBe(
      "SERVER_DEFAULT:gemini-dynamic",
    );
  });

  it("drops saved default-provider credentials and models when its type changes", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");
    const { encryptLocalSecret, LOCAL_SECRET_CONTEXTS } =
      await import("../lib/security/localSecrets");
    const apiKeySecret = await encryptLocalSecret(
      "browser-key",
      LOCAL_SECRET_CONTEXTS.providerApiKey(SERVER_DEFAULT_PROVIDER_ID),
    );

    useCoreSettingsStore.setState((state) => ({
      ...state,
      providers: [
        {
          id: SERVER_DEFAULT_PROVIDER_ID,
          name: "Hosted Default",
          type: "Google",
          baseUrl: "default",
          apiKey: "",
          apiKeySecret,
          enabled: true,
          models: ["gemini-dynamic"],
          modelsList: ["gemini-dynamic"],
          isServerDefault: true,
        },
      ],
      defaultModels: {
        ...state.defaultModels,
        titleGeneration: "SERVER_DEFAULT:gemini-dynamic",
      },
    }));

    useCoreSettingsStore.getState().applyServerConfig({
      ...serverConfig,
      modelProvider: {
        ...serverConfig.modelProvider,
        type: "Anthropic",
        models: [],
        defaultModels: {},
      },
    });

    const provider = useCoreSettingsStore
      .getState()
      .providers.find((item) => item.id === SERVER_DEFAULT_PROVIDER_ID);
    expect(provider).toMatchObject({
      type: "Anthropic",
      models: [],
      modelsList: [],
    });
    expect(provider?.apiKeySecret).toBeUndefined();
    expect(useCoreSettingsStore.getState().defaultModels.titleGeneration).toBe(
      "",
    );
  });

  it("lets static server models replace stale dynamic models and seed task defaults", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");

    useCoreSettingsStore.setState((state) => ({
      ...state,
      providers: [
        {
          id: SERVER_DEFAULT_PROVIDER_ID,
          name: "Hosted Default",
          type: "Google",
          baseUrl: "default",
          apiKey: "",
          enabled: true,
          models: ["gemini-dynamic"],
          modelsList: ["gemini-dynamic"],
          isServerDefault: true,
        },
      ],
      defaultModels: {
        ...state.defaultModels,
        titleGeneration: "SERVER_DEFAULT:gemini-dynamic",
        relatedQuestions: "SERVER_DEFAULT:gemini-dynamic",
      },
    }));

    useCoreSettingsStore.getState().applyServerConfig({
      ...serverConfig,
      modelProvider: {
        ...serverConfig.modelProvider,
        models: ["gemini-static"],
        defaultModels: {
          titleGeneration: "gemini-static",
        },
      },
    });

    expect(
      useCoreSettingsStore
        .getState()
        .providers.find(
          (provider) => provider.id === SERVER_DEFAULT_PROVIDER_ID,
        ),
    ).toMatchObject({
      models: ["gemini-static"],
      modelsList: ["gemini-static"],
    });
    expect(useCoreSettingsStore.getState().defaultModels).toMatchObject({
      titleGeneration: "SERVER_DEFAULT:gemini-static",
      relatedQuestions: "",
    });
  });

  it("persists the default provider local key like a regular provider", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");
    const { encryptLocalSecret, LOCAL_SECRET_CONTEXTS } =
      await import("../lib/security/localSecrets");
    const apiKeySecret = await encryptLocalSecret(
      "browser-key",
      LOCAL_SECRET_CONTEXTS.providerApiKey(SERVER_DEFAULT_PROVIDER_ID),
    );

    useCoreSettingsStore.setState((state) => ({
      ...state,
      providers: [
        {
          id: SERVER_DEFAULT_PROVIDER_ID,
          name: "Hosted Default",
          type: "Google",
          baseUrl: "default",
          apiKey: "",
          apiKeySecret,
          enabled: true,
          models: ["gemini-default"],
          modelsList: ["gemini-default"],
          isServerDefault: true,
        },
      ],
    }));

    const partialize = (useCoreSettingsStore as any).persist.getOptions()
      .partialize;
    const persisted = partialize(useCoreSettingsStore.getState());

    expect(persisted.providers).toHaveLength(1);
    expect(persisted.providers[0]).toMatchObject({
      id: SERVER_DEFAULT_PROVIDER_ID,
      apiKey: "",
      apiKeySecret,
      isServerDefault: true,
    });
  });

  it("initializes missing server model metadata without overwriting user edits", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");

    useSettingsStore.setState((state) => ({
      ...state,
      customModelMetadata: {
        "user-edited": {
          id: "user-edited",
          name: "User Edited Name",
          reasoning: false,
        },
      },
    }));

    useSettingsStore.getState().applyServerConfig({
      ...serverConfig,
      modelProvider: {
        ...serverConfig.modelProvider,
        models: ["server-new", "user-edited"],
        modelMetadata: {
          "server-new": {
            id: "server-new",
            name: "Server New",
            tool_call: true,
          },
          "user-edited": {
            id: "user-edited",
            name: "Server Name",
            reasoning: true,
          },
        },
      },
    });

    expect(useSettingsStore.getState().customModelMetadata).toMatchObject({
      [`${SERVER_DEFAULT_PROVIDER_ID}:server-new`]: {
        id: "server-new",
        name: "Server New",
        tool_call: true,
      },
      "user-edited": {
        id: "user-edited",
        name: "User Edited Name",
        reasoning: false,
      },
    });
  });

  it("stores new custom model metadata under provider-qualified keys", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");

    useSettingsStore.getState().setCustomModelMetadata("provider-a", "shared", {
      id: "shared",
      name: "Provider A Shared",
      tool_call: true,
    });
    useSettingsStore.getState().setCustomModelMetadata("provider-b", "shared", {
      id: "shared",
      name: "Provider B Shared",
      tool_call: false,
    });

    expect(useSettingsStore.getState().customModelMetadata).toMatchObject({
      "provider-a:shared": {
        id: "shared",
        name: "Provider A Shared",
        tool_call: true,
      },
      "provider-b:shared": {
        id: "shared",
        name: "Provider B Shared",
        tool_call: false,
      },
    });
  });

  it("refreshes built-in plugin definitions without dropping saved auth secrets", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");
    const { JINA_READER_PLUGIN } = await import("../config/plugins");
    const { encryptLocalSecret, LOCAL_SECRET_CONTEXTS, hasLocalSecret } =
      await import("../lib/security/localSecrets");

    const localValueSecret = await encryptLocalSecret(
      "jina-secret",
      LOCAL_SECRET_CONTEXTS.pluginAuth(JINA_READER_PLUGIN.id),
    );
    const staleJinaPlugin: Plugin = {
      ...JINA_READER_PLUGIN,
      title: "Old Jina",
      auth: { type: "none" },
    };

    useSettingsStore.setState((state) => ({
      ...state,
      installedPlugins: state.installedPlugins.map((plugin) =>
        plugin.id === JINA_READER_PLUGIN.id ? staleJinaPlugin : plugin,
      ),
      activePlugins: [JINA_READER_PLUGIN.id],
      pluginConfigs: {
        [JINA_READER_PLUGIN.id]: {
          disabledFunctions: [],
          auth: {
            type: "bearer",
            value: "",
            ...(localValueSecret ? { localValueSecret } : {}),
            addTo: "header",
          },
        },
      },
    }));

    useSettingsStore.getState().ensureBuiltInPlugins();

    const refreshedPlugin = useSettingsStore
      .getState()
      .installedPlugins.find((plugin) => plugin.id === JINA_READER_PLUGIN.id);
    const savedAuth =
      useSettingsStore.getState().pluginConfigs[JINA_READER_PLUGIN.id]?.auth;

    expect(refreshedPlugin?.title).toBe(JINA_READER_PLUGIN.title);
    expect(refreshedPlugin?.auth).toEqual({ type: "bearer", required: false });
    expect(useSettingsStore.getState().activePlugins).toContain(
      JINA_READER_PLUGIN.id,
    );
    expect(hasLocalSecret(savedAuth?.localValueSecret)).toBe(true);
  });

  it("adds every configured built-in plugin to installed plugins", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");
    const {
      BUILT_IN_PLUGINS,
      GEMINI_IMAGE_PLUGIN,
      OPENAI_IMAGE_PLUGIN,
      OPENAI_RESPONSES_IMAGE_PLUGIN,
    } = await import("../config/plugins");

    useSettingsStore.setState((state) => ({
      ...state,
      installedPlugins: state.installedPlugins.filter(
        (plugin) =>
          plugin.id !== GEMINI_IMAGE_PLUGIN.id &&
          plugin.id !== OPENAI_IMAGE_PLUGIN.id &&
          plugin.id !== OPENAI_RESPONSES_IMAGE_PLUGIN.id,
      ),
    }));

    useSettingsStore.getState().ensureBuiltInPlugins();

    const installedPluginIds = useSettingsStore
      .getState()
      .installedPlugins.map((plugin) => plugin.id);

    expect(installedPluginIds).toEqual(
      expect.arrayContaining(BUILT_IN_PLUGINS.map((plugin) => plugin.id)),
    );
    expect(installedPluginIds).toContain(GEMINI_IMAGE_PLUGIN.id);
    expect(installedPluginIds).toContain(OPENAI_IMAGE_PLUGIN.id);
    expect(installedPluginIds).toContain(OPENAI_RESPONSES_IMAGE_PLUGIN.id);
  });

  it("keeps plugin auth local secrets in persisted settings snapshots", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");
    const { AGNES_IMAGE_PLUGIN } = await import("../config/plugins");
    const { encryptLocalSecret, LOCAL_SECRET_CONTEXTS, hasLocalSecret } =
      await import("../lib/security/localSecrets");
    const { hasPluginAuthValue } =
      await import("../lib/security/localSecretResolvers");

    const localValueSecret = await encryptLocalSecret(
      "agnes-secret",
      LOCAL_SECRET_CONTEXTS.pluginAuth(AGNES_IMAGE_PLUGIN.id),
    );

    useSettingsStore.setState((state) => ({
      ...state,
      activePlugins: [AGNES_IMAGE_PLUGIN.id],
      pluginConfigs: {
        ...state.pluginConfigs,
        [AGNES_IMAGE_PLUGIN.id]: {
          disabledFunctions: [],
          auth: {
            type: "bearer",
            value: "",
            ...(localValueSecret ? { localValueSecret } : {}),
            addTo: "header",
          },
        },
      },
    }));

    const partialize = (useSettingsStore as any).persist.getOptions()
      .partialize;
    const persisted = partialize(useSettingsStore.getState());

    expect(
      hasLocalSecret(
        persisted.pluginConfigs[AGNES_IMAGE_PLUGIN.id]?.auth?.localValueSecret,
      ),
    ).toBe(true);
    expect(
      hasPluginAuthValue(persisted.pluginConfigs[AGNES_IMAGE_PLUGIN.id]?.auth),
    ).toBe(true);
  });

  it("sets active plugins from a normalized target list", async () => {
    const { useSettingsStore } = await import("../store/core/settingsStore");
    const { AGNES_IMAGE_PLUGIN, UNSPLASH_PLUGIN, WEATHER_PLUGIN } =
      await import("../config/plugins");

    useSettingsStore
      .getState()
      .setActivePlugins([
        WEATHER_PLUGIN.id,
        WEATHER_PLUGIN.id,
        AGNES_IMAGE_PLUGIN.id,
        "missing-plugin",
        UNSPLASH_PLUGIN.id,
      ]);

    expect(useSettingsStore.getState().activePlugins).toEqual([
      WEATHER_PLUGIN.id,
      UNSPLASH_PLUGIN.id,
    ]);
  });

  it("removes only the unmodified legacy Gemini provider during migration", async () => {
    const { useCoreSettingsStore } =
      await import("../store/core/coreSettingsStore");
    const migrate = (useCoreSettingsStore as any).persist.getOptions().migrate;

    const migrated = await migrate(
      {
        providers: [
          {
            id: "GEMINI",
            name: "Google Gemini",
            type: "Google",
            baseUrl: "https://generativelanguage.googleapis.com",
            apiKey: "",
            enabled: true,
            models: ["gemini-flash-latest"],
            modelsList: ["gemini-flash-latest"],
          },
          {
            id: "GEMINI_CUSTOM",
            name: "My Gemini",
            type: "Google",
            baseUrl: "https://generativelanguage.googleapis.com",
            apiKey: "user-key",
            enabled: true,
            models: ["gemini-flash-latest"],
            modelsList: ["gemini-flash-latest"],
          },
        ],
        defaultModels: {
          titleGeneration: "GEMINI:gemini-flash-latest",
          relatedQuestions: "GEMINI_CUSTOM:gemini-flash-latest",
          contextCompression: "",
          promptOptimization: "",
          ragQuery: "",
          memory: "",
        },
      },
      3,
    );

    expect(migrated.providers.map((provider: any) => provider.id)).toEqual([
      "GEMINI_CUSTOM",
    ]);
    expect(migrated.defaultModels).toMatchObject({
      titleGeneration: "",
      relatedQuestions: "GEMINI_CUSTOM:gemini-flash-latest",
      memory: "",
    });
  });
});
