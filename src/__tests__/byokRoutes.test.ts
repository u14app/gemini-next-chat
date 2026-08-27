import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  safeFetchJson: vi.fn(),
  safeFetchText: vi.fn(),
  safeFetchArrayBuffer: vi.fn(),
  decryptSecretEnvelope: vi.fn(),
  decryptOptionalSecret: vi.fn(),
  resolveProviderRuntimeConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/security/safeFetch", () => ({
  safeFetchJson: mocks.safeFetchJson,
  safeFetchText: mocks.safeFetchText,
  safeFetchArrayBuffer: mocks.safeFetchArrayBuffer,
}));

vi.mock("@/utils/apiHelpers", () => ({
  assertProviderOutboundAllowed: vi.fn(),
  createGeminiClient: vi.fn(),
}));

vi.mock("@/config/limits", async () => vi.importActual("../config/limits"));

vi.mock("@/lib/api/middleware", async () =>
  vi.importActual("../lib/api/middleware"),
);

vi.mock("@/lib/api/schemas", async () => vi.importActual("../lib/api/schemas"));

vi.mock("@/lib/api/uploads", async () => vi.importActual("../lib/api/uploads"));

vi.mock("@/lib/utils/safeServerLog", () => ({
  safeServerLogError: vi.fn(),
  safeServerLogWarn: vi.fn(),
}));

vi.mock("@/lib/utils/generatedImages", async () =>
  vi.importActual("../lib/utils/generatedImages"),
);

vi.mock("@/lib/providers/base", () => ({
  ProviderFactory: {
    createGeminiClient: vi.fn(),
    createOpenAIClient: vi.fn(),
  },
}));

vi.mock("@/lib/providers/models", async () =>
  vi.importActual("../lib/providers/models"),
);
vi.mock("@/lib/providers/providerTypes", async () =>
  vi.importActual("../lib/providers/providerTypes"),
);

vi.mock("@/lib/security/searchPolicy", async () =>
  vi.importActual("../lib/security/searchPolicy"),
);

vi.mock("@/lib/security/urlPolicy", async () =>
  vi.importActual("../lib/security/urlPolicy"),
);

vi.mock("@/lib/search/results", async () =>
  vi.importActual("../lib/search/results"),
);

vi.mock("@/lib/byok/shared", async () => vi.importActual("../lib/byok/shared"));

vi.mock("@/lib/defaultConfig/server", async () =>
  vi.importActual("../lib/defaultConfig/server"),
);

vi.mock("@/lib/defaultConfig/shared", async () =>
  vi.importActual("../lib/defaultConfig/shared"),
);

vi.mock("@/lib/byok/server", () => ({
  decryptSecretEnvelope: mocks.decryptSecretEnvelope,
  decryptOptionalSecret: mocks.decryptOptionalSecret,
  resolveProviderRuntimeConfig: mocks.resolveProviderRuntimeConfig,
}));

const apiKeySecret = {
  v: 1,
  kid: "test-key",
  alg: "RSA-OAEP-256+A256GCM",
  iv: "iv",
  wrappedKey: "wrapped",
  ciphertext: "ciphertext",
  context: "search:tavily",
} as const;

const mineruTokenSecret = {
  ...apiKeySecret,
  context: "docs:mineru",
};

async function createImageEditRequest(payload: Record<string, unknown>) {
  const formData = new FormData();
  formData.set(
    "payload",
    JSON.stringify({
      ...payload,
      attachments: [
        {
          id: "att_1",
          mimeType: "image/png",
          fileName: "source.png",
          uploadId: "image-0",
        },
      ],
    }),
  );
  formData.set(
    "image:image-0",
    new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "source.png",
      { type: "image/png" },
    ),
  );
  const encoded = new Request("https://neo.test/api/chat/generate-image", {
    method: "POST",
    body: formData,
  });
  const bytes = await encoded.arrayBuffer();
  return new Request(encoded.url, {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });
}

