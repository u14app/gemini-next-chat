import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProviderApiKey,
  getProviderChatUrl,
  getProviderGoogleSdkOptions,
  getProviderModelsUrl,
  getSafeUrlPolicy,
  isPrivateIpAddress,
  normalizeProviderBaseUrl,
  validateOutboundUrl,
} from "../lib/security/urlPolicy";

vi.mock("server-only", () => ({}));

describe("url policy and provider runtime helpers", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("normalizes OpenAI-compatible base URLs without duplicating /v1", () => {
    expect(normalizeProviderBaseUrl("https://api.example.com", "OpenAI")).toBe(
      "https://api.example.com/v1",
    );
    expect(
      normalizeProviderBaseUrl("https://api.example.com/v1/", "OpenAI"),
    ).toBe("https://api.example.com/v1");
    expect(
      normalizeProviderBaseUrl("https://api.example.com/v2", "OpenAI"),
    ).toBe("https://api.example.com/v2");
  });

  it("normalizes OpenAI Compatible base URLs like OpenAI", () => {
    expect(
      normalizeProviderBaseUrl(
        "https://compat.example.com",
        "OpenAI Compatible",
      ),
    ).toBe("https://compat.example.com/v1");
  });

  it("normalizes Anthropic base URLs to the Messages and Models API roots", () => {
    expect(
      normalizeProviderBaseUrl("https://api.anthropic.com", "Anthropic"),
    ).toBe("https://api.anthropic.com/v1");
    expect(getProviderChatUrl("https://api.anthropic.com", "Anthropic")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(getProviderModelsUrl("https://api.anthropic.com", "Anthropic")).toBe(
      "https://api.anthropic.com/v1/models",
    );
    expect(
      normalizeProviderBaseUrl(
        "https://gateway.example.com/anthropic/v1",
        "Anthropic",
      ),
    ).toBe("https://gateway.example.com/anthropic/v1");
  });

  it("normalizes OrcaRouter base URLs like an OpenAI-compatible gateway", () => {
    expect(
      normalizeProviderBaseUrl("https://api.orcarouter.ai", "OrcaRouter"),
    ).toBe("https://api.orcarouter.ai/v1");
    expect(getProviderChatUrl("https://api.orcarouter.ai", "OrcaRouter")).toBe(
      "https://api.orcarouter.ai/v1/chat/completions",
    );
    expect(
      getProviderModelsUrl("https://api.orcarouter.ai", "OrcaRouter"),
    ).toBe("https://api.orcarouter.ai/v1/models");
    expect(
      normalizeProviderBaseUrl("https://api.orcarouter.ai/v1", "OrcaRouter"),
    ).toBe("https://api.orcarouter.ai/v1");
  });

  it("splits Google SDK base URL from API version and allows version override", () => {
    expect(
      normalizeProviderBaseUrl(
        "https://generativelanguage.googleapis.com",
        "Google",
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(
      getProviderModelsUrl(
        "https://generativelanguage.googleapis.com",
        "Google",
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(
      getProviderGoogleSdkOptions(
        "https://generativelanguage.googleapis.com/v1",
      ),
    ).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiVersion: "v1",
    });
  });

  it("does not use legacy provider environment variables as API key fallbacks", () => {
    process.env.GEMINI_API_KEY = "gemini-env-secret";
    process.env.API_KEY = "api-env-secret";
    process.env.OPENAI_API_KEY = "openai-env-secret";

    expect(getProviderApiKey({ type: "Google" })).toBe("");
    expect(getProviderApiKey({ type: "Anthropic" })).toBe("");
    expect(getProviderApiKey({ type: "OpenAI" })).toBe("");
    expect(getProviderApiKey({ type: "OpenAI Compatible" })).toBe("");
  });

  it("allows user-configured HTTP private targets in local and hosted modes", () => {
    for (const mode of ["local", "hosted"]) {
      process.env.DEPLOYMENT_MODE = mode;
      delete process.env.ALLOW_LOCAL_NETWORK_PROXY;

      for (const context of [
        "provider",
        "search",
        "rag",
        "pluginManifest",
        "plugin",
        "mcp",
      ] as const) {
        expect(
          validateOutboundUrl(
            "http://127.0.0.1:8080/endpoint",
            getSafeUrlPolicy(context),
          ).hostname,
          `${mode}:${context}`,
        ).toBe("127.0.0.1");
      }
    }
  });

  it("allows HTTP MCP servers on private networks in hosted mode", () => {
    process.env.DEPLOYMENT_MODE = "hosted";
    delete process.env.ALLOW_LOCAL_NETWORK_PROXY;

    expect(
      validateOutboundUrl("http://192.168.1.10/mcp", getSafeUrlPolicy("mcp"))
        .hostname,
    ).toBe("192.168.1.10");
  });

  it("allows configured voice provider hosts only", () => {
    expect(
      validateOutboundUrl(
        "https://api.elevenlabs.io/v1/text-to-speech/voice-id",
        getSafeUrlPolicy("voice"),
      ).hostname,
    ).toBe("api.elevenlabs.io");
    expect(
      validateOutboundUrl(
        "https://api.xiaomimimo.com/v1/chat/completions",
        getSafeUrlPolicy("voice"),
      ).hostname,
    ).toBe("api.xiaomimimo.com");
    expect(() =>
      validateOutboundUrl(
        "https://example.com/v1/chat/completions",
        getSafeUrlPolicy("voice"),
      ),
    ).toThrow(/not trusted for voice/i);
  });

  it("keeps fixed service contexts HTTPS-only", () => {
    for (const [context, url] of [
      ["docs", "http://api.cloud.llamaindex.ai/parse"],
      ["voice", "http://api.elevenlabs.io/v1/voices"],
      ["agent", "http://registry.npmmirror.com/agents.json"],
      ["metadata", "http://basellm.github.io/models.json"],
      ["sharedStore", "http://127.0.0.1:8787/pipeline"],
    ] as const) {
      expect(
        () => validateOutboundUrl(url, getSafeUrlPolicy(context)),
        context,
      ).toThrow(/Protocol/i);
    }
  });

  it("allows explicitly self-hosted provider URLs", () => {
    const result = validateOutboundUrl(
      "http://localhost:11434/v1",
      getSafeUrlPolicy("provider"),
    );
    expect(result.hostname).toBe("localhost");
  });

  it("keeps image proxy targets HTTPS-only while allowing private addresses", () => {
    process.env.DEPLOYMENT_MODE = "hosted";
    delete process.env.ALLOW_LOCAL_NETWORK_PROXY;

    expect(
      validateOutboundUrl(
        "https://127.0.0.1/image.png",
        getSafeUrlPolicy("image"),
      ).hostname,
    ).toBe("127.0.0.1");

    expect(() =>
      validateOutboundUrl(
        "http://127.0.0.1/image.png",
        getSafeUrlPolicy("image"),
      ),
    ).toThrow(/Protocol/i);

    process.env.ALLOW_LOCAL_NETWORK_PROXY = "true";
    expect(
      validateOutboundUrl(
        "http://127.0.0.1/image.png",
        getSafeUrlPolicy("image"),
      ).hostname,
    ).toBe("127.0.0.1");
  });

  it("allows local HTTP provider proxying in hosted mode without an opt-in", () => {
    process.env.DEPLOYMENT_MODE = "hosted";
    delete process.env.ALLOW_LOCAL_NETWORK_PROXY;

    expect(
      validateOutboundUrl(
        "http://localhost:11434/v1",
        getSafeUrlPolicy("provider"),
      ).hostname,
    ).toBe("localhost");
  });

  it("detects private IPv4-mapped IPv6 and CGNAT addresses", () => {
    expect(isPrivateIpAddress("::ffff:172.16.0.2")).toBe(true);
    expect(isPrivateIpAddress("::ffff:169.254.10.20")).toBe(true);
    expect(isPrivateIpAddress("100.64.0.1")).toBe(true);
  });

  it("treats special-use IP ranges as non-public proxy targets", () => {
    for (const address of [
      "0.0.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "240.0.0.1",
      "::ffff:198.18.0.1",
      "2001:db8::1",
      "ff02::1",
    ]) {
      expect(isPrivateIpAddress(address), address).toBe(true);
    }

    expect(isPrivateIpAddress("93.184.216.34")).toBe(false);
    expect(isPrivateIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(
      false,
    );
  });

  it("allows redirects from plugin URLs to private network targets", async () => {
    const { safeFetch } = await import("../lib/security/safeFetch");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "http://127.0.0.1/admin",
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(
      safeFetch(
        "https://93.184.216.34/openapi.json",
        { method: "GET" },
        { policy: getSafeUrlPolicy("plugin") },
      ),
    ).resolves.toBeInstanceOf(Response);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects HTTPS-to-HTTP redirects for fixed HTTPS-only targets", async () => {
    const { safeFetch } = await import("../lib/security/safeFetch");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://93.184.216.34/registry.json",
        },
      }),
    );

    await expect(
      safeFetch(
        "https://93.184.216.34/registry.json",
        { method: "GET" },
        {
          policy: {
            context: "pluginManifest",
            allowedProtocols: ["https:"],
          },
        },
      ),
    ).rejects.toThrow(/Protocol/i);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("strips sensitive headers on cross-origin redirects", async () => {
    const { safeFetch } = await import("../lib/security/safeFetch");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://93.184.216.35/next",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
        }),
      );

    await safeFetch(
      "https://93.184.216.34/start",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer secret",
          "X-API-Key": "secret",
          "X-Goog-API-Key": "secret",
          "Content-Type": "application/json",
        },
      },
      { policy: getSafeUrlPolicy("plugin") },
    );

    const redirectedInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const redirectedHeaders = new Headers(redirectedInit.headers);

    expect(redirectedHeaders.get("authorization")).toBeNull();
    expect(redirectedHeaders.get("x-api-key")).toBeNull();
    expect(redirectedHeaders.get("x-goog-api-key")).toBeNull();
    expect(redirectedHeaders.get("content-type")).toBe("application/json");
  });

  it("removes merged user abort listeners after successful safe fetches", async () => {
    const { safeFetch } = await import("../lib/security/safeFetch");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ ok: true }),
    );
    const userController = new AbortController();
    const addSpy = vi.spyOn(userController.signal, "addEventListener");
    const removeSpy = vi.spyOn(userController.signal, "removeEventListener");

    await safeFetch(
      "https://93.184.216.34/openapi.json",
      { method: "GET", signal: userController.signal },
      { policy: getSafeUrlPolicy("plugin") },
    );

    expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), {
      once: true,
    });
    expect(removeSpy).toHaveBeenCalledWith("abort", addSpy.mock.calls[0]?.[1]);
  });

  it("times out while reading stalled safe fetch response bodies", async () => {
    vi.useFakeTimers();
    const { safeFetchText } = await import("../lib/security/safeFetch");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new ReadableStream()),
    );

    const result = safeFetchText(
      "https://93.184.216.34/openapi.json",
      { method: "GET" },
      { policy: getSafeUrlPolicy("plugin"), timeoutMs: 25 },
    );
    const expectation = expect(result).rejects.toMatchObject({
      name: "ResponseTimeoutError",
      code: "RESPONSE_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });
});
