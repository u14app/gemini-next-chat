/**
 * Minimal HTML → markdown-ish text extraction for the `fetch_url` tool.
 *
 * This is deliberately a lossy reader, not a converter: the goal is to hand the
 * model readable prose at a fraction of the token cost of raw HTML. It is pure
 * and dependency-free so it can run on the server and be unit-tested directly.
 */

const BLOCK_TAGS =
  "address|article|aside|blockquote|div|dl|dd|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    const key = String(entity);
    if (key in HTML_ENTITIES) return HTML_ENTITIES[key];
    if (key.startsWith("#x") || key.startsWith("#X")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

/** Pulls the document title out of `<title>` or the first `<h1>`. */
export function extractHtmlTitle(html: string): string | undefined {
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (!title) return undefined;
  const text = decodeHtmlEntities(title.replace(/<[^>]+>/g, "")).trim();
  return text || undefined;
}

export function htmlToReadableText(html: string): string {
  return (
    html
      // Anything that is never prose.
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(
        /<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi,
        "",
      )
      .replace(/<(head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
      // Headings become markdown so the model keeps the document outline.
      .replace(
        /<h([1-6])[^>]*>/gi,
        (_, level) => `\n\n${"#".repeat(Number(level))} `,
      )
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      // `</li>` must not become a blank line, or every list item is spaced out.
      .replace(/<\/li\s*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(new RegExp(`</?(?:${BLOCK_TAGS})[^>]*>`, "gi"), "\n\n")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((line) =>
        decodeHtmlEntities(line)
          .replace(/[^\S\n]+/g, " ")
          .trim(),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export interface ReadableDocument {
  title?: string;
  content: string;
  truncated: boolean;
}

export function toReadableDocument(
  body: string,
  contentType: string,
  maxChars: number,
): ReadableDocument {
  const isHtml = contentType.includes("html");
  const title = isHtml ? extractHtmlTitle(body) : undefined;
  const text = isHtml ? htmlToReadableText(body) : body.trim();

  return {
    title,
    content: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}
