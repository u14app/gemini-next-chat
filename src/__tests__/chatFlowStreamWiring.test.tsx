// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatStoreState = {
  isActiveSessionLoading: false,
  activeMessages: [] as unknown[],
  sessions: [{ id: "session-1", compression: undefined }] as unknown[],
  currentSessionId: "session-1",
  syncActiveSession: vi.fn(async () => undefined),
};

// jsdom's localStorage is not wired up in this project's setup.
vi.mock("@/lib/sync/deviceIdentity", () => ({
  getSyncDeviceId: () => "test-device",
}));

vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => chatStoreState },
}));

const streamChatResponse = vi.fn(async (...args: unknown[]) => {
  void args;
});
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: (...args: unknown[]) => streamChatResponse(...args),
  prepareHistoryForLLM: async (messages: unknown[]) => messages,
}));

vi.mock("@/services/api/skillService", () => ({
  resolveSkillsForMessage: async () => ({
    context: "resolved-skill-context",
    invocations: [],
    skippedSkillIds: [],
  }),
  resolveRecordedSkillInvocations: () => ({
    context: "recorded-skill-context",
    invocations: [],
    skippedSkillIds: [],
  }),
}));

import { useResponseBranchFlow } from "@/hooks/useResponseBranchFlow";
import { useSendMessageFlow } from "@/hooks/useSendMessageFlow";
import { useMessageEditFlow } from "@/hooks/useMessageEditFlow";
import { createChatFlowDeps } from "./support/chatFlowDeps";
import type { Message } from "@/types";

// Positional arguments of `streamChatResponse`.
const SKILLS_CONTEXT_ARG = 14;
const SEARCH_STATUS_ARG = 8;
const TOOL_UPDATE_ARG = 9;
const USAGE_ARG = 11;
const OUTPUT_BLOCKS_ARG = 15;
const TOOL_CONFIRMATION_ARG = 16;
const STREAM_OPTIONS_ARG = 17;

const conversation = [
  { id: "user-1", role: "user", content: "hello", timestamp: 0 },
  { id: "model-1", role: "model", content: "hi", timestamp: 1 },
] as Message[];

