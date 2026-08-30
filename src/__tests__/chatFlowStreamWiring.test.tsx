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
const TOOL_CONFIRMATION_ARG = 16;
const STREAM_OPTIONS_ARG = 17;

const conversation = [
  { id: "user-1", role: "user", content: "hello", timestamp: 0 },
  { id: "model-1", role: "model", content: "hi", timestamp: 1 },
] as Message[];

describe("skill and tool-confirmation wiring", () => {
  beforeEach(() => {
    streamChatResponse.mockClear();
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
});
