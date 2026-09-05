import { describe, expect, it } from "vitest";

import { buildImagePromptInstruction } from "@/lib/chat/imagePrompt";

describe("image prompt helpers", () => {
  it("builds the shared Markdown image citation rules", () => {
    const instruction = buildImagePromptInstruction();

    expect(instruction).toContain("<image-citation>");
    expect(instruction).toContain("standalone Markdown image paragraph");
    expect(instruction).toContain("exact supplied URL");
    expect(instruction).toContain(
      "Never use `>` to wrap or represent an image",
    );
    expect(instruction).toContain("raw `<img>` HTML tag");
    expect(instruction).toContain("inside an HTML element");
    expect(instruction).toContain("Do not force an image");
  });
});
