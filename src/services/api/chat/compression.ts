import type { Message, Session } from "@/types";
import { v7 as uuidv7 } from "uuid";
import { useSettingsStore, getTaskModel } from "@/store/core/settingsStore";
import {
  parseModelString,
  resolveProviderModelMetadata,
} from "@/lib/utils/model";
import {
  buildCompressionSource,
  createContextCompressionSummaryPrompt,
  mergeCompressedContentWithMemoryIds,
  normalizeCompressedContent,
  normalizeCompressedContentWithMemoryIds,
  textToBase64,
} from "@/lib/utils/contextCompression";
import { logDevWarn } from "@/lib/utils/devLogger";
import { isAbortError } from "./streamErrors";
import { streamGenerateContent } from "./simpleGeneration";

// Helper functions for history preparation and compression
// These remain client-side as they need access to local state

// Helper to get compression config from store
const getCompressionConfig = () => {
  const { system } = useSettingsStore.getState();
  // Use stored values or defaults if something is wrong (though state should be init)
  // Turns to Messages: 1 Turn = 2 Messages
  return {
    thresholdMessages: (system.compressionThreshold || 12) * 2,
    keepMessages: (system.historyKeepCount || 4) * 2,
  };
};

// Generate summary using backend API
const generateSummary = async (
  text: string,
  signal?: AbortSignal,
): Promise<string> => {
  try {
    // Use configured task model
    const summaryModel = getTaskModel("contextCompression");

    const prompt = createContextCompressionSummaryPrompt(text);

    const response = await streamGenerateContent(
      summaryModel,
      prompt,
      () => {},
      signal,
    );
    return response;
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
    logDevWarn("Summary generation failed, returning raw truncation", e);
    return normalizeCompressedContent(
      `${text.slice(0, 1000)}... [Summary Failed]`,
    );
  }
};

// Reconstruct history for the LLM based on stored compression state + uncompressed tail
export const prepareHistoryForLLM = async (
  allMessages: Message[],
  compression: Session["compression"],
  model: string,
): Promise<Message[]> => {
  // Filter out empty model messages (can happen after retract/delete operations)
  const validMessages = allMessages.filter(
    (m) =>
      m.role === "user" ||
      (m.role === "model" &&
        (m.content.trim() !== "" ||
          m.attachments?.length ||
          m.reasoning ||
          m.searchSources?.length ||
          m.toolCalls?.length ||
          m.outputBlocks?.length)),
  );

  // If no compression state exists, return filtered history
  if (!compression) return validMessages;

  // 1. Identify uncompressed tail
  const lastCompressedIndex = validMessages.findIndex(
    (m) => m.id === compression.lastCompressedMessageId,
  );
  let uncompressedTail: Message[] = [];

  if (lastCompressedIndex !== -1) {
    uncompressedTail = validMessages.slice(lastCompressedIndex + 1);
  } else {
    // If ID not found (maybe message deleted?), fallback to full history or handle error.
    // Safer to return full history if state is invalid.
    return validMessages;
  }

  // 2. Identify First User Message (Requirement: Preserve user's first question)
  const firstUserMsg = validMessages.find((m) => m.role === "user");

  // 3. Construct Compressed Message Placeholder
  // Check model capability for attachment
  const { modelMetadata, customModelMetadata } = useSettingsStore.getState();
  const { providerId, modelName } = parseModelString(model);
  const meta = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const supportAttachment = meta ? (meta.attachment ?? false) : true;

  let compressedMsg: Message;
  const placeholderId = uuidv7();
  const compressedContent = normalizeCompressedContent(
    compression.compressedContent,
  );

  if (supportAttachment) {
    compressedMsg = {
      id: placeholderId,
      role: "model",
      timestamp: Date.now(),
      content:
        "The context has been compressed. If you need to view the previous conversation, please read the attached content.",
      attachments: [
        {
          id: uuidv7(),
          mimeType: "text/plain",
          fileName: "conversation_history.txt",
          data: textToBase64(compressedContent),
        },
      ],
    };
  } else {
    compressedMsg = {
      id: placeholderId,
      role: "model",
      timestamp: Date.now(),
      content: `The context has been compressed. To retrieve previous conversation content, please read the following conversation summary:\n\n${compressedContent}`,
    };
  }

  // 4. Assemble Final Array
  // [First User] -> [Compressed Placeholder] -> [Uncompressed Tail]
  // Note: If firstUserMsg is actually part of the tail (unlikely if compression exists), we shouldn't duplicate it.
  // Since compression usually happens after 12 turns, firstUserMsg is definitely compressed.

  const result: Message[] = [];
  if (firstUserMsg) {
    result.push(firstUserMsg);
  }
  result.push(compressedMsg);
  result.push(...uncompressedTail);

  return result;
};

