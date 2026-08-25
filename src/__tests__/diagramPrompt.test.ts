import { describe, expect, it } from "vitest";
import { allPlugins, parseMarkdownWithFrontMatter } from "@xiangfa/mindmap";
import {
  appendDiagramRequestInstructions,
  buildDiagramPromptInstruction,
  isDiagramPromptInstructionEnabled,
  isEnhancedDiagramPromptInstructionEnabled,
  MINDMAP_PROMPT_EXAMPLE,
} from "../lib/chat/diagramPrompt";
import { parseMarkdownDiagramBlocks } from "../lib/utils/markdownDiagrams";

describe("diagram prompt helpers", () => {
  it("builds base diagram guidance with separated Mermaid and mindmap formats", () => {
    const instruction = buildDiagramPromptInstruction();

    expect(instruction).toContain("<diagram-rendering>");
    expect(instruction).toContain("```mermaid");
    expect(instruction).toContain("```mindmap");
    expect(instruction).toContain("fully closed");
    expect(instruction).toContain("first tree-content line is the root node");
    expect(instruction).toContain("every child line starts with `- `");
    expect(instruction).toContain("exactly two additional spaces");
    expect(instruction).toContain("never use tabs");
    expect(instruction).toContain("JSON");
    expect(instruction).toContain("Markdown headings");
    expect(instruction).toContain("blank line");
    expect(instruction).toContain("frontmatter");
    expect(instruction).toContain("task states");
    expect(instruction).toContain("collapsed branches");
    expect(instruction).toContain("tags");
    expect(instruction).toContain("cross-links");
    expect(instruction).not.toContain("<diagram-visual-polish>");
    expect(isDiagramPromptInstructionEnabled(instruction)).toBe(true);
    expect(isEnhancedDiagramPromptInstructionEnabled(instruction)).toBe(false);
  });

  it("adds enhanced diagram style guidance only when requested", () => {
    const instruction = buildDiagramPromptInstruction({ enhanced: true });

    expect(instruction).toContain("<diagram-rendering>");
    expect(instruction).toContain("<diagram-visual-polish>");
    expect(instruction).toContain("theme-aware");
    expect(instruction).toContain("short node labels");
    expect(isDiagramPromptInstructionEnabled(instruction)).toBe(true);
    expect(isEnhancedDiagramPromptInstructionEnabled(instruction)).toBe(true);
  });

  it("appends request-level diagram guidance and avoids duplicates", () => {
    const systemInstruction = buildDiagramPromptInstruction({ enhanced: true });
    const message = appendDiagramRequestInstructions(
      "Explain this architecture.",
      systemInstruction,
    );

    expect(message).toContain("Explain this architecture.");
    expect(message).toContain('data-diagram-rendering="true"');
    expect(message).toContain("Mermaid");
    expect(message).toContain("mindmap");
    expect(message).toContain("fully closed");
    expect(message).toContain("unprefixed root");
    expect(message).toContain("each deeper level adds exactly two spaces");
    expect(message).toContain("Never put a Mermaid `mindmap` declaration");
    expect(message).toContain("enhanced visual style");

    expect(appendDiagramRequestInstructions(message, systemInstruction)).toBe(
      message,
    );
  });

  it("leaves request text unchanged when diagram guidance is absent", () => {
    expect(
      appendDiagramRequestInstructions("Use normal Markdown.", "plain prompt"),
    ).toBe("Use normal Markdown.");
  });

  it("ships a canonical example accepted by the installed mindmap parser", () => {
    const parsed = parseMarkdownWithFrontMatter(
      MINDMAP_PROMPT_EXAMPLE,
      allPlugins,
    );

    expect(parsed.frontMatter).toEqual({});
    expect(parsed.roots).toHaveLength(1);
    expect(parsed.roots[0]).toMatchObject({
      text: "Project Planning",
      children: [
        {
          text: "Goals",
          children: [{ text: "Scope" }, { text: "Success criteria" }],
        },
        {
          text: "Delivery",
          children: [{ text: "Milestones" }, { text: "Verification" }],
        },
      ],
    });
  });

  it("routes the canonical closed fence into the current mindmap renderer", () => {
    const segments = parseMarkdownDiagramBlocks(
      `\`\`\`mindmap\n${MINDMAP_PROMPT_EXAMPLE}\n\`\`\``,
    );

    expect(segments).toEqual([
      {
        kind: "diagram",
        diagram: {
          type: "mindmap",
          language: "mindmap",
          content: MINDMAP_PROMPT_EXAMPLE,
          incomplete: false,
        },
      },
    ]);
  });
});
