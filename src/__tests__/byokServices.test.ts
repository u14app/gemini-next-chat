import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "../types";

const mocks = vi.hoisted(() => ({
  coreGetState: vi.fn(),
  getTaskModel: vi.fn(),
  settingsGetState: vi.fn(),
  getImageCompressionConfig: vi.fn(),
  compressImageAttachments: vi.fn(),
  prepareGeneratedImageAttachments: vi.fn(),
  createBrowserGoogleClient: vi.fn(),
  createDisposableAudioFromBlob: vi.fn(),
}));

vi.mock("@/store/core/coreSettingsStore", () => ({
  useCoreSettingsStore: {
    getState: mocks.coreGetState,
  },
}));

vi.mock("@/store/core/settingsStore", () => ({
  getTaskModel: mocks.getTaskModel,
  useSettingsStore: {
    getState: mocks.settingsGetState,
  },
}));

vi.mock("@/store/core/memoryStore", () => ({
  useMemoryStore: {
    getState: () => ({
      settings: {
        enabled: false,
        searchEnabled: false,
        autoRecordEnabled: false,
        dreamEnabled: false,
        triggerCount: 100,
        targetCount: 50,
      },
      memories: [],
      markMemoriesUsed: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/utils/imageCompression", () => ({
  compressImageAttachments: mocks.compressImageAttachments,
  getImageCompressionConfig: mocks.getImageCompressionConfig,
  prepareGeneratedImageAttachments: mocks.prepareGeneratedImageAttachments,
}));

vi.mock("@/utils/pluginUtils", () => ({
  executePluginFunction: vi.fn(),
}));

vi.mock("@/lib/plugin/resolve", () => ({
  getEnabledPluginFunctions: vi.fn(() => []),
}));

vi.mock("@/lib/utils/model", async () => vi.importActual("../lib/utils/model"));

vi.mock("@/lib/chat/entities", async () =>
  vi.importActual("../lib/chat/entities"),
);

vi.mock("@/lib/utils/chatInput", () => ({
  appendContextToChatInput: vi.fn((input) => input),
  clampChatInputText: vi.fn((value) => value),
}));

vi.mock("@/lib/settings/searchRag", () => ({
  getSearchCompatibility: vi.fn(() => ({ enabled: true, mode: "none" })),
  resolveEffectiveSearchCapability: vi.fn(() => ({
    enabled: true,
    mode: "none",
  })),
  getSearchCompatibilityErrorMessage: vi.fn(() => "Search is unavailable"),
}));

vi.mock("@/lib/utils/contextCompression", () => ({
  buildCompressionSource: vi.fn(() => ({
    text: "",
    includedMemoryIds: [],
  })),
  createContextCompressionSummaryPrompt: vi.fn(() => ""),
  mergeCompressedContent: vi.fn((value) => value),
  normalizeCompressedContent: vi.fn((value) => value),
  textToBase64: vi.fn((value) => value),
}));

vi.mock("@/lib/utils/disposableAudio", () => ({
  createDisposableAudioFromBlob: mocks.createDisposableAudioFromBlob,
}));

vi.mock("@/lib/providers/browserClients", () => ({
  createBrowserOpenAIClient: vi.fn(),
  createBrowserAnthropicClient: vi.fn(),
  createBrowserGoogleClient: mocks.createBrowserGoogleClient,
}));

vi.mock("@/lib/utils/voiceModels", async () =>
  vi.importActual("../lib/utils/voiceModels"),
);

vi.mock("../lib/api/client", async () => {
  const actual = await vi.importActual("../lib/api/client");
  return {
    ...actual,
    signedApiFetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init),
    ),
  };
});

const providerWithoutLocalKey: ModelProvider = {
  id: "env-provider",
  name: "Env Gemini",
  type: "Google",
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKey: "",
  enabled: true,
  models: ["gemini-title", "audio-model"],
  modelsList: ["gemini-title", "audio-model"],
};

function getJsonRequestBody(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  return JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body));
}

