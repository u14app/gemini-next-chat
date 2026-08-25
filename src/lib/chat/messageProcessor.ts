import { v7 as uuidv7 } from "uuid";
import { createCitationSources } from "@/lib/utils/citations";
import type { Attachment, Message, Source } from "@/types";
import type { ModelInfo } from "@/services/api/chatService";
import {
  isIndexedKnowledgeFileAttachment,
  processRAGAttachments,
  processLocalKBAttachments,
  type RagQueryError,
} from "../utils/rag";
import {
  separateKBAttachments,
  processAttachmentsForModel,
} from "../utils/attachments";
import {
  createKnowledgeCollectionAttachment,
  getKnowledgeAttachmentSelectionKey,
  isKnowledgeFileAttachment,
} from "../utils/knowledgeAttachments";
import { parseModelString, resolveProviderModelMetadata } from "../utils/model";
import { resolveOPFSUrl } from "@/utils/opfs";
import { appendContextToChatInput } from "../utils/chatInput";

export interface ProcessMessageOptions {
  text: string;
  attachments: Attachment[];
  selectedModel: string;
  modelMetadata: Record<string, any>;
  customModelMetadata: Record<string, any>;
  ragConfig: {
    enabled: boolean;
    url?: string;
    token?: string;
    tokenSecret?: unknown;
    useDefaultVectorStore?: boolean;
    serverVectorStoreAvailable?: boolean;
  };
  ragEnabled?: boolean;
  deferKnowledgeRetrieval?: boolean;
  deferAttachmentReading?: boolean;
  knowledgeCollections: any[];
  workspaceKnowledgeCollectionIds?: string[];
  signal?: AbortSignal;
}

export interface ProcessedMessageData {
  finalText: string;
  finalAttachments: Attachment[];
  knowledgeScope: Attachment[];
  ragSources: Source[];
  ragError?: RagQueryError;
  userMessage: Message;
}

/**
 * Process message and attachments before sending to LLM
 */
export async function processMessageForSending(
  options: ProcessMessageOptions,
): Promise<ProcessedMessageData> {
  const {
    text,
    attachments,
    selectedModel,
    modelMetadata,
    customModelMetadata,
    ragConfig,
    ragEnabled = true,
    deferKnowledgeRetrieval = false,
    deferAttachmentReading = false,
    knowledgeCollections,
    workspaceKnowledgeCollectionIds = [],
    signal,
  } = options;

  let finalText = text;
  let convertedContent = "";
  let ragSources: Source[] = [];
  let ragError: RagQueryError | undefined;
  const finalAttachments: Attachment[] = [];

  // Separate KB and other attachments
  const { kbAttachments, otherAttachments } =
    separateKBAttachments(attachments);
  const workspaceKBAttachments = workspaceKnowledgeCollectionIds.map((id) => {
    const collection = knowledgeCollections.find((item) => item.id === id);
    return createKnowledgeCollectionAttachment({
      collectionId: id,
      collectionName: collection?.name || id,
    });
  });
  const allKBAttachments: Attachment[] = [];
  const seenKnowledgeKeys = new Set<string>();
  for (const attachment of [...kbAttachments, ...workspaceKBAttachments]) {
    const key = getKnowledgeAttachmentSelectionKey(attachment);
    if (!key || seenKnowledgeKeys.has(key)) continue;
    seenKnowledgeKeys.add(key);
    allKBAttachments.push(attachment);
  }

  // Check model capability
  const { providerId, modelName } = parseModelString(selectedModel);
  const meta = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
  const supportAttachment = meta ? (meta.attachment ?? false) : true;

  // Process RAG attachments
  const hasKB = allKBAttachments.length > 0;
  const effectiveRagConfig = {
    ...ragConfig,
    enabled: ragConfig.enabled && ragEnabled,
  };
  const isRagServiceEnabled = effectiveRagConfig.enabled;

  if (hasKB && deferKnowledgeRetrieval) {
    // Agent mode keeps these selectors as the boundary for search_knowledge.
    // It must not eagerly retrieve or inject the selected knowledge here.
  } else if (hasKB && isRagServiceEnabled) {
    const fileAttachments = allKBAttachments.filter(isKnowledgeFileAttachment);

    const ragResult = await processRAGAttachments(
      text,
      allKBAttachments,
      effectiveRagConfig,
      supportAttachment,
      knowledgeCollections,
      signal,
    );
    convertedContent += ragResult.convertedContent;
    finalAttachments.push(...ragResult.finalAttachments);
    ragSources = ragResult.ragSources;
    ragError = ragResult.ragError;

    const localFileAttachments = fileAttachments.filter(
      (attachment) =>
        !isIndexedKnowledgeFileAttachment(attachment, knowledgeCollections),
    );
    if (localFileAttachments.length > 0) {
      const localResult = await processLocalKBAttachments(
        localFileAttachments,
        knowledgeCollections,
        supportAttachment,
      );
      convertedContent += localResult.convertedContent;
      finalAttachments.push(...localResult.finalAttachments);
    }
  } else if (hasKB && !isRagServiceEnabled) {
    const localResult = await processLocalKBAttachments(
      allKBAttachments,
      knowledgeCollections,
      supportAttachment,
    );
    convertedContent += localResult.convertedContent;
    finalAttachments.push(...localResult.finalAttachments);
  }

  // Process other attachments
  if (!deferAttachmentReading) {
    const attachmentResult = await processAttachmentsForModel(
      otherAttachments,
      supportAttachment,
      resolveOPFSUrl,
    );
    finalAttachments.push(...attachmentResult.finalAttachments);
    convertedContent += attachmentResult.convertedContent;
  }

  // Combine text with converted content
  finalText = appendContextToChatInput(finalText, convertedContent);

  // Create user message
  const userMessage: Message = {
    id: uuidv7(),
    role: "user",
    content: text,
    timestamp: Date.now(),
    attachments: attachments,
  };

  return {
    finalText,
    finalAttachments,
    knowledgeScope: allKBAttachments.map((attachment) => ({ ...attachment })),
    ragSources,
    ragError,
    userMessage,
  };
}

/**
 * Create initial bot message placeholder
 */
export function createBotMessagePlaceholder(
  modelDisplayName: string,
  ragSources: Source[],
  ragError?: RagQueryError,
): Message {
  const botMsgId = uuidv7();
  const startTime = Date.now();

  return {
    id: botMsgId,
    role: "model",
    content: "",
    reasoning: "",
    timestamp: startTime,
    model: modelDisplayName,
    ragSources: ragSources.length > 0 ? ragSources : undefined,
    citations:
      ragSources.length > 0
        ? createCitationSources({ knowledge: ragSources })
        : undefined,
    ragError,
    isSearching: false,
  };
}

/**
 * Get model display name from available models
 */
export function getModelDisplayName(
  selectedModel: string,
  availableModels: ModelInfo[],
): string {
  const currentModelInfo = availableModels.find(
    (m) => m.name === selectedModel,
  );
  return currentModelInfo?.displayName || selectedModel;
}
