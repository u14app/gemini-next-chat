import { NextRequest, NextResponse } from "next/server";
import { VoiceTranscribeRequestSchema } from "@/lib/api/schemas";
import {
  assertMultipartRequestContentLengthUnderLimit,
  createApiErrorResponse,
  parseJsonFormValue,
} from "@/lib/api/middleware";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import { API_INPUT_LIMITS, VOICE_LIMITS } from "@/config/limits";
import { getUploadBlobValidationError } from "@/lib/api/uploads";
import { ProviderFactory, type ProviderConfig } from "@/lib/providers/base";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import {
  decryptSecretEnvelope,
  resolveProviderRuntimeConfig,
} from "@/lib/byok/server";
import {
  getDefaultElevenLabsApiKey,
  getDefaultElevenLabsSttModel,
  getDefaultMimoApiKey,
  getDefaultMimoSttModel,
  getDefaultVoiceProvider,
} from "@/lib/defaultConfig/server";
import { safeServerLogError } from "@/lib/utils/safeServerLog";
import {
  blobToBase64,
  transcribeWithModelProvider,
} from "@/lib/voice/modelVoice";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const MIMO_CHAT_COMPLETIONS_URL =
  "https://api.xiaomimimo.com/v1/chat/completions";
const MIMO_STT_MODEL = "mimo-v2.5-asr";

type MimoTranscriptionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const serverModelVoiceRuntime = {
  assertOutboundAllowed: (provider: ProviderConfig, signal?: AbortSignal) =>
    ProviderFactory.assertProviderOutboundAllowed(provider, signal),
  createOpenAIClient: (provider: ProviderConfig) =>
    ProviderFactory.createOpenAIClient(provider),
  createGoogleClient: (provider: ProviderConfig) =>
    ProviderFactory.createGoogleClient(provider),
};

function getMimoAudioMimeType(blob: Blob): string {
  const mimeType = blob.type || "audio/wav";
  if (mimeType.includes("mpeg")) return "audio/mpeg";
  if (mimeType.includes("mp3")) return "audio/mp3";
  if (mimeType.includes("wav")) return "audio/wav";
  return mimeType;
}

