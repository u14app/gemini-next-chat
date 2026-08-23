import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeFetchTextMock = vi.hoisted(() => vi.fn());
const decryptOptionalSecretMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/api/middleware", async () =>
  vi.importActual("../lib/api/middleware"),
);

vi.mock("@/lib/api/schemas", async () => vi.importActual("../lib/api/schemas"));

vi.mock("@/lib/byok/shared", async () => vi.importActual("../lib/byok/shared"));

vi.mock("@/lib/plugin/manifest", async () =>
  vi.importActual("../lib/plugin/manifest"),
);

vi.mock("@/lib/plugin/config", async () =>
  vi.importActual("../lib/plugin/config"),
);

vi.mock("@/lib/security/urlPolicy", async () =>
  vi.importActual("../lib/security/urlPolicy"),
);

vi.mock("@/lib/security/deployment", async () =>
  vi.importActual("../lib/security/deployment"),
);

vi.mock("@/lib/utils/safeServerLog", async () =>
  vi.importActual("../lib/utils/safeServerLog"),
);

vi.mock("@/lib/security/safeFetch", () => ({
  safeFetchText: safeFetchTextMock,
}));

vi.mock("@/lib/byok/server", () => ({
  decryptOptionalSecret: decryptOptionalSecretMock,
}));

const secret = {
  v: 1,
  kid: "kid",
  alg: "RSA-OAEP-256+A256GCM",
  iv: "iv",
  wrappedKey: "wrapped",
  ciphertext: "ciphertext",
  context: "plugin:test-plugin:auth",
} as const;

function createRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/plugins/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

