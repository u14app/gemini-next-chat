import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChatStream: vi.fn(),
  resolveProviderRuntimeConfig: vi.fn(async (provider) => provider),
}));

vi.mock("@/lib/api/chat-handler", () => ({
  handleChatStream: mocks.handleChatStream,
}));

vi.mock("@/lib/api/middleware", () => ({
  logRequest: vi.fn(),
  withStreamApiHandler: (handler: unknown) => handler,
}));

vi.mock("@/lib/api/schemas", () => ({
  ChatRequestSchema: {
    parse: (body: unknown) => body,
  },
}));

vi.mock("@/lib/byok/server", () => ({
  resolveProviderRuntimeConfig: mocks.resolveProviderRuntimeConfig,
}));

describe("chat route cancellation", () => {
  beforeEach(() => {
    mocks.handleChatStream.mockReset();
    mocks.handleChatStream.mockResolvedValue(new Response());
    mocks.resolveProviderRuntimeConfig.mockClear();
  });

  it("passes the incoming request signal to the chat handler", async () => {
    const controller = new AbortController();
    const request = new Request("https://neo.local/api/chat", {
      method: "POST",
      signal: controller.signal,
    });
    const body = {
      provider: { type: "OpenAI", apiKey: "test" },
      modelName: "gpt-test",
      history: [],
      newMessage: "Hello",
      responseFormat: {
        name: "research_wave",
        schema: { type: "object" },
        strict: true,
      },
    };

    const { POST } = await import("../app/api/chat/route");
    await (POST as unknown as (request: Request, body: unknown) => Response)(
      request,
      { payload: body, files: new Map() },
    );

    expect(mocks.handleChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormat: body.responseFormat,
        signal: request.signal,
      }),
    );
  });
});
