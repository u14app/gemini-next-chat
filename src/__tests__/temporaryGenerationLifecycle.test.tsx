// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  endTemporarySession,
  registerTemporarySession,
} from "@/lib/chat/sessionRetention";

const state = vi.hoisted(() => ({ currentSessionId: "" }));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => state },
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: { getState: () => ({}) },
}));

import {
  useChatGenerationController,
  type ActiveGenerationRun,
} from "@/hooks/useChatGenerationController";

describe("temporary generation lifetime", () => {
  it("invalidates the old request immediately and does not stop the next ordinary request", () => {
    state.currentSessionId = "temporary-controller-test";
    registerTemporarySession(state.currentSessionId);
    const { result } = renderHook(() => useChatGenerationController());
    let temporary!: ActiveGenerationRun;
    act(() => {
      temporary = result.current.beginActiveGeneration();
    });
    expect(result.current.isGenerating).toBe(true);
    act(() => {
      endTemporarySession(state.currentSessionId);
    });
    expect(temporary.controller.signal.aborted).toBe(true);
    expect(result.current.isGenerationRunActive(temporary)).toBe(false);
    expect(result.current.isGenerating).toBe(false);
    state.currentSessionId = "ordinary-controller-test";
    let ordinary!: ActiveGenerationRun;
    act(() => {
      ordinary = result.current.beginActiveGeneration();
    });
    act(() => {
      result.current.finishActiveGeneration(temporary);
    });
    expect(result.current.isGenerationRunActive(ordinary)).toBe(true);
    expect(result.current.isGenerating).toBe(true);
    act(() => {
      result.current.finishActiveGeneration(ordinary);
    });
  });
});
