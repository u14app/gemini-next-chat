import type {
  LongTextFormat,
  LongTextPresentation,
  MessageOutputBlock,
} from "@/types";
import { sanitizeDownloadFilename } from "@/lib/utils/filename";

export const LONG_TEXT_TOOL_NAME = "start_long_text_output";
export const LONG_TEXT_TITLE_MAX_LENGTH = 180;
export const LONG_TEXT_PREVIEW_MAX_LENGTH = 2_400;
export const LONG_TEXT_OPFS_PREFIX = "chat/long-text";

export interface LongTextOutputRequest {
  title: string;
  format: LongTextFormat;
}

export type LongTextOutputParseResult =
  | { ok: true; value: LongTextOutputRequest }
  | {
      ok: false;
      error: {
        code: "INVALID_LONG_TEXT_OUTPUT";
        message: string;
      };
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const invalidRequest = (message: string): LongTextOutputParseResult => ({
  ok: false,
  error: { code: "INVALID_LONG_TEXT_OUTPUT", message },
});

export function parseLongTextOutputRequest(
  input: unknown,
): LongTextOutputParseResult {
  if (!isRecord(input)) {
    return invalidRequest("Long text output arguments must be an object.");
  }

  const unexpectedKeys = Object.keys(input).filter(
    (key) => key !== "title" && key !== "format",
  );
  if (unexpectedKeys.length > 0) {
    return invalidRequest(
      `Unexpected long text output field: ${unexpectedKeys[0]}.`,
    );
  }

  if (typeof input.title !== "string") {
    return invalidRequest("A document title is required.");
  }
  const title = input.title.trim();
  if (!title || title.length > LONG_TEXT_TITLE_MAX_LENGTH) {
    return invalidRequest(
      `The document title must contain 1-${LONG_TEXT_TITLE_MAX_LENGTH} characters.`,
    );
  }

  const format = input.format ?? "markdown";
  if (format !== "markdown" && format !== "plain_text") {
    return invalidRequest(
      'The document format must be either "markdown" or "plain_text".',
    );
  }

  return { ok: true, value: { title, format } };
}

export function createLongTextPresentation(
  request: LongTextOutputRequest,
): LongTextPresentation {
  const extension = request.format === "markdown" ? "md" : "txt";
  const mimeType =
    request.format === "markdown" ? "text/markdown" : "text/plain";
  const fileNameStem =
    request.title.replace(/\.(?:md|markdown|txt)$/i, "").trim() || "document";
  const fileName = sanitizeDownloadFilename(
    `${fileNameStem}.${extension}`,
    `document.${extension}`,
  );

  return {
    kind: "long_text",
    title: request.title,
    format: request.format,
    document: { fileName, mimeType },
  };
}

export function normalizeLongTextPresentation(
  input: unknown,
): LongTextPresentation | undefined {
  if (!isRecord(input) || input.kind !== "long_text") return undefined;
  const parsed = parseLongTextOutputRequest({
    title: input.title,
    format: input.format,
  });
  if (!parsed.ok || !isRecord(input.document)) return undefined;

  const expected = createLongTextPresentation(parsed.value);
  const expectedMimeType = expected.document.mimeType;
  if (input.document.mimeType !== expectedMimeType) return undefined;

  const fileName = sanitizeDownloadFilename(
    input.document.fileName,
    expected.document.fileName,
  );
  const url =
    typeof input.document.url === "string" &&
    input.document.url.startsWith("opfs://chat/")
      ? input.document.url
      : undefined;
  const localFileMissing = input.document.localFileMissing === true;
  const localFileError =
    typeof input.document.localFileError === "string"
      ? input.document.localFileError.slice(0, 500)
      : undefined;

  return {
    ...expected,
    document: {
      fileName,
      mimeType: expectedMimeType,
      ...(url ? { url } : {}),
      ...(localFileMissing ? { localFileMissing: true } : {}),
      ...(localFileError ? { localFileError } : {}),
    },
  };
}

export function getLongTextPreview(
  content: string,
  maxLength = LONG_TEXT_PREVIEW_MAX_LENGTH,
): { content: string; truncated: boolean } {
  if (content.length <= maxLength) return { content, truncated: false };

  const hardLimit = Math.max(1, maxLength);
  const candidate = content.slice(0, hardLimit);
  const minimumBoundary = Math.floor(hardLimit * 0.6);
  const paragraphBoundary = candidate.lastIndexOf("\n\n");
  const lineBoundary = candidate.lastIndexOf("\n");
  const boundary =
    paragraphBoundary >= minimumBoundary
      ? paragraphBoundary
      : lineBoundary >= minimumBoundary
        ? lineBoundary
        : hardLimit;

  return { content: candidate.slice(0, boundary).trimEnd(), truncated: true };
}

export const getLongTextBlocks = (
  blocks: MessageOutputBlock[] = [],
): Array<Extract<MessageOutputBlock, { type: "text" }>> =>
  blocks.filter(
    (block): block is Extract<MessageOutputBlock, { type: "text" }> =>
      block.type === "text" && block.presentation?.kind === "long_text",
  );

/** Flat message editing cannot preserve the boundary between these text blocks. */
export function hasMixedLongTextOutput(
  blocks: MessageOutputBlock[] = [],
): boolean {
  let textBlockCount = 0;
  let hasLongText = false;

  for (const block of blocks) {
    if (block.type !== "text") continue;
    textBlockCount += 1;
    hasLongText ||= block.presentation?.kind === "long_text";
  }

  return hasLongText && textBlockCount > 1;
}
