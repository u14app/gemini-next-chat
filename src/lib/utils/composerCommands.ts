import { ATTACHMENT_LIMITS } from "@/config/limits";

export type ComposerTrigger = "/" | "@";

export interface ComposerTriggerMatch {
  trigger: ComposerTrigger;
  /** Text typed after the trigger character, up to the caret. */
  query: string;
  /** Index of the trigger character within the composer value. */
  start: number;
  /** Caret index, i.e. the exclusive end of the trigger token. */
  end: number;
}

export interface ComposerFilterableItem {
  /** The text typed after the trigger to select this item, e.g. `new-chat`. */
  token: string;
  label: string;
}

const MAX_TRIGGER_QUERY_CHARS = 64;

function isTriggerBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Detects an in-progress `/` command or `@` reference token at the caret.
 *
 * `/` only triggers at the very start of the composer because it reads as a
 * command prefix; `@` triggers at the start or after whitespace so it can be
 * used mid-sentence.
 */
export function detectComposerTrigger(
  text: string,
  caret: number,
): ComposerTriggerMatch | null {
  if (caret < 0 || caret > text.length) return null;

  for (let index = caret - 1; index >= 0; index--) {
    const char = text[index];
    if (/\s/.test(char)) return null;

    if (char === "/" || char === "@") {
      if (char === "/" && index !== 0) return null;
      if (char === "@" && index !== 0 && !isTriggerBoundary(text[index - 1])) {
        return null;
      }

      return {
        trigger: char,
        query: text.slice(index + 1, caret),
        start: index,
        end: caret,
      };
    }

    if (caret - index > MAX_TRIGGER_QUERY_CHARS) return null;
  }

  return null;
}

/**
 * Case-insensitive substring match over `token` and `label`, ranked so prefix
 * matches surface above mid-string matches. Preserves input order within a
 * rank so callers keep control of the default ordering.
 */
export function filterComposerItems<T extends ComposerFilterableItem>(
  items: readonly T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];

  const prefixed: T[] = [];
  const contained: T[] = [];

  for (const item of items) {
    const token = item.token.toLowerCase();
    const label = item.label.toLowerCase();

    if (token.startsWith(normalized) || label.startsWith(normalized)) {
      prefixed.push(item);
    } else if (token.includes(normalized) || label.includes(normalized)) {
      contained.push(item);
    }
  }

  return [...prefixed, ...contained];
}

/** Removes the trigger token from the composer value once an item is picked. */
export function consumeComposerTrigger(
  text: string,
  match: ComposerTriggerMatch,
): { text: string; caret: number } {
  const next = `${text.slice(0, match.start)}${text.slice(match.end)}`;
  return { text: next, caret: match.start };
}

/** Filesystem-safe file name for a referenced conversation attachment. */
export function buildConversationFileName(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "conversation"}.md`;
}

/** Wraps a serialized message log in a titled markdown document. */
export function buildConversationTranscript(
  title: string,
  body: string,
): string {
  const heading = title.trim() || "Untitled conversation";
  return `# ${heading}\n\n${body.trim()}\n`;
}

/**
 * Conversation transcripts are injected silently, so cap them well below the
 * total attachment budget to leave room for files the user picked themselves.
 */
export const CONVERSATION_REFERENCE_MAX_CHARS = Math.floor(
  ATTACHMENT_LIMITS.maxTotalBase64Chars / 4,
);
