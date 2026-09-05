"use client";

import { useCallback, useRef, useState } from "react";
import type { useTranslations } from "next-intl";
import { v7 as uuidv7 } from "uuid";
import type { Attachment, VoiceSettings } from "@/types";
import {
  transcribeAudio,
  startBrowserSpeechRecognition,
} from "@/services/api/voiceService";
import { formatBytes } from "@/config/limits";
import { stopMediaStreamTracks } from "@/lib/utils/mediaRecording";
import { logDevError } from "@/lib/utils/devLogger";
import { saveToOPFS } from "@/utils/opfs";

const logInputError = logDevError;

interface UseComposerRecordingOptions {
  offline: boolean;
  voice: VoiceSettings;
  maxAttachmentFileBytes: number;
  t: ReturnType<typeof useTranslations<"MessageInput">>;
  /** Owned by the composer so file selection and polish share the same flag. */
  isMountedRef: React.RefObject<boolean>;
  appendTranscript: (text: string) => void;
  appendAttachments: (incoming: Attachment[]) => void;
  setErrorMsg: (message: string | null) => void;
}

/**
 * Owns browser speech recognition and MediaRecorder audio capture for the
 * composer. Teardown is exposed rather than run in an unmount effect so the
 * composer keeps disposing recording state at the same point it always has.
 */
