import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PLUGIN_EXECUTION_LIMITS } from "../config/limits";
import { streamAnthropicMessages } from "../lib/streaming/anthropic";
import { streamGeminiResponse } from "../lib/streaming/gemini";
import {
  streamOpenAIChatCompletions,
  streamOpenAIResponse,
  streamOpenAIResponses,
} from "../lib/streaming/openai";
import type { SSEMessage } from "../lib/streaming/sse";

const responseFormat = {
  name: "research_wave",
  schema: {
    type: "object",
    properties: { packets: { type: "array" } },
    required: ["packets"],
    additionalProperties: false,
  },
  strict: true,
} as const;

async function* asyncChunks(chunks: unknown[]) {
  for (const chunk of chunks) {
    yield chunk;
  }

  // This file shares one success-stream helper across all provider adapters.
  // Emit each provider's semantic terminal so every fixture represents a
  // completed upstream stream rather than a premature EOF.
  yield { choices: [{ delta: {}, finish_reason: "stop" }] };
  yield { type: "response.completed", response: {} };
  yield { type: "message_stop" };
  yield { candidates: [{ finishReason: "STOP" }] };
}

function toolCallMessages(messages: SSEMessage[]) {
  return messages.filter(
    (message): message is Extract<SSEMessage, { type: "tool_call" }> =>
      message.type === "tool_call",
  );
}

function reasoningMessages(messages: SSEMessage[]) {
  return messages.filter(
    (message): message is Extract<SSEMessage, { type: "reasoning" }> =>
      message.type === "reasoning",
  );
}

function contentMessages(messages: SSEMessage[]) {
  return messages.filter(
    (message): message is Extract<SSEMessage, { type: "content" }> =>
      message.type === "content",
  );
}

function searchMessages(messages: SSEMessage[]) {
  return messages.filter(
    (message): message is Extract<SSEMessage, { type: "search" }> =>
      message.type === "search",
  );
}