async function transcribeWithMimo(
  audioBlob: Blob,
  apiKey: string,
  modelId: string | undefined,
  language: "auto" | "en" | "zh" | "ja" | undefined,
) {
  const mimeType = getMimoAudioMimeType(audioBlob);
  const audioBase64 = await blobToBase64(audioBlob);
  const { response, data } = await safeFetchJson<MimoTranscriptionResponse>(
    MIMO_CHAT_COMPLETIONS_URL,
    {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId === MIMO_STT_MODEL ? modelId : MIMO_STT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:${mimeType};base64,${audioBase64}`,
                },
              },
            ],
          },
        ],
        asr_options: {
          language: language || "auto",
        },
      }),
    },
    {
      policy: getSafeUrlPolicy("voice"),
      timeoutMs: 60_000,
      maxResponseBytes: 1024 * 1024,
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: `Mimo STT Error: ${response.status}` },
      { status: response.status },
    );
  }

  return NextResponse.json({
    text: data.choices?.[0]?.message?.content || "",
  });
}

export async function POST(request: NextRequest) {
  try {
    assertMultipartRequestContentLengthUnderLimit(
      request,
      VOICE_LIMITS.maxTranscriptionAudioBytes +
        API_INPUT_LIMITS.maxMultipartOverheadBytes,
    );

    const formData = await request.formData();
    const audioBlob = formData.get("audio");
    const { provider, apiKeySecret, modelId, modelProvider, language } =
      VoiceTranscribeRequestSchema.parse({
        provider: formData.get("provider"),
        apiKeySecret: parseJsonFormValue(
          formData.get("apiKeySecret"),
          "apiKeySecret",
        ),
        apiKey: formData.get("apiKey") || undefined,
        modelId: formData.get("modelId") || undefined,
        modelProvider: parseJsonFormValue(
          formData.get("modelProvider"),
          "modelProvider",
        ),
        language: formData.get("language") || undefined,
      });

    const audioError = getUploadBlobValidationError(audioBlob, {
      label: "Audio file",
      maxBytes: VOICE_LIMITS.maxTranscriptionAudioBytes,
    });
    if (audioError) {
      return NextResponse.json(
        { error: audioError },
        {
          status: audioError.includes("too large") ? 413 : 400,
        },
      );
    }
    const validAudioBlob = audioBlob as Blob;

    const defaultVoiceProvider = getDefaultVoiceProvider();
    if (provider === "default" && !defaultVoiceProvider) {
      return NextResponse.json(
        { error: "Default speech recognition is not configured" },
        { status: 400 },
      );
    }

    if (
      provider === "mimo" ||
      (provider === "default" && defaultVoiceProvider === "mimo")
    ) {
      const defaultModel =
        provider === "default" ? getDefaultMimoSttModel() : "";
      const apiKey =
        provider === "default"
          ? getDefaultMimoApiKey()
          : apiKeySecret
            ? await decryptSecretEnvelope(apiKeySecret, BYOK_CONTEXTS.mimo)
            : "";
      if (!apiKey || (provider === "default" && !defaultModel)) {
        return NextResponse.json(
          {
            error:
              provider === "default"
                ? "Default speech recognition is not configured"
                : "Mimo API Key is missing",
          },
          { status: 400 },
        );
      }

      return transcribeWithMimo(
        validAudioBlob,
        apiKey,
        provider === "default" ? defaultModel : modelId,
        language,
      );
    }

    if (provider === "default" || provider === "elevenlabs") {
      const defaultModel =
        provider === "default" ? getDefaultElevenLabsSttModel() : "";
      const apiKey =
        provider === "default"
          ? getDefaultElevenLabsApiKey()
          : apiKeySecret
            ? await decryptSecretEnvelope(
                apiKeySecret,
                BYOK_CONTEXTS.elevenLabs,
              )
            : "";
      if (!apiKey || (provider === "default" && !defaultModel)) {
        return NextResponse.json(
          {
            error:
              provider === "default"
                ? "Default speech recognition is not configured"
                : "ElevenLabs API Key is missing",
          },
          { status: 400 },
        );
      }

      const elevenFormData = new FormData();
      elevenFormData.append("file", validAudioBlob);
      elevenFormData.append(
        "model_id",
        provider === "default" ? defaultModel : modelId || "scribe_v2",
      );

      const { response, data } = await safeFetchJson<any>(
        `${ELEVENLABS_API_URL}/speech-to-text`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
          },
          body: elevenFormData,
        },
        {
          policy: getSafeUrlPolicy("voice"),
          timeoutMs: 60_000,
          maxResponseBytes: 1024 * 1024,
        },
      );

      if (!response.ok) {
        return NextResponse.json(
          { error: `ElevenLabs STT Error: ${response.status}` },
          { status: response.status },
        );
      }

      return NextResponse.json({ text: data.text });
    }

    if (provider === "model") {
      if (!modelProvider || !modelId) {
        return NextResponse.json(
          { error: "Model provider and model ID are required" },
          { status: 400 },
        );
      }

      const resolvedProvider =
        await resolveProviderRuntimeConfig(modelProvider);
      const result = await transcribeWithModelProvider(
        resolvedProvider,
        modelId,
        validAudioBlob,
        language,
        serverModelVoiceRuntime,
        request.signal,
      );
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status },
        );
      }
      return NextResponse.json({ text: result.value });
    }

    return NextResponse.json(
      { error: "Unsupported provider" },
      { status: 400 },
    );
  } catch (error) {
    safeServerLogError("Transcription error:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return createApiErrorResponse(error, "Invalid transcription request");
    }
    return createApiErrorResponse(error, "Transcription failed");
  }
}
