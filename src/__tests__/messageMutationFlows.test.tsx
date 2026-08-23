// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatStoreState = {
  isActiveSessionLoading: false,
  activeMessages: [] as unknown[],
  sessions: [] as unknown[],
  currentSessionId: "session-1",
  syncActiveSession: vi.fn(async () => undefined),
};

vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => chatStoreState },
}));

import { useMessageEditFlow } from "@/features/chat/hooks/useMessageEditFlow";
import { useResponseBranchFlow } from "@/features/chat/hooks/useResponseBranchFlow";
import { createChatFlowDeps } from "./support/chatFlowDeps";
import type { Message } from "@/types";

const retractTarget = {
  id: "message-1",
  role: "user",
  content: "hello",
  timestamp: 0,
} as Message;

describe("message mutation flows", () => {
  beforeEach(() => {
    chatStoreState.isActiveSessionLoading = false;
  });

  it("mutates the message tree when the session is idle", async () => {
    const deps = createChatFlowDeps();
    const edit = renderHook(() => useMessageEditFlow(deps)).result.current;
    const branch = renderHook(() => useResponseBranchFlow(deps)).result.current;

    branch.handleVersionChange("message-1", "next");
    edit.handleEditMessage("message-1", "edited");
    await edit.handleDeleteMessage("message-1");
    await edit.handleRetractMessage(retractTarget);

    expect(deps.switchMessageVersion).toHaveBeenCalledWith(
      "session-1",
      "message-1",
      "next",
    );
    expect(deps.updateMessageContent).toHaveBeenCalledWith(
      "session-1",
      "message-1",
      "edited",
    );
    expect(deps.deleteMessage).toHaveBeenCalledWith("session-1", "message-1");
    expect(deps.deleteMessageAndSubsequent).toHaveBeenCalledWith(
      "session-1",
      "message-1",
    );
  });

  it.each([
    ["a local generation is running", { isGenerating: true }, false],
    ["the active session is still loading", {}, true],
  ])("refuses every mutation while %s", async (_label, overrides, loading) => {
    chatStoreState.isActiveSessionLoading = loading;
    const deps = createChatFlowDeps(overrides);
    const edit = renderHook(() => useMessageEditFlow(deps)).result.current;
    const branch = renderHook(() => useResponseBranchFlow(deps)).result.current;

    branch.handleVersionChange("message-1", "next");
    branch.handleVersionSelect("message-1", "message-2");
    edit.handleEditMessage("message-1", "edited");
    await edit.handleDeleteMessage("message-1");
    await edit.handleRetractMessage(retractTarget);

    expect(deps.switchMessageVersion).not.toHaveBeenCalled();
    expect(deps.selectMessageVersion).not.toHaveBeenCalled();
    expect(deps.updateMessageContent).not.toHaveBeenCalled();
    expect(deps.deleteMessage).not.toHaveBeenCalled();
    expect(deps.deleteMessageAndSubsequent).not.toHaveBeenCalled();
  });
});
