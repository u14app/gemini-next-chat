import { describe, expect, it } from "vitest";
import {
  buildConversationFileName,
  buildConversationTranscript,
  buildVisibleConversationSource,
  consumeComposerTrigger,
  CONVERSATION_REFERENCE_MAX_CHARS,
  detectComposerTrigger,
  filterComposerItems,
} from "../lib/utils/composerCommands";
import { ATTACHMENT_LIMITS } from "../config/limits";

describe("detectComposerTrigger", () => {
  it("opens for a slash only at the start of the composer", () => {
    expect(detectComposerTrigger("/att", 4)).toEqual({
      trigger: "/",
      query: "att",
      start: 0,
      end: 4,
    });
    expect(detectComposerTrigger("/", 1)).toMatchObject({
      trigger: "/",
      query: "",
    });
  });

  it("ignores slashes that are not a command prefix", () => {
    expect(detectComposerTrigger("and/or", 6)).toBeNull();
    expect(detectComposerTrigger("https://example.com", 19)).toBeNull();
    expect(detectComposerTrigger("see /docs", 9)).toBeNull();
  });

  it("opens for an at-sign at the start or after whitespace", () => {
    expect(detectComposerTrigger("@wea", 4)).toMatchObject({
      trigger: "@",
      query: "wea",
      start: 0,
    });
    expect(detectComposerTrigger("ask @wea", 8)).toMatchObject({
      trigger: "@",
      query: "wea",
      start: 4,
      end: 8,
    });
  });

  it("ignores an at-sign glued to preceding text", () => {
    expect(detectComposerTrigger("user@example", 12)).toBeNull();
  });

  it("closes once the query contains whitespace", () => {
    expect(detectComposerTrigger("/attach file", 12)).toBeNull();
    expect(detectComposerTrigger("@weather now", 12)).toBeNull();
  });

  it("returns null when the caret sits before the trigger", () => {
    expect(detectComposerTrigger("/attach", 0)).toBeNull();
    expect(detectComposerTrigger("hello @weather", 3)).toBeNull();
  });

  it("gives up on queries longer than the scan window", () => {
    const long = `@${"a".repeat(80)}`;
    expect(detectComposerTrigger(long, long.length)).toBeNull();
  });

  it("rejects out-of-range carets", () => {
    expect(detectComposerTrigger("/a", -1)).toBeNull();
    expect(detectComposerTrigger("/a", 5)).toBeNull();
  });
});

describe("filterComposerItems", () => {
  const items = [
    { token: "new-chat", label: "New chat" },
    { token: "compress", label: "Compress context" },
    { token: "renew", label: "Renew session" },
  ];

  it("returns every item for an empty query", () => {
    expect(filterComposerItems(items, "  ")).toEqual(items);
  });

  it("ranks prefix matches above substring matches", () => {
    expect(filterComposerItems(items, "new").map((item) => item.token)).toEqual(
      ["new-chat", "renew"],
    );
  });

  it("matches case-insensitively on token and label", () => {
    expect(
      filterComposerItems(items, "COMPRESS").map((item) => item.token),
    ).toEqual(["compress"]);
    expect(
      filterComposerItems(items, "session").map((item) => item.token),
    ).toEqual(["renew"]);
  });

  it("returns nothing when no item matches", () => {
    expect(filterComposerItems(items, "zzz")).toEqual([]);
  });
});

describe("consumeComposerTrigger", () => {
  it("removes the token and leaves the caret at its start", () => {
    const text = "ask @weather";
    const match = detectComposerTrigger(text, text.length)!;
    expect(consumeComposerTrigger(text, match)).toEqual({
      text: "ask ",
      caret: 4,
    });
  });

  it("keeps text after the caret intact", () => {
    const text = "@wea rest";
    const match = detectComposerTrigger(text, 4)!;
    expect(consumeComposerTrigger(text, match)).toEqual({
      text: " rest",
      caret: 0,
    });
  });
});

describe("conversation transcript helpers", () => {
  it("slugifies titles into a markdown file name", () => {
    expect(buildConversationFileName("Trip planning 2026!")).toBe(
      "Trip-planning-2026.md",
    );
    expect(buildConversationFileName("需求 讨论")).toBe("需求-讨论.md");
  });

  it("falls back to a generic name for title-less conversations", () => {
    expect(buildConversationFileName("   ")).toBe("conversation.md");
    expect(buildConversationFileName("***")).toBe("conversation.md");
  });

  it("wraps the serialized log under a title heading", () => {
    expect(buildConversationTranscript("Trip", "[USER]: hi\n\n")).toBe(
      "# Trip\n\n[USER]: hi\n",
    );
    expect(buildConversationTranscript("  ", "body")).toBe(
      "# Untitled conversation\n\nbody\n",
    );
  });

  it("serializes only visible message content for conversation references", () => {
    const source = buildVisibleConversationSource([
      {
        role: "user",
        content: "Visible question",
        memoryContext: {
          injectedMemoryIds: ["private-memory"],
          promptContext: "Hidden deployment credential",
        },
      },
      { role: "model", content: "Visible answer" },
    ]);

    expect(source).toBe("[USER]: Visible question\n\n[MODEL]: Visible answer");
    expect(source).not.toContain("Hidden deployment credential");
    expect(source).not.toContain("MEMORY CONTEXT");
  });

  it("caps a referenced conversation well under the attachment budget", () => {
    expect(CONVERSATION_REFERENCE_MAX_CHARS).toBeLessThan(
      ATTACHMENT_LIMITS.maxTotalBase64Chars,
    );
    expect(CONVERSATION_REFERENCE_MAX_CHARS).toBeGreaterThan(0);
  });
});