describe("streamed tool-call normalization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps OpenAI provider indexes to a dense bounded tool-call list", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(async (request: any) => {
            void request;
            return asyncChunks([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 1_000_000,
                          id: "call_large_index",
                          function: {
                            name: "lookup",
                            arguments: '{"q":"neo"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ]);
          }),
        },
      },
    };

    await streamOpenAIResponse({
      client: client as any,
      model: "gpt-test",
      messages: [],
      onChunk: (message) => messages.push(message),
    });

    const calls = toolCallMessages(messages);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolCall).toMatchObject({
      id: "call_large_index",
      name: "lookup",
      args: { q: "neo" },
      status: "pending",
    });
  });

  it("keeps the streamed tool-call ceiling high but bounded", async () => {
    expect(PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls).toBe(100);
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
                      tool_calls: Array.from(
                        {
                          length:
                            PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls + 2,
                        },
                        (_, index) => ({
                          index,
                          id: `call_${index}`,
                          function: {
                            name: "lookup",
                            arguments: `{"q":"${index}"}`,
                          },
                        }),
                      ),
                    },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIResponse({
      client: client as any,
      model: "gpt-test",
      messages: [],
      onChunk: (message) => messages.push(message),
    });

    expect(toolCallMessages(messages)).toHaveLength(
      PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls,
    );
  });

  it("emits oversized or invalid OpenAI tool arguments as completed errors", async () => {
    const messages: SSEMessage[] = [];
    const oversizedArgs = `{"q":"${"x".repeat(
      PLUGIN_EXECUTION_LIMITS.maxArgsJsonChars,
    )}"}`;
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
                          id: "call_big",
                          function: {
                            name: "lookup",
                            arguments: oversizedArgs,
                          },
                        },
                        {
                          index: 1,
                          id: "call_bad_json",
                          function: {
                            name: "lookup",
                            arguments: '{"q":',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIResponse({
      client: client as any,
      model: "gpt-test",
      messages: [],
      onChunk: (message) => messages.push(message),
    });

    const calls = toolCallMessages(messages);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolCall).toMatchObject({
      id: "call_big",
      status: "error",
      isError: true,
    });
    expect(String(calls[0].toolCall.result)).toMatch(/too large/i);
    expect(calls[1].toolCall).toMatchObject({
      id: "call_bad_json",
      status: "error",
      isError: true,
    });
    expect(String(calls[1].toolCall.result)).toMatch(/valid JSON/i);
  });

  it("streams OpenAI Responses API text, usage, and function calls", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      responses: {
        create: vi.fn(async () =>
          asyncChunks([
            { type: "response.output_text.delta", delta: "Hello" },
            {
              type: "response.output_item.done",
              item: {
                type: "function_call",
                call_id: "call_lookup",
                name: "lookup",
                arguments: '{"q":"neo"}',
              },
            },
            {
              type: "response.completed",
              response: {
                usage: {
                  input_tokens: 3,
                  output_tokens: 5,
                  total_tokens: 8,
                },
              },
            },
          ]),
        ),
      },
    };

    await streamOpenAIResponses({
      client: client as any,
      model: "gpt-test",
      input: [],
      onChunk: (message) => messages.push(message),
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        { type: "content", content: "Hello" },
        {
          type: "usage",
          usage: {
            prompt_tokens: 3,
            completion_tokens: 5,
            total_tokens: 8,
          },
        },
      ]),
    );
    expect(toolCallMessages(messages)[0].toolCall).toMatchObject({
      id: "call_lookup",
      name: "lookup",
      args: { q: "neo" },
      status: "pending",
    });
    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test",
        stream: true,
      }),
    );
    const request = (client.responses.create as any).mock.calls[0][0];
    expect(request).not.toHaveProperty("text");
  });

  it("maps structured output to OpenAI Responses text.format", async () => {
    const client = {
      responses: {
        create: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamOpenAIResponses({
      client: client as any,
      model: "gpt-test",
      input: [],
      responseFormat,
      onChunk: () => undefined,
    });

    const request = (client.responses.create as any).mock.calls[0][0];
    expect(request.text).toEqual({
      format: {
        type: "json_schema",
        name: responseFormat.name,
        schema: responseFormat.schema,
        strict: true,
      },
    });
  });

  it("keeps chat completions available for OpenAI Compatible providers", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () =>
            asyncChunks([
              {
                choices: [
                  {
                    delta: { content: "Compat" },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "compat-model",
      messages: [],
      tools: [],
      onChunk: (message) => messages.push(message),
    });

    expect(messages).toContainEqual({ type: "content", content: "Compat" });
    const request = (client.chat.completions.create as any).mock.calls[0][0];
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("response_format");
  });

  it("maps structured output to OpenAI Compatible response_format", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => asyncChunks([])),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "compat-model",
      messages: [],
      responseFormat,
      onChunk: () => undefined,
    });

    const request = (client.chat.completions.create as any).mock.calls[0][0];
    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: responseFormat.name,
        schema: responseFormat.schema,
        strict: true,
      },
    });
  });

  it("uses a conservative OpenAI Compatible chat request shape", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () =>
            asyncChunks([
              {
                choices: [
                  {
                    delta: { content: "Compat" },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "mimo-v2.5-free",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
        {
          role: "assistant",
          content: "Hi",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/image.png" },
            },
          ],
        },
      ],
      onChunk: (message) => messages.push(message),
    });

    const request = (client.chat.completions.create as any).mock.calls[0][0];
    expect(request).not.toHaveProperty("stream_options");
    expect(request.messages[0]).toEqual({
      role: "user",
      content: "Hello",
    });
    expect(request.messages[1]).toEqual({
      role: "assistant",
      content: "Hi",
    });
    expect(request.messages[2].content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Describe this" },
        expect.objectContaining({ type: "image_url" }),
      ]),
    );
  });

  it("suppresses OpenAI Compatible reasoning deltas when reasoning is disabled", async () => {
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
                      reasoning_content: "Hidden chain. ",
                      content: "Answer",
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      reasoning: "More hidden reasoning.",
                    },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "compat-model",
      messages: [],
      useReasoning: false,
      onChunk: (message) => messages.push(message),
    });

    expect(reasoningMessages(messages)).toEqual([]);
    expect(messages).toContainEqual({ type: "content", content: "Answer" });
  });

  it("streams OpenAI Compatible reasoning deltas when reasoning is enabled", async () => {
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
                      reasoning_content: "Consider freshness. ",
                      content: "Answer",
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      reasoning: "Check sources.",
                    },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "compat-model",
      messages: [],
      reasoningMode: "high",
      onChunk: (message) => messages.push(message),
    });

    const request = (client.chat.completions.create as any).mock.calls[0][0];
    expect(request.reasoning_effort).toBe("high");
    expect(
      reasoningMessages(messages).map((message) => message.content),
    ).toEqual(["Consider freshness. ", "Check sources."]);
    expect(messages).toContainEqual({ type: "content", content: "Answer" });
  });

  it("maps OpenAI Compatible reasoning modes to reasoning_effort only for explicit strengths", async () => {
    const makeClient = () => ({
      chat: {
        completions: {
          create: vi.fn(async () => asyncChunks([])),
        },
      },
    });
    const lowClient = makeClient();
    const autoClient = makeClient();
    const offClient = makeClient();

    await streamOpenAIChatCompletions({
      client: lowClient as any,
      model: "compat-model",
      messages: [],
      reasoningMode: "low",
      onChunk: () => undefined,
    });
    await streamOpenAIChatCompletions({
      client: autoClient as any,
      model: "compat-model",
      messages: [],
      reasoningMode: "auto",
      onChunk: () => undefined,
    });
    await streamOpenAIChatCompletions({
      client: offClient as any,
      model: "compat-model",
      messages: [],
      reasoningMode: "off",
      onChunk: () => undefined,
    });

    expect(
      (lowClient.chat.completions.create as any).mock.calls[0][0]
        .reasoning_effort,
    ).toBe("low");
    expect(
      (autoClient.chat.completions.create as any).mock.calls[0][0],
    ).not.toHaveProperty("reasoning_effort");
    expect(
      (offClient.chat.completions.create as any).mock.calls[0][0],
    ).not.toHaveProperty("reasoning_effort");
  });

  it("separates DeepSeek think tags from visible OpenAI Compatible content", async () => {
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
                      content:
                        "Intro <think>Check contrast.</think> Final answer.",
                    },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "deepseek-reasoner",
      messages: [],
      useReasoning: true,
      onChunk: (message) => messages.push(message),
    });

    expect(
      reasoningMessages(messages).map((message) => message.content),
    ).toEqual(["Check contrast."]);
    expect(
      contentMessages(messages)
        .map((message) => message.content)
        .join(""),
    ).toBe("Intro  Final answer.");
  });

  it("handles DeepSeek think tags split across OpenAI Compatible chunks", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () =>
            asyncChunks([
              { choices: [{ delta: { content: "Start <thi" } }] },
              { choices: [{ delta: { content: "nk>Step one. " } }] },
              { choices: [{ delta: { content: "Step two.</th" } }] },
              { choices: [{ delta: { content: "ink> Done." } }] },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "deepseek-reasoner",
      messages: [],
      useReasoning: true,
      onChunk: (message) => messages.push(message),
    });

    expect(
      reasoningMessages(messages)
        .map((message) => message.content)
        .join(""),
    ).toBe("Step one. Step two.");
    expect(
      contentMessages(messages)
        .map((message) => message.content)
        .join(""),
    ).toBe("Start  Done.");
  });

  it("strips DeepSeek think tags from visible content when reasoning is disabled", async () => {
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
                      content: "<think>Hidden chain.</think>Answer",
                    },
                  },
                ],
              },
            ]),
          ),
        },
      },
    };

    await streamOpenAIChatCompletions({
      client: client as any,
      model: "deepseek-reasoner",
      messages: [],
      useReasoning: false,
      onChunk: (message) => messages.push(message),
    });

    expect(reasoningMessages(messages)).toEqual([]);
    expect(
      contentMessages(messages)
        .map((message) => message.content)
        .join(""),
    ).toBe("Answer");
  });

  it("suppresses OpenAI Responses reasoning events when reasoning is disabled", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      responses: {
        create: vi.fn(async () =>
          asyncChunks([
            {
              type: "response.reasoning_summary_text.delta",
              delta: "Hidden summary.",
            },
            {
              type: "response.output_item.done",
              item: {
                type: "reasoning",
                summary: [{ type: "summary_text", text: "Hidden item." }],
              },
            },
            {
              type: "response.output_text.delta",
              delta: "Visible answer",
            },
          ]),
        ),
      },
    };

    await streamOpenAIResponses({
      client: client as any,
      model: "gpt-test",
      input: [],
      useReasoning: false,
      onChunk: (message) => messages.push(message),
    });

    expect(reasoningMessages(messages)).toEqual([]);
    expect(messages).toContainEqual({
      type: "content",
      content: "Visible answer",
    });
  });

  it("requests OpenAI Responses reasoning summaries and native web search", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      responses: {
        create: vi.fn(async () =>
          asyncChunks([
            {
              type: "response.output_item.done",
              item: {
                type: "web_search_call",
                id: "ws_1",
                status: "completed",
                action: {
                  type: "search",
                  queries: ["neo chat"],
                  sources: [{ type: "url", url: "https://example.com/a" }],
                },
              },
            },
            {
              type: "response.output_item.done",
              item: {
                type: "reasoning",
                summary: [{ type: "summary_text", text: "Need current info." }],
              },
            },
            {
              type: "response.output_item.done",
              item: {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "Result",
                    annotations: [
                      {
                        type: "url_citation",
                        title: "Example B",
                        url: "https://example.com/b",
                      },
                    ],
                  },
                ],
              },
            },
          ]),
        ),
      },
    };

    await streamOpenAIResponses({
      client: client as any,
      model: "gpt-test",
      input: [],
      reasoningMode: "high",
      enableWebSearch: true,
      onChunk: (message) => messages.push(message),
    });

    const request = (client.responses.create as any).mock.calls[0][0];
    expect(request.reasoning).toMatchObject({
      effort: "high",
      summary: "auto",
    });
    expect(request.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "web_search_preview" }),
      ]),
    );
    expect(request.include).toEqual(
      expect.arrayContaining([
        "web_search_call.results",
        "web_search_call.action.sources",
      ]),
    );
    expect(
      reasoningMessages(messages).map((message) => message.content),
    ).toEqual(["Need current info."]);
    expect(
      searchMessages(messages).flatMap(
        (message) => message.results?.sources || [],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://example.com/a" }),
        expect.objectContaining({ url: "https://example.com/b" }),
      ]),
    );
  });

  it("requests OpenAI Responses reasoning summaries without effort in auto mode", async () => {
    const client = {
      responses: {
        create: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamOpenAIResponses({
      client: client as any,
      model: "gpt-test",
      input: [],
      reasoningMode: "auto",
      onChunk: () => undefined,
    });

    const request = (client.responses.create as any).mock.calls[0][0];
    expect(request.reasoning).toEqual({ summary: "auto" });
  });

  it("streams Anthropic Messages API text, usage, and tool calls via the official SDK surface", async () => {
    const messages: SSEMessage[] = [];
    const client = {
      messages: {
        create: vi.fn(async () =>
          asyncChunks([
            {
              type: "message_start",
              message: {
                usage: { input_tokens: 7, output_tokens: 0 },
              },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Hello" },
            },
            {
              type: "content_block_start",
              index: 1,
              content_block: {
                type: "tool_use",
                id: "toolu_lookup",
                name: "lookup",
                input: {},
              },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: {
                type: "input_json_delta",
                partial_json: '{"q":"neo"}',
              },
            },
            {
              type: "content_block_stop",
              index: 1,
            },
            {
              type: "message_delta",
              usage: { output_tokens: 5 },
            },
            { type: "ping" },
            { type: "message_stop" },
          ]),
        ),
      },
    };

    await streamAnthropicMessages({
      client: client as any,
      model: "claude-test",
      messages: [{ role: "user", content: "Hello" }],
      onChunk: (message) => messages.push(message),
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        { type: "content", content: "Hello" },
        {
          type: "usage",
          usage: {
            prompt_tokens: 7,
            completion_tokens: 5,
            total_tokens: 12,
          },
        },
      ]),
    );
    expect(toolCallMessages(messages)[0].toolCall).toMatchObject({
      id: "toolu_lookup",
      name: "lookup",
      args: { q: "neo" },
      status: "pending",
    });
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-test",
        max_tokens: 4096,
        stream: true,
      }),
    );
    const request = (client.messages.create as any).mock.calls[0][0];
    expect(request).not.toHaveProperty("output_config");
  });

  it("maps structured output to Anthropic output_config.format", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamAnthropicMessages({
      client: client as any,
      model: "claude-test",
      messages: [{ role: "user", content: "Archive" }],
      responseFormat,
      onChunk: () => undefined,
    });

    const request = (client.messages.create as any).mock.calls[0][0];
    expect(request.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: responseFormat.schema,
      },
    });
  });

  it("requests Anthropic adaptive thinking in auto reasoning mode", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamAnthropicMessages({
      client: client as any,
      model: "claude-test",
      messages: [{ role: "user", content: "Think" }],
      reasoningMode: "auto",
      onChunk: () => undefined,
    });

    const request = (client.messages.create as any).mock.calls[0][0];
    expect(request.thinking).toEqual({ type: "adaptive" });
  });

  it("uses the Anthropic beta Messages client for file references", async () => {
    const stableCreate = vi.fn();
    const betaCreate = vi.fn(async () => asyncChunks([]));
    const client = {
      messages: { create: stableCreate },
      beta: { messages: { create: betaCreate } },
    };

    await streamAnthropicMessages({
      client: client as any,
      model: "claude-test",
      messages: [{ role: "user", content: "Describe the file" }],
      betas: ["files-api-2025-04-14"],
      onChunk: () => undefined,
    });

    expect(stableCreate).not.toHaveBeenCalled();
    expect(betaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        betas: ["files-api-2025-04-14"],
      }),
    );
  });

  it("maps Anthropic explicit reasoning modes to thinking budgets", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamAnthropicMessages({
      client: client as any,
      model: "claude-test",
      messages: [{ role: "user", content: "Think harder" }],
      reasoningMode: "high",
      temperature: 0.2,
      onChunk: () => undefined,
    });

    const request = (client.messages.create as any).mock.calls[0][0];
    expect(request.thinking).toEqual({
      type: "enabled",
      budget_tokens: 3072,
    });
    expect(request).not.toHaveProperty("temperature");
  });

  it("normalizes Gemini tool calls with unique IDs and argument errors", async () => {
    const messages: SSEMessage[] = [];
    vi.spyOn(Date, "now").mockReturnValue(123);
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
                          args: { q: "neo" },
                        },
                      },
                      {
                        functionCall: {
                          name: "lookup",
                          args: "not-an-object",
                        },
                      },
                    ],
                  },
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

    const calls = toolCallMessages(messages);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.toolCall.id)).toEqual([
      "call_123_0",
      "call_123_1",
    ]);
    expect(calls[0].toolCall).toMatchObject({
      name: "lookup",
      args: { q: "neo" },
      status: "pending",
    });
    expect(calls[1].toolCall).toMatchObject({
      name: "lookup",
      status: "error",
      isError: true,
    });
    expect(String(calls[1].toolCall.result)).toMatch(/JSON object/i);
    const request = (client.models.generateContentStream as any).mock
      .calls[0][0];
    expect(request.config).not.toHaveProperty("responseMimeType");
    expect(request.config).not.toHaveProperty("responseJsonSchema");
  });

  it("maps structured output to Gemini JSON response config", async () => {
    const client = {
      models: {
        generateContentStream: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamGeminiResponse({
      client: client as any,
      model: "gemini-test",
      contents: [],
      responseFormat,
      onChunk: () => undefined,
    });

    const request = (client.models.generateContentStream as any).mock
      .calls[0][0];
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toEqual(responseFormat.schema);
  });

  it("suppresses Gemini thought parts when reasoning is disabled", async () => {
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
                      { thought: true, text: "Hidden thought. " },
                      { text: "Answer" },
                    ],
                  },
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
      reasoningMode: "off",
      onChunk: (message) => messages.push(message),
    });

    expect(reasoningMessages(messages)).toEqual([]);
    expect(messages).toContainEqual({ type: "content", content: "Answer" });
  });

  it("streams Gemini thought parts and grounding metadata as reasoning and search", async () => {
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
                      { thought: true, text: "I should search. " },
                      { text: "Answer" },
                    ],
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: { uri: "https://example.com/g", title: "Gemini" },
                      },
                    ],
                    groundingSupports: [
                      { segment: { text: "Grounded snippet" } },
                    ],
                  },
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
      reasoningMode: "auto",
      onChunk: (message) => messages.push(message),
    });

    const request = (client.models.generateContentStream as any).mock
      .calls[0][0];
    expect(request.config.thinkingConfig).toEqual({ includeThoughts: true });
    expect(
      reasoningMessages(messages).map((message) => message.content),
    ).toEqual(["I should search. "]);
    expect(messages).toContainEqual({ type: "content", content: "Answer" });
    expect(searchMessages(messages)[0].results?.sources).toEqual([
      expect.objectContaining({
        title: "Gemini",
        url: "https://example.com/g",
        content: "Grounded snippet",
      }),
    ]);
  });

  it("maps Gemini 2.5 reasoning modes to thinking budgets", async () => {
    const client = {
      models: {
        generateContentStream: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamGeminiResponse({
      client: client as any,
      model: "gemini-2.5-flash",
      contents: [],
      reasoningMode: "medium",
      onChunk: () => undefined,
    });

    const request = (client.models.generateContentStream as any).mock
      .calls[0][0];
    expect(request.config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 8192,
    });
  });

  it("maps Gemini 3 reasoning modes to thinking levels", async () => {
    const client = {
      models: {
        generateContentStream: vi.fn(async () => asyncChunks([])),
      },
    };

    await streamGeminiResponse({
      client: client as any,
      model: "gemini-3-flash-preview",
      contents: [],
      reasoningMode: "low",
      onChunk: () => undefined,
    });

    const request = (client.models.generateContentStream as any).mock
      .calls[0][0];
    expect(request.config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: "LOW",
    });
  });

  it("passes AbortSignal through every provider SDK streaming request", async () => {
    const controller = new AbortController();
    const openAIChatCreate = vi.fn(async () => asyncChunks([]));
    const openAIResponsesCreate = vi.fn(async () => asyncChunks([]));
    const anthropicCreate = vi.fn(async () => asyncChunks([]));
    const geminiGenerate = vi.fn(async () => asyncChunks([]));

    await streamOpenAIChatCompletions({
      client: {
        chat: { completions: { create: openAIChatCreate } },
      } as any,
      model: "gpt-test",
      messages: [],
      signal: controller.signal,
      onChunk: () => undefined,
    });
    await streamOpenAIResponses({
      client: { responses: { create: openAIResponsesCreate } } as any,
      model: "gpt-test",
      input: [],
      signal: controller.signal,
      onChunk: () => undefined,
    });
    await streamAnthropicMessages({
      client: { messages: { create: anthropicCreate } } as any,
      model: "claude-test",
      messages: [],
      signal: controller.signal,
      onChunk: () => undefined,
    });
    await streamGeminiResponse({
      client: { models: { generateContentStream: geminiGenerate } } as any,
      model: "gemini-test",
      contents: [],
      signal: controller.signal,
      onChunk: () => undefined,
    });

    expect(openAIChatCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(openAIResponsesCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(geminiGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ abortSignal: controller.signal }),
      }),
    );
  });
});
