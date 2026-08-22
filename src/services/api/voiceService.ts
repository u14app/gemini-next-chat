import { VoiceSettings } from "@/types";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import {
  createDisposableAudioFromBlob,
  DisposableAudioElement,
} from "@/lib/utils/disposableAudio";
import {
  DEFAULT_ELEVENLABS_TTS_MODEL,
  getAvailableProviderModel,
  isElevenLabsSTTModel,
  isElevenLabsTTSModel,
} from "@/lib/utils/voiceModels";
import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import {
  buildProviderRuntimeConfig,
  encryptSecret,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import {
  hasElevenLabsApiKey,
  hasMimoApiKey,
  resolveElevenLabsApiKey,
  resolveMimoApiKey,
} from "@/lib/security/localSecretResolvers";
import { getBrowserVoiceLanguage } from "@/lib/voice/language";
import {
  buildDirectProviderConfig,
  describeDirectCallError,
  getBrowserProviderRuntime,
  shouldUseDirectCall,
} from "./chat/transport";
import {
  synthesizeWithModelProvider,
  transcribeWithModelProvider,
} from "@/lib/voice/modelVoice";

const getProviderForModel = (modelString: string) => {
  const { providers } = useCoreSettingsStore.getState();
  const availableModel = getAvailableProviderModel(modelString, providers);

  if (!availableModel) {
    throw new Error(
      "Selected voice model is no longer available. Please choose another model in Settings.",
    );
  }

  const { provider, modelId } = availableModel;

  return { provider, modelId };
};

export const transcribeAudio = async (
  audioBlob: Blob,
  settings: VoiceSettings,
): Promise<string> => {
  if (settings.sttProvider === "default") {
    const response = await signedApiFetch("/api/voice/transcribe", {
      method: "POST",
      body: (() => {
        const formData = new FormData();
        formData.append("audio", audioBlob);
        formData.append("provider", "default");
        formData.append(
          "modelId",
          isElevenLabsSTTModel(settings.sttModel)
            ? settings.sttModel
            : "scribe_v2",
        );
        formData.append("language", settings.sttLanguage || "auto");
        return formData;
      })(),
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Transcription failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{ text?: string }>(
      response,
      "Transcription failed",
    );
    return data.text || "";
  }

  if (settings.sttProvider === "elevenlabs") {
    if (!hasElevenLabsApiKey(settings)) {
      throw new Error("ElevenLabs API Key is missing");
    }

    const response = await fetchWithByokRetry(async () => {
      const apiKey = await resolveElevenLabsApiKey(settings);
      const retryFormData = new FormData();
      retryFormData.append("audio", audioBlob);
      retryFormData.append("provider", "elevenlabs");
      retryFormData.append(
        "apiKeySecret",
        JSON.stringify(await encryptSecret(apiKey, BYOK_CONTEXTS.elevenLabs)),
      );
      retryFormData.append(
        "modelId",
        isElevenLabsSTTModel(settings.sttModel)
          ? settings.sttModel
          : "scribe_v2",
      );
      retryFormData.append("language", settings.sttLanguage || "auto");

      return signedApiFetch("/api/voice/transcribe", {
        method: "POST",
        body: retryFormData,
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Transcription failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{ text?: string }>(
      response,
      "Transcription failed",
    );
    return data.text || "";
  }

  if (settings.sttProvider === "mimo") {
    if (!hasMimoApiKey(settings)) {
      throw new Error("Mimo API Key is missing");
    }

    const response = await fetchWithByokRetry(async () => {
      const apiKey = await resolveMimoApiKey(settings);
      const retryFormData = new FormData();
      retryFormData.append("audio", audioBlob);
      retryFormData.append("provider", "mimo");
      retryFormData.append(
        "apiKeySecret",
        JSON.stringify(await encryptSecret(apiKey, BYOK_CONTEXTS.mimo)),
      );
      retryFormData.append("modelId", "mimo-v2.5-asr");
      retryFormData.append("language", settings.sttLanguage || "auto");

      return signedApiFetch("/api/voice/transcribe", {
        method: "POST",
        body: retryFormData,
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Transcription failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{ text?: string }>(
      response,
      "Transcription failed",
    );
    return data.text || "";
  }

  if (settings.sttProvider === "model") {
    if (!settings.sttModel) throw new Error("No model selected for STT");
    const sttModel = settings.sttModel;
    const { provider, modelId } = getProviderForModel(sttModel);

    if (shouldUseDirectCall(provider)) {
      try {
        const [runtime, directProvider] = await Promise.all([
          getBrowserProviderRuntime(),
          buildDirectProviderConfig(provider),
        ]);
        const result = await transcribeWithModelProvider(
          directProvider,
          modelId,
          audioBlob,
          settings.sttLanguage || "auto",
          runtime,
        );
        if (!result.ok) throw new Error(result.error);
        return result.value;
      } catch (error) {
        throw describeDirectCallError(error, provider);
      }
    }

    const response = await fetchWithByokRetry(async () => {
      const retryFormData = new FormData();
      retryFormData.append("audio", audioBlob);
      retryFormData.append("provider", "model");
      retryFormData.append(
        "modelProvider",
        JSON.stringify(await buildProviderRuntimeConfig(provider)),
      );
      retryFormData.append("modelId", modelId);
      retryFormData.append("language", settings.sttLanguage || "auto");

      return signedApiFetch("/api/voice/transcribe", {
        method: "POST",
        body: retryFormData,
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Transcription failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{ text?: string }>(
      response,
      "Transcription failed",
    );
    return data.text || "";
  }

  return "";
};

interface BrowserSTTCallbacks {
  onTranscript: (text: string) => void;
  onError: (error: any) => void;
  onEnd?: () => void;
}

export const startBrowserSpeechRecognition = (
  language: string,
  callbacks: BrowserSTTCallbacks,
): any => {
  if (typeof window === "undefined") return null;

  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    throw new Error("Browser does not support Speech Recognition");
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.lang = getBrowserVoiceLanguage(language, navigator.language);

  recognition.onresult = (event: any) => {
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      }
    }

    if (finalTranscript) {
      callbacks.onTranscript(finalTranscript);
    }
  };

  recognition.onerror = (event: any) => {
    callbacks.onError(event.error);
  };

  if (callbacks.onEnd) {
    recognition.onend = callbacks.onEnd;
  }

  recognition.start();
  return recognition;
};

export const synthesizeSpeech = async (
  text: string,
  settings: VoiceSettings,
): Promise<DisposableAudioElement | void> => {
  if (settings.ttsProvider === "default") {
    if (!text.trim()) return;

    const response = await signedApiFetch("/api/voice/synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        provider: "default",
        voiceId: settings.ttsVoiceId,
      }),
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Speech synthesis failed"),
      );
    }

    return createDisposableAudioFromBlob(await response.blob());
  }

  if (settings.ttsProvider === "elevenlabs") {
    if (!hasElevenLabsApiKey(settings)) {
      throw new Error("ElevenLabs API Key is missing");
    }

    if (!text.trim()) return;

    const response = await fetchWithByokRetry(async () => {
      const apiKey = await resolveElevenLabsApiKey(settings);
      return signedApiFetch("/api/voice/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
          provider: "elevenlabs",
          apiKeySecret: await encryptSecret(apiKey, BYOK_CONTEXTS.elevenLabs),
          voiceId: settings.ttsVoiceId,
          modelId: isElevenLabsTTSModel(settings.ttsModel)
            ? settings.ttsModel
            : DEFAULT_ELEVENLABS_TTS_MODEL,
        }),
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Speech synthesis failed"),
      );
    }

    return createDisposableAudioFromBlob(await response.blob());
  } else if (settings.ttsProvider === "mimo") {
    if (!hasMimoApiKey(settings)) {
      throw new Error("Mimo API Key is missing");
    }

    if (!text.trim()) return;

    const response = await fetchWithByokRetry(async () => {
      const apiKey = await resolveMimoApiKey(settings);
      return signedApiFetch("/api/voice/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          provider: "mimo",
          apiKeySecret: await encryptSecret(apiKey, BYOK_CONTEXTS.mimo),
          modelId: "mimo-v2.5-tts",
          voiceId: settings.mimoTtsVoiceId || "mimo_default",
        }),
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Speech synthesis failed"),
      );
    }

    return createDisposableAudioFromBlob(await response.blob());
  } else if (settings.ttsProvider === "model") {
    if (!settings.ttsModel) throw new Error("No model selected for TTS");
    if (!text.trim()) return;
    const ttsModel = settings.ttsModel;
    const { provider, modelId } = getProviderForModel(ttsModel);

    if (shouldUseDirectCall(provider)) {
      try {
        const [runtime, directProvider] = await Promise.all([
          getBrowserProviderRuntime(),
          buildDirectProviderConfig(provider),
        ]);
        const result = await synthesizeWithModelProvider(
          directProvider,
          modelId,
          text,
          runtime,
        );
        if (!result.ok) throw new Error(result.error);
        return createDisposableAudioFromBlob(
          new Blob([result.value.audio], { type: result.value.mimeType }),
        );
      } catch (error) {
        throw describeDirectCallError(error, provider);
      }
    }

    const response = await fetchWithByokRetry(async () => {
      return signedApiFetch("/api/voice/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          provider: "model",
          modelProvider: await buildProviderRuntimeConfig(provider),
          modelId,
        }),
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Speech synthesis failed"),
      );
    }

    return createDisposableAudioFromBlob(await response.blob());
  } else {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window)) {
        reject(new Error("Browser does not support Speech Synthesis"));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);

      if (settings.ttsLanguage !== "auto") {
        utterance.lang = getBrowserVoiceLanguage(settings.ttsLanguage);
      }

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const targetLang = utterance.lang || navigator.language;
        const voice = voices.find((v) => v.lang === targetLang) || voices[0];
        utterance.voice = voice;
      }

      window.speechSynthesis.speak(utterance);
      resolve();
    });
  }
};
