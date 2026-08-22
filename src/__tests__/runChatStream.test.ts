import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SSEMessage } from "@/lib/streaming/sse";

const mocks = vi.hoisted(() => ({
  streamOpenAIResponses: vi.fn(),
  streamOpenAIChatCompletions: vi.fn(),
  streamAnthropicMessages: vi.fn(),
  streamGeminiResponse: vi.fn(),
}));

vi.mock("../lib/streaming/openai", () => ({
  streamOpenAIChatCompletions: mocks.streamOpenAIChatCompletions,
  streamOpenAIResponses: mocks.streamOpenAIResponses,
}));

vi.mock("../lib/streaming/anthropic", async () => {
  const actual = await vi.importActual("../lib/streaming/anthropic");
  return { ...actual, streamAnthropicMessages: mocks.streamAnthropicMessages };
});

vi.mock("../lib/streaming/gemini", () => ({
  streamGeminiResponse: mocks.streamGeminiResponse,
}));

import { runChatStream, type ProviderRuntime } from "@/lib/chat/runChatStream";

function makeRuntime(): {
  runtime: ProviderRuntime;
  assertOutboundAllowed: ReturnType<typeof vi.fn>;
  logStreamError: ReturnType<typeof vi.fn>;
} {
  const assertOutboundAllowed = vi.fn(async () => undefined);
  const logStreamError = vi.fn();

  return {
    assertOutboundAllowed,
    logStreamError,
    runtime: {
      assertOutboundAllowed,
      createOpenAIClient: () => ({}) as never,
      createAnthropicClient: () => ({}) as never,
      createGoogleClient: () => ({}) as never,
      logStreamError,
    },
  };
}

function baseOptions(type: string) {
  return {
    provider: { type, baseUrl: "https://example.com", apiKey: "k" } as never,
    modelName: "test-model",
    history: [],
    newMessage: "hi",
    attachments: [],
    config: {},
  };
}

// 每个 provider 分支都必须把适配器产出的事件原样透传给 send，并以 done 收尾
const CASES: Array<{ type: string; stream: () => ReturnType<typeof vi.fn> }> = [
  { type: "OpenAI", stream: () => mocks.streamOpenAIResponses },
  {
    type: "OpenAI Compatible",
    stream: () => mocks.streamOpenAIChatCompletions,
  },
  { type: "Anthropic", stream: () => mocks.streamAnthropicMessages },
  { type: "Google", stream: () => mocks.streamGeminiResponse },
];

describe("runChatStream transport-free dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(CASES)(
    "relays the adapter events for $type",
    async ({ type, stream }) => {
      stream().mockImplementation(async (options: any) => {
        options.onChunk({ type: "content", content: "hello" });
        options.onChunk({
          type: "usage",
          usage: { inputTokens: 1, outputTokens: 2 },
        });
      });

      const sent: SSEMessage[] = [];
      const { runtime, assertOutboundAllowed } = makeRuntime();

      await runChatStream({
        ...baseOptions(type),
        runtime,
        send: (message) => sent.push(message),
      });

      expect(assertOutboundAllowed).toHaveBeenCalledTimes(1);
      expect(sent.map((message) => message.type)).toEqual([
        "content",
        "usage",
        "done",
      ]);
      expect(sent[0]).toEqual({ type: "content", content: "hello" });
    },
  );

  it("logs and rethrows non-abort failures", async () => {
    const failure = new Error("provider exploded");
    mocks.streamGeminiResponse.mockRejectedValue(failure);

    const sent: SSEMessage[] = [];
    const { runtime, logStreamError } = makeRuntime();

    await expect(
      runChatStream({
        ...baseOptions("Google"),
        runtime,
        send: (message) => sent.push(message),
      }),
    ).rejects.toThrow("provider exploded");

    expect(logStreamError).toHaveBeenCalledWith(failure, expect.anything());
    expect(sent).toEqual([]);
  });
});
