import { describe, expect, it } from "vitest";
import {
  API_INPUT_LIMITS,
  ATTACHMENT_LIMITS,
  CHAT_CONFIG_LIMITS,
  PLUGIN_EXECUTION_LIMITS,
} from "../config/limits";
import {
  ChatRequestSchema,
  DocumentParseSchema,
  EncryptedSecretEnvelopeSchema,
  ImageGenerateRequestSchema,
  MessageSchema,
  SearchRequestSchema,
  SimpleGenerateRequestSchema,
  ToolExecutionSchema,
  VoiceSynthesizeRequestSchema,
  VoiceTranscribeRequestSchema,
} from "../lib/api/schemas";

const encryptedSecret = {
  v: 1,
  kid: "test-key",
  alg: "RSA-OAEP-256+A256GCM",
  iv: "iv",
  wrappedKey: "wrapped",
  ciphertext: "ciphertext",
  context: "provider:Gemini",
} as const;

describe("api schemas", () => {
  it("accepts encrypted BYOK envelopes", () => {
    expect(EncryptedSecretEnvelopeSchema.parse(encryptedSecret)).toEqual(
      encryptedSecret,
    );
  });

  it("rejects non-base64url BYOK envelope fields", () => {
    expect(() =>
      EncryptedSecretEnvelopeSchema.parse({
        ...encryptedSecret,
        ciphertext: "not+base64/url=",
      }),
    ).toThrow();
  });

  it("rejects plaintext provider API keys", () => {
    expect(() =>
      ChatRequestSchema.parse({
        provider: { type: "Gemini", apiKey: "test" },
        modelName: "gemini-test",
        history: [],
        newMessage: "hello",
      }),
    ).toThrow(/encrypted BYOK secret/i);
  });

  it("rejects Base64 image attachments in current and historical chat input", () => {
    const image = {
      id: "inline",
      mimeType: "image/png",
      fileName: "inline.png",
      data: "aW1hZ2U=",
    };
    const baseRequest = {
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      history: [],
      newMessage: "describe",
    };

    expect(() =>
      ChatRequestSchema.parse({ ...baseRequest, attachments: [image] }),
    ).toThrow(/uploaded as files/i);
    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        history: [
          {
            role: "user",
            content: "earlier",
            attachments: [image],
          },
        ],
      }),
    ).toThrow(/uploaded as files/i);
    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        attachments: [
          {
            id: "missing",
            mimeType: "image/png",
            fileName: "missing.png",
          },
        ],
      }),
    ).toThrow(/source is required/i);
  });

  it("rejects unknown high-risk request fields", () => {
    expect(() =>
      ChatRequestSchema.parse({
        provider: { type: "Gemini", apiKeySecret: encryptedSecret },
        modelName: "gemini-test",
        history: [],
        newMessage: "hello",
        unexpected: true,
      }),
    ).toThrow();

    expect(() =>
      SearchRequestSchema.parse({
        provider: "tavily",
        query: "hello",
        config: {
          apiKeySecret: { ...encryptedSecret, context: "search:tavily" },
          extra: "field",
        },
      }),
    ).toThrow();
  });

  it("accepts Deep Research independently from Agent mode", () => {
    const parsed = ChatRequestSchema.parse({
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      history: [],
      newMessage: "research this",
      config: {
        useAgentMode: false,
        useDeepResearch: true,
      },
    });

    expect(parsed.config?.useDeepResearch).toBe(true);
    expect(parsed.config?.useAgentMode).toBe(false);
  });

  it("fills legacy tool call status defaults", () => {
    const message = MessageSchema.parse({
      role: "model",
      content: "",
      toolCalls: [
        {
          id: "call_1",
          name: "lookup",
          args: { q: "neo" },
          result: { ok: true },
        },
      ],
    });

    expect(message.id).toBe("");
    expect(message.timestamp).toBe(0);
    expect(message.toolCalls?.[0]?.status).toBe("success");
  });

  it("accepts strict v2 skill invocation metadata in chat history", () => {
    expect(() =>
      ChatRequestSchema.parse({
        provider: { type: "Gemini", apiKeySecret: encryptedSecret },
        modelName: "gemini-test",
        history: [
          {
            role: "model",
            content: "Translated text",
            skillInvocations: [
              {
                id: "translation-localization",
                title: "Translation & Localization",
                description:
                  "Translate and localize text between Chinese and English.",
                category: "writing",
                mode: "manual",
                schemaVersion: 2,
                definitionHash: "fnv1a-1234abcd",
                order: 0,
                parameters: { audience: "operators" },
                bundleId: "launch-brief",
              },
            ],
          },
        ],
        newMessage: "regenerate",
      }),
    ).not.toThrow();
  });

  it("rejects malformed or unknown skill invocation metadata", () => {
    const invocation = {
      id: "translation-localization",
      title: "Translation & Localization",
      category: "writing",
      mode: "auto",
      schemaVersion: 2,
      definitionHash: "fnv1a-1234abcd",
      order: 0,
    };
    const request = {
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      history: [
        {
          role: "model",
          content: "Translated text",
          skillInvocations: [invocation],
        },
      ],
      newMessage: "regenerate",
    };

    expect(() =>
      ChatRequestSchema.parse({
        ...request,
        history: [
          {
            ...request.history[0],
            skillInvocations: [
              { ...invocation, definitionHash: "sha256-not-supported" },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      ChatRequestSchema.parse({
        ...request,
        history: [
          {
            ...request.history[0],
            skillInvocations: [{ ...invocation, unexpected: true }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects native search in the external search route schema", () => {
    expect(() =>
      SearchRequestSchema.parse({
        provider: "google",
        query: "hello",
      }),
    ).toThrow();
  });

  it("rejects chat requests with too much attachment payload", () => {
    const firstPayload = "a".repeat(ATTACHMENT_LIMITS.maxTotalBase64Chars / 2);
    const secondPayload = "b".repeat(
      ATTACHMENT_LIMITS.maxTotalBase64Chars / 2 + 1,
    );

    expect(() =>
      ChatRequestSchema.parse({
        provider: { type: "Gemini", apiKeySecret: encryptedSecret },
        modelName: "gemini-test",
        history: [],
        newMessage: "hello",
        attachments: [
          {
            id: "att_1",
            mimeType: "text/plain",
            fileName: "large-a.txt",
            data: firstPayload,
          },
          {
            id: "att_2",
            mimeType: "text/plain",
            fileName: "large-b.txt",
            data: secondPayload,
          },
        ],
      }),
    ).toThrow(/Attachment payload is too large/i);
  });

  it("rejects chat and image generation attachments over the runtime file limit", () => {
    const originalLimit = process.env.MAX_ATTACHMENT_FILE_BYTES;
    process.env.MAX_ATTACHMENT_FILE_BYTES = "4";
    try {
      expect(() =>
        ChatRequestSchema.parse({
          provider: { type: "Gemini", apiKeySecret: encryptedSecret },
          modelName: "gemini-test",
          history: [],
          newMessage: "hello",
          attachments: [
            {
              id: "att_1",
              mimeType: "text/plain",
              fileName: "large.txt",
              data: "aGVsbG8=",
            },
          ],
        }),
      ).toThrow(/Attachment file is too large/i);

      expect(() =>
        ImageGenerateRequestSchema.parse({
          provider: { type: "OpenAI", apiKeySecret: encryptedSecret },
          modelName: "gpt-image-2",
          prompt: "edit",
          attachments: [
            {
              id: "att_1",
              mimeType: "image/png",
              fileName: "large.png",
              data: "aGVsbG8=",
            },
          ],
        }),
      ).toThrow(/Attachment file is too large/i);
    } finally {
      if (originalLimit === undefined) {
        delete process.env.MAX_ATTACHMENT_FILE_BYTES;
      } else {
        process.env.MAX_ATTACHMENT_FILE_BYTES = originalLimit;
      }
    }
  });

  it("rejects chat requests with oversized model or text fields", () => {
    const baseRequest = {
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      history: [],
      newMessage: "hello",
    };

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        modelName: "m".repeat(API_INPUT_LIMITS.maxModelNameChars + 1),
      }),
    ).toThrow();

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        newMessage: "x".repeat(API_INPUT_LIMITS.maxChatTextChars + 1),
      }),
    ).toThrow();

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        systemInstruction: "x".repeat(
          API_INPUT_LIMITS.maxSystemInstructionChars + 1,
        ),
      }),
    ).toThrow();
  });

  it("rejects chat requests with out-of-range temperature", () => {
    const baseRequest = {
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      history: [],
      newMessage: "hello",
    };

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        config: { temperature: CHAT_CONFIG_LIMITS.maxTemperature + 1 },
      }),
    ).toThrow();

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        config: { temperature: CHAT_CONFIG_LIMITS.maxTemperature },
      }),
    ).not.toThrow();
  });

  it("accepts supported chat reasoning modes and rejects unsupported values", () => {
    const baseRequest = {
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      history: [],
      newMessage: "hello",
    };

    expect(
      ChatRequestSchema.parse({
        ...baseRequest,
        config: {
          reasoningMode: "auto",
          imageCount: 3,
          useAgentMode: true,
        },
      }),
    ).toMatchObject({
      config: {
        reasoningMode: "auto",
        imageCount: 3,
        useAgentMode: true,
      },
    });

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        config: { reasoningMode: "xhigh" },
      }),
    ).toThrow();

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        config: { imageCount: 5 },
      }),
    ).toThrow();

    expect(() =>
      ChatRequestSchema.parse({
        ...baseRequest,
        config: { useAgentMode: "yes" },
      }),
    ).toThrow();
  });

  it("accepts file-upload image descriptors and private HTTPS edit attachments", () => {
    const baseRequest = {
      provider: { type: "OpenAI", apiKeySecret: encryptedSecret },
      modelName: "gpt-image-2",
      prompt: "make three variants",
    };

    expect(
      ImageGenerateRequestSchema.parse({
        ...baseRequest,
        imageCount: 4,
        attachments: [
          {
            id: "att_1",
            mimeType: "image/png",
            fileName: "source.png",
            uploadId: "image-0",
          },
        ],
      }),
    ).toMatchObject({ imageCount: 4 });

    expect(() =>
      ImageGenerateRequestSchema.parse({
        ...baseRequest,
        attachments: [
          {
            id: "legacy-inline",
            mimeType: "image/png",
            fileName: "inline.png",
            data: "abc",
          },
        ],
      }),
    ).toThrow(/uploaded as files/i);

    expect(() =>
      ImageGenerateRequestSchema.parse({
        ...baseRequest,
        imageCount: 5,
      }),
    ).toThrow();

    expect(
      ImageGenerateRequestSchema.parse({
        ...baseRequest,
        attachments: [
          {
            id: "att_2",
            mimeType: "image/png",
            fileName: "blocked.png",
            url: "https://127.0.0.1/private.png",
          },
        ],
      }),
    ).toMatchObject({
      attachments: [{ url: "https://127.0.0.1/private.png" }],
    });

    expect(() =>
      ImageGenerateRequestSchema.parse({
        ...baseRequest,
        attachments: [
          {
            id: "att_3",
            mimeType: "image/png",
            fileName: "insecure.png",
            url: "http://127.0.0.1/private.png",
          },
        ],
      }),
    ).toThrow(/Only HTTPS/i);
  });

  it("rejects simple generation requests with oversized model or prompt fields", () => {
    const baseRequest = {
      provider: { type: "Gemini", apiKeySecret: encryptedSecret },
      modelName: "gemini-test",
      prompt: "hello",
    };

    expect(() =>
      SimpleGenerateRequestSchema.parse({
        ...baseRequest,
        modelName: "m".repeat(API_INPUT_LIMITS.maxModelNameChars + 1),
      }),
    ).toThrow();

    expect(() =>
      SimpleGenerateRequestSchema.parse({
        ...baseRequest,
        prompt: "x".repeat(API_INPUT_LIMITS.maxSimplePromptChars + 1),
      }),
    ).toThrow();
  });

  it("accepts HTTPS private-network attachment URLs on chat requests", () => {
    expect(
      ChatRequestSchema.parse({
        provider: { type: "Gemini", apiKeySecret: encryptedSecret },
        modelName: "gemini-test",
        history: [],
        newMessage: "read this",
        attachments: [
          {
            id: "att_1",
            mimeType: "text/plain",
            fileName: "local.txt",
            url: "https://127.0.0.1:8443/local.txt",
          },
        ],
      }),
    ).toMatchObject({
      attachments: [{ url: "https://127.0.0.1:8443/local.txt" }],
    });
  });

  it("requires a voice ID for ElevenLabs speech synthesis requests", () => {
    expect(() =>
      VoiceSynthesizeRequestSchema.parse({
        provider: "elevenlabs",
        apiKeySecret: { ...encryptedSecret, context: "voice:elevenlabs" },
        text: "hello",
      }),
    ).toThrow(/voice ID is required/i);

    expect(() =>
      VoiceSynthesizeRequestSchema.parse({
        provider: "browser",
        text: "hello",
      }),
    ).not.toThrow();
  });

  it("accepts Mimo speech provider requests", () => {
    expect(() =>
      VoiceSynthesizeRequestSchema.parse({
        provider: "mimo",
        apiKeySecret: { ...encryptedSecret, context: "voice:mimo" },
        text: "hello",
        voiceId: "mimo_default",
      }),
    ).not.toThrow();

    expect(() =>
      VoiceTranscribeRequestSchema.parse({
        provider: "mimo",
        apiKeySecret: { ...encryptedSecret, context: "voice:mimo" },
        modelId: "mimo-v2.5-asr",
        language: "ja",
      }),
    ).not.toThrow();
  });

  it("rejects plaintext document parse API keys", () => {
    expect(() =>
      DocumentParseSchema.parse({
        file: new File(["hello"], "doc.txt", { type: "text/plain" }),
        apiKeySecret: { ...encryptedSecret, context: "docs:llama-parse" },
        apiKey: "test",
      }),
    ).toThrow(/encrypted BYOK secret/i);
  });

  it("rejects plaintext voice transcription API keys", () => {
    expect(() =>
      VoiceTranscribeRequestSchema.parse({
        provider: "elevenlabs",
        apiKeySecret: { ...encryptedSecret, context: "voice:elevenlabs" },
        apiKey: "test",
      }),
    ).toThrow(/encrypted BYOK secret/i);
  });

  it("rejects oversized plugin execution arguments", () => {
    expect(() =>
      ToolExecutionSchema.parse({
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          functions: [
            {
              name: "lookup",
              path: "/lookup",
              method: "GET",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
        functionDef: {
          name: "lookup",
          path: "/lookup",
          method: "GET",
          parameters: { type: "object", properties: {} },
        },
        args: {
          q: "x".repeat(PLUGIN_EXECUTION_LIMITS.maxArgsJsonChars + 1),
        },
      }),
    ).toThrow(/too large/i);
  });

  it("rejects plaintext plugin auth values", () => {
    expect(() =>
      ToolExecutionSchema.parse({
        plugin: {
          id: "test-plugin",
          baseUrl: "https://api.example.com",
          auth: { type: "apiKey" },
          functions: [
            {
              name: "lookup",
              path: "/lookup",
              method: "GET",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
        functionDef: {
          name: "lookup",
          path: "/lookup",
          method: "GET",
          parameters: { type: "object", properties: {} },
        },
        args: { q: "neo" },
        authConfig: { type: "apiKey", value: "secret" },
      }),
    ).toThrow(/encrypted BYOK secret/i);
  });
});
