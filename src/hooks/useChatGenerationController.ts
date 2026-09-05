"use client";
import { getTemporarySessionSignal } from "@/lib/chat/sessionRetention";

import { useCallback, useRef, useState } from "react";

import {
  createActiveGenerationSyncSnapshot,
  createInterruptedGenerationUpdate,
  getNextGenerationRunId,
  isCurrentGenerationRun,
  type ActiveGenerationSyncSnapshot,
} from "@/lib/chat/generationLifecycle";
import { useChatStore } from "@/store/core/chatStore";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import {
  recoverInterruptedToolExecutions,
  transitionAgentRunStatus,
} from "@/lib/agent";

export interface ActiveGenerationRun {
  runId: number;
  controller: AbortController;
  cleanup?: () => void;
}

interface UseChatGenerationControllerOptions {
  persistStoppedGeneration?: (
    snapshot: ActiveGenerationSyncSnapshot,
  ) => Promise<void>;
}

export function useChatGenerationController({
  persistStoppedGeneration,
}: UseChatGenerationControllerOptions = {}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationRunRef = useRef(0);

  const beginActiveGeneration = useCallback((): ActiveGenerationRun => {
    const runId = getNextGenerationRunId(generationRunRef.current);
    const controller = new AbortController();
    generationRunRef.current = runId;
    abortControllerRef.current = controller;
    setIsGenerating(true);

    const lifetime = getTemporarySessionSignal(
      useChatStore.getState().currentSessionId,
    );
    const onEnd = () => {
      controller.abort();
      if (abortControllerRef.current === controller) {
        generationRunRef.current = getNextGenerationRunId(
          generationRunRef.current,
        );
        abortControllerRef.current = null;
        setIsGenerating(false);
      }
    };
    lifetime?.addEventListener("abort", onEnd, { once: true });
    const cleanup = () => lifetime?.removeEventListener("abort", onEnd);
    controller.signal.addEventListener("abort", cleanup, { once: true });
    if (lifetime?.aborted) onEnd();
    return { runId, controller, cleanup };
  }, []);

  const isGenerationRunActive = useCallback(
    ({ runId, controller }: ActiveGenerationRun) =>
      isCurrentGenerationRun({
        currentRunId: generationRunRef.current,
        runId,
        currentController: abortControllerRef.current,
        controller,
      }),
    [],
  );

  const finishActiveGeneration = useCallback(
    ({ runId, controller, cleanup }: ActiveGenerationRun) => {
      cleanup?.();
      if (!isGenerationRunActive({ runId, controller })) return;

      abortControllerRef.current = null;
      setIsGenerating(false);
    },
    [isGenerationRunActive],
  );

  const stopActiveGeneration = useCallback(async () => {
    let state = useChatStore.getState();
    const streamingMessage = [...state.activeMessages]
      .reverse()
      .find((message) => message.generation?.status === "streaming");
    const agentRunId = streamingMessage?.generation?.agentRunId;
    if (agentRunId) {
      const run = useAgentRunStore.getState().runsById[agentRunId];
      if (
        run &&
        run.status !== "completed" &&
        run.status !== "failed" &&
        run.status !== "cancelled"
      ) {
        const recovered = recoverInterruptedToolExecutions(run);
        const hasUnknownEffect = recovered.toolExecutions.some(
          (record) => record.status === "effect_unknown",
        );
        await useAgentRunStore.getState().upsertRun(
          transitionAgentRunStatus(
            recovered,
            hasUnknownEffect ? "failed" : "cancelled",
            hasUnknownEffect
              ? {
                  stop: {
                    reason: "effect_unknown",
                    error: {
                      code: "TOOL_EFFECT_UNKNOWN",
                      message:
                        "A tool may have produced a side effect before it was stopped.",
                      recoverable: false,
                    },
                  },
                }
              : { stop: { reason: "user_stopped" } },
          ),
        );
      }
    }
    if (state.currentSessionId && streamingMessage?.generation) {
      state.updateMessage(
        state.currentSessionId,
        streamingMessage.id,
        createInterruptedGenerationUpdate(streamingMessage),
      );
      state = useChatStore.getState();
    }
    const syncSnapshot = createActiveGenerationSyncSnapshot({
      currentSessionId: state.currentSessionId,
      activeMessages: state.activeMessages,
    });

    generationRunRef.current = getNextGenerationRunId(generationRunRef.current);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);

    if (!syncSnapshot) return;

    if (persistStoppedGeneration) {
      await persistStoppedGeneration(syncSnapshot);
      return;
    }

    await state.syncActiveSession(
      syncSnapshot.sessionId,
      syncSnapshot.messages,
    );
  }, [persistStoppedGeneration]);

  return {
    isGenerating,
    beginActiveGeneration,
    isGenerationRunActive,
    finishActiveGeneration,
    stopActiveGeneration,
  };
}
