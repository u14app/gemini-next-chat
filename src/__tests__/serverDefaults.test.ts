import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  safeFetchJson: vi.fn(),
  safeFetchText: vi.fn(),
  safeFetchArrayBuffer: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/config/limits", async () => vi.importActual("../config/limits"));
vi.mock("@/config/defaults", async () => vi.importActual("../config/defaults"));
vi.mock("@/lib/api/middleware", async () =>
  vi.importActual("../lib/api/middleware"),
);
vi.mock("@/lib/api/schemas", async () => vi.importActual("../lib/api/schemas"));
vi.mock("@/lib/api/uploads", async () => vi.importActual("../lib/api/uploads"));
vi.mock("@/lib/byok/shared", async () => vi.importActual("../lib/byok/shared"));
vi.mock("@/lib/byok/server", async () => vi.importActual("../lib/byok/server"));
vi.mock("@/lib/defaultConfig/server", async () =>
  vi.importActual("../lib/defaultConfig/server"),
);
vi.mock("@/lib/defaultConfig/shared", async () =>
  vi.importActual("../lib/defaultConfig/shared"),
);
vi.mock("@/lib/providers/models", async () =>
  vi.importActual("../lib/providers/models"),
);
vi.mock("@/lib/providers/providerTypes", async () =>
  vi.importActual("../lib/providers/providerTypes"),
);
vi.mock("@/lib/search/results", async () =>
  vi.importActual("../lib/search/results"),
);
vi.mock("@/lib/security/searchPolicy", async () =>
  vi.importActual("../lib/security/searchPolicy"),
);
vi.mock("@/lib/security/urlPolicy", async () =>
  vi.importActual("../lib/security/urlPolicy"),
);
vi.mock("@/lib/settings/appConfig", async () =>
  vi.importActual("../lib/settings/appConfig"),
);

vi.mock("@/lib/security/safeFetch", async () => {
  const actual = await vi.importActual<any>("../lib/security/safeFetch");
  return {
    ...actual,
    safeFetchJson: mocks.safeFetchJson,
    safeFetchText: mocks.safeFetchText,
    safeFetchArrayBuffer: mocks.safeFetchArrayBuffer,
  };
});

vi.mock("@/lib/utils/safeServerLog", () => ({
  safeServerLogError: vi.fn(),
  safeServerLogWarn: vi.fn(),
}));

vi.mock("@/lib/providers/base", () => ({
  ProviderFactory: {
    createGeminiClient: vi.fn(),
    createOpenAIClient: vi.fn(),
  },
}));

const ENV_KEYS = [
  "ACCESS_PASSWORD",
  "BYOK_PRIVATE_KEY_PEM",
  "BYOK_ALLOW_EPHEMERAL_KEY",
  "DEPLOYMENT_MODE",
  "TRUST_PROXY_HEADERS",
  "RATE_LIMIT_STORE",
  "DOCUMENT_PARSE_JOB_STORE",
  "PLUGIN_REGISTRY_STORE",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SHARING_ENABLED",
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
  "DEFAULT_SEARCH_PROVIDER",
  "DEFAULT_SEARCH_API_KEY",
  "DEFAULT_SEARCH_BASE_URL",
  "DEFAULT_RAG_BASE_URL",
  "DEFAULT_RAG_TOKEN",
  "DEFAULT_RAG_TOP_K",
  "DEFAULT_RAG_CHUNK_SIZE",
  "DEFAULT_RAG_NAMESPACE",
  "DEFAULT_DOCUMENT_PARSE_PROVIDER",
  "DEFAULT_MINERU_API_TOKEN",
  "DEFAULT_LLAMA_PARSE_API_KEY",
  "DEFAULT_ELEVENLABS_API_KEY",
  "DEFAULT_ELEVENLABS_STT_MODEL",
  "DEFAULT_ELEVENLABS_TTS_MODEL",
  "DEFAULT_ELEVENLABS_TTS_VOICE_ID",
  "DEFAULT_VOICE_PROVIDER",
  "DEFAULT_MIMO_API_KEY",
  "DEFAULT_MIMO_STT_MODEL",
  "DEFAULT_MIMO_TTS_MODEL",
  "DEFAULT_MIMO_TTS_VOICE_ID",
  "DEFAULT_SYSTEM_PROMPT",
  "DEFAULT_ENABLE_AUTO_TITLE",
  "DEFAULT_ENABLE_RELATED_QUESTIONS",
  "DEFAULT_ENABLE_AUTO_COMPRESSION",
  "DEFAULT_COMPRESSION_THRESHOLD",
  "DEFAULT_HISTORY_KEEP_COUNT",
  "DEFAULT_ENABLE_CODE_COLLAPSE",
  "DEFAULT_ENABLE_HTML_VISUAL_PROMPT",
  "MAX_ATTACHMENT_FILE_BYTES",
] as const;

