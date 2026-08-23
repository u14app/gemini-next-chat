import { describe, expect, it } from "vitest";

import {
  decodeHtmlEntities,
  extractHtmlTitle,
  htmlToReadableText,
  toReadableDocument,
} from "../lib/agent/readableDocument";

describe("readableDocument", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &#39;d&#39; &#x41;")).toBe(
      "a & b <c> 'd' A",
    );
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeHtmlEntities("&notarealentity;")).toBe("&notarealentity;");
  });

  it("prefers <title> and falls back to the first <h1>", () => {
    expect(extractHtmlTitle("<title>Hello &amp; Co</title>")).toBe(
      "Hello & Co",
    );
    expect(extractHtmlTitle("<body><h1>Fallback</h1></body>")).toBe("Fallback");
    expect(extractHtmlTitle("<p>no title</p>")).toBeUndefined();
  });

  it("drops scripts, styles, and head content entirely", () => {
    const text = htmlToReadableText(
      "<head><title>t</title></head><body><script>alert(1)</script><style>p{}</style><p>Visible</p></body>",
    );

    expect(text).toBe("Visible");
    expect(text).not.toContain("alert");
  });

  it("keeps the document outline as markdown", () => {
    expect(
      htmlToReadableText(
        "<h2>Title</h2><p>Body</p><ul><li>One</li><li>Two</li></ul>",
      ),
    ).toBe("## Title\n\nBody\n\n- One\n- Two");
  });

  it("collapses runs of whitespace and blank lines", () => {
    expect(htmlToReadableText("<p>a    b</p>\n\n\n\n<p>c</p>")).toBe(
      "a b\n\nc",
    );
  });

  it("truncates at the character budget and reports it", () => {
    const doc = toReadableDocument(
      "<title>T</title><p>abcdefghij</p>",
      "text/html; charset=utf-8",
      4,
    );

    expect(doc).toEqual({ title: "T", content: "abcd", truncated: true });
  });

  it("passes plain text through without HTML handling", () => {
    const doc = toReadableDocument("  a < b & c  ", "text/plain", 100);

    expect(doc).toEqual({
      title: undefined,
      content: "a < b & c",
      truncated: false,
    });
  });
});
