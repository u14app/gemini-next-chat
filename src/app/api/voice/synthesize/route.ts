import { NextRequest, NextResponse } from "next/server";
import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { VoiceSynthesizeRequestSchema } from "@/lib/api/schemas";
import { safeFetchArrayBuffer, safeFetchJson } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import { ProviderFactory, type ProviderConfig } from "@/lib/providers/base";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import {
  decryptSecretEnvelope,
  resolveProviderRuntimeConfig,
} from "@/lib/byok/server";
import {
  getDefaultElevenLabsApiKey,
  getDefaultElevenLabsTtsModel,
  getDefaultElevenLabsTtsVoiceId,
  getDefaultMimoApiKey,
  getDefaultMimoTtsModel,
  getDefaultMimoTtsVoiceId,
  getDefaultVoiceProvider,
} from "@/lib/defaultConfig/server";
import { safeServerLogError } from "@/lib/utils/safeServerLog";
import { base64ToBytes, bytesToArrayBuffer } from "@/lib/utils/binary";
import {
  DEFAULT_ELEVENLABS_TTS_MODEL,
  isElevenLabsTTSModel,
} from "@/lib/utils/voiceModels";
import { synthesizeWithModelProvider } from "@/lib/voice/modelVoice";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const MIMO_CHAT_COMPLETIONS_URL =
  "https://api.xiaomimimo.com/v1/chat/completions";
const MIMO_TTS_MODEL = "mimo-v2.5-tts";

const serverModelVoiceRuntime = {
  assertOutboundAllowed: (provider: ProviderConfig, signal?: AbortSignal) =>
    ProviderFactory.assertProviderOutboundAllowed(provider, signal),
  createOpenAIClient: (provider: ProviderConfig) =>
    ProviderFactory.createOpenAIClient(provider),
  createGoogleClient: (provider: ProviderConfig) =>
    ProviderFactory.createGoogleClient(provider),
};

type MimoSynthesisResponse = {
  choices?: Array<{
    message?: {
      audio?: {
        data?: string;
      };
    };
  }>;
};

async function synthesizeWithMimo(
  text: string,
  apiKey: string,
  modelId: string | undefined,
  voiceId: string | undefined,
) {
  const { response, data } = await safeFetchJson<MimoSynthesisResponse>(
    MIMO_CHAT_COMPLETIONS_URL,
    {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId === MIMO_TTS_MODEL ? modelId : MIMO_TTS_MODEL,
        messages: [
          {
            role: "assistant",
            content: text,
          },
        ],
        audio: {
          format: "wav",
          voice: voiceId?.trim() || "mimo_default",
        },
      }),
    },
    {
      policy: getSafeUrlPolicy("voice"),
      timeoutMs: 60_000,
      maxResponseBytes: 10 * 1024 * 1024,
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: `Mimo TTS Error: ${response.status}` },
      { status: response.status },
    );
  }

  const base64Audio = data.choices?.[0]?.message?.audio?.data;
  if (!base64Audio) {
    return NextResponse.json(
      { error: "Mimo did not return audio data" },
      { status: 502 },
    );
  }

  const audioBytes = base64ToBytes(base64Audio);
  return new NextResponse(bytesToArrayBuffer(audioBytes), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": audioBytes.byteLength.toString(),
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { text, provider, apiKeySecret, voiceId, modelProvider, modelId } =
      VoiceSynthesizeRequestSchema.parse(await readJsonRequestBody(request));

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const defaultVoiceProvider = getDefaultVoiceProvider();
    if (provider === "default" && !defaultVoiceProvider) {
      return NextResponse.json(
        { error: "Default speech synthesis is not configured" },
        { status: 400 },
      );
    }

    if (
      provider === "mimo" ||
      (provider === "default" && defaultVoiceProvider === "mimo")
    ) {
      const defaultModel =
        provider === "default" ? getDefaultMimoTtsModel() : "";
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
                ? "Default speech synthesis is not configured"
                : "Mimo API Key is missing",
          },
          { status: 400 },
        );
      }

      return synthesizeWithMimo(
        text,
        apiKey,
        provider === "default" ? defaultModel : modelId,
        provider === "default" ? getDefaultMimoTtsVoiceId() : voiceId,
      );
    }

    if (provider === "default" || provider === "elevenlabs") {
      const defaultModel =
        provider === "default" ? getDefaultElevenLabsTtsModel() : "";
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
                ? "Default speech synthesis is not configured"
                : "ElevenLabs API Key is missing",
          },
          { status: 400 },
        );
      }

      const effectiveVoiceId =
        voiceId?.trim() ||
        (provider === "default" ? getDefaultElevenLabsTtsVoiceId() : "");

      if (!effectiveVoiceId) {
        return NextResponse.json(
          { error: "ElevenLabs voice ID is missing" },
          { status: 400 },
        );
      }

      const url = `${ELEVENLABS_API_URL}/text-to-speech/${encodeURIComponent(effectiveVoiceId)}?output_format=mp3_44100_128`;
      const effectiveModelId =
        provider === "default"
          ? defaultModel
          : isElevenLabsTTSModel(modelId)
            ? modelId
            : DEFAULT_ELEVENLABS_TTS_MODEL;

      const payload = {
        text: text,
        model_id: effectiveModelId,
      };

      const requestInit = {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      };

      const response = await safeFetchArrayBuffer(url, requestInit, {
        policy: getSafeUrlPolicy("voice"),
        timeoutMs: 60_000,
        maxResponseBytes: 10 * 1024 * 1024,
      });

      if (!response.response.ok) {
        return NextResponse.json(
          {
            error: `ElevenLabs TTS Error: ${response.response.status}`,
          },
          { status: response.response.status },
        );
      }

      const audioBuffer = response.arrayBuffer;

      return new NextResponse(audioBuffer, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": audioBuffer.byteLength.toString(),
        },
      });
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
      const result = await synthesizeWithModelProvider(
        resolvedProvider,
        modelId,
        text,
        serverModelVoiceRuntime,
        request.signal,
      );
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status },
        );
      }
      return new NextResponse(result.value.audio, {
        headers: {
          "Content-Type": result.value.mimeType,
          "Content-Length": result.value.audio.byteLength.toString(),
        },
      });
    }

    return NextResponse.json(
      { error: "Unsupported provider" },
      { status: 400 },
    );
  } catch (error) {
    safeServerLogError("Speech synthesis error:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return createApiErrorResponse(error, "Invalid speech request");
    }
    return createApiErrorResponse(error, "Speech synthesis failed");
  }
}
