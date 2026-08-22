import type { MessageOutputBlock } from "@/types";
import { deleteFromOPFS, saveToOPFS, writeToOPFS } from "@/utils/opfs";
import { LONG_TEXT_OPFS_PREFIX } from "@/lib/chat/longText";

type SaveFile = (file: File, prefix?: string) => Promise<string>;
type WriteFile = (url: string, content: string) => Promise<void>;
type DeleteFile = (url?: string) => Promise<void>;

export interface PersistLongTextFilesResult {
  outputBlocks: MessageOutputBlock[];
  createdUrls: string[];
}

const createTextFile = (
  content: string,
  fileName: string,
  mimeType: string,
): File => {
  const blob = new Blob([content], { type: mimeType });
  if (typeof File !== "undefined") {
    return new File([blob], fileName, { type: mimeType });
  }
  return Object.assign(blob, {
    name: fileName,
    lastModified: Date.now(),
  }) as File;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 500)
    : String(error).slice(0, 500);

export async function persistLongTextOutputBlocks(
  blocks: MessageOutputBlock[] = [],
  options: {
    saveFile?: SaveFile;
    writeFile?: WriteFile;
    deleteFile?: DeleteFile;
    signal?: AbortSignal;
  } = {},
): Promise<PersistLongTextFilesResult> {
  const saveFile = options.saveFile || saveToOPFS;
  const writeFile = options.writeFile || writeToOPFS;
  const deleteFile = options.deleteFile || deleteFromOPFS;
  const createdUrls: string[] = [];
  const outputBlocks = blocks.map((block) =>
    block.type === "text" && block.presentation
      ? {
          ...block,
          presentation: {
            ...block.presentation,
            document: { ...block.presentation.document },
          },
        }
      : block,
  );

  for (const block of outputBlocks) {
    if (block.type !== "text" || block.presentation?.kind !== "long_text") {
      continue;
    }

    options.signal?.throwIfAborted();
    const document = block.presentation.document;
    if (!block.content && !document.url) continue;
    try {
      if (document.url) {
        await writeFile(document.url, block.content);
      } else {
        const url = await saveFile(
          createTextFile(block.content, document.fileName, document.mimeType),
          LONG_TEXT_OPFS_PREFIX,
        );
        document.url = url;
        createdUrls.push(url);
      }

      if (options.signal?.aborted) {
        await Promise.all(
          createdUrls.map((url) => deleteFile(url).catch(() => undefined)),
        );
        options.signal.throwIfAborted();
      }
      delete document.localFileMissing;
      delete document.localFileError;
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      document.localFileMissing = true;
      document.localFileError = getErrorMessage(error);
    }
  }

  return { outputBlocks, createdUrls };
}

export async function cleanupCreatedLongTextFiles(
  urls: string[],
  deleteFile: DeleteFile = deleteFromOPFS,
): Promise<void> {
  await Promise.all(urls.map((url) => deleteFile(url).catch(() => undefined)));
}
