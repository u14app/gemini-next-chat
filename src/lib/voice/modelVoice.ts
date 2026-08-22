/**
 * Transport-independent voice operations for user-configured model providers.
 */

import {
  base64ToBytes,
  bytesToArrayBuffer,
  bytesToBase64,
  createPcmWavBytes,
} from "../utils/binary";
import {
  isGoogleProviderType,
  isOpenAIProviderType,
} from "../providers/providerTypes";
import {
  getGeminiTranscriptionPrompt,
  getProviderTranscriptionLanguage,
} from "./language";
import type { ProviderConfig, ProviderRuntime } from "../chat/runChatStream";

type ModelVoiceRuntime = Pick<
  ProviderRuntime,
  "assertOutboundAllowed" | "createOpenAIClient" | "createGoogleClient"
>;

type ModelVoiceResult<T> =
  { ok: true; value: T } | { ok: false; status: number; error: string };

export type ModelVoiceLanguage = "auto" | "en" | "zh" | "ja" | undefined;

function getAudioExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("aac")) return "aac";
  return "webm";
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export async function transcribeWithModelProvider(
  provider: ProviderConfig,
  modelId: string,
  audioBlob: Blob,
  language: ModelVoiceLanguage,
  runtime: ModelVoiceRuntime,
  signal?: AbortSignal,
): Promise<ModelVoiceResult<string>> {
  await runtime.assertOutboundAllowed(provider, signal);

  if (isOpenAIProviderType(provider.type)) {
    const openai = runtime.createOpenAIClient(provider);
    const extension = getAudioExtension(audioBlob.type || "");
    const file = new File([audioBlob], `audio.${extension}`, {
      type: audioBlob.type || `audio/${extension}`,
    });
    const request = {
      file,
      model: modelId,
      language: getProviderTranscriptionLanguage(language),
    };
    const response = signal
      ? await openai.audio.transcriptions.create(request, { signal })
      : await openai.audio.transcriptions.create(request);
    return { ok: true, value: response.text || "" };
  }

  if (isGoogleProviderType(provider.type)) {
    const google = runtime.createGoogleClient(provider);
    const response = await google.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: audioBlob.type || "audio/wav",
              data: await blobToBase64(audioBlob),
            },
          },
          { text: getGeminiTranscriptionPrompt(language) },
        ],
      },
      config: signal ? { abortSignal: signal } : undefined,
    });
    return { ok: true, value: response.text || "" };
  }

  return {
    ok: false,
    status: 400,
    error: `${provider.type} does not support transcription`,
  };
}

export async function synthesizeWithModelProvider(
  provider: ProviderConfig,
  modelId: string,
  text: string,
  runtime: ModelVoiceRuntime,
  signal?: AbortSignal,
): Promise<ModelVoiceResult<{ audio: ArrayBuffer; mimeType: string }>> {
  await runtime.assertOutboundAllowed(provider, signal);

  if (isOpenAIProviderType(provider.type)) {
    const openai = runtime.createOpenAIClient(provider);
    const request = { model: modelId, voice: "alloy" as const, input: text };
    const response = signal
      ? await openai.audio.speech.create(request, { signal })
      : await openai.audio.speech.create(request);
    return {
      ok: true,
      value: {
        audio: await response.arrayBuffer(),
        mimeType: response.headers.get("content-type") || "audio/mpeg",
      },
    };
  }

  if (isGoogleProviderType(provider.type)) {
    const google = runtime.createGoogleClient(provider);
    const response = await google.models.generateContent({
      model: modelId,
      contents: { parts: [{ text }] },
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return {
        ok: false,
        status: 502,
        error: "Model did not return audio data",
      };
    }

    const wavBytes = createPcmWavBytes(base64ToBytes(base64Audio));
    return {
      ok: true,
      value: { audio: bytesToArrayBuffer(wavBytes), mimeType: "audio/wav" },
    };
  }

  return {
    ok: false,
    status: 400,
    error: `${provider.type} does not support speech synthesis`,
  };
}