const LEGACY_PROVIDER_ENV_KEYS = [
  "GEMINI_API_KEY",
  "API_KEY",
  "OPENAI_API_KEY",
] as const;

const originalEnv = new Map<string, string | undefined>();

function clearDefaultEnv() {
  for (const key of [...ENV_KEYS, ...LEGACY_PROVIDER_ENV_KEYS]) {
    delete process.env[key];
  }
}

function setEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

describe("server default configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.safeFetchJson.mockReset();
    mocks.safeFetchText.mockReset();
    mocks.safeFetchArrayBuffer.mockReset();

    originalEnv.clear();
    for (const key of [...ENV_KEYS, ...LEGACY_PROVIDER_ENV_KEYS]) {
      originalEnv.set(key, process.env[key]);
    }
    clearDefaultEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearDefaultEnv();
    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns public defaults without API keys, tokens, or server base URLs", async () => {
    setEnv({
      DEFAULT_PROVIDER_TYPE: "OpenAI",
      DEFAULT_PROVIDER_NAME: "Hosted Default",
      DEFAULT_PROVIDER_BASE_URL: "https://llm.internal/v1",
      DEFAULT_PROVIDER_API_KEY: "provider-secret",
      DEFAULT_PROVIDER_MODELS: "gpt-4o, gpt-4o-mini, gpt-4o",
      DEFAULT_MODEL_TITLE_GENERATION: "gpt-4o-mini",
      DEFAULT_SEARCH_PROVIDER: "tavily",
      DEFAULT_SEARCH_API_KEY: "search-secret",
      DEFAULT_SEARCH_BASE_URL: "https://search.internal",
      DEFAULT_RAG_BASE_URL: "https://rag.internal",
      DEFAULT_RAG_TOKEN: "rag-secret",
      DEFAULT_RAG_TOP_K: "7",
      DEFAULT_RAG_CHUNK_SIZE: "768",
      DEFAULT_RAG_NAMESPACE: "tenant-a",
      DEFAULT_DOCUMENT_PARSE_PROVIDER: "mineru",
      DEFAULT_MINERU_API_TOKEN: "mineru-secret",
      DEFAULT_LLAMA_PARSE_API_KEY: "llama-secret",
      DEFAULT_ELEVENLABS_API_KEY: "eleven-secret",
      DEFAULT_ELEVENLABS_STT_MODEL: "scribe_v1",
      DEFAULT_ELEVENLABS_TTS_VOICE_ID: "SAz9YHcvj6GT2YYXdXww",
      DEFAULT_SYSTEM_PROMPT: "Use the hosted defaults.",
      DEFAULT_ENABLE_AUTO_TITLE: "false",
      DEFAULT_ENABLE_HTML_VISUAL_PROMPT: "true",
      DEFAULT_COMPRESSION_THRESHOLD: "12",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();
    const serialized = JSON.stringify(config);

    expect(config.modelProvider).toMatchObject({
      available: true,
      id: "SERVER_DEFAULT",
      name: "Hosted Default",
      type: "OpenAI",
      models: ["gpt-4o", "gpt-4o-mini"],
      defaultModels: { titleGeneration: "gpt-4o-mini" },
    });
    expect(config.search.available).toBe(true);
    expect(config.rag).toMatchObject({
      vectorStoreAvailable: true,
      documentProcessingAvailable: true,
      documentProcessingProvider: "mineru",
      topK: 7,
      chunkSize: 768,
      namespace: "tenant-a",
    });
    expect(config.voice).toMatchObject({
      elevenLabsAvailable: true,
      mimoAvailable: false,
      defaultSttAvailable: false,
      defaultTtsAvailable: false,
    });
    expect(config.voice.defaultProvider).toBeUndefined();
    expect(config.voice.sttModel).toBeUndefined();
    expect(config.voice.ttsModel).toBeUndefined();
    expect(config.voice.ttsVoiceId).toBeUndefined();
    expect(config.system).toMatchObject({
      systemPrompt: "Use the hosted defaults.",
      enableAutoTitle: false,
      enableHtmlVisualPrompt: true,
      compressionThreshold: 12,
    });
    expect(config.limits.attachments.maxFileBytes).toBe(10 * 1024 * 1024);

    for (const secret of [
      "provider-secret",
      "search-secret",
      "rag-secret",
      "mineru-secret",
      "llama-secret",
      "eleven-secret",
      "llm.internal",
      "search.internal",
      "rag.internal",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("exposes clamped runtime attachment upload limits", async () => {
    setEnv({
      MAX_ATTACHMENT_FILE_BYTES: String(1024 * 1024),
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getPublicServerConfig().limits.attachments.maxFileBytes).toBe(
      1024 * 1024,
    );

    setEnv({
      MAX_ATTACHMENT_FILE_BYTES: String(100 * 1024 * 1024),
    });

    expect(
      getPublicServerConfig().limits.attachments.maxFileBytes,
    ).toBeLessThan(100 * 1024 * 1024);

    setEnv({
      MAX_ATTACHMENT_FILE_BYTES: "not-a-number",
    });

    expect(getPublicServerConfig().limits.attachments.maxFileBytes).toBe(
      10 * 1024 * 1024,
    );
  });

  it("allows self-hosted defaults to disable HTML visual prompting", async () => {
    setEnv({
      DEFAULT_ENABLE_HTML_VISUAL_PROMPT: "false",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();

    expect(config.system?.enableHtmlVisualPrompt).toBe(false);
  });

  it("keeps explicitly configured keyless Firecrawl available as a default search provider", async () => {
    setEnv({
      DEFAULT_SEARCH_PROVIDER: "firecrawl",
    });

    const { getDefaultSearchRuntimeConfig, getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getDefaultSearchRuntimeConfig()).toEqual({
      provider: "firecrawl",
    });
    expect(getPublicServerConfig().search.available).toBe(true);
  });

  it("does not enable a server search provider when none is configured", async () => {
    const { getDefaultSearchRuntimeConfig, getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getDefaultSearchRuntimeConfig()).toBeNull();
    expect(getPublicServerConfig().search.available).toBe(false);
  });

  it("does not publish a default voice provider unless it is explicitly configured", async () => {
    setEnv({
      DEFAULT_ELEVENLABS_API_KEY: "eleven-secret",
      DEFAULT_ELEVENLABS_STT_MODEL: "scribe_v2",
      DEFAULT_ELEVENLABS_TTS_MODEL: "eleven_flash_v2_5",
      DEFAULT_ELEVENLABS_TTS_VOICE_ID: "SAz9YHcvj6GT2YYXdXww",
      DEFAULT_MIMO_API_KEY: "mimo-secret",
      DEFAULT_MIMO_STT_MODEL: "mimo-v2.5-asr",
      DEFAULT_MIMO_TTS_MODEL: "mimo-v2.5-tts",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();

    expect(config.voice).toMatchObject({
      elevenLabsAvailable: true,
      mimoAvailable: true,
      defaultSttAvailable: false,
      defaultTtsAvailable: false,
    });
    expect(config.voice.defaultProvider).toBeUndefined();
    expect(config.voice.sttModel).toBeUndefined();
    expect(config.voice.ttsModel).toBeUndefined();
  });

  it("publishes deployment health without exposing deployment secrets", async () => {
    setEnv({
      ACCESS_PASSWORD: "first-secret-password, second-secret-password",
      BYOK_PRIVATE_KEY_PEM: "private-key-secret",
      BYOK_ALLOW_EPHEMERAL_KEY: "false",
      DEPLOYMENT_MODE: "hosted",
      TRUST_PROXY_HEADERS: "true",
      RATE_LIMIT_STORE: "upstash",
      DOCUMENT_PARSE_JOB_STORE: "upstash",
      PLUGIN_REGISTRY_STORE: "upstash",
      UPSTASH_REDIS_REST_URL: "https://redis.internal",
      UPSTASH_REDIS_REST_TOKEN: "redis-secret",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();
    const serialized = JSON.stringify(config);

    expect(config.deployment).toEqual({
      mode: "hosted",
      accessPasswordEnabled: true,
      trustedProxyHeaders: true,
      byokStableKeyConfigured: true,
      byokEphemeralAllowed: true,
      apiProof: {
        required: true,
        enabled: true,
        configured: true,
        ephemeral: false,
        protectedHighCostApis: true,
        windowSeconds: 60,
        sessionTtlSeconds: 600,
      },
      rateLimitStore: "shared",
      documentParseJobStore: "shared",
      pluginRegistryStore: "shared",
    });
    for (const secret of [
      "first-secret-password",
      "second-secret-password",
      "private-key-secret",
      "redis-secret",
      "redis.internal",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("publishes single-instance hosted fallbacks without relaxing durable stores", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({
      BYOK_ALLOW_EPHEMERAL_KEY: "false",
      DEPLOYMENT_MODE: "hosted",
      RATE_LIMIT_STORE: "memory",
      DOCUMENT_PARSE_JOB_STORE: "memory",
      PLUGIN_REGISTRY_STORE: "memory",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getPublicServerConfig().deployment).toMatchObject({
      mode: "hosted",
      byokStableKeyConfigured: false,
      byokEphemeralAllowed: true,
      apiProof: {
        required: true,
        enabled: true,
        configured: true,
        ephemeral: true,
      },
      rateLimitStore: "memory",
      documentParseJobStore: "missing",
      pluginRegistryStore: "missing",
    });
  });

  it("accepts JSON provider model arrays and publishes sanitized model metadata", async () => {
    setEnv({
      DEFAULT_PROVIDER_TYPE: "OpenAI",
      DEFAULT_PROVIDER_NAME: "Hosted Default",
      DEFAULT_PROVIDER_API_KEY: "provider-secret",
      DEFAULT_PROVIDER_MODELS: JSON.stringify([
        "gpt-4o-mini",
        {
          id: "gpt-4o",
          name: "GPT-4o Hosted",
          capabilities: {
            attachment: true,
            vision: true,
            audio: true,
            image_generation: true,
            reasoning: false,
            tool_call: true,
          },
          reasoning_options: [
            {
              type: "effort",
              values: ["low", "high", "xhigh", "minimal"],
            },
          ],
        },
        { id: "gpt-4o", name: "Duplicate" },
      ]),
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();
    const serialized = JSON.stringify(config);

    expect(config.modelProvider.models).toEqual(["gpt-4o-mini", "gpt-4o"]);
    expect(config.modelProvider.modelMetadata).toEqual({
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o Hosted",
        attachment: true,
        reasoning: false,
        reasoning_options: [{ type: "effort", values: ["low", "high"] }],
        tool_call: true,
        modalities: { input: ["image", "audio", "text"], output: ["image"] },
      },
    });
    expect(serialized).not.toContain("provider-secret");
  });

  it("accepts compact provider model capability arrays and falls back to id names", async () => {
    setEnv({
      DEFAULT_PROVIDER_TYPE: "OpenAI Compatible",
      DEFAULT_PROVIDER_NAME: "Hosted Default",
      DEFAULT_PROVIDER_API_KEY: "provider-secret",
      DEFAULT_PROVIDER_MODELS: JSON.stringify([
        {
          id: "gpt-5.5",
          capabilities: [
            "vision",
            "attachment",
            "reasoning",
            "tool_call",
            "image_editing",
          ],
        },
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          modalities: {
            input: ["text"],
            output: ["image"],
          },
          capabilities: {
            vision: true,
            audio: false,
            attachment: true,
            reasoning: false,
            tool_call: true,
          },
        },
        "gpt-5.4-mini",
      ]),
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();

    expect(config.modelProvider.models).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
    expect(config.modelProvider.modelMetadata).toEqual({
      "gpt-5.5": {
        id: "gpt-5.5",
        name: "gpt-5.5",
        attachment: true,
        reasoning: true,
        tool_call: true,
        modalities: { input: ["image", "text"], output: ["image"] },
      },
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        attachment: true,
        reasoning: false,
        tool_call: true,
        modalities: { input: ["text"], output: ["image"] },
      },
    });
  });

  it("falls back to comma-separated models when provider model JSON is invalid", async () => {
    setEnv({
      DEFAULT_PROVIDER_TYPE: "OpenAI",
      DEFAULT_PROVIDER_API_KEY: "provider-secret",
      DEFAULT_PROVIDER_MODELS: 'model-a, {"id": "not-json"',
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getPublicServerConfig().modelProvider.models).toEqual([
      "model-a",
      '{"id": "not-json"',
    ]);
  });

  it("ignores legacy provider key fallbacks for server defaults", async () => {
    setEnv({
      DEFAULT_PROVIDER_TYPE: "Gemini",
      GEMINI_API_KEY: "gemini-fallback-secret",
      API_KEY: "api-fallback-secret",
      OPENAI_API_KEY: "openai-fallback-secret",
    });

    const { getDefaultProviderRuntimeConfig, getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const runtimeConfig = getDefaultProviderRuntimeConfig();

    expect(runtimeConfig).toMatchObject({
      type: "Google",
    });
    expect(runtimeConfig).not.toHaveProperty("apiKey");

    const { GET } = await import("../app/api/config/route");
    const response = await GET();
    const publicConfig = getPublicServerConfig();
    const body = await response.json();
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(publicConfig.modelProvider.available).toBe(true);
    expect(body.modelProvider.available).toBe(true);
    expect(text).not.toContain("gemini-fallback-secret");
    expect(text).not.toContain("api-fallback-secret");
    expect(text).not.toContain("openai-fallback-secret");
  });

  it("keeps the default provider hidden when it has no configuration", async () => {
    const { getDefaultProviderRuntimeConfig, getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getDefaultProviderRuntimeConfig()).toBeNull();
    expect(getPublicServerConfig().modelProvider.available).toBe(false);
  });

  it("uses server default provider credentials when fetching model lists", async () => {
    setEnv({
      DEFAULT_PROVIDER_TYPE: "OpenAI",
      DEFAULT_PROVIDER_API_KEY: "provider-secret",
      DEFAULT_PROVIDER_BASE_URL: "https://llm.internal/custom",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
      },
    });

    const { POST } = await import("../app/api/providers/models/route");
    const response = await POST(
      new Request("https://neo.test/api/providers/models", {
        method: "POST",
        body: JSON.stringify({
          provider: { type: "OpenAI", source: "server-default" },
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://llm.internal/custom/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer provider-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "provider-secret",
    );
  });

  it("uses server default search credentials for provider default requests", async () => {
    setEnv({
      DEFAULT_SEARCH_PROVIDER: "tavily",
      DEFAULT_SEARCH_API_KEY: "search-secret",
      DEFAULT_SEARCH_BASE_URL: "https://search.internal",
    });
    mocks.safeFetchText.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        results: [
          {
            title: "Result",
            url: "https://example.com/result",
            content: "Body",
          },
        ],
        images: [],
      }),
    });

    const { POST } = await import("../app/api/search/route");
    const response = await POST(
      new Request("https://neo.test/api/search", {
        method: "POST",
        body: JSON.stringify({
          provider: "default",
          query: "neo",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchText).toHaveBeenCalledWith(
      "https://search.internal/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer search-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "search-secret",
    );
  });

  it("routes an explicitly configured keyless default Firecrawl search through the server", async () => {
    setEnv({
      DEFAULT_SEARCH_PROVIDER: "firecrawl",
    });
    mocks.safeFetchText.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        data: {
          web: [
            {
              title: "Firecrawl result",
              url: "https://example.com/result",
              markdown: "Result content",
            },
          ],
          images: [],
        },
      }),
      url: "https://api.firecrawl.dev/v2/search",
    });

    const { POST } = await import("../app/api/search/route");
    const response = await POST(
      new Request("https://neo.test/api/search", {
        method: "POST",
        body: JSON.stringify({
          provider: "default",
          query: "neo",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchText).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
      }),
      expect.any(Object),
    );
  });

  it("uses server default RAG credentials and namespace for default queries", async () => {
    setEnv({
      DEFAULT_RAG_BASE_URL: "https://rag.internal/api",
      DEFAULT_RAG_TOKEN: "rag-secret",
      DEFAULT_RAG_TOP_K: "3",
      DEFAULT_RAG_NAMESPACE: "hosted",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        result: [
          {
            score: 0.9,
            data: "Knowledge",
            metadata: { fileName: "doc.md" },
          },
        ],
      },
    });

    const { POST } = await import("../app/api/rag/query/route");
    const response = await POST(
      new Request("https://neo.test/api/rag/query", {
        method: "POST",
        body: JSON.stringify({
          text: "What is Neo?",
          useDefault: true,
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://rag.internal/api/query-data/hosted",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer rag-secret",
        }),
        body: expect.stringContaining('"topK":3'),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain("rag-secret");
  });

  it("rejects custom namespaces when query requests use the server default RAG token", async () => {
    setEnv({
      DEFAULT_RAG_BASE_URL: "https://rag.internal/api",
      DEFAULT_RAG_TOKEN: "rag-secret",
      DEFAULT_RAG_NAMESPACE: "hosted",
    });

    const { POST } = await import("../app/api/rag/query/route");
    const response = await POST(
      new Request("https://neo.test/api/rag/query", {
        method: "POST",
        body: JSON.stringify({
          text: "What is Neo?",
          namespace: "other-tenant",
          useDefault: true,
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Custom RAG namespace requires user-provided credentials",
    });
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
  });

  it("rejects custom namespaces when upsert requests use the server default RAG token", async () => {
    setEnv({
      DEFAULT_RAG_BASE_URL: "https://rag.internal/api",
      DEFAULT_RAG_TOKEN: "rag-secret",
      DEFAULT_RAG_NAMESPACE: "hosted",
    });

    const { POST } = await import("../app/api/rag/upsert/route");
    const response = await POST(
      new Request("https://neo.test/api/rag/upsert", {
        method: "POST",
        body: JSON.stringify({
          items: [{ id: "id-1", data: "Knowledge" }],
          namespace: "other-tenant",
          useDefault: true,
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Custom RAG namespace requires user-provided credentials",
    });
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
  });

  it("rejects custom namespaces when delete requests use the server default RAG token", async () => {
    setEnv({
      DEFAULT_RAG_BASE_URL: "https://rag.internal/api",
      DEFAULT_RAG_TOKEN: "rag-secret",
      DEFAULT_RAG_NAMESPACE: "hosted",
    });

    const { POST } = await import("../app/api/rag/delete/route");
    const response = await POST(
      new Request("https://neo.test/api/rag/delete", {
        method: "POST",
        body: JSON.stringify({
          ids: ["id-1"],
          namespace: "other-tenant",
          useDefault: true,
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Custom RAG namespace requires user-provided credentials",
    });
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
  });

  it("uses the server LlamaParse key when document parsing requests opt into defaults", async () => {
    setEnv({
      DEFAULT_DOCUMENT_PARSE_PROVIDER: "llamaParse",
      DEFAULT_LLAMA_PARSE_API_KEY: "llama-secret",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 418 }),
      data: {},
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "doc.txt", { type: "text/plain" }),
    );
    formData.set("useDefault", "true");
    formData.set("provider", "llamaParse");

    const { POST } = await import("../app/api/doc-parse/route");
    const response = await POST(
      new Request("https://neo.test/api/doc-parse", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(418);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.cloud.llamaindex.ai/api/v2/parse/upload",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer llama-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain("llama-secret");
  });

  it("publishes Mineru as the default parser without requiring a token", async () => {
    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");

    expect(getPublicServerConfig().rag).toMatchObject({
      documentProcessingAvailable: true,
      documentProcessingProvider: "mineru",
    });
  });

  it("uses the server ElevenLabs key for default speech transcription", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "elevenlabs",
      DEFAULT_ELEVENLABS_API_KEY: "eleven-secret",
      DEFAULT_ELEVENLABS_STT_MODEL: "scribe_v2",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: { text: "hello" },
    });

    const formData = new FormData();
    formData.set(
      "audio",
      new File(["audio"], "speech.webm", { type: "audio/webm" }),
    );
    formData.set("provider", "default");

    const { POST } = await import("../app/api/voice/transcribe/route");
    const response = await POST(
      new Request("https://neo.test/api/voice/transcribe", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/speech-to-text",
      expect.objectContaining({
        headers: expect.objectContaining({
          "xi-api-key": "eleven-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "eleven-secret",
    );
  });

  it("uses the server ElevenLabs key and default voice for speech synthesis", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "elevenlabs",
      DEFAULT_ELEVENLABS_API_KEY: "eleven-secret",
      DEFAULT_ELEVENLABS_TTS_VOICE_ID: "SAz9YHcvj6GT2YYXdXww",
    });
    mocks.safeFetchArrayBuffer.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      arrayBuffer: new Uint8Array([1, 2, 3]),
    });

    const { POST } = await import("../app/api/voice/synthesize/route");
    const response = await POST(
      new Request("https://neo.test/api/voice/synthesize", {
        method: "POST",
        body: JSON.stringify({
          provider: "default",
          text: "hello",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchArrayBuffer).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/SAz9YHcvj6GT2YYXdXww?output_format=mp3_44100_128",
      expect.objectContaining({
        headers: expect.objectContaining({
          "xi-api-key": "eleven-secret",
        }),
      }),
      expect.any(Object),
    );
    const requestInit = mocks.safeFetchArrayBuffer.mock.calls[0][1];
    expect(JSON.parse(requestInit.body)).toMatchObject({
      model_id: "eleven_flash_v2_5",
    });
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
  });

  it("disables default ElevenLabs TTS when its default model is empty", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "elevenlabs",
      DEFAULT_ELEVENLABS_API_KEY: "eleven-secret",
      DEFAULT_ELEVENLABS_STT_MODEL: "scribe_v2",
      DEFAULT_ELEVENLABS_TTS_MODEL: "",
      DEFAULT_ELEVENLABS_TTS_VOICE_ID: "SAz9YHcvj6GT2YYXdXww",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();

    expect(config.voice).toMatchObject({
      defaultProvider: "elevenlabs",
      elevenLabsAvailable: true,
      defaultSttAvailable: true,
      defaultTtsAvailable: false,
      sttModel: "scribe_v2",
    });
    expect(config.voice.ttsModel).toBeUndefined();
    expect(config.voice.ttsVoiceId).toBeUndefined();
  });

  it("rejects default ElevenLabs synthesis when its default model is empty", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "elevenlabs",
      DEFAULT_ELEVENLABS_API_KEY: "eleven-secret",
      DEFAULT_ELEVENLABS_TTS_MODEL: "",
      DEFAULT_ELEVENLABS_TTS_VOICE_ID: "SAz9YHcvj6GT2YYXdXww",
    });
    mocks.safeFetchArrayBuffer.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      arrayBuffer: new Uint8Array([1, 2, 3]),
    });

    const { POST } = await import("../app/api/voice/synthesize/route");
    const response = await POST(
      new Request("https://neo.test/api/voice/synthesize", {
        method: "POST",
        body: JSON.stringify({
          provider: "default",
          text: "hello",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Default speech synthesis is not configured",
    });
    expect(mocks.safeFetchArrayBuffer).not.toHaveBeenCalled();
  });

  it("publishes Mimo as the server default voice provider", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "mimo",
      DEFAULT_MIMO_API_KEY: "mimo-secret",
      DEFAULT_MIMO_STT_MODEL: "mimo-v2.5-asr",
      DEFAULT_MIMO_TTS_MODEL: "mimo-v2.5-tts",
      DEFAULT_MIMO_TTS_VOICE_ID: "Chloe",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();
    const serialized = JSON.stringify(config);

    expect(config.voice).toMatchObject({
      defaultProvider: "mimo",
      mimoAvailable: true,
      defaultSttAvailable: true,
      defaultTtsAvailable: true,
      mimoSttModel: "mimo-v2.5-asr",
      mimoTtsModel: "mimo-v2.5-tts",
      mimoTtsVoiceId: "Chloe",
    });
    expect(serialized).not.toContain("mimo-secret");
  });

  it("publishes Mimo default TTS without STT when the Mimo STT model is empty", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "mimo",
      DEFAULT_MIMO_API_KEY: "mimo-secret",
      DEFAULT_MIMO_STT_MODEL: "",
      DEFAULT_MIMO_TTS_MODEL: "mimo-v2.5-tts",
      DEFAULT_MIMO_TTS_VOICE_ID: "Chloe",
    });

    const { getPublicServerConfig } =
      await import("../lib/defaultConfig/server");
    const config = getPublicServerConfig();

    expect(config.voice).toMatchObject({
      defaultProvider: "mimo",
      mimoAvailable: true,
      defaultSttAvailable: false,
      defaultTtsAvailable: true,
      mimoTtsModel: "mimo-v2.5-tts",
      mimoTtsVoiceId: "Chloe",
    });
    expect(config.voice.sttModel).toBeUndefined();
    expect(config.voice.mimoSttModel).toBeUndefined();
  });

  it("uses the server Mimo key for default speech transcription", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "mimo",
      DEFAULT_MIMO_API_KEY: "mimo-secret",
      DEFAULT_MIMO_STT_MODEL: "mimo-v2.5-asr",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        choices: [{ message: { content: "hello from mimo" } }],
      },
    });

    const formData = new FormData();
    formData.set(
      "audio",
      new File(["audio"], "speech.wav", { type: "audio/wav" }),
    );
    formData.set("provider", "default");
    formData.set("language", "en");

    const { POST } = await import("../app/api/voice/transcribe/route");
    const response = await POST(
      new Request("https://neo.test/api/voice/transcribe", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.xiaomimimo.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          "api-key": "mimo-secret",
        }),
      }),
      expect.any(Object),
    );

    const requestInit = mocks.safeFetchJson.mock.calls[0][1];
    const payload = JSON.parse(requestInit.body);
    expect(payload).toMatchObject({
      model: "mimo-v2.5-asr",
      asr_options: { language: "en" },
    });
    expect(payload.messages[0].content[0].input_audio.data).toContain(
      "data:audio/wav;base64,",
    );
    expect(await response.json()).toEqual({ text: "hello from mimo" });
  });

  it("uses the server Mimo key and default voice for speech synthesis", async () => {
    setEnv({
      DEFAULT_VOICE_PROVIDER: "mimo",
      DEFAULT_MIMO_API_KEY: "mimo-secret",
      DEFAULT_MIMO_TTS_MODEL: "mimo-v2.5-tts",
      DEFAULT_MIMO_TTS_VOICE_ID: "Chloe",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        choices: [{ message: { audio: { data: "AQID" } } }],
      },
    });

    const { POST } = await import("../app/api/voice/synthesize/route");
    const response = await POST(
      new Request("https://neo.test/api/voice/synthesize", {
        method: "POST",
        body: JSON.stringify({
          provider: "default",
          text: "hello",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.xiaomimimo.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          "api-key": "mimo-secret",
        }),
      }),
      expect.any(Object),
    );

    const requestInit = mocks.safeFetchJson.mock.calls[0][1];
    const payload = JSON.parse(requestInit.body);
    expect(payload).toMatchObject({
      model: "mimo-v2.5-tts",
      audio: { format: "wav", voice: "Chloe" },
    });
    expect(payload.messages).toContainEqual({
      role: "assistant",
      content: "hello",
    });
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
  });
});