describe("BYOK route integration", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.safeFetchJson.mockReset();
    mocks.safeFetchText.mockReset();
    mocks.safeFetchArrayBuffer.mockReset();
    mocks.decryptSecretEnvelope.mockReset();
    mocks.decryptOptionalSecret.mockReset();
    mocks.resolveProviderRuntimeConfig.mockReset();
  });

  it("decrypts search credentials before calling the upstream API", async () => {
    mocks.decryptOptionalSecret.mockResolvedValue("tvly-secret");
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        results: [
          {
            title: "Result",
            url: "https://example.com/result",
            content: "Body",
          },
        ],
        images: [],
      },
    });

    const { POST } = await import("../app/api/search/route");
    const response = await POST(
      new Request("https://neo.test/api/search", {
        method: "POST",
        body: JSON.stringify({
          provider: "tavily",
          query: "neo",
          config: {
            apiKeySecret,
          },
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(mocks.decryptOptionalSecret).toHaveBeenCalledWith(
      apiKeySecret,
      "search:tavily",
    );
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tvly-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain("tvly-secret");
  });

  it("preserves an actionable Firecrawl public-service rejection", async () => {
    mocks.decryptOptionalSecret.mockResolvedValue(undefined);
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 403 }),
      data: {
        success: false,
        error:
          "This IP looks suspicious, so Firecrawl cannot be used without an API key.",
      },
    });

    const { POST } = await import("../app/api/search/route");
    const response = await POST(
      new Request("https://neo.test/api/search", {
        method: "POST",
        body: JSON.stringify({
          provider: "firecrawl",
          query: "neo",
          config: {},
        }),
      }) as any,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/add a Firecrawl API key/i),
    });
  });

  it("rejects provider model requests that only have legacy environment keys", async () => {
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalApiKey = process.env.API_KEY;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-env-secret";
    process.env.API_KEY = "api-env-secret";
    process.env.OPENAI_API_KEY = "openai-env-secret";
    mocks.resolveProviderRuntimeConfig.mockResolvedValue({ type: "Gemini" });

    try {
      const { POST } = await import("../app/api/providers/models/route");
      const response = await POST(
        new Request("https://neo.test/api/providers/models", {
          method: "POST",
          body: JSON.stringify({
            provider: { type: "Gemini" },
          }),
        }) as any,
      );

      expect(response.status).toBe(401);
      expect(mocks.safeFetchJson).not.toHaveBeenCalled();
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain("gemini-env-secret");
      expect(text).not.toContain("api-env-secret");
      expect(text).not.toContain("openai-env-secret");
    } finally {
      if (originalGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = originalGeminiKey;
      }
      if (originalApiKey === undefined) {
        delete process.env.API_KEY;
      } else {
        process.env.API_KEY = originalApiKey;
      }
      if (originalOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiKey;
      }
    }
  });

  it("routes OpenAI Compatible image generation to the Images generations endpoint", async () => {
    const controller = new AbortController();
    mocks.resolveProviderRuntimeConfig.mockResolvedValue({
      type: "OpenAI Compatible",
      baseUrl: "https://api.krill-ai.com/v1",
      apiKey: "krill-key",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: [{ b64_json: "aW1hZ2U=" }],
      },
    });

    const { POST } = await import("../app/api/chat/generate-image/route");
    const request = new Request("https://neo.test/api/chat/generate-image", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        provider: {
          type: "OpenAI Compatible",
          baseUrl: "https://api.krill-ai.com/v1",
          apiKeySecret,
        },
        modelName: "gpt-image-2",
        prompt: "draw a quiet dashboard",
      }),
    });
    const response = await POST(request as any);

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.krill-ai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        signal: request.signal,
        headers: expect.objectContaining({
          Authorization: "Bearer krill-key",
        }),
      }),
      expect.any(Object),
    );
    expect(mocks.safeFetchJson.mock.calls[0]?.[2]).toMatchObject({
      timeoutMs: 120_000,
    });
    const requestInit = mocks.safeFetchJson.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).not.toHaveProperty(
      "response_format",
    );
  });

  it("returns OpenAI Compatible URL-only generated images", async () => {
    mocks.resolveProviderRuntimeConfig.mockResolvedValue({
      type: "OpenAI Compatible",
      baseUrl: "https://api.krill-ai.com/v1",
      apiKey: "krill-key",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: [{ url: "https://cdn.krill-ai.com/generated.png" }],
      },
    });

    const { POST } = await import("../app/api/chat/generate-image/route");
    const response = await POST(
      new Request("https://neo.test/api/chat/generate-image", {
        method: "POST",
        body: JSON.stringify({
          provider: {
            type: "OpenAI Compatible",
            baseUrl: "https://api.krill-ai.com/v1",
            apiKeySecret,
          },
          modelName: "gpt-image-2",
          prompt: "draw a quiet dashboard",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatchObject({
      mimeType: "image/png",
      url: "https://cdn.krill-ai.com/generated.png",
    });
    expect(body.images[0]).not.toHaveProperty("data");
  });

  it("routes OpenAI Compatible image edits to the Images edits endpoint", async () => {
    mocks.resolveProviderRuntimeConfig.mockResolvedValue({
      type: "OpenAI Compatible",
      baseUrl: "https://api.krill-ai.com/v1",
      apiKey: "krill-key",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: [{ b64_json: "ZWRpdA==" }],
      },
    });

    const { POST } = await import("../app/api/chat/generate-image/route");
    const request = await createImageEditRequest({
      provider: {
        type: "OpenAI Compatible",
        baseUrl: "https://api.krill-ai.com/v1",
        apiKeySecret,
      },
      modelName: "gpt-image-2",
      prompt: "edit this image",
    });
    const response = await POST(request as any);

    expect(response.status).toBe(200);
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      "https://api.krill-ai.com/v1/images/edits",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer krill-key",
        }),
        body: expect.any(FormData),
      }),
      expect.any(Object),
    );
    const requestInit = mocks.safeFetchJson.mock.calls[0]?.[1] as RequestInit;
    const formData = requestInit.body as FormData;
    expect(formData.has("response_format")).toBe(false);
    expect(formData.get("image")).toBeInstanceOf(File);
  });

  it("returns OpenAI Compatible URL-only edited images", async () => {
    mocks.resolveProviderRuntimeConfig.mockResolvedValue({
      type: "OpenAI Compatible",
      baseUrl: "https://api.krill-ai.com/v1",
      apiKey: "krill-key",
    });
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: [{ url: "https://cdn.krill-ai.com/edited.png" }],
      },
    });

    const { POST } = await import("../app/api/chat/generate-image/route");
    const request = await createImageEditRequest({
      provider: {
        type: "OpenAI Compatible",
        baseUrl: "https://api.krill-ai.com/v1",
        apiKeySecret,
      },
      modelName: "gpt-image-2",
      prompt: "edit this image",
    });
    const response = await POST(request as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatchObject({
      mimeType: "image/png",
      url: "https://cdn.krill-ai.com/edited.png",
    });
    expect(body.images[0]).not.toHaveProperty("data");
  });

  it("rejects plaintext document parse API keys in multipart requests", async () => {
    const { POST } = await import("../app/api/doc-parse/route");
    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "doc.txt", { type: "text/plain" }),
    );
    formData.set(
      "apiKeySecret",
      JSON.stringify({ ...apiKeySecret, context: "docs:llama-parse" }),
    );
    formData.set("apiKey", "llama-plaintext");
    formData.set("provider", "llamaParse");

    const response = await POST(
      new Request("https://neo.test/api/doc-parse", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(mocks.decryptSecretEnvelope).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "llama-plaintext",
    );
  });

  it("rejects plaintext Mineru document parse tokens in multipart requests", async () => {
    const { POST } = await import("../app/api/doc-parse/route");
    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "doc.pdf", { type: "application/pdf" }),
    );
    formData.set("provider", "mineru");
    formData.set("apiKeySecret", JSON.stringify(mineruTokenSecret));
    formData.set("apiToken", "mineru-plaintext");

    const response = await POST(
      new Request("https://neo.test/api/doc-parse", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(mocks.decryptSecretEnvelope).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "mineru-plaintext",
    );
  });

  it("returns a stable validation error for malformed document parser secret JSON", async () => {
    const { POST } = await import("../app/api/doc-parse/route");
    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "notes.txt", { type: "text/plain" }),
    );
    formData.set("provider", "mineru");
    formData.set("apiKeySecret", "{not-json");

    const response = await POST(
      new Request("https://neo.test/api/doc-parse", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_SECRET_JSON",
    });
    expect(mocks.decryptSecretEnvelope).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
  });

  it("rejects plaintext voice API keys in transcription multipart requests", async () => {
    const { POST } = await import("../app/api/voice/transcribe/route");
    const formData = new FormData();
    formData.set(
      "audio",
      new File(["audio"], "speech.webm", { type: "audio/webm" }),
    );
    formData.set("provider", "elevenlabs");
    formData.set(
      "apiKeySecret",
      JSON.stringify({ ...apiKeySecret, context: "voice:elevenlabs" }),
    );
    formData.set("apiKey", "voice-plaintext");

    const response = await POST(
      new Request("https://neo.test/api/voice/transcribe", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(mocks.decryptSecretEnvelope).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "voice-plaintext",
    );
  });

  it("returns a stable validation error for malformed voice secret JSON", async () => {
    const { POST } = await import("../app/api/voice/transcribe/route");
    const formData = new FormData();
    formData.set(
      "audio",
      new File(["audio"], "speech.webm", { type: "audio/webm" }),
    );
    formData.set("provider", "elevenlabs");
    formData.set("apiKeySecret", "{not-json");

    const response = await POST(
      new Request("https://neo.test/api/voice/transcribe", {
        method: "POST",
        headers: { "content-length": "2048" },
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_SECRET_JSON",
    });
    expect(mocks.decryptSecretEnvelope).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
  });

  it("rejects transcription multipart requests without a trustworthy content length before parsing", async () => {
    const { POST } = await import("../app/api/voice/transcribe/route");
    const formData = new FormData();
    formData.set(
      "audio",
      new File(["audio"], "speech.webm", { type: "audio/webm" }),
    );
    formData.set("provider", "elevenlabs");
    formData.set(
      "apiKeySecret",
      JSON.stringify({ ...apiKeySecret, context: "voice:elevenlabs" }),
    );

    const response = await POST(
      new Request("https://neo.test/api/voice/transcribe", {
        method: "POST",
        body: formData,
      }) as any,
    );

    expect(response.status).toBe(411);
    expect(await response.json()).toMatchObject({
      code: "LENGTH_REQUIRED",
    });
    expect(mocks.decryptSecretEnvelope).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();
  });
});
