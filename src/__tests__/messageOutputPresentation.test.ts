import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getMessageOutputBlockSpacingClass,
  normalizeMessageOutputPresentation,
} from "@/lib/chat/messageOutputPresentation";
import type { MessageOutputBlock } from "@/types";

const textBlock = (id: string, content: string): MessageOutputBlock => ({
  id,
  type: "text",
  content,
});

const toolBlock: MessageOutputBlock = {
  id: "tools",
  type: "tool_group",
  toolCalls: [
    {
      id: "call-1",
      name: "search_web",
      args: {},
      status: "success",
    },
  ],
};

describe("message output presentation", () => {
  it("uses one shared margin contract for operational blocks", () => {
    expect(getMessageOutputBlockSpacingClass(false)).toBe("mb-3");
    expect(getMessageOutputBlockSpacingClass(true)).toBe("mb-3 mt-3");

    const renderer = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MessageOutputRenderer.tsx",
      ),
      "utf8",
    );
    expect(renderer).toContain("data-message-output-block");
    expect(renderer).toContain("getMessageOutputBlockSpacingClass(index > 0)");
    expect(renderer).toContain("[&>*]:m-0!");
    expect(renderer).toContain("node: <AgentRunBar");
    expect(renderer).toContain("node: <TaskPlanBlock");
    expect(renderer).toContain("<ConnectedResearchTaskCard");
    expect(renderer).toContain("<SourceBlock");
    expect(renderer).toContain("node: <MemorySearchBlock");
    expect(renderer).toContain("<ToolCallBlock");
    expect(renderer).toContain("<ReasoningBlock");
  });
  it("keeps Chinese and English word fragments together until a newline", () => {
    const chinese = normalizeMessageOutputPresentation([
      textBlock("before", "资"),
      toolBlock,
      textBlock("after", "料\n下一段"),
    ]);
    const english = normalizeMessageOutputPresentation([
      textBlock("before", "resea"),
      toolBlock,
      textBlock("after", "rch\nNext paragraph"),
    ]);

    expect(chinese).toEqual([
      textBlock("before", "资料\n"),
      toolBlock,
      textBlock("after", "下一段"),
    ]);
    expect(english).toEqual([
      textBlock("before", "research\n"),
      toolBlock,
      textBlock("after", "Next paragraph"),
    ]);
  });

  it("moves a whole visible continuation when no newline exists yet", () => {
    expect(
      normalizeMessageOutputPresentation([
        textBlock("before", "资"),
        toolBlock,
        textBlock("after", "料"),
      ]),
    ).toEqual([textBlock("before", "资料"), toolBlock]);
  });

  it("does not use punctuation as a safe boundary", () => {
    const blocks = normalizeMessageOutputPresentation([
      textBlock("before", "第一句。仍在同一行"),
      toolBlock,
      textBlock("after", "继续\n下一段"),
    ]);

    expect(blocks).toEqual([
      textBlock("before", "第一句。仍在同一行继续\n"),
      toolBlock,
      textBlock("after", "下一段"),
    ]);
  });

  it("keeps a completed line boundary and consecutive activity blocks in order", () => {
    const searchBlock: MessageOutputBlock = {
      id: "search",
      type: "search",
      isSearching: false,
      sources: [],
      images: [],
    };
    const reasoningBlock: MessageOutputBlock = {
      id: "reasoning",
      type: "reasoning",
      content: "Checked sources.",
    };
    const planBlock: MessageOutputBlock = {
      id: "plan",
      type: "task_plan",
      steps: [{ title: "Verify", status: "completed" }],
    };
    const input = [
      textBlock("before", "完整一行\n"),
      toolBlock,
      searchBlock,
      reasoningBlock,
      planBlock,
      textBlock("after", "下一行"),
    ];

    expect(normalizeMessageOutputPresentation(input)).toEqual(input);
  });

  it("waits for a fenced code block to close before placing activity", () => {
    const blocks = normalizeMessageOutputPresentation([
      textBlock("before", "示例\n```ts\nconst value"),
      toolBlock,
      textBlock("after", " = 1;\n```\n后文"),
    ]);

    expect(blocks).toEqual([
      textBlock("before", "示例\n```ts\nconst value = 1;\n```\n"),
      toolBlock,
      textBlock("after", "后文"),
    ]);
  });

  it("does not move text across content block boundaries", () => {
    const image: MessageOutputBlock = {
      id: "image",
      type: "image",
      image: {
        id: "generated",
        mimeType: "image/png",
        data: "image-data",
        fileName: "generated.png",
      },
    };
    const input = [
      textBlock("before", "资"),
      image,
      toolBlock,
      textBlock("after", "料\n下一段"),
    ];

    expect(normalizeMessageOutputPresentation(input)).toEqual(input);
  });

  it("preserves the exact concatenated model text", () => {
    const input = [
      textBlock("before", "第一段"),
      toolBlock,
      textBlock("after", "续写\n第二段"),
    ];
    const output = normalizeMessageOutputPresentation(input);
    const concatenate = (blocks: MessageOutputBlock[]) =>
      blocks
        .filter((block) => block.type === "text")
        .map((block) => block.content)
        .join("");

    expect(concatenate(output)).toBe(concatenate(input));
  });
});