// Background task to calculate new compression if needed
export const performBackgroundCompression = async (
  allMessages: Message[],
  currentCompression: Session["compression"],
  model: string,
  signal?: AbortSignal,
  options?: { ignoreThreshold?: boolean },
): Promise<Session["compression"] | null> => {
  const { thresholdMessages, keepMessages } = getCompressionConfig();

  // 1. Identify Uncompressed Segment
  let startIndex = 0;
  let oldContent = "";
  let oldIncludedMemoryIds: string[] = [];

  if (currentCompression) {
    const lastIdx = allMessages.findIndex(
      (m) => m.id === currentCompression.lastCompressedMessageId,
    );
    if (lastIdx !== -1) {
      startIndex = lastIdx + 1;
      const normalizedPrevious = normalizeCompressedContentWithMemoryIds({
        content: currentCompression.compressedContent,
        memoryIds: currentCompression.includedMemoryIds || [],
      });
      oldContent = normalizedPrevious.content;
      oldIncludedMemoryIds = normalizedPrevious.representedMemoryIds;
    }
  } else {
    // If no previous compression, start from index 1 (keeping index 0 User safe)
    startIndex = 1;
  }

  const uncompressedMessages = allMessages.slice(startIndex);

  // 2. Check Threshold
  // A manual `/compress` skips the threshold; the guards below still keep a
  // short session from producing an empty compression.
  if (
    !options?.ignoreThreshold &&
    uncompressedMessages.length < thresholdMessages + keepMessages
  ) {
    return null; // No new compression needed
  }

  // 3. Define chunk to compress
  // We keep the last 'keepMessages' raw. Compress everything else in the uncompressed segment.
  const splitIndex = uncompressedMessages.length - keepMessages;
  const messagesToCompress = uncompressedMessages.slice(0, splitIndex);
  if (messagesToCompress.length === 0) return null;

  // 4. Generate Content
  const compressionSource = buildCompressionSource(messagesToCompress);
  if (!compressionSource.lastIncludedMessageId) return null;
  const textToCompress = compressionSource.text;

  const { modelMetadata, customModelMetadata } = useSettingsStore.getState();
  const { providerId, modelName } = parseModelString(model);
  const meta = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const supportAttachment = meta ? (meta.attachment ?? false) : true;

  let nextCompressedContent = textToCompress;

  if (!supportAttachment) {
    // Generate Summary
    const summary = await generateSummary(textToCompress, signal);
    nextCompressedContent = oldContent
      ? `[New Summary Segment]:\n${summary}`
      : summary;
  }

  const mergedCompression = mergeCompressedContentWithMemoryIds({
    previousContent: oldContent,
    previousMemoryIds: oldIncludedMemoryIds,
    nextContent: nextCompressedContent,
    nextMemoryIds: compressionSource.includedMemoryIds,
  });

  return {
    compressedContent: mergedCompression.content,
    lastCompressedMessageId: compressionSource.lastIncludedMessageId,
    includedMemoryIds: mergedCompression.representedMemoryIds,
  };
};
