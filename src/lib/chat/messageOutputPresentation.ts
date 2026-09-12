import type { MessageOutputBlock } from "@/types";

type TextOutputBlock = Extract<MessageOutputBlock, { type: "text" }>;

const ACTIVITY_BLOCK_TYPES = new Set<MessageOutputBlock["type"]>([
  "reasoning",
  "research_task",
  "search",
  "task_plan",
  "tool_group",
  "workspace_archive",
  "workspace_file",
  "image_generation_status",
]);

const isPlainTextBlock = (
  block: MessageOutputBlock | undefined,
): block is TextOutputBlock => block?.type === "text" && !block.presentation;

const isActivityBlock = (block: MessageOutputBlock | undefined) =>
  Boolean(block && ACTIVITY_BLOCK_TYPES.has(block.type));

interface FenceMarker {
  character: "`" | "~";
  length: number;
}

export function getMessageOutputBlockSpacingClass(
  previousElementIsUnframed: boolean,
): string {
  return previousElementIsUnframed ? "mb-3 mt-3" : "mb-3";
}

function getOpeningFence(line: string): FenceMarker | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/u);
  if (!match) return null;
  return {
    character: match[1]![0] as FenceMarker["character"],
    length: match[1]!.length,
  };
}

function isClosingFence(line: string, fence: FenceMarker): boolean {
  const marker = fence.character.repeat(fence.length);
  return new RegExp(`^ {0,3}${marker}${fence.character}*[\\t ]*$`, "u").test(
    line,
  );
}

/**
 * Finds the first line boundary at or after `start`. Newlines inside fenced
 * code are ignored until the matching fence closes.
 */
function findFirstSafeBoundary(text: string, start: number): number | null {
  let offset = 0;
  let fence: FenceMarker | null = null;

  while (offset < text.length) {
    const lineBreak = /\r\n|\n|\r/gu;
    lineBreak.lastIndex = offset;
    const match = lineBreak.exec(text);
    const lineEnd = match?.index ?? text.length;
    const boundaryEnd = match ? match.index + match[0].length : text.length;
    const line = text.slice(offset, lineEnd);
    let openedFence = false;
    let closedFence = false;

    if (fence) {
      if (isClosingFence(line, fence)) {
        fence = null;
        closedFence = true;
      }
    } else {
      const openingFence = getOpeningFence(line);
      if (openingFence) {
        fence = openingFence;
        openedFence = true;
      }
    }

    if (boundaryEnd >= start) {
      if (closedFence) return boundaryEnd;
      if (match && !fence && !openedFence) return boundaryEnd;
    }

    if (!match) break;
    offset = boundaryEnd;
  }

  return null;
}

/**
 * Keeps operational cards interleaved with model text without allowing them
 * to split a visible line. The persisted block order is never mutated.
 */
export function normalizeMessageOutputPresentation(
  blocks: readonly MessageOutputBlock[],
): MessageOutputBlock[] {
  const normalized = blocks.map((block) =>
    block.type === "text" ? { ...block } : block,
  );

  let index = 0;
  while (index < normalized.length) {
    const left = normalized[index];
    if (!isPlainTextBlock(left)) {
      index += 1;
      continue;
    }

    let rightIndex = index + 1;
    while (isActivityBlock(normalized[rightIndex])) rightIndex += 1;
    const right = normalized[rightIndex];
    if (rightIndex === index + 1 || !isPlainTextBlock(right)) {
      index += 1;
      continue;
    }

    const combined = left.content + right.content;
    const boundary = findFirstSafeBoundary(combined, left.content.length);
    if (boundary !== null && boundary <= left.content.length) {
      index = rightIndex;
      continue;
    }

    const prefixLength =
      boundary === null ? right.content.length : boundary - left.content.length;
    left.content += right.content.slice(0, prefixLength);
    right.content = right.content.slice(prefixLength);

    if (!right.content) {
      normalized.splice(rightIndex, 1);
      continue;
    }
    index = rightIndex;
  }

  return normalized;
}
