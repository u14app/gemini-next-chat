import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMessageOutputBlockBuilder,
  getMessageOutputBlocks,
} from "../lib/chat/messageOutputBlocks";
import type { Message, MessageOutputBlock } from "../types";

describe("message output blocks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps separate tool groups when text appears between tool calls", () => {
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    });

    builder.appendText("Before ");
    builder.appendToolCall({
      id: "call_1",
      name: "lookup",
      args: { q: "one" },
      status: "pending",
    });
    builder.appendText("After ");
    builder.appendToolCall({
      id: "call_2",
      name: "lookup",
      args: { q: "two" },
      status: "pending",
    });

    expect(builder.getBlocks().map((block) => block.type)).toEqual([
      "text",
      "tool_group",
      "text",
      "tool_group",
    ]);
  });

  it("keeps generated images in model output order", () => {
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    });

    builder.appendText("Before ");
    builder.appendImage({
      id: "img_1",
      mimeType: "image/png",
      data: "abc123",
      fileName: "generated.png",
    });
    builder.appendText("After");

    expect(builder.getBlocks()).toEqual([
      { id: "block-1", type: "text", content: "Before " },
      {
        id: "block-2",
        type: "image",
        image: {
          id: "img_1",
          mimeType: "image/png",
          data: "abc123",
          fileName: "generated.png",
        },
      },
      { id: "block-3", type: "text", content: "After" },
    ]);
  });

  it("creates a long text block only when the next body token arrives", () => {
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    });

    builder.appendText("I will prepare a document.");
    builder.appendToolCall({
      id: "long-text-call",
      name: "start_long_text_output",
      args: { title: "Release notes" },
      status: "success",
      result: { ok: true },
    });
    expect(
      builder.startLongTextCapture({
        title: "Release notes",
        format: "markdown",
      }),
    ).toEqual({ ok: true });
    builder.appendReasoning("Organizing sections.");

    expect(builder.getLongTextCaptureState()).toEqual({
      pending: true,
      activeBlockId: undefined,
      hasContent: false,
    });
    expect(
      builder
        .getBlocks()
        .some(
          (block) =>
            block.type === "text" && block.presentation?.kind === "long_text",
        ),
    ).toBe(false);

    builder.appendText("\n  ");
    expect(builder.getLongTextCaptureState()).toEqual({
      pending: true,
      activeBlockId: undefined,
      hasContent: false,
    });
    builder.appendText("# Release notes\n\nFirst paragraph.");
    builder.appendText("\n\nSecond paragraph.");
    builder.finalizeLongTextCapture();

    expect(builder.getBlocks().map((block) => block.type)).toEqual([
      "text",
      "tool_group",
      "reasoning",
      "text",
    ]);
    expect(builder.getBlocks().at(-1)).toEqual({
      id: "block-4",
      type: "text",
      content: "\n  # Release notes\n\nFirst paragraph.\n\nSecond paragraph.",
      presentation: {
        kind: "long_text",
        title: "Release notes",
        format: "markdown",
        document: {
          fileName: "Release notes.md",
          mimeType: "text/markdown",
        },
      },
    });
  });

  it("enforces one long text block and resumes an interrupted block in place", () => {
    const initialBlocks: MessageOutputBlock[] = [
      {
        id: "document-1",
        type: "text",
        content: "Partial",
        presentation: {
          kind: "long_text",
          title: "Draft",
          format: "plain_text",
          document: {
            fileName: "Draft.txt",
            mimeType: "text/plain",
          },
        },
      },
    ];
    const builder = createMessageOutputBlockBuilder({ initialBlocks });

    expect(
      builder.startLongTextCapture({ title: "Second", format: "markdown" }),
    ).toMatchObject({
      ok: false,
      error: { code: "LONG_TEXT_OUTPUT_ALREADY_STARTED" },
    });
    expect(builder.resumeLongTextCapture("document-1")).toBe(true);
    builder.appendReasoning("Continuation reasoning");
    builder.appendText(" continuation");
    builder.finalizeLongTextCapture();

    expect(builder.getBlocks()).toEqual([
      expect.objectContaining({
        type: "reasoning",
        content: "Continuation reasoning",
      }),
      expect.objectContaining({
        id: "document-1",
        content: "Partial continuation",
        presentation: expect.objectContaining({ kind: "long_text" }),
      }),
    ]);
  });

  it("adds and removes image generation status blocks", () => {
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    }) as any;

    expect(typeof builder.appendImageGenerationStatus).toBe("function");
    expect(typeof builder.clearImageGenerationStatus).toBe("function");

    const statusId = builder.appendImageGenerationStatus();
    builder.appendText("After");

    expect(builder.getBlocks()).toEqual([
      {
        id: statusId,
        type: "image_generation_status",
        status: "generating",
      },
      { id: "block-2", type: "text", content: "After" },
    ]);

    expect(builder.clearImageGenerationStatus(statusId)).toBe(true);
    expect(builder.getBlocks()).toEqual([
      { id: "block-2", type: "text", content: "After" },
    ]);
    expect(builder.clearImageGenerationStatus(statusId)).toBe(false);
  });

  it("merges consecutive tool calls and updates tool results in place", () => {
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    });

    builder.appendToolCall({
      id: "call_1",
      name: "lookup",
      args: { q: "one" },
      status: "pending",
    });
    builder.appendToolCall({
      id: "call_2",
      name: "fetch",
      args: { id: "two" },
      status: "pending",
    });
    builder.updateToolCall({
      id: "call_1",
      name: "lookup",
      args: { q: "one" },
      status: "success",
      result: { ok: true },
    });

    const blocks = builder.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_group",
      toolCalls: [
        { id: "call_1", status: "success", result: { ok: true } },
        { id: "call_2", status: "pending" },
      ],
    });
  });

  it("uses legacy fields when old messages do not have output blocks", () => {
    const message: Message = {
      id: "msg_1",
      role: "model",
      content: "Final answer",
      reasoning: "I should check context.",
      timestamp: 1,
      searchSources: [
        {
          title: "Source",
          url: "https://example.com",
          content: "Context",
        },
      ],
      toolCalls: [
        {
          id: "call_1",
          name: "lookup",
          args: {},
          status: "success",
          result: "ok",
        },
      ],
    };

    expect(getMessageOutputBlocks(message).map((block) => block.type)).toEqual([
      "search",
      "tool_group",
      "reasoning",
      "text",
    ]);
  });

  it("records reasoning block duration when visible content starts", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000);
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    });

    builder.appendReasoning("Step one. ");
    now.mockReturnValueOnce(2_750);
    builder.appendText("Answer");

    const reasoningBlock = builder
      .getBlocks()
      .find((block) => block.type === "reasoning");
    expect(reasoningBlock).toMatchObject({
      type: "reasoning",
      startedAt: 1_000,
      endedAt: 2_750,
      durationMs: 1_750,
    });
  });

  it("finalizes active reasoning blocks when a stream ends without visible text", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(4_000);
    const builder = createMessageOutputBlockBuilder({
      createId: () => "reasoning-only",
    });

    builder.appendReasoning("Only reasoning.");
    now.mockReturnValueOnce(4_850);
    builder.finalizeActiveReasoning();

    expect(builder.getBlocks()[0]).toMatchObject({
      type: "reasoning",
      startedAt: 4_000,
      endedAt: 4_850,
      durationMs: 850,
    });
  });

  it("clones reasoning duration metadata from initial blocks and snapshots", () => {
    const initialBlocks = [
      {
        id: "reasoning-1",
        type: "reasoning" as const,
        content: "Reasoning",
        startedAt: 10,
        endedAt: 25,
        durationMs: 15,
      },
    ];
    const builder = createMessageOutputBlockBuilder({ initialBlocks });

    initialBlocks[0].durationMs = 999;
    const snapshot = builder.getBlocks();
    expect(snapshot[0]).toMatchObject({
      type: "reasoning",
      startedAt: 10,
      endedAt: 25,
      durationMs: 15,
    });

    if (snapshot[0]?.type === "reasoning") {
      snapshot[0].durationMs = 500;
    }
    expect(builder.getBlocks()[0]).toMatchObject({
      type: "reasoning",
      durationMs: 15,
    });
  });

  it("upserts one task plan at a fixed position and finalizes reasoning", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const builder = createMessageOutputBlockBuilder({
      createId: (() => {
        let index = 0;
        return () => `block-${++index}`;
      })(),
    });

    builder.appendText("Before");
    builder.appendReasoning("Planning");
    now.mockReturnValue(2_500);
    builder.upsertTaskPlan({
      steps: [{ title: "First draft", status: "in_progress" }],
      note: "Initial note",
    });
    builder.appendText("After");
    builder.upsertTaskPlan({
      steps: [
        { title: "First draft", status: "completed" },
        { title: "Verify", status: "in_progress" },
      ],
    });

    const blocks = builder.getBlocks();
    expect(blocks.map((block) => block.type)).toEqual([
      "text",
      "reasoning",
      "task_plan",
      "text",
    ]);
    expect(blocks.filter((block) => block.type === "task_plan")).toHaveLength(
      1,
    );
    expect(blocks[1]).toMatchObject({
      type: "reasoning",
      startedAt: 1_000,
      endedAt: 2_500,
      durationMs: 1_500,
    });
    expect(blocks[2]).toEqual({
      id: "block-3",
      type: "task_plan",
      steps: [
        { title: "First draft", status: "completed" },
        { title: "Verify", status: "in_progress" },
      ],
    });
  });

  it("deep-clones initial, input, and returned task plan steps", () => {
    const initialBlocks: MessageOutputBlock[] = [
      {
        id: "plan-1",
        type: "task_plan",
        steps: [{ title: "Original", status: "pending" }],
      },
      {
        id: "plan-duplicate",
        type: "task_plan",
        steps: [{ title: "Duplicate", status: "pending" }],
      },
    ];
    const builder = createMessageOutputBlockBuilder({ initialBlocks });

    if (initialBlocks[0]?.type === "task_plan") {
      initialBlocks[0].steps[0]!.title = "Mutated initial";
    }
    expect(builder.getBlocks()).toHaveLength(1);
    expect(builder.getBlocks()[0]).toMatchObject({
      id: "plan-1",
      steps: [{ title: "Original", status: "pending" }],
    });

    const update = {
      steps: [{ title: "Updated", status: "in_progress" as const }],
    };
    builder.upsertTaskPlan(update);
    update.steps[0]!.title = "Mutated input";

    const snapshot = builder.getBlocks();
    if (snapshot[0]?.type === "task_plan") {
      snapshot[0].steps[0]!.title = "Mutated snapshot";
    }

    expect(builder.getBlocks()[0]).toEqual({
      id: "plan-1",
      type: "task_plan",
      steps: [{ title: "Updated", status: "in_progress" }],
    });
  });

  it("completes only unfinished steps in the current task plan", () => {
    const builder = createMessageOutputBlockBuilder({
      initialBlocks: [
        {
          id: "plan-1",
          type: "task_plan",
          steps: [
            { title: "Inspect", status: "completed" },
            { title: "Implement", status: "in_progress" },
            { title: "Verify", status: "pending" },
          ],
          note: "Keep this note",
        },
      ],
    });

    expect(builder.completeTaskPlan()).toBe(true);
    expect(builder.getBlocks()).toEqual([
      {
        id: "plan-1",
        type: "task_plan",
        steps: [
          { title: "Inspect", status: "completed" },
          { title: "Implement", status: "completed" },
          { title: "Verify", status: "completed" },
        ],
        note: "Keep this note",
      },
    ]);
    expect(builder.completeTaskPlan()).toBe(false);
  });
});
