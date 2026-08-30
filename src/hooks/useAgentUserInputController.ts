"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentUserInputController,
  AgentUserInputRequest,
  AgentUserInputResult,
} from "@/types";

interface PendingResolver {
  resolve: (result: AgentUserInputResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function createInterruptedError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(
      "User input request was interrupted.",
      "AbortError",
    );
  }
  const error = new Error("User input request was interrupted.");
  error.name = "AbortError";
  return error;
}

export function useAgentUserInputController() {
  const [pendingRequests, setPendingRequests] = useState<
    AgentUserInputRequest[]
  >([]);
  const resolversRef = useRef(new Map<string, PendingResolver>());

  const remove = useCallback((requestId: string) => {
    setPendingRequests((current) =>
      current.filter((request) => request.requestId !== requestId),
    );
  }, []);

  const requestInput = useCallback(
    (request: AgentUserInputRequest, signal?: AbortSignal) => {
      if (signal?.aborted) return Promise.reject(createInterruptedError());

      const existing = resolversRef.current.get(request.requestId);
      existing?.reject(createInterruptedError());
      setPendingRequests((current) => [
        ...current.filter(
          (candidate) => candidate.requestId !== request.requestId,
        ),
        request,
      ]);

      return new Promise<AgentUserInputResult>((resolve, reject) => {
        const onAbort = () => {
          resolversRef.current.delete(request.requestId);
          remove(request.requestId);
          reject(createInterruptedError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        resolversRef.current.set(request.requestId, {
          resolve,
          reject,
          signal,
          onAbort,
        });
      });
    },
    [remove],
  );

  const respond = useCallback(
    (requestId: string, result: AgentUserInputResult) => {
      const resolver = resolversRef.current.get(requestId);
      if (!resolver) return false;
      if (resolver.signal && resolver.onAbort) {
        resolver.signal.removeEventListener("abort", resolver.onAbort);
      }
      resolversRef.current.delete(requestId);
      remove(requestId);
      resolver.resolve(result);
      return true;
    },
    [remove],
  );

  const interruptAll = useCallback(() => {
    const error = createInterruptedError();
    for (const [requestId, resolver] of resolversRef.current) {
      if (resolver.signal && resolver.onAbort) {
        resolver.signal.removeEventListener("abort", resolver.onAbort);
      }
      resolver.reject(error);
      resolversRef.current.delete(requestId);
    }
    setPendingRequests([]);
  }, []);

  useEffect(() => interruptAll, [interruptAll]);

  const controller = useMemo<AgentUserInputController>(
    () => ({ requestInput }),
    [requestInput],
  );

  return { controller, pendingRequests, respond, interruptAll };
}
