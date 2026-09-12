import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeUrlPolicy } from "../lib/security/urlPolicy";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

describe("provider response lifecycle limits", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    lookupMock.mockReset();
  });

  it("enforces the timeout until the response body finishes", async () => {
    vi.useFakeTimers();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          },
        }),
      ),
    );
    const { safeFetch, ResponseTimeoutError } =
      await import("../lib/security/safeFetch");

    const response = await safeFetch(
      "https://example.com/v1/chat/completions",
      {},
      {
        policy: getSafeUrlPolicy("provider"),
        timeoutMs: 25,
        maxResponseBytes: 1024,
        enforceResponseLimits: true,
      },
    );
    const body = response.text();
    const bodyExpectation =
      expect(body).rejects.toBeInstanceOf(ResponseTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await bodyExpectation;
  });

  it("raises a distinct size error for oversized full responses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("12345"));
    const { safeFetch, ResponseSizeLimitError } =
      await import("../lib/security/safeFetch");

    const response = await safeFetch(
      "https://example.com/v1/models",
      {},
      {
        policy: getSafeUrlPolicy("provider"),
        maxResponseBytes: 4,
        enforceResponseLimits: true,
      },
    );

    await expect(response.text()).rejects.toBeInstanceOf(
      ResponseSizeLimitError,
    );
  });

  it("passes caller cancellation to provider fetch without a DNS preflight", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      });
    const controller = new AbortController();
    const { safeFetch } = await import("../lib/security/safeFetch");

    const request = safeFetch(
      "https://example.com/v1/models",
      { signal: controller.signal },
      { policy: getSafeUrlPolicy("provider") },
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("configures text, image, and streaming provider budgets", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/providers/base.ts", "utf8"),
    );

    expect(source).toContain("30_000");
    expect(source).toContain("2 * 1024 * 1024");
    expect(source).toContain("120_000");
    expect(source).toContain("36 * 1024 * 1024");
    expect(source).toContain("10 * 60_000");
    expect(source).toContain("8 * 1024 * 1024");
    expect(source).toContain("enforceResponseLimits: true");
    expect(source).toContain(
      "Google provider SDK does not expose the guarded fetch hook.",
    );
  });

  it("applies the decoded chat-stream budget before image response limits", async () => {
    const { getProviderResponseLimits } = await import("../lib/providers/base");

    expect(
      getProviderResponseLimits("https://api.example.test/v1/responses", {
        body: JSON.stringify({
          stream: true,
          tools: [{ type: "image_generation" }],
        }),
      }),
    ).toMatchObject({
      timeoutMs: 10 * 60_000,
      maxResponseBytes: 8 * 1024 * 1024,
    });
  });

  it("allows image-sized time budgets for provider file uploads", async () => {
    const { getProviderResponseLimits } = await import("../lib/providers/base");

    expect(
      getProviderResponseLimits("https://api.example.test/v1/files", {
        method: "POST",
        body: new FormData(),
      }),
    ).toMatchObject({
      timeoutMs: 120_000,
      maxResponseBytes: 36 * 1024 * 1024,
    });
  });

  it("keeps timeout and size codes at the public error boundary", async () => {
    const { toPublicErrorPayload } = await import("../lib/errors");
    const { ResponseSizeLimitError, ResponseTimeoutError } =
      await import("../lib/security/safeFetch");

    expect(
      toPublicErrorPayload(new ResponseTimeoutError(30_000)),
    ).toMatchObject({ code: "RESPONSE_TIMEOUT", statusCode: 504 });
    expect(
      toPublicErrorPayload(new ResponseSizeLimitError(2 * 1024 * 1024)),
    ).toMatchObject({ code: "RESPONSE_SIZE_LIMIT", statusCode: 502 });

    const sdkTimeout = new Error("Request timed out.");
    sdkTimeout.name = "APIConnectionTimeoutError";
    expect(toPublicErrorPayload(sdkTimeout)).toMatchObject({
      code: "RESPONSE_TIMEOUT",
      statusCode: 504,
    });
    expect(
      toPublicErrorPayload(
        Object.assign(new Error("Connection error"), {
          cause: new ResponseSizeLimitError(2 * 1024 * 1024),
        }),
      ),
    ).toMatchObject({ code: "RESPONSE_SIZE_LIMIT", statusCode: 502 });
  });

  it("emits a distinct timeout code when an SDK timeout reaches SSE", async () => {
    const { createStreamHandler } = await import("../lib/streaming/sse");
    const sdkTimeout = new Error("Request timed out.");
    sdkTimeout.name = "APIConnectionTimeoutError";
    const stream = createStreamHandler(async () => {
      throw sdkTimeout;
    });

    const payload = await new Response(stream).text();

    expect(payload).toContain('"code":"RESPONSE_TIMEOUT"');
    expect(payload).toContain('"statusCode":504');
  });

  it("disables provider SDK retries so response deadlines are not multiplied", async () => {
    const { ProviderFactory } = await import("../lib/providers/base");
    const provider = {
      id: "test",
      name: "test",
      type: "OpenAI" as const,
      apiKey: "test-key",
      enabled: true,
      models: [],
    };

    const openai = ProviderFactory.createOpenAIClient(provider);
    const anthropic = ProviderFactory.createAnthropicClient({
      ...provider,
      type: "Anthropic",
    });

    expect(openai.maxRetries).toBe(0);
    expect(anthropic.maxRetries).toBe(0);
  });
});
