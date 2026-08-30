"use client";
import React, { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { useTranslations } from "next-intl";
import type { Attachment, RAGConfig, SystemSettings } from "@/types";
import {
  ATTACHMENT_LIMITS,
  IMAGE_ATTACHMENT_LIMITS,
  formatBytes,
  getAttachmentPayloadChars,
  getAttachmentsPayloadChars,
} from "@/config/limits";
import { logDevError } from "@/lib/utils/devLogger";
import { saveToOPFS } from "@/utils/opfs";
import {
  getChatAttachmentFileSelectionMessage,
  isChatImageFileCandidate,
  selectChatAttachmentFiles,
} from "@/lib/utils/chatAttachmentFiles";
import { createChatDocumentAttachment } from "@/lib/utils/documentAttachments";
import {
  getImageCompressionConfig,
  ImageAttachmentPreparationError,
  prepareImageFileForAttachment,
  type ImagePreparationStage,
} from "@/lib/utils/imageCompression";
import { isNativeMediaFile } from "@/lib/utils/messageInputHelpers";
import type { useComposerCapabilityState } from "./useComposerCapabilityState";

export type AttachmentProcessingStage =
  ImagePreparationStage | "preparing" | "parsing" | "conversation";

type ModelCapabilities = ReturnType<
  typeof useComposerCapabilityState
>["modelCapabilities"];

const logInputError = logDevError;

interface UseComposerAttachmentsOptions {
  offline: boolean;
  system: SystemSettings;
  rag: RAGConfig;
  modelCapabilities: ModelCapabilities;
  maxAttachmentFileBytes: number;
  t: ReturnType<typeof useTranslations<"MessageInput">>;
  /** Owned by the composer so file selection and polish share the same flag. */
  isMountedRef: React.RefObject<boolean>;
  /** Owned by the composer so unmount can invalidate an in-flight selection. */
  fileSelectionRunRef: React.RefObject<number>;
  fileSelectionAbortRef: React.RefObject<AbortController | null>;
  setErrorMsg: (message: string | null) => void;
  setShowAttachMenu: (show: boolean) => void;
}

export function useComposerAttachments({
  offline,
  system,
  rag,
  modelCapabilities,
  maxAttachmentFileBytes,
  t,
  isMountedRef,
  fileSelectionRunRef,
  fileSelectionAbortRef,
  setErrorMsg,
  setShowAttachMenu,
}: UseComposerAttachmentsOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isParsingAttachments, setIsParsingAttachments] = useState(false);
  const [attachmentProcessingStage, setAttachmentProcessingStage] =
    useState<AttachmentProcessingStage>("preparing");

  const appendAttachments = (incoming: Attachment[]) => {
    if (incoming.length === 0) return;

    const accepted: Attachment[] = [];
    let totalPayloadChars = getAttachmentsPayloadChars(attachments);
    let rejectedByCount = 0;
    let rejectedBySize = 0;

    for (const attachment of incoming) {
      if (attachments.length + accepted.length >= ATTACHMENT_LIMITS.maxCount) {
        rejectedByCount += 1;
        continue;
      }

      const payloadChars = getAttachmentPayloadChars(attachment);
      if (
        totalPayloadChars + payloadChars >
        ATTACHMENT_LIMITS.maxTotalBase64Chars
      ) {
        rejectedBySize += 1;
        continue;
      }

      totalPayloadChars += payloadChars;
      accepted.push(attachment);
    }

    if (rejectedByCount > 0) {
      setErrorMsg(
        t("attachmentLimitReached", { max: ATTACHMENT_LIMITS.maxCount }),
      );
    } else if (rejectedBySize > 0) {
      setErrorMsg(
        t("attachmentsExceedSize", {
          size: formatBytes(ATTACHMENT_LIMITS.maxTotalBase64Chars),
        }),
      );
    }

    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
  };

  const canAttachFileNatively = (file: File): boolean => {
    if (!isNativeMediaFile(file)) return false;
    if (modelCapabilities.attachment) return true;
    if (isChatImageFileCandidate(file)) return modelCapabilities.vision;
    if (file.type.startsWith("audio/")) return modelCapabilities.audio;
    if (file.type.startsWith("video/")) return modelCapabilities.video;
    return false;
  };

  const getNativeMediaOPFSPrefix = (file: File): string => {
    if (file.type.startsWith("audio/")) return "chat/audio";
    if (file.type.startsWith("video/")) return "chat/video";
    return "chat/files";
  };

  const processSelectedFiles = async (
    files: File[],
    {
      documentsOnly = false,
      closeAttachMenu = false,
    }: { documentsOnly?: boolean; closeAttachMenu?: boolean } = {},
  ) => {
    if (offline || files.length === 0) return;

    const runId = fileSelectionRunRef.current + 1;
    fileSelectionRunRef.current = runId;
    fileSelectionAbortRef.current?.abort();
    const abortController = new AbortController();
    fileSelectionAbortRef.current = abortController;
    const selection = selectChatAttachmentFiles(attachments.length, files, {
      maxFileBytes: maxAttachmentFileBytes,
      maxImageFileBytes: IMAGE_ATTACHMENT_LIMITS.maxSourceBytes,
    });
    let deferredError = getChatAttachmentFileSelectionMessage(selection, {
      maxFileBytes: maxAttachmentFileBytes,
      maxImageFileBytes: IMAGE_ATTACHMENT_LIMITS.maxSourceBytes,
    });
    if (
      selection.rejectedByCount.length === 0 &&
      selection.rejectedBySize.length > 0 &&
      selection.rejectedBySize.every(isChatImageFileCandidate)
    ) {
      deferredError = t("imageTooLarge", {
        size: formatBytes(IMAGE_ATTACHMENT_LIMITS.maxSourceBytes),
      });
    }
    if (selection.accepted.length === 0) {
      if (deferredError) setErrorMsg(deferredError);
      if (closeAttachMenu) setShowAttachMenu(false);
      if (fileSelectionAbortRef.current === abortController) {
        fileSelectionAbortRef.current = null;
      }
      return;
    }
    const newAttachments: Attachment[] = [];

    setErrorMsg(null);
    setAttachmentProcessingStage("preparing");
    setIsParsingAttachments(true);
    try {
      for (const file of selection.accepted) {
        const useNativeAttachment =
          !documentsOnly && canAttachFileNatively(file);
        try {
          abortController.signal.throwIfAborted();
          if (useNativeAttachment) {
            if (isChatImageFileCandidate(file)) {
              const preparedFile = await prepareImageFileForAttachment(
                file,
                getImageCompressionConfig(system),
                {
                  signal: abortController.signal,
                  maxOutputBytes: maxAttachmentFileBytes,
                  onStage: (stage) => {
                    if (
                      isMountedRef.current &&
                      fileSelectionRunRef.current === runId
                    ) {
                      setAttachmentProcessingStage(stage);
                    }
                  },
                },
              );
              const url = await saveToOPFS(preparedFile, "chat/images");
              if (
                !isMountedRef.current ||
                fileSelectionRunRef.current !== runId
              ) {
                return;
              }
              newAttachments.push({
                id: uuidv7(),
                mimeType: preparedFile.type,
                url,
                fileName: preparedFile.name,
              });
              continue;
            }

            setAttachmentProcessingStage("preparing");
            if (
              file.type.startsWith("audio/") ||
              file.type.startsWith("video/")
            ) {
              const url = await saveToOPFS(
                file,
                getNativeMediaOPFSPrefix(file),
              );
              if (
                !isMountedRef.current ||
                fileSelectionRunRef.current !== runId
              ) {
                return;
              }
              newAttachments.push({
                id: uuidv7(),
                mimeType: file.type || "application/octet-stream",
                url,
                fileName: file.name,
              });
              continue;
            }
          }

          setAttachmentProcessingStage("parsing");
          const result = await createChatDocumentAttachment(file, {
            id: uuidv7(),
            rag,
            saveOriginalFile: saveToOPFS,
          });
          if (!isMountedRef.current || fileSelectionRunRef.current !== runId) {
            return;
          }
          newAttachments.push(result.attachment);
        } catch (err) {
          if (!isMountedRef.current || fileSelectionRunRef.current !== runId) {
            return;
          }
          if (err instanceof Error && err.name === "AbortError") return;
          logInputError(
            useNativeAttachment
              ? "Error reading file"
              : "Error parsing document attachment",
            err,
          );
          if (err instanceof ImageAttachmentPreparationError) {
            deferredError = t(
              err.code === "compressed-too-large"
                ? "imageStillTooLarge"
                : "imageTooLarge",
              { size: formatBytes(err.limitBytes) },
            );
          } else if (isChatImageFileCandidate(file)) {
            deferredError = t("failedToProcessImage", {
              fileName: file.name,
            });
          } else {
            deferredError = t(
              useNativeAttachment
                ? "failedToReadFile"
                : "failedToParseDocument",
              { fileName: file.name },
            );
          }
        }
      }

      if (isMountedRef.current && fileSelectionRunRef.current === runId) {
        appendAttachments(newAttachments);
        if (closeAttachMenu) setShowAttachMenu(false);
        if (deferredError) setErrorMsg(deferredError);
      }
    } finally {
      if (isMountedRef.current && fileSelectionRunRef.current === runId) {
        setIsParsingAttachments(false);
        setAttachmentProcessingStage("preparing");
        if (fileSelectionAbortRef.current === abortController) {
          fileSelectionAbortRef.current = null;
        }
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    if (inputEl.files && inputEl.files.length > 0) {
      await processSelectedFiles(Array.from(inputEl.files) as File[], {
        closeAttachMenu: true,
      });
      if (inputEl.value) inputEl.value = "";
    }
  };

  const handleTextFallbackSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const inputEl = e.currentTarget;
    if (inputEl.files && inputEl.files.length > 0) {
      await processSelectedFiles(Array.from(inputEl.files) as File[], {
        documentsOnly: true,
      });
      if (inputEl.value) inputEl.value = "";
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleKBSelect = (selectedAttachments: Attachment[]) => {
    appendAttachments(selectedAttachments);
  };

  return {
    attachments,
    setAttachments,
    isParsingAttachments,
    setIsParsingAttachments,
    attachmentProcessingStage,
    setAttachmentProcessingStage,
    appendAttachments,
    processSelectedFiles,
    handleFileSelect,
    handleTextFallbackSelect,
    removeAttachment,
    handleKBSelect,
  };
}
