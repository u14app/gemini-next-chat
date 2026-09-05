// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  endTemporarySession,
  registerTemporarySession,
} from "@/lib/chat/sessionRetention";
import {
  createAgentRun,
  markToolExecutionRunning,
  prepareToolExecution,
} from "@/lib/agent";
import type { Message } from "@/types";

const state = vi.hoisted(() => ({
  currentSessionId: "",
  activeMessages: [] as Message[],
  updateMessage: vi.fn(),
  syncActiveSession: vi.fn(async () => undefined),
}));
const agentState = vi.hoisted(() => ({
  runsById: {} as Record<string, ReturnType<typeof createAgentRun>>,
  upsertRun: vi.fn(async () => undefined),
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => state },
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: { getState: () => agentState },
}));

import {
  useChatGenerationController,
  type ActiveGenerationRun,
} from "@/hooks/useChatGenerationController";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<undefined>((settle) => {
    resolve = () => settle(undefined);
  });
  return { promise, resolve };
}

describe("temporary generation lifetime", () => {
  beforeEach(() => {
    state.currentSessionId = "";
    state.activeMessages = [];
    state.updateMessage.mockReset();
    state.syncActiveSession.mockReset();
    state.syncActiveSession.mockResolvedValue(undefined);
    agentState.runsById = {};
    agentState.upsertRun.mockReset();
    agentState.upsertRun.mockResolvedValue(undefined);
  });

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

  it("invalidates the source run and snapshots it before deferred persistence", async () => {
    const sourceSessionId = "session-source";
    const sourceMessage: Message = {
      id: "model-source",
      role: "model",
      content: "partial answer",
      timestamp: 1,
      generation: {
        status: "streaming",
        requestId: "request-source",
        agentRunId: "agent-source",
        ownerDeviceId: "device",
        model: "test-provider/test-model",
        attempt: 0,
        checkpointAt: 1,
      },
    };
    state.currentSessionId = sourceSessionId;
    state.activeMessages = [sourceMessage];
    state.updateMessage.mockImplementation(
      (sessionId: string, messageId: string, updates: Partial<Message>) => {
        if (state.currentSessionId !== sessionId) return;
        state.activeMessages = state.activeMessages.map((message) =>
          message.id === messageId ? { ...message, ...updates } : message,
        );
      },
    );

    let run = createAgentRun({
      id: "agent-source",
      sessionId: sourceSessionId,
      now: 1,
    });
    run = prepareToolExecution(run, {
      id: "execution-source",
      callId: "call-source",
      toolName: "write_record",
      definitionFingerprint: "definition",
      argumentsHash: "arguments",
      policy: {
        effects: ["external_write"],
        idempotency: "non_idempotent",
        sensitivity: "user_data",
        origin: "plugin",
      },
      at: 2,
    });
    run = markToolExecutionRunning(run, "execution-source", 3);
    agentState.runsById = { "agent-source": run };

    const agentPersistence = createDeferred();
    const messagePersistence = createDeferred();
    agentState.upsertRun.mockReturnValue(agentPersistence.promise);
    const persistStoppedGeneration = vi.fn(
      async () => messagePersistence.promise,
    );
    const { result } = renderHook(() =>
      useChatGenerationController({ persistStoppedGeneration }),
    );
    let generation!: ActiveGenerationRun;
    act(() => {
      generation = result.current.beginActiveGeneration();
    });

    let stopPromise!: Promise<void>;
    act(() => {
      stopPromise = result.current.stopActiveGeneration();
    });

    expect(generation.controller.signal.aborted).toBe(true);
    expect(result.current.isGenerationRunActive(generation)).toBe(false);
    expect(state.activeMessages[0].generation?.status).toBe("interrupted");
    expect(persistStoppedGeneration).toHaveBeenCalledWith({
      sessionId: sourceSessionId,
      messages: [
        expect.objectContaining({
          id: sourceMessage.id,
          generation: expect.objectContaining({ status: "interrupted" }),
        }),
      ],
    });
    expect(agentState.upsertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        stop: expect.objectContaining({ reason: "effect_unknown" }),
        toolExecutions: [expect.objectContaining({ status: "effect_unknown" })],
      }),
    );

    state.currentSessionId = "session-next";
    state.activeMessages = [];
    expect(result.current.stopActiveGeneration()).toBe(stopPromise);

    const nextMessage: Message = {
      ...sourceMessage,
      id: "model-next",
      generation: {
        ...sourceMessage.generation!,
        requestId: "request-next",
        agentRunId: undefined,
      },
    };
    state.activeMessages = [nextMessage];
    let nextGeneration!: ActiveGenerationRun;
    act(() => {
      nextGeneration = result.current.beginActiveGeneration();
    });
    let nextStopPromise!: Promise<void>;
    act(() => {
      nextStopPromise = result.current.stopActiveGeneration();
    });
    expect(nextStopPromise).not.toBe(stopPromise);
    expect(nextGeneration.controller.signal.aborted).toBe(true);
    expect(persistStoppedGeneration).toHaveBeenLastCalledWith({
      sessionId: "session-next",
      messages: [
        expect.objectContaining({
          id: nextMessage.id,
          generation: expect.objectContaining({ status: "interrupted" }),
        }),
      ],
    });

    let stopped = false;
    void stopPromise.then(() => {
      stopped = true;
    });
    messagePersistence.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);

    agentPersistence.resolve();
    await act(async () => {
      await Promise.all([stopPromise, nextStopPromise]);
    });
    expect(stopped).toBe(true);
  });
});
