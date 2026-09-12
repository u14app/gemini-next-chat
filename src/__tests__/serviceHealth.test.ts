import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("service health status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("publishes non-sensitive hosted health status", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ACCESS_PASSWORD", "access-secret");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "private-key-secret");
    vi.stubEnv("RATE_LIMIT_STORE", "upstash");
    vi.stubEnv("DOCUMENT_PARSE_JOB_STORE", "upstash");
    vi.stubEnv("PLUGIN_REGISTRY_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.internal");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret");
    vi.stubEnv("DEFAULT_PROVIDER_API_KEY", "provider-secret");
    vi.stubEnv("DEFAULT_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("DEFAULT_SEARCH_API_KEY", "search-secret");
    vi.stubEnv("DEFAULT_RAG_BASE_URL", "https://rag.internal");
    vi.stubEnv("DEFAULT_RAG_TOKEN", "rag-secret");
    vi.stubEnv("DEFAULT_DOCUMENT_PARSE_PROVIDER", "mineru");
    vi.stubEnv("DEFAULT_MINERU_API_TOKEN", "mineru-secret");
    vi.stubEnv("DEFAULT_LLAMA_PARSE_API_KEY", "llama-secret");
    vi.stubEnv("DEFAULT_VOICE_PROVIDER", "elevenlabs");
    vi.stubEnv("DEFAULT_ELEVENLABS_API_KEY", "voice-secret");
    vi.stubEnv("DEFAULT_ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });
    const serialized = JSON.stringify(health);

    expect(health.deploymentMode).toBe("hosted");
    expect(health.services.byok.status).toBe("available");
    expect(health.services.apiProof.status).toBe("available");
    expect(health.services.rateLimitStore.status).toBe("available");
    expect(health.services.pluginRegistry.status).toBe("available");
    expect(health.services.defaultModel.status).toBe("available");
    expect(health.services.search.status).toBe("available");
    expect(health.services.rag.status).toBe("available");
    expect(health.services.voice.status).toBe("available");
    for (const secret of [
      "access-secret",
      "private-key-secret",
      "redis-secret",
      "redis.internal",
      "provider-secret",
      "search-secret",
      "rag-secret",
      "mineru-secret",
      "llama-secret",
      "voice-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("does not mark voice configured when the default voice provider is unset", async () => {
    vi.stubEnv("DEFAULT_ELEVENLABS_API_KEY", "voice-secret");
    vi.stubEnv("DEFAULT_ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.voice).toMatchObject({
      status: "unconfigured",
      code: "VOICE_UNCONFIGURED",
    });
  });

  it("marks Mineru no-token document parsing as available by default", async () => {
    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.rag).toMatchObject({
      status: "available",
      code: "RAG_CONFIGURED",
    });
  });

  it("marks keyless Firecrawl search as available by default", async () => {
    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.search).toMatchObject({
      status: "available",
      code: "SEARCH_CONFIGURED",
    });
  });

  it("degrades only API rate limits when hosted shared stores are missing", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    vi.stubEnv("DOCUMENT_PARSE_JOB_STORE", "memory");
    vi.stubEnv("PLUGIN_REGISTRY_STORE", "memory");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.rateLimitStore).toMatchObject({
      status: "degraded",
      code: "MEMORY_STORE_FALLBACK",
    });
    expect(health.services.pluginRegistry).toMatchObject({
      status: "policy_blocked",
      code: "SHARED_STORE_REQUIRED",
    });
  });

  it("treats a separator-only access password list as unconfigured", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ACCESS_PASSWORD", " , , ");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.accessPassword).toMatchObject({
      status: "missing_key",
      code: "ACCESS_PASSWORD_RECOMMENDED",
    });
  });

  it("warns when hosted rate limits cannot identify clients by trusted proxy headers", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.proxyHeaders).toMatchObject({
      status: "degraded",
      code: "PROXY_HEADERS_UNTRUSTED",
    });
  });

  it("marks public deployments left in local mode as policy blocked", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://chat.example.com");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.hostedMode).toMatchObject({
      status: "policy_blocked",
      code: "PUBLIC_LOCAL_MODE",
    });
  });

  it("keeps localhost local mode marked as local only", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.hostedMode).toMatchObject({
      status: "local_only",
      code: "LOCAL_MODE",
    });
  });

  it("marks hosted BYOK and request proof as degraded when the stable key is missing", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "");

    const { getServiceHealthStatus } =
      await import("../lib/services/serviceHealth");
    const health = getServiceHealthStatus({ now: 1_700_000_000_000 });

    expect(health.services.apiProof).toMatchObject({
      status: "degraded",
      code: "API_PROOF_EPHEMERAL",
    });
    expect(health.services.byok).toMatchObject({
      status: "degraded",
      code: "EPHEMERAL_KEY_ALLOWED",
    });
  });
});