describe("BYOK service requests", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.coreGetState.mockReturnValue({
      providers: [providerWithoutLocalKey],
    });
    mocks.getTaskModel.mockReturnValue("env-provider:gemini-title");
    mocks.settingsGetState.mockReturnValue({
      search: {
        provider: "google",
        configs: {},
        resultsLimit: 5,
      },
    });
    mocks.getImageCompressionConfig.mockReturnValue({
      enabled: true,
      maxSizeMB: 1,
      maxWidthOrHeight: 1024,
    });
    mocks.compressImageAttachments.mockImplementation(
      async (attachments) => attachments,
    );
    mocks.prepareGeneratedImageAttachments.mockImplementation(
      async (attachments) => attachments,
    );
  });

  it("keeps direct code simulation and model voice requests off the server", async () => {
    const directProvider: ModelProvider = {
      ...providerWithoutLocalKey,
      apiKey: "local-key",
      directCall: true,
    };
    mocks.coreGetState.mockReturnValue({ providers: [directProvider] });

    const generateContent = vi.fn(async (request: any) => {
      if (request.config?.tools) {
        return {
          candidates: [
            {
              content: {
                parts: [
                  { codeExecutionResult: { output: "direct-code-output" } },
                ],
              },
            },
          ],
        };
      }
      if (request.config?.responseModalities) {
        return {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { data: "AQI=" } }],
              },
            },
          ],
        };
      }
      return { text: "direct-transcript" };
    });
    mocks.createBrowserGoogleClient.mockReturnValue({
      models: { generateContent },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const { executeCode } = await import("../services/api/chatService");
    const { synthesizeSpeech, transcribeAudio } =
      await import("../services/api/voiceService");

    await expect(
      executeCode("env-provider:gemini-title", "print('hi')"),
    ).resolves.toBe("direct-code-output");
    await expect(
      transcribeAudio(new Blob(["audio"], { type: "audio/webm" }), {
        sttProvider: "model",
        sttModel: "env-provider:audio-model",
        sttLanguage: "auto",
      } as any),
    ).resolves.toBe("direct-transcript");
    await synthesizeSpeech("hello", {
      ttsProvider: "model",
      ttsModel: "env-provider:audio-model",
    } as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(mocks.createDisposableAudioFromBlob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "audio/wav" }),
    );
  });

  it("allows chat helper calls to use server env fallback without sending apiKey", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ title: "Generated title" }));
    const { generateChatTitle } = await import("../services/api/chatService");

    await expect(
      generateChatTitle([
        {
          id: "msg-1",
          role: "user",
          content: "hello",
          timestamp: 0,
        },
      ]),
    ).resolves.toBe("Generated title");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/generate-title",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.provider).toMatchObject({
      type: "Google",
      name: "Env Gemini",
    });
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });

  it("allows auxiliary provider helpers to use server env fallback", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ output: "ok" }))
      .mockResolvedValueOnce(Response.json({ questions: ["next?"] }))
      .mockResolvedValueOnce(Response.json({ queries: ["rag query"] }))
      .mockResolvedValueOnce(Response.json({ images: [], message: "done" }));
    const {
      executeCode,
      generateImage,
      generateRAGSearchQueries,
      generateRelatedQuestions,
    } = await import("../services/api/chatService");

    await expect(
      executeCode("env-provider:gemini-title", "print('hi')"),
    ).resolves.toBe("ok");
    await expect(generateRelatedQuestions([])).resolves.toEqual(["next?"]);
    await expect(generateRAGSearchQueries("hello")).resolves.toEqual([
      "rag query",
    ]);
    await expect(
      generateImage("env-provider:gemini-title", "paint a quiet UI"),
    ).resolves.toMatchObject({ message: "done" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (let index = 0; index < 4; index += 1) {
      expect(
        JSON.stringify(getJsonRequestBody(fetchMock, index)),
      ).not.toContain("apiKey");
    }
  });

  it("passes AbortSignal through auxiliary client requests", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ title: "Title" }))
      .mockResolvedValueOnce(Response.json({ questions: [] }))
      .mockResolvedValueOnce(Response.json({ queries: ["query"] }));
    const {
      generateChatTitle,
      generateRAGSearchQueries,
      generateRelatedQuestions,
    } = await import("../services/api/chatService");

    await generateChatTitle([], controller.signal);
    await generateRelatedQuestions([], controller.signal);
    await generateRAGSearchQueries("hello", controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.signal).toBe(controller.signal);
    }
  });

  it("prepares direct image inputs and outputs around the API request", async () => {
    const inputAttachment = {
      id: "input",
      mimeType: "image/png",
      data: "aW5wdXQ=",
      fileName: "input.png",
    };
    const outputAttachment = {
      id: "output",
      mimeType: "image/png",
      data: "b3V0cHV0",
      fileName: "output.png",
    };
    const preparedOutput = {
      id: outputAttachment.id,
      mimeType: outputAttachment.mimeType,
      fileName: outputAttachment.fileName,
      url: "opfs://images/generated/output.png",
    };
    mocks.prepareGeneratedImageAttachments.mockResolvedValue([preparedOutput]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ images: [outputAttachment], message: "done" }),
      );
    const { generateImage } = await import("../services/api/chatService");

    const result = await generateImage("env-provider:gemini-title", "paint", {
      attachments: [inputAttachment],
    });

    expect(mocks.compressImageAttachments).toHaveBeenCalledWith(
      [inputAttachment],
      {
        enabled: true,
        maxSizeMB: 1,
        maxWidthOrHeight: 1024,
      },
      { signal: undefined },
    );
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeInstanceOf(FormData);
    const formData = requestBody as FormData;
    const payload = JSON.parse(String(formData.get("payload")));
    expect(payload.attachments).toEqual([
      {
        id: "input",
        mimeType: "image/png",
        fileName: "input.png",
        uploadId: "image-0",
      },
    ]);
    expect(formData.get("image:image-0")).toBeInstanceOf(File);
    expect(String(formData.get("payload"))).not.toContain("aW5wdXQ=");
    expect(mocks.prepareGeneratedImageAttachments).toHaveBeenCalledWith(
      [outputAttachment],
      {
        enabled: true,
        maxSizeMB: 1,
        maxWidthOrHeight: 1024,
      },
      { signal: undefined },
    );
    expect(result.images).toEqual([preparedOutput]);
  });

  it("allows voice model STT to use server env fallback without sending apiKey", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ text: "Transcript" }));
    const { transcribeAudio } = await import("../services/api/voiceService");

    await expect(
      transcribeAudio(new Blob(["audio"], { type: "audio/webm" }), {
        sttProvider: "model",
        sttModel: "env-provider:audio-model",
        sttLanguage: "auto",
      } as any),
    ).resolves.toBe("Transcript");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/transcribe",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const modelProvider = JSON.parse(String(body.get("modelProvider")));
    expect(modelProvider).toMatchObject({
      type: "Google",
      name: "Env Gemini",
    });
    expect(JSON.stringify(modelProvider)).not.toContain("apiKey");
  });

  it("allows voice model TTS to use server env fallback without sending apiKey", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("audio", { status: 200 }));
    const { synthesizeSpeech } = await import("../services/api/voiceService");

    await expect(
      synthesizeSpeech("hello", {
        ttsProvider: "model",
        ttsModel: "env-provider:audio-model",
      } as any),
    ).resolves.toBeUndefined();

    const body = getJsonRequestBody(fetchMock);
    expect(body.modelProvider).toMatchObject({
      type: "Google",
      name: "Env Gemini",
    });
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });
});