describe("skill and tool-confirmation wiring", () => {
  beforeEach(() => {
    streamChatResponse.mockReset();
    streamChatResponse.mockResolvedValue(undefined);
    chatStoreState.activeMessages = conversation;
  });

  it("sends the resolved skill context and confirmation controller when composing", async () => {
    const deps = createChatFlowDeps();
    const { handleSendMessage } = renderHook(() => useSendMessageFlow(deps))
      .result.current;

    await handleSendMessage("hello", []);

    expect(streamChatResponse).toHaveBeenCalledTimes(1);
    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[SKILLS_CONTEXT_ARG]).toBe("resolved-skill-context");
    expect(args[TOOL_CONFIRMATION_ARG]).toBe(deps.toolConfirmationController);
  });

  it("stores and forwards explicitly referenced plugins when composing", async () => {
    const deps = createChatFlowDeps();
    const { handleSendMessage } = renderHook(() => useSendMessageFlow(deps))
      .result.current;

    await handleSendMessage("hello", [], undefined, undefined, {
      skillIds: [],
      pluginIds: ["weather"],
    });

    expect(deps.addMessage).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.objectContaining({ forcedPluginIds: ["weather"] }),
    );
    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[STREAM_OPTIONS_ARG]).toEqual(
      expect.objectContaining({ forcedPluginIds: ["weather"] }),
    );
  });

  it("sends the resolved skill context and confirmation controller when regenerating", async () => {
    const deps = createChatFlowDeps({ activeMessages: conversation });
    const { handleRegenerate } = renderHook(() => useResponseBranchFlow(deps))
      .result.current;

    await handleRegenerate("model-1");

    expect(streamChatResponse).toHaveBeenCalledTimes(1);
    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[SKILLS_CONTEXT_ARG]).toBe("resolved-skill-context");
    expect(args[TOOL_CONFIRMATION_ARG]).toBe(deps.toolConfirmationController);
  });

  it("replays explicitly referenced plugins when regenerating", async () => {
    const messages = [
      { ...conversation[0], forcedPluginIds: ["weather"] },
      conversation[1],
    ] as Message[];
    chatStoreState.activeMessages = messages;
    const deps = createChatFlowDeps({ activeMessages: messages });
    const { handleRegenerate } = renderHook(() => useResponseBranchFlow(deps))
      .result.current;

    await handleRegenerate("model-1");

    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[STREAM_OPTIONS_ARG]).toEqual(
      expect.objectContaining({ forcedPluginIds: ["weather"] }),
    );
  });

  it("keeps explicitly referenced plugins when editing a user message", async () => {
    const messages = [
      { ...conversation[0], forcedPluginIds: ["weather"] },
      conversation[1],
    ] as Message[];
    chatStoreState.activeMessages = messages;
    const deps = createChatFlowDeps({ activeMessages: messages });
    const { handleSubmitUserMessageEdit } = renderHook(() =>
      useMessageEditFlow(deps),
    ).result.current;

    await handleSubmitUserMessageEdit("user-1", "edited prompt");

    expect(deps.createEditedUserMessageBranch).toHaveBeenCalledWith(
      "session-1",
      "user-1",
      expect.objectContaining({ forcedPluginIds: ["weather"] }),
      expect.any(Object),
    );
    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[STREAM_OPTIONS_ARG]).toEqual(
      expect.objectContaining({ forcedPluginIds: ["weather"] }),
    );
  });

  it("reuses the recorded invocations instead of re-resolving them", async () => {
    const deps = createChatFlowDeps({
      activeMessages: [
        conversation[0],
        { ...conversation[1], skillInvocations: [{ id: "skill-1" }] },
      ] as Message[],
    });
    const { handleRegenerate } = renderHook(() => useResponseBranchFlow(deps))
      .result.current;

    await handleRegenerate("model-1");

    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[SKILLS_CONTEXT_ARG]).toBe("recorded-skill-context");
  });

  it("passes the confirmation controller when continuing an interrupted answer", async () => {
    const interrupted = {
      ...conversation[1],
      generation: {
        status: "interrupted",
        requestId: "request-1",
        model: "test-provider/test-model",
      },
    } as Message;
    chatStoreState.activeMessages = [conversation[0], interrupted];
    const deps = createChatFlowDeps({
      activeMessages: [conversation[0], interrupted],
    });
    const { handleContinueGeneration } = renderHook(() =>
      useResponseBranchFlow(deps),
    ).result.current;

    await handleContinueGeneration("model-1");

    expect(streamChatResponse).toHaveBeenCalledTimes(1);
    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[TOOL_CONFIRMATION_ARG]).toBe(deps.toolConfirmationController);
  });

  it("retains existing structured blocks when continuing without a long-text block", async () => {
    const initialBlocks: NonNullable<Message["outputBlocks"]> = [
      {
        id: "search-1",
        type: "search",
        sources: [],
        images: [],
      },
    ];
    const streamedBlocks: NonNullable<Message["outputBlocks"]> = [
      ...initialBlocks,
      { id: "text-1", type: "text", content: "continued" },
    ];
    const interrupted = {
      ...conversation[1],
      outputBlocks: initialBlocks,
      generation: {
        status: "interrupted",
        requestId: "request-1",
        model: "test-provider/test-model",
      },
    } as Message;
    chatStoreState.activeMessages = [conversation[0], interrupted];
    streamChatResponse.mockImplementationOnce(async (...args: unknown[]) => {
      const onChunk = args[6] as (
        text: string,
        reasoning?: string,
        outputBlocks?: Message["outputBlocks"],
      ) => void;
      const onOutputBlocks = args[OUTPUT_BLOCKS_ARG] as (
        outputBlocks: NonNullable<Message["outputBlocks"]>,
      ) => void;
      onChunk("continued", undefined, streamedBlocks);
      onOutputBlocks(streamedBlocks);
    });
    const deps = createChatFlowDeps({
      activeMessages: [conversation[0], interrupted],
    });
    const { handleContinueGeneration } = renderHook(() =>
      useResponseBranchFlow(deps),
    ).result.current;

    await handleContinueGeneration("model-1");

    expect(deps.updateMessage).toHaveBeenCalledWith(
      "session-1",
      "model-1",
      expect.objectContaining({ outputBlocks: initialBlocks }),
    );
    const args = streamChatResponse.mock.calls[0] as unknown[];
    expect(args[STREAM_OPTIONS_ARG]).toEqual(
      expect.objectContaining({ initialOutputBlocks: initialBlocks }),
    );
    expect(args[SEARCH_STATUS_ARG]).toEqual(expect.any(Function));
    expect(args[TOOL_UPDATE_ARG]).toEqual(expect.any(Function));
    expect(args[USAGE_ARG]).toEqual(expect.any(Function));
    expect(deps.updateMessageContent).toHaveBeenCalledWith(
      "session-1",
      "model-1",
      "hicontinued",
      undefined,
      streamedBlocks,
    );
  });

  it("extends only the resumed long-text block and persists the complete block snapshot", async () => {
    const existingContent =
      "This is a sufficiently long document introduction for continuation.";
    const initialBlocks: NonNullable<Message["outputBlocks"]> = [
      { id: "plain-1", type: "text", content: "Keep this exact text." },
      {
        id: "document-1",
        type: "text",
        content: existingContent,
        presentation: {
          kind: "long_text",
          title: "Draft",
          format: "markdown",
          document: { fileName: "draft.md", mimeType: "text/markdown" },
        },
      },
      {
        id: "search-1",
        type: "search",
        sources: [],
        images: [],
      },
    ];
    const serviceBlocks: NonNullable<Message["outputBlocks"]> = [
      initialBlocks[0],
      {
        ...initialBlocks[1],
        type: "text",
        content: `${existingContent}${existingContent} Added section.`,
      },
      initialBlocks[2],
      { id: "new-text", type: "text", content: "New trailing block." },
    ];
    const interrupted = {
      ...conversation[1],
      content: existingContent,
      outputBlocks: initialBlocks,
      generation: {
        status: "interrupted",
        requestId: "request-1",
        model: "test-provider/test-model",
      },
    } as Message;
    chatStoreState.activeMessages = [conversation[0], interrupted];
    streamChatResponse.mockImplementationOnce(async (...args: unknown[]) => {
      const onChunk = args[6] as (
        text: string,
        reasoning?: string,
        outputBlocks?: Message["outputBlocks"],
      ) => void;
      const onOutputBlocks = args[OUTPUT_BLOCKS_ARG] as (
        outputBlocks: NonNullable<Message["outputBlocks"]>,
      ) => void;
      onChunk(`${existingContent} Added section.`, undefined, serviceBlocks);
      onOutputBlocks(serviceBlocks);
    });
    const deps = createChatFlowDeps({
      activeMessages: [conversation[0], interrupted],
    });
    const { handleContinueGeneration } = renderHook(() =>
      useResponseBranchFlow(deps),
    ).result.current;

    await handleContinueGeneration("model-1");

    const persistedBlocks = vi
      .mocked(deps.updateMessageContent)
      .mock.calls.at(-1)?.[4];
    expect(persistedBlocks).toEqual([
      initialBlocks[0],
      {
        ...initialBlocks[1],
        content: `${existingContent} Added section.`,
      },
      initialBlocks[2],
      serviceBlocks[3],
    ]);
    expect(
      (streamChatResponse.mock.calls[0] as unknown[])[STREAM_OPTIONS_ARG],
    ).toEqual(
      expect.objectContaining({
        initialOutputBlocks: initialBlocks,
        resumeLongTextBlockId: "document-1",
      }),
    );
  });

  it("records continuation tool state so a second unsafe continuation is blocked", async () => {
    const interrupted = {
      ...conversation[1],
      generation: {
        status: "interrupted",
        requestId: "request-1",
        agentRunId: "agent-run-1",
        model: "test-provider/test-model",
      },
    } as Message;
    chatStoreState.activeMessages = [conversation[0], interrupted];
    const updateMessage = vi.fn(
      (sessionId: string, messageId: string, updates: Partial<Message>) => {
        if (sessionId !== chatStoreState.currentSessionId) return;
        chatStoreState.activeMessages = (
          chatStoreState.activeMessages as Message[]
        ).map((message) =>
          message.id === messageId ? { ...message, ...updates } : message,
        );
      },
    );
    streamChatResponse.mockImplementationOnce(async (...args: unknown[]) => {
      const onToolUpdate = args[TOOL_UPDATE_ARG] as (
        toolCalls: NonNullable<Message["toolCalls"]>,
      ) => void;
      onToolUpdate([
        {
          id: "tool-1",
          name: "write_record",
          args: {},
          status: "running",
          risk: "write",
        },
      ]);
      throw new Error("connection lost after tool start");
    });
    const deps = createChatFlowDeps({
      activeMessages: [conversation[0], interrupted],
      updateMessage,
    });
    const effectiveContext = deps.getEffectiveContextForSession(
      undefined,
      "test-provider/test-model",
    );
    vi.mocked(deps.getEffectiveContextForSession).mockReturnValue({
      ...effectiveContext,
      agentModeEnabled: true,
    });
    const { handleContinueGeneration } = renderHook(() =>
      useResponseBranchFlow(deps),
    ).result.current;

    await handleContinueGeneration("model-1");
    await handleContinueGeneration("model-1");

    expect(streamChatResponse).toHaveBeenCalledTimes(1);
    expect(updateMessage).toHaveBeenCalledWith("session-1", "model-1", {
      toolCalls: [
        expect.objectContaining({ status: "running", risk: "write" }),
      ],
    });
    expect(deps.showActionError).toHaveBeenCalledWith("errUnsafeContinue");
  });
});
