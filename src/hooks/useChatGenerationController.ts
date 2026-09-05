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
  const stopPromiseRef = useRef<Promise<void> | null>(null);

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

  const stopActiveGeneration = useCallback(() => {
    if (!abortControllerRef.current && stopPromiseRef.current) {
      return stopPromiseRef.current;
    }

    const state = useChatStore.getState();
    const sourceSessionId = state.currentSessionId;
    const streamingMessage = [...state.activeMessages]
      .reverse()
      .find((message) => message.generation?.status === "streaming");
    const agentRunId = streamingMessage?.generation?.agentRunId;
    const agentRun = agentRunId
      ? useAgentRunStore.getState().runsById[agentRunId]
      : undefined;

    generationRunRef.current = getNextGenerationRunId(generationRunRef.current);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);

    if (sourceSessionId && streamingMessage?.generation) {
      state.updateMessage(
        sourceSessionId,
        streamingMessage.id,
        createInterruptedGenerationUpdate(streamingMessage),
      );
    }
    const sourceState = useChatStore.getState();
    const syncSnapshot = createActiveGenerationSyncSnapshot({
      currentSessionId: sourceSessionId,
      activeMessages:
        sourceState.currentSessionId === sourceSessionId
          ? sourceState.activeMessages
          : state.activeMessages,
    });

    const persistenceTasks: Promise<unknown>[] = [];
    if (
      agentRun &&
      agentRun.status !== "completed" &&
      agentRun.status !== "failed" &&
      agentRun.status !== "cancelled"
    ) {
      const recovered = recoverInterruptedToolExecutions(agentRun);
      const hasUnknownEffect = recovered.toolExecutions.some(
        (record) => record.status === "effect_unknown",
      );
      persistenceTasks.push(
        useAgentRunStore.getState().upsertRun(
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
        ),
      );
    }

    if (syncSnapshot) {
      persistenceTasks.push(
        persistStoppedGeneration
          ? persistStoppedGeneration(syncSnapshot)
          : state.syncActiveSession(
              syncSnapshot.sessionId,
              syncSnapshot.messages,
            ),
      );
    }

    const stopPromise = Promise.allSettled(persistenceTasks)
      .then((results) => {
        const failure = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failure) throw failure.reason;
      })
      .finally(() => {
        if (stopPromiseRef.current === stopPromise) {
          stopPromiseRef.current = null;
        }
      });
    stopPromiseRef.current = stopPromise;
    return stopPromise;
  }, [persistStoppedGeneration]);

  return {
    isGenerating,
    beginActiveGeneration,
    isGenerationRunActive,
    finishActiveGeneration,
    stopActiveGeneration,
  };
}
