import { describe, expect, it } from "vitest";
import { allPlugins, parseMarkdownWithFrontMatter } from "@xiangfa/mindmap";
import {
  appendDiagramRequestInstructions,
  buildDiagramPromptInstruction,
  isDiagramPromptInstructionEnabled,
  isEnhancedDiagramPromptInstructionEnabled,
  CHART_PROMPT_EXAMPLE,
  MINDMAP_PROMPT_EXAMPLE,
} from "../lib/chat/diagramPrompt";
import { parseMarkdownDiagramBlocks } from "../lib/utils/markdownDiagrams";

describe("diagram prompt helpers", () => {
  it("builds base diagram guidance with separated Mermaid and mindmap formats", () => {
    const instruction = buildDiagramPromptInstruction();

    expect(instruction).toContain("<diagram-rendering>");
    expect(instruction).toContain("```mermaid");
    expect(instruction).toContain("```mindmap");
    expect(instruction).toContain("```chart");
    expect(instruction).toContain('"version": 1');
    expect(instruction).toContain('"renderer": "echarts"');
    expect(instruction).toContain('"kind": "inline"');
    expect(instruction).toContain('"dimensions"');
    expect(instruction).toContain('"source"');
    expect(instruction).toContain('"spec"');
    expect(instruction).toContain("explicit JSON hex colors");
    expect(instruction).toContain("var(--chart-1)");
    expect(instruction).toContain("12 or fewer");
    expect(instruction).toContain(
      "Never put chart envelopes in tool arguments, function inputs, Research plans or execution payloads",
    );
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
    expect(message).toContain("chart");
    expect(message).toContain('renderer: "echarts"');
    expect(message).toContain("explicit JSON hex colors");
    expect(message).toContain("markdown-chart");
    expect(message).toContain(
      "Never use chart envelopes in tool arguments or structured outputs",
    );
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

  it("ships a canonical chart envelope with inline data and explicit colors", () => {
    const chart = JSON.parse(CHART_PROMPT_EXAMPLE) as {
      version: number;
      renderer: string;
      data: {
        kind: string;
        dimensions: string[];
        source: unknown[];
      };
      spec: {
        color: string[];
        series: unknown[];
      };
    };

    expect(chart.version).toBe(1);
    expect(chart.renderer).toBe("echarts");
    expect(chart.data.kind).toBe("inline");
    expect(chart.data.dimensions).toEqual(["Quarter", "Sign-ups"]);
    expect(chart.data.source).toHaveLength(4);
    expect(chart.spec.series).toHaveLength(1);
    expect(chart.spec.color).toEqual([
      "#18B7C9",
      "#6FD6A7",
      "#8E7CF5",
      "#F5B85B",
      "#E8799C",
    ]);
    expect(CHART_PROMPT_EXAMPLE).not.toContain("var(--");
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