export function useComposerRecording({
  offline,
  voice,
  maxAttachmentFileBytes,
  t,
  isMountedRef,
  appendTranscript,
  appendAttachments,
  setErrorMsg,
}: UseComposerRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Browser Speech Rec
  const recognitionRef = useRef<any>(null);
  // MediaRecorder Audio Capture
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingKindRef = useRef<"browser" | "media" | null>(null);
  const timerRef = useRef<any>(null);
  const recordingSessionRef = useRef(0);

  const clearRecordingTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseMediaStream = useCallback((stream = mediaStreamRef.current) => {
    stopMediaStreamTracks(stream);
    if (!stream || mediaStreamRef.current === stream) {
      mediaStreamRef.current = null;
    }
  }, []);

  const startRecording = async () => {
    if (offline) return;
    setErrorMsg(null);
    if (voice.autoTranscribe && voice.sttProvider === "browser") {
      const sessionId = recordingSessionRef.current + 1;
      recordingSessionRef.current = sessionId;
      try {
        recognitionRef.current = startBrowserSpeechRecognition(
          voice.sttLanguage,
          {
            onTranscript: (text) => {
              if (
                !isMountedRef.current ||
                recordingSessionRef.current !== sessionId
              ) {
                return;
              }
              appendTranscript(text);
            },
            onError: (err) => {
              if (
                !isMountedRef.current ||
                recordingSessionRef.current !== sessionId
              ) {
                return;
              }
              logInputError("Speech recognition error", err);
              stopRecording();
            },
            onEnd: () => {
              if (
                !isMountedRef.current ||
                recordingSessionRef.current !== sessionId
              ) {
                return;
              }
              recordingSessionRef.current += 1;
              recognitionRef.current = null;
              recordingKindRef.current = null;
              clearRecordingTimer();
              setIsRecording(false);
            },
          },
        );

        recordingKindRef.current = "browser";
        setIsRecording(true);
        setRecordingSeconds(0);
        clearRecordingTimer();
        timerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      } catch (e) {
        logInputError("Failed to start browser recording", e);
        recognitionRef.current = null;
        recordingKindRef.current = null;
        if (isMountedRef.current && recordingSessionRef.current === sessionId) {
          setErrorMsg(
            e instanceof Error ? e.message : t("failedToStartRecognition"),
          );
        }
      }
    } else {
      const sessionId = recordingSessionRef.current + 1;
      recordingSessionRef.current = sessionId;
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (
          !isMountedRef.current ||
          recordingSessionRef.current !== sessionId
        ) {
          releaseMediaStream(stream);
          return;
        }
        mediaStreamRef.current = stream;

        let mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported("audio/webm")) {
          if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
          } else {
            mimeType = ""; // Let browser decide default
          }
        }

        const mediaRecorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (recordingSessionRef.current !== sessionId) return;
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const recordedType = mediaRecorder.mimeType || "audio/webm";
          const audioChunks = audioChunksRef.current;
          audioChunksRef.current = [];
          releaseMediaStream(stream);
          if (mediaRecorderRef.current === mediaRecorder) {
            mediaRecorderRef.current = null;
          }
          if (recordingKindRef.current === "media") {
            recordingKindRef.current = null;
          }
          clearRecordingTimer();

          if (
            !isMountedRef.current ||
            recordingSessionRef.current !== sessionId
          ) {
            return;
          }
          setIsRecording(false);

          const audioBlob = new Blob(audioChunks, {
            type: recordedType,
          });

          if (voice.autoTranscribe) {
            setIsTranscribing(true);
            try {
              const text = await transcribeAudio(audioBlob, voice);
              if (
                text &&
                isMountedRef.current &&
                recordingSessionRef.current === sessionId
              ) {
                appendTranscript(text);
              }
            } catch (e) {
              logInputError("Transcription failed", e);
              if (
                isMountedRef.current &&
                recordingSessionRef.current === sessionId
              ) {
                setErrorMsg(
                  e instanceof Error ? e.message : t("transcriptionFailed"),
                );
              }
            } finally {
              if (
                isMountedRef.current &&
                recordingSessionRef.current === sessionId
              ) {
                setIsTranscribing(false);
              }
            }
          } else {
            try {
              if (
                !isMountedRef.current ||
                recordingSessionRef.current !== sessionId
              ) {
                return;
              }
              let extension = "webm";
              if (recordedType.includes("mp4")) extension = "mp4";
              else if (recordedType.includes("aac")) extension = "aac";
              else if (recordedType.includes("ogg")) extension = "ogg";
              else if (recordedType.includes("wav")) extension = "wav";
              const fileName = `Voice Note ${new Date().toLocaleTimeString().replace(/:/g, "-")}.${extension}`;

              if (audioBlob.size > maxAttachmentFileBytes) {
                setErrorMsg(
                  t("attachmentsExceedSize", {
                    size: formatBytes(maxAttachmentFileBytes),
                  }),
                );
                return;
              }

              const audioFile = new File([audioBlob], fileName, {
                type: recordedType,
              });
              const url = await saveToOPFS(audioFile, "chat/audio");

              const newAtt: Attachment = {
                id: uuidv7(),
                mimeType: recordedType,
                url,
                fileName,
              };
              appendAttachments([newAtt]);
            } catch (e) {
              logInputError("Failed to process audio attachment", e);
              if (
                isMountedRef.current &&
                recordingSessionRef.current === sessionId
              ) {
                setErrorMsg(t("failedToProcessAudio"));
              }
            }
          }
        };

        mediaRecorder.start();
        recordingKindRef.current = "media";
        setIsRecording(true);
        setRecordingSeconds(0);
        clearRecordingTimer();
        timerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      } catch (e) {
        logInputError("Failed to access microphone", e);
        releaseMediaStream(stream);
        mediaRecorderRef.current = null;
        recordingKindRef.current = null;
        if (isMountedRef.current && recordingSessionRef.current === sessionId) {
          setErrorMsg(t("failedToAccessMicrophone"));
        }
      }
    }
  };

  const stopRecording = () => {
    if (recordingKindRef.current === "browser") {
      recordingSessionRef.current += 1;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Recognition can already be inactive by the time the UI stops it.
        }
        recognitionRef.current = null;
      }
    } else if (recordingKindRef.current === "media") {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          releaseMediaStream();
          mediaRecorderRef.current = null;
        }
      } else {
        releaseMediaStream();
        mediaRecorderRef.current = null;
      }
    }
    recordingKindRef.current = null;
    if (isMountedRef.current) {
      setIsRecording(false);
    }
    clearRecordingTimer();
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  /** Disposes recognition, recorder, and timer state. Called on unmount. */
  const teardownRecording = useCallback(() => {
    recordingSessionRef.current += 1;
    clearRecordingTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // The browser may throw if recognition has already ended.
      }
      recognitionRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore stale recorder state during component teardown.
        }
      }
      mediaRecorderRef.current = null;
    }

    audioChunksRef.current = [];
    recordingKindRef.current = null;
    releaseMediaStream();
  }, [clearRecordingTimer, releaseMediaStream]);

  const resetRecording = useCallback(() => {
    teardownRecording();
    setIsRecording(false);
    setIsTranscribing(false);
    setRecordingSeconds(0);
  }, [teardownRecording]);

  return {
    isRecording,
    isTranscribing,
    recordingSeconds,
    toggleRecording,
    teardownRecording,
    resetRecording,
  };
}