describe("plugin execute route", () => {
  beforeEach(() => {
    safeFetchTextMock.mockReset();
    decryptOptionalSecretMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unresolved path parameters before outbound fetch", async () => {
    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          functions: [{ name: "lookup", path: "/items/{id}", method: "GET" }],
        },
        functionDef: { name: "lookup", path: "/items/{id}", method: "GET" },
        args: {},
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Plugin path parameters are missing",
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("rejects legacy plugin payloads in hosted mode", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          functions: [{ name: "lookup", path: "/items/{id}", method: "GET" }],
        },
        functionDef: { name: "lookup", path: "/items/{id}", method: "GET" },
        args: { id: "abc" },
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Legacy plugin execution payloads are disabled in hosted mode",
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("adds API key auth to query parameters and keeps response size capped", async () => {
    const controller = new AbortController();
    decryptOptionalSecretMock.mockResolvedValue("secret-value");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({ ok: true }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const request = createRequest(
      {
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          auth: { type: "apiKey", name: "token", in: "query" },
          functions: [{ name: "lookup", path: "/items/{id}", method: "GET" }],
        },
        functionDef: {
          name: "lookup",
          path: "/items/{id}",
          method: "GET",
        },
        args: { id: "abc", q: "neo" },
        authConfig: {
          type: "apiKey",
          addTo: "query",
          key: "token",
          valueSecret: secret,
        },
      },
      controller.signal,
    );
    const response = await POST(request as any);

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://api.example.com/items/abc?q=neo&token=secret-value",
      expect.objectContaining({
        method: "GET",
        signal: request.signal,
      }),
      expect.objectContaining({ maxResponseBytes: 2 * 1024 * 1024 }),
    );
  });

  it("rejects plugin auth header names that would override request routing", async () => {
    decryptOptionalSecretMock.mockResolvedValue("secret-value");

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          auth: { type: "apiKey", in: "header" },
          functions: [{ name: "lookup", path: "/items", method: "GET" }],
        },
        functionDef: { name: "lookup", path: "/items", method: "GET" },
        args: {},
        authConfig: {
          type: "apiKey",
          addTo: "header",
          key: "Host",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Plugin authentication header name is not allowed",
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("does not let runtime plugin auth config override manifest auth location", async () => {
    decryptOptionalSecretMock.mockResolvedValue("secret-value");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({ ok: true }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          auth: { type: "apiKey", name: "token", in: "query" },
          functions: [{ name: "lookup", path: "/items", method: "GET" }],
        },
        functionDef: { name: "lookup", path: "/items", method: "GET" },
        args: {},
        authConfig: {
          type: "apiKey",
          addTo: "header",
          key: "X-API-Key",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://api.example.com/items?token=secret-value",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          "X-API-Key": "secret-value",
        }),
      }),
      expect.any(Object),
    );
  });

  it("executes registered plugin functions with the new id/name payload", async () => {
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({ temp: 21 }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "weather-gpt",
        functionName: "getCurrentWeather",
        args: { location: "Shanghai" },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://weathergpt.vercel.app/api/weather?location=Shanghai",
      expect.objectContaining({ method: "GET" }),
      expect.any(Object),
    );
  });

  it("injects optional Jina reader bearer auth and normalizes markdown content", async () => {
    decryptOptionalSecretMock.mockResolvedValue("jina-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        code: 200,
        data: { content: "# Example\n\nReadable markdown." },
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "jina-web-reader",
        functionName: "read_webpage",
        args: { url: "https://example.com/doc" },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://r.jina.ai/https%3A%2F%2Fexample.com%2Fdoc",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer jina-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(await response.json()).toEqual({
      result: "# Example\n\nReadable markdown.",
    });
  });

  it("allows Jina reader requests for private HTTP target URLs", async () => {
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        code: 200,
        data: { content: "# Local service" },
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "jina-web-reader",
        functionName: "read_webpage",
        args: { url: "http://localhost:3000/admin" },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://r.jina.ai/http%3A%2F%2Flocalhost%3A3000%2Fadmin",
      expect.objectContaining({ method: "GET" }),
      expect.any(Object),
    );
  });

  it("normalizes Agnes image generation results", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        created: 1780000000,
        data: [
          {
            url: "https://storage.example/image.png",
            b64_json: null,
            revised_prompt: null,
          },
        ],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-image-generation",
        functionName: "generate_image",
        args: {
          prompt: "A compact glass cube",
          size: "1024x768",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "agnes-custom-image-model",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://apihub.agnes-ai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer agnes-secret",
        }),
      }),
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "agnes-custom-image-model",
      prompt: "A compact glass cube",
      size: "1024x768",
    });
    expect(await response.json()).toEqual({
      result: {
        imageUrl: "https://storage.example/image.png",
        imageBase64: null,
        revisedPrompt: null,
        raw: {
          created: 1780000000,
          data: [
            {
              url: "https://storage.example/image.png",
              b64_json: null,
              revised_prompt: null,
            },
          ],
        },
      },
    });
  });

  it("executes Agnes image editing with extra_body image inputs", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        created: 1780000000,
        data: [
          {
            url: null,
            b64_json: "edited-image",
            revised_prompt: null,
          },
        ],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-image-generation",
        functionName: "generate_image",
        args: {
          prompt: "Make the object orange",
          size: "1024x768",
          image: ["https://example.com/input.png"],
          response_format: "b64_json",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "agnes-image-2.1-flash",
      prompt: "Make the object orange",
      size: "1024x768",
      extra_body: {
        image: ["https://example.com/input.png"],
        response_format: "b64_json",
      },
    });
    expect(await response.json()).toMatchObject({
      result: {
        imageBase64: "edited-image",
      },
    });
  });

  it("executes Gemini image generation through Interactions", async () => {
    decryptOptionalSecretMock.mockResolvedValue("gemini-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "interaction_1",
        output_image: {
          data: "gemini-image",
          mime_type: "image/png",
        },
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "gemini-image-generation",
        functionName: "generate_gemini_image",
        args: {
          prompt: "A compact glass cube",
          aspect_ratio: "3:2",
          image_size: "2K",
          n: 3,
        },
        authConfig: {
          type: "apiKey",
          valueSecret: secret,
          baseUrl: "https://gemini-proxy.example/v1beta",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://gemini-proxy.example/v1beta/interactions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": "gemini-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "gemini-3.1-flash-image",
      input: "A compact glass cube",
      response_modalities: ["image"],
      generation_config: {
        candidate_count: 3,
        image_config: {
          aspect_ratio: "3:2",
          image_size: "2K",
        },
      },
    });
    expect(await response.json()).toMatchObject({
      result: {
        imageBase64: "gemini-image",
        imageUrl: null,
      },
    });
  });

  it("executes OpenAI image generation through Responses", async () => {
    decryptOptionalSecretMock.mockResolvedValue("openai-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        output: [
          {
            type: "image_generation_call",
            id: "ig_1",
            result: "openai-image",
            revised_prompt: "A revised prompt",
          },
        ],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-responses-image-processing",
        functionName: "generate_image_with_responses",
        args: {
          prompt: "A quiet dashboard",
          model: "gpt-5.5",
          image_model: "gpt-image-1.5",
          action: "generate",
          quality: "high",
          size: "1536x1024",
          n: 4,
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          baseUrl: "https://openai-proxy.example/api",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://openai-proxy.example/api/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openai-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "gpt-5.5",
      input: "A quiet dashboard",
      tools: [
        {
          type: "image_generation",
          model: "gpt-image-1.5",
          action: "generate",
          quality: "high",
          size: "1536x1024",
        },
      ],
    });
    expect(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body).not.toContain('"n"');
    expect(await response.json()).toMatchObject({
      result: {
        imageBase64: "openai-image",
        revisedPrompt: "A revised prompt",
      },
    });
  });

  it("uses configured OpenAI Responses image model defaults", async () => {
    decryptOptionalSecretMock.mockResolvedValue("openai-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        output: [
          {
            type: "image_generation_call",
            id: "ig_1",
            result: "openai-image",
          },
        ],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-responses-image-processing",
        functionName: "generate_image_with_responses",
        args: {
          prompt: "A quiet dashboard",
          action: "generate",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "gpt-image-custom",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "gpt-5.5",
      input: "A quiet dashboard",
      tools: [
        {
          type: "image_generation",
          model: "gpt-image-custom",
          action: "generate",
        },
      ],
    });
  });

  it("does not expose Responses image processing through the compatible OpenAI plugin", async () => {
    decryptOptionalSecretMock.mockResolvedValue("openai-secret");

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-image-generation",
        functionName: "generate_image_with_responses",
        args: {
          prompt: "A quiet dashboard",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Plugin function is not declared by this plugin",
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("executes OpenAI Responses image edits with input images", async () => {
    decryptOptionalSecretMock.mockResolvedValue("openai-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        output: [
          {
            type: "image_generation_call",
            id: "ig_edit",
            result: "edited-openai-image",
          },
        ],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-responses-image-processing",
        functionName: "generate_image_with_responses",
        args: {
          prompt: "Edit this image",
          action: "edit",
          image: ["data:image/png;base64,aW1hZ2U="],
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "gpt-5.5",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Edit this image" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,aW1hZ2U=",
            },
          ],
        },
      ],
      tools: [
        {
          type: "image_generation",
          action: "edit",
        },
      ],
    });
    expect(await response.json()).toMatchObject({
      result: {
        imageBase64: "edited-openai-image",
      },
    });
  });

  it("executes OpenAI-compatible image generations with configured endpoint", async () => {
    decryptOptionalSecretMock.mockResolvedValue("compat-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        data: [{ url: "https://cdn.example.com/generated.png" }],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-image-generation",
        functionName: "generate_image_with_images_api",
        args: {
          prompt: "A compact glass cube",
          model: "gpt-image-2",
          size: "1024x1024",
          n: 2,
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          baseUrl: "https://api.krill-ai.com/v1",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://api.krill-ai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer compat-secret",
        }),
      }),
      expect.any(Object),
    );
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "gpt-image-2",
      prompt: "A compact glass cube",
      size: "1024x1024",
      n: 2,
    });
    expect(await response.json()).toMatchObject({
      result: {
        imageUrl: "https://cdn.example.com/generated.png",
        imageBase64: null,
      },
    });
  });

  it("uses configured OpenAI-compatible image model defaults", async () => {
    decryptOptionalSecretMock.mockResolvedValue("compat-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        data: [{ url: "https://cdn.example.com/generated.png" }],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-image-generation",
        functionName: "generate_image_with_images_api",
        args: {
          prompt: "A compact glass cube",
          size: "1024x1024",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "gpt-image-custom",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      model: "gpt-image-custom",
      prompt: "A compact glass cube",
      size: "1024x1024",
    });
  });

  it("executes OpenAI-compatible image edits as multipart requests", async () => {
    decryptOptionalSecretMock.mockResolvedValue("compat-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        data: [{ b64_json: "edited-image" }],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-image-generation",
        functionName: "generate_image_with_images_api",
        args: {
          prompt: "Edit this image",
          model: "gpt-image-2",
          image: ["data:image/png;base64,aW1hZ2U="],
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          baseUrl: "https://api.krill-ai.com/v1",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://api.krill-ai.com/v1/images/edits",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer compat-secret",
        }),
        body: expect.any(FormData),
      }),
      expect.any(Object),
    );
    const formData = safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as FormData;
    expect(formData.get("model")).toBe("gpt-image-2");
    expect(formData.get("prompt")).toBe("Edit this image");
    expect(formData.getAll("image")).toHaveLength(1);
    expect(await response.json()).toMatchObject({
      result: {
        imageBase64: "edited-image",
      },
    });
  });

  it("allows private HTTP OpenAI-compatible endpoint overrides", async () => {
    decryptOptionalSecretMock.mockResolvedValue("compat-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        data: [{ url: "http://localhost:11434/generated.png" }],
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "openai-image-generation",
        functionName: "generate_image_with_images_api",
        args: {
          prompt: "A compact glass cube",
          model: "gpt-image-2",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          baseUrl: "http://localhost:11434/v1",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
      expect.any(Object),
    );
  });

  it("creates Agnes text-to-video tasks with configured model defaults", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_text",
        task_id: "task_text",
        video_id: "video_text",
        status: "queued",
        progress: 0,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "create_video",
        args: {
          prompt: "A quiet cinematic beach shot",
          num_frames: 121,
          frame_rate: 24,
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "agnes-video-custom",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://apihub.agnes-ai.com/v1/videos",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer agnes-secret",
        }),
      }),
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      prompt: "A quiet cinematic beach shot",
      num_frames: 121,
      frame_rate: 24,
      model: "agnes-video-custom",
    });
  });

  it("creates Agnes image-to-video tasks with explicit model priority", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_image",
        video_id: "video_image",
        status: "queued",
        progress: 0,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "create_video",
        args: {
          prompt: "Animate the product photo",
          image: "https://example.com/product.png",
          model: "agnes-video-explicit",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "agnes-video-configured",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(safeFetchTextMock.mock.calls.at(-1)?.[1]?.body as string),
    ).toEqual({
      prompt: "Animate the product photo",
      image: "https://example.com/product.png",
      model: "agnes-video-explicit",
    });
  });

  it("rejects non-HTTPS Agnes image-to-video inputs", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "create_video",
        args: {
          prompt: "Animate this image",
          image: "data:image/png;base64,aW1hZ2U=",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Agnes image-to-video currently requires a public HTTPS image URL",
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("normalizes Agnes video task result fields", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_1",
        task_id: "task_1",
        video_id: "video_1",
        status: "completed",
        progress: 100,
        seconds: "5.0",
        size: "1152x768",
        remixed_from_video_id: "https://storage.example/video.mp4",
        error: null,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: { video_id: "video_1" },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://apihub.agnes-ai.com/agnesapi?video_id=video_1",
      expect.objectContaining({ method: "GET" }),
      expect.any(Object),
    );
    expect(await response.json()).toEqual({
      result: {
        taskId: "task_1",
        videoId: "video_1",
        status: "completed",
        generationStatus: "generated",
        progress: 100,
        seconds: "5.0",
        size: "1152x768",
        videoUrl: "https://storage.example/video.mp4",
        error: null,
        raw: {
          id: "task_1",
          task_id: "task_1",
          video_id: "video_1",
          status: "completed",
          progress: 100,
          seconds: "5.0",
          size: "1152x768",
          remixed_from_video_id: "https://storage.example/video.mp4",
          error: null,
        },
      },
    });
  });

  it("retrieves Agnes video results with configured model name", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_custom",
        video_id: "video_custom",
        status: "completed",
        progress: 100,
        url: "https://storage.example/custom.mp4",
        error: null,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: { video_id: "video_custom" },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "agnes-video-custom",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://apihub.agnes-ai.com/agnesapi?video_id=video_custom&model_name=agnes-video-custom",
      expect.objectContaining({ method: "GET" }),
      expect.any(Object),
    );
  });

  it("prefers explicit Agnes video result model names", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_explicit",
        video_id: "video_explicit",
        status: "completed",
        progress: 100,
        url: "https://storage.example/explicit.mp4",
        error: null,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: {
          video_id: "video_explicit",
          model_name: "agnes-video-explicit",
        },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "agnes-video-configured",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://apihub.agnes-ai.com/agnesapi?video_id=video_explicit&model_name=agnes-video-explicit",
      expect.objectContaining({ method: "GET" }),
      expect.any(Object),
    );
  });

  it("normalizes Agnes video tasks that are still generating", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_2",
        video_id: "video_2",
        status: "in_progress",
        progress: 42,
        error: null,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: { video_id: "video_2" },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        taskId: "task_2",
        videoId: "video_2",
        status: "in_progress",
        generationStatus: "generating",
        progress: 42,
        videoUrl: null,
        error: null,
      },
    });
  });

  it("normalizes failed Agnes video tasks without turning them into transport errors", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_3",
        video_id: "video_3",
        status: "failed",
        progress: 75,
        error: "Generation failed upstream",
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: { video_id: "video_3" },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        taskId: "task_3",
        videoId: "video_3",
        status: "failed",
        generationStatus: "failed",
        error: "Generation failed upstream",
      },
    });
  });

  it("retrieves legacy Agnes video results by task id", async () => {
    decryptOptionalSecretMock.mockResolvedValue("agnes-secret");
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        id: "task_legacy",
        status: "queued",
        progress: 0,
        error: null,
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: { task_id: "task_legacy" },
        authConfig: {
          type: "bearer",
          valueSecret: secret,
          model: "agnes-video-custom",
        },
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(safeFetchTextMock).toHaveBeenCalledWith(
      "https://apihub.agnes-ai.com/v1/videos/task_legacy",
      expect.objectContaining({ method: "GET" }),
      expect.any(Object),
    );
    expect(await response.json()).toMatchObject({
      result: {
        taskId: "task_legacy",
        status: "queued",
        generationStatus: "generating",
      },
    });
  });

  it("rejects Agnes video result lookups without a video id or task id", async () => {
    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      createRequest({
        pluginId: "agnes-video-generation",
        functionName: "get_video_result",
        args: {},
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "TOOL_ARGUMENT_SCHEMA_INVALID",
      error: expect.stringMatching(/video_id|task_id|schema/i),
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });
});
