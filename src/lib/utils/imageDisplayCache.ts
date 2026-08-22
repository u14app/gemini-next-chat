import type { Attachment, Message, MessageOutputBlock } from "@/types";
import {
  deleteFromOPFS,
  saveToOPFS,
  resolveOPFSBlob,
  isOPFSUrl,
} from "@/utils/opfs";
import { base64ToBytes, bytesToArrayBuffer, bytesToBase64 } from "./binary";
import { logDevError } from "./devLogger";

type SaveFile = (file: File, prefix?: string) => Promise<string>;
type DeleteFile = (url?: string) => Promise<void>;
type ResolveOPFSBlob = (url: string) => Promise<Blob | null>;
type CreateObjectURL = (blob: Blob) => string;

const DEFAULT_IMAGE_CACHE_PREFIX = "images";

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mimeType.startsWith("image/");
}

function getSourceKind(attachment: Attachment): "data" | "url" | null {
  if (attachment.data) return "data";
  if (attachment.url && !isOPFSUrl(attachment.url)) return "url";
  return null;
}

function getSourceValue(attachment: Attachment): string | null {
  if (attachment.data) return attachment.data;
  if (attachment.url && !isOPFSUrl(attachment.url)) return attachment.url;
  return null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(value);

  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function createBlobFromBase64(data: string, mimeType: string): Blob {
  const bytes = base64ToBytes(data);
  return new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
}

function createFileFromBlob(blob: Blob, fileName: string): File {
  if (typeof File !== "undefined") {
    return new File([blob], fileName, { type: blob.type });
  }

  return Object.assign(blob, {
    name: fileName,
    lastModified: Date.now(),
  }) as File;
}

export function getAttachmentOriginalDisplayUrl(
  attachment: Attachment,
): string | null {
  if (attachment.url && !isOPFSUrl(attachment.url)) return attachment.url;
  if (attachment.data) {
    return `data:${attachment.mimeType};base64,${attachment.data}`;
  }
  return null;
}

export async function getAttachmentSourceFingerprint(
  attachment: Attachment,
): Promise<string | null> {
  const sourceKind = getSourceKind(attachment);
  const sourceValue = getSourceValue(attachment);
  if (!sourceKind || !sourceValue) return null;

  return sha256(`${attachment.mimeType}\0${sourceKind}\0${sourceValue}`);
}

export async function ensureImageDisplayCache(
  attachment: Attachment,
  options: {
    saveFile?: SaveFile;
    deleteFile?: DeleteFile;
    now?: () => number;
    prefix?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Attachment> {
  options.signal?.throwIfAborted();
  if (!isImageAttachment(attachment)) return attachment;
  if (!attachment.data) return attachment;

  const sourceFingerprint = await getAttachmentSourceFingerprint(attachment);
  options.signal?.throwIfAborted();
  if (!sourceFingerprint) return attachment;

  if (
    attachment.displayCache?.opfsUrl &&
    attachment.displayCache.sourceFingerprint === sourceFingerprint
  ) {
    return attachment;
  }

  try {
    const blob = createBlobFromBase64(attachment.data, attachment.mimeType);
    const file = createFileFromBlob(blob, attachment.fileName);
    const opfsUrl = await (options.saveFile || saveToOPFS)(
      file,
      options.prefix || DEFAULT_IMAGE_CACHE_PREFIX,
    );
    if (options.signal?.aborted) {
      await (options.deleteFile || deleteFromOPFS)(opfsUrl).catch((error) => {
        logDevError("Failed to remove cancelled image cache from OPFS", error);
      });
      options.signal.throwIfAborted();
    }

    return {
      ...attachment,
      displayCache: {
        opfsUrl,
        sourceKind: "data",
        sourceFingerprint,
        createdAt: options.now?.() ?? Date.now(),
      },
    };
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    logDevError("Failed to cache image attachment in OPFS", error);
    return attachment;
  }
}

export async function resolveAttachmentDisplayBlobUrl(
  attachment: Attachment,
  options: {
    resolveOPFSBlob?: ResolveOPFSBlob;
    createObjectURL?: CreateObjectURL;
  } = {},
): Promise<string | null> {
  if (!isImageAttachment(attachment)) return null;

  const createUrl = options.createObjectURL || URL.createObjectURL.bind(URL);
  const readOPFSBlob = options.resolveOPFSBlob || resolveOPFSBlob;

  if (attachment.displayCache?.opfsUrl) {
    try {
      const blob = await readOPFSBlob(attachment.displayCache.opfsUrl);
      if (blob) return createUrl(blob);
    } catch (error) {
      logDevError("Failed to resolve cached image from OPFS", error);
    }
  }

  if (attachment.url && isOPFSUrl(attachment.url)) {
    try {
      const blob = await readOPFSBlob(attachment.url);
      if (blob) return createUrl(blob);
    } catch (error) {
      logDevError("Failed to resolve legacy OPFS image", error);
    }
  }

  if (!attachment.data) return null;

  try {
    return createUrl(
      createBlobFromBase64(attachment.data, attachment.mimeType),
    );
  } catch (error) {
    logDevError("Failed to create image Blob URL", error);
    return null;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

export async function stripAttachmentDisplayCacheForModel(
  attachment: Attachment,
  options: {
    resolveOPFSBlob?: ResolveOPFSBlob;
  } = {},
): Promise<Attachment> {
  const stripped = { ...attachment };
  delete stripped.displayCache;

  if (stripped.url && isOPFSUrl(stripped.url)) {
    if (isImageAttachment(stripped)) {
      delete stripped.data;
      return stripped;
    }
    if (!stripped.data) {
      try {
        const blob = await (options.resolveOPFSBlob || resolveOPFSBlob)(
          stripped.url,
        );
        if (blob) {
          stripped.data = await blobToBase64(blob);
        }
      } catch (error) {
        logDevError(
          "Failed to convert OPFS attachment for model request",
          error,
        );
      }
    }
    delete stripped.url;
  }

  return stripped;
}

export async function stripAttachmentsDisplayCacheForModel(
  attachments: Attachment[] = [],
  options: {
    resolveOPFSBlob?: ResolveOPFSBlob;
  } = {},
): Promise<Attachment[]> {
  return Promise.all(
    attachments.map((attachment) =>
      stripAttachmentDisplayCacheForModel(attachment, options),
    ),
  );
}

function stripToolCallResultImagesForModel(
  toolCall: NonNullable<Message["toolCalls"]>[number],
) {
  const stripped = { ...toolCall };
  delete stripped.resultImages;
  return stripped;
}

async function stripOutputBlockDisplayCacheForModel(
  block: MessageOutputBlock,
  options: {
    resolveOPFSBlob?: ResolveOPFSBlob;
  },
): Promise<MessageOutputBlock> {
  if (block.type === "text" && block.presentation) {
    return { id: block.id, type: "text", content: block.content };
  }
  if (block.type === "tool_group") {
    return {
      ...block,
      toolCalls: block.toolCalls.map(stripToolCallResultImagesForModel),
    };
  }
  if (block.type !== "image") return block;

  return {
    ...block,
    image: await stripAttachmentDisplayCacheForModel(block.image, options),
  };
}

export async function stripMessageDisplayCacheForModel(
  message: Message,
  options: {
    resolveOPFSBlob?: ResolveOPFSBlob;
  } = {},
): Promise<Message> {
  const [attachments, outputBlocks] = await Promise.all([
    message.attachments
      ? stripAttachmentsDisplayCacheForModel(message.attachments, options)
      : Promise.resolve(undefined),
    message.outputBlocks
      ? Promise.all(
          message.outputBlocks.map((block) =>
            stripOutputBlockDisplayCacheForModel(block, options),
          ),
        )
      : Promise.resolve(undefined),
  ]);
  const toolCalls = message.toolCalls?.map(stripToolCallResultImagesForModel);

  return {
    ...message,
    ...(attachments ? { attachments } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(outputBlocks ? { outputBlocks } : {}),
  };
}

export async function stripMessagesDisplayCacheForModel(
  messages: Message[],
  options: {
    resolveOPFSBlob?: ResolveOPFSBlob;
  } = {},
): Promise<Message[]> {
  return Promise.all(
    messages.map((message) =>
      stripMessageDisplayCacheForModel(message, options),
    ),
  );
}
