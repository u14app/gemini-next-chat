import { describe, expect, it, vi } from "vitest";
import { Stream } from "openai/streaming";

vi.mock("server-only", () => ({}));

import { streamAnthropicMessages } from "../lib/streaming/anthropic";
import { streamGeminiResponse } from "../lib/streaming/gemini";
import {
  streamOpenAIChatCompletions,
  streamOpenAIResponses,
} from "../lib/streaming/openai";
import type { SSEMessage } from "../lib/streaming/sse";

const incompleteProviderStream = {
  name: "IncompleteProviderStreamError",
  code: "INCOMPLETE_PROVIDER_STREAM",
  statusCode: 502,
};

async function* asyncChunks(chunks: unknown[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function openAIChatCompletionSseRequest(
  events: Array<unknown | "[DONE]">,
  chunkSize?: number,
) {
  const body = events
    .map((event) =>
      event === "[DONE]"
        ? "data: [DONE]\n\n"
        : `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  const responseBody = chunkSize
    ? new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (let offset = 0; offset < body.length; offset += chunkSize) {
            controller.enqueue(
              encoder.encode(body.slice(offset, offset + chunkSize)),
            );
          }
          controller.close();
        },
      })
    : body;
  const response = new Response(responseBody, {
    headers: { "content-type": "text/event-stream" },
  });
  const stream = Stream.fromSSEResponse(response, new AbortController());
  const request = Promise.resolve(stream) as Promise<typeof stream> & {
    asResponse: () => Promise<Response>;
  };
  request.asResponse = async () => response;
  return request;
}

function content(messages: SSEMessage[]) {
  return messages
    .filter(
      (message): message is Extract<SSEMessage, { type: "content" }> =>
        message.type === "content",
    )
    .map((message) => message.content)
    .join("");
}

describe("provider stream terminal validation", () => {
  it("accepts an OpenAI Chat Completions finish_reason", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () =>
            asyncChunks([
              { choices: [{ delta: { content: "hello" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ]),
          ),
        },
      },
    };

    await expect(
      streamOpenAIChatCompletions({
        client: client as any,
        model: "gpt-test",
        messages: [],
        onChunk: (message) => messages.push(message),
      }),
    ).resolves.toBeUndefined();
    expect(content(messages)).toBe("hello");
  });

  it("accepts tool_calls as an OpenAI Chat Completions terminal", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () =>
            asyncChunks([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_1",
                          function: {
                            name: "lookup",
                            arguments: '{"q":"test"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [{ delta: {}, finish_reason: "tool_calls" }],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "gpt-test",
      messages: [],
      onChunk: (message) => messages.push(message),
    });

    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolCall: expect.objectContaining({ name: "lookup" }),
      }),
    );
  });

  it("accepts an explicit OpenAI [DONE] sentinel without finish_reason", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(() =>
            openAIChatCompletionSseRequest(
              [{ choices: [{ delta: { content: "hello" } }] }, "[DONE]"],
              3,
            ),
          ),
        },
      },
    };

    await expect(
      streamOpenAIChatCompletions({
        client: client as any,
        model: "gpt-test",
        messages: [],
        onChunk: (message) => messages.push(message),
      }),
    ).resolves.toBeUndefined();
    expect(content(messages)).toBe("hello");
  });

  it("rejects premature OpenAI Chat Completions EOF after preserving content", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(() =>
            openAIChatCompletionSseRequest([
              { choices: [{ delta: { content: "partial" } }] },
            ]),
          ),
        },
      },
    };

    await expect(
      streamOpenAIChatCompletions({
        client: client as any,
        model: "gpt-test",
        messages: [],
        onChunk: (message) => messages.push(message),
      }),
    ).rejects.toMatchObject(incompleteProviderStream);
    expect(content(messages)).toBe("partial");
  });

  it("requires response.completed for OpenAI Responses", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      responses: {
        create: vi.fn(async () =>
          asyncChunks([
            { type: "response.output_text.delta", delta: "hello" },
            { type: "response.completed", response: {} },
          ]),
        ),
      },
    };

    await expect(
      streamOpenAIResponses({
        client: client as any,
        model: "gpt-test",
        input: [],
        onChunk: (message) => messages.push(message),
      }),
    ).resolves.toBeUndefined();
    expect(content(messages)).toBe("hello");
  });

  it("rejects premature OpenAI Responses EOF after preserving content", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      responses: {
        create: vi.fn(async () =>
          asyncChunks([
            { type: "response.output_text.delta", delta: "partial" },
          ]),
        ),
      },
    };

    await expect(
      streamOpenAIResponses({
        client: client as any,
        model: "gpt-test",
        input: [],
        onChunk: (message) => messages.push(message),
      }),
    ).rejects.toMatchObject(incompleteProviderStream);
    expect(content(messages)).toBe("partial");
  });

  it.each([
    ["response.failed", { error: { message: "failed upstream" } }],
    ["response.error", { error: { message: "errored upstream" } }],
    ["error", { message: "generic upstream error" }],
    [
      "response.incomplete",
      { response: { incomplete_details: { reason: "max_output_tokens" } } },
    ],
  ])("rejects the OpenAI Responses %s terminal", async (type, details) => {
    const client = {
      responses: {
        create: vi.fn(async () => asyncChunks([{ type, ...details }])),
      },
    };

    await expect(
      streamOpenAIResponses({
        client: client as any,
        model: "gpt-test",
        input: [],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow(/OpenAI Responses/i);
  });

  it("accepts Anthropic message_stop", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      messages: {
        create: vi.fn(async () =>
          asyncChunks([
            {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "hello" },
            },
            { type: "message_stop" },
          ]),
        ),
      },
    };

    await expect(
      streamAnthropicMessages({
        client: client as any,
        model: "claude-test",
        messages: [],
        onChunk: (message) => messages.push(message),
      }),
    ).resolves.toBeUndefined();
    expect(content(messages)).toBe("hello");
  });

  it("rejects premature Anthropic EOF after preserving content", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      messages: {
        create: vi.fn(async () =>
          asyncChunks([
            {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "partial" },
            },
          ]),
        ),
      },
    };

    await expect(
      streamAnthropicMessages({
        client: client as any,
        model: "claude-test",
        messages: [],
        onChunk: (message) => messages.push(message),
      }),
    ).rejects.toMatchObject(incompleteProviderStream);
    expect(content(messages)).toBe("partial");
  });

  it.each(["STOP", "SAFETY"])(
    "accepts Gemini %s as a valid finishReason",
    async (finishReason) => {
      const client = {
        models: {
          generateContentStream: vi.fn(async () =>
            asyncChunks([{ candidates: [{ finishReason }] }]),
          ),
        },
      };

      await expect(
        streamGeminiResponse({
          client: client as any,
          model: "gemini-test",
          contents: [],
          onChunk: vi.fn(),
        }),
      ).resolves.toBeUndefined();
    },
  );

  it("accepts a terminal Gemini tool call", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      models: {
        generateContentStream: vi.fn(async () =>
          asyncChunks([
            {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: "lookup",
                          args: { q: "test" },
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            },
          ]),
        ),
      },
    };

    await streamGeminiResponse({
      client: client as any,
      model: "gemini-test",
      contents: [],
      onChunk: (message) => messages.push(message),
    });

    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolCall: expect.objectContaining({ name: "lookup" }),
      }),
    );
  });

  it("rejects premature Gemini EOF after preserving content", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      models: {
        generateContentStream: vi.fn(async () =>
          asyncChunks([
            {
              candidates: [{ content: { parts: [{ text: "partial" }] } }],
            },
          ]),
        ),
      },
    };

    await expect(
      streamGeminiResponse({
        client: client as any,
        model: "gemini-test",
        contents: [],
        onChunk: (message) => messages.push(message),
      }),
    ).rejects.toMatchObject(incompleteProviderStream);
    expect(content(messages)).toBe("partial");
  });

  it("rejects an unspecified Gemini finishReason", async () => {
    const client = {
      models: {
        generateContentStream: vi.fn(async () =>
          asyncChunks([
            { candidates: [{ finishReason: "FINISH_REASON_UNSPECIFIED" }] },
          ]),
        ),
      },
    };

    await expect(
      streamGeminiResponse({
        client: client as any,
        model: "gemini-test",
        contents: [],
        onChunk: vi.fn(),
      }),
    ).rejects.toMatchObject(incompleteProviderStream);
  });
});
