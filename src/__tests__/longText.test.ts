import { describe, expect, it } from "vitest";

import {
  createLongTextPresentation,
  getLongTextPreview,
  normalizeLongTextPresentation,
  parseLongTextOutputRequest,
} from "@/lib/chat/longText";

describe("long text output metadata", () => {
  it("validates the declaration and defaults to Markdown", () => {
    expect(parseLongTextOutputRequest({ title: "  Field notes  " })).toEqual({
      ok: true,
      value: { title: "Field notes", format: "markdown" },
    });
    expect(
      parseLongTextOutputRequest({
        title: "Transcript",
        format: "plain_text",
      }),
    ).toEqual({
      ok: true,
      value: { title: "Transcript", format: "plain_text" },
    });
  });

  it("rejects empty, oversized, malformed, and additional arguments", () => {
    for (const input of [
      {},
      { title: " " },
      { title: "x".repeat(181) },
      { title: "Notes", format: "html" },
      { title: "Notes", body: "must not be accepted" },
      null,
    ]) {
      expect(parseLongTextOutputRequest(input)).toMatchObject({
        ok: false,
        error: { code: "INVALID_LONG_TEXT_OUTPUT" },
      });
    }
  });

  it("creates safe document metadata and normalizes persisted values", () => {
    const presentation = createLongTextPresentation({
      title: "Plan / Q3",
      format: "markdown",
    });
    expect(presentation).toEqual({
      kind: "long_text",
      title: "Plan / Q3",
      format: "markdown",
      document: {
        fileName: "Plan _ Q3.md",
        mimeType: "text/markdown",
      },
    });
    expect(
      createLongTextPresentation({
        title: "Already named.md",
        format: "markdown",
      }).document.fileName,
    ).toBe("Already named.md");

    expect(
      normalizeLongTextPresentation({
        ...presentation,
        document: {
          ...presentation.document,
          url: "opfs://chat/restored-backup/document.md",
          localFileMissing: true,
          localFileError: "missing",
        },
      }),
    ).toMatchObject({
      document: {
        url: "opfs://chat/restored-backup/document.md",
        localFileMissing: true,
        localFileError: "missing",
      },
    });
    expect(
      normalizeLongTextPresentation({
        ...presentation,
        document: {
          ...presentation.document,
          url: "https://example.com/not-local.md",
        },
      })?.document.url,
    ).toBeUndefined();
  });

  it("trims previews at a nearby paragraph boundary", () => {
    const preview = getLongTextPreview(
      `${"a".repeat(80)}\n\n${"b".repeat(80)}`,
      120,
    );
    expect(preview).toEqual({ content: "a".repeat(80), truncated: true });
    expect(getLongTextPreview("short", 120)).toEqual({
      content: "short",
      truncated: false,
    });
  });
});
