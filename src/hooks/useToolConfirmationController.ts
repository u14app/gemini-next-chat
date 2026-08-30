"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { matchesToolSessionApproval } from "@/lib/plugin/confirmation";
import type {
  ToolConfirmationController,
  ToolConfirmationDecision,
  ToolConfirmationRequest,
  ToolSessionApproval,
} from "@/types";

interface PendingResolver {
  resolve: (decision: ToolConfirmationDecision) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface SessionApprovalContext {
  approvals: ToolSessionApproval[];
  onApprovalsChange: (approvals: ToolSessionApproval[]) => void;
}

interface UseToolConfirmationControllerOptions {
  sessionId: string | null;
  approvals: ToolSessionApproval[];
  onApprovalsChange: (approvals: ToolSessionApproval[]) => void;
}

function createInterruptedError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Tool confirmation was interrupted.", "AbortError");
  }

  const error = new Error("Tool confirmation was interrupted.");
  error.name = "AbortError";
  return error;
}

export function useToolConfirmationController({
  sessionId,
  approvals,
  onApprovalsChange,
}: UseToolConfirmationControllerOptions) {
  const [pendingRequests, setPendingRequests] = useState<
    ToolConfirmationRequest[]
  >([]);
  const resolversRef = useRef(new Map<string, PendingResolver>());
  const approvalsRef = useRef(approvals);
  const onApprovalsChangeRef = useRef(onApprovalsChange);
  const currentSessionIdRef = useRef(sessionId);
  const sessionApprovalContextsRef = useRef(
    new Map<string, SessionApprovalContext>(),
  );

  useEffect(() => {
    currentSessionIdRef.current = sessionId;
    approvalsRef.current = approvals;
    onApprovalsChangeRef.current = onApprovalsChange;
    if (sessionId) {
      sessionApprovalContextsRef.current.set(sessionId, {
        approvals,
        onApprovalsChange,
      });
    }
  }, [approvals, onApprovalsChange, sessionId]);

  const removePendingRequest = useCallback((toolCallId: string) => {
    setPendingRequests((current) =>
      current.filter((request) => request.toolCallId !== toolCallId),
    );
  }, []);

  const interruptAll = useCallback(() => {
    const error = createInterruptedError();
    for (const [toolCallId, resolver] of resolversRef.current) {
      if (resolver.signal && resolver.onAbort) {
        resolver.signal.removeEventListener("abort", resolver.onAbort);
      }
      resolver.reject(error);
      resolversRef.current.delete(toolCallId);
    }
    setPendingRequests([]);
  }, []);

  useEffect(() => interruptAll, [interruptAll]);

  const requestConfirmation = useCallback(
    (request: ToolConfirmationRequest, signal?: AbortSignal) => {
      if (signal?.aborted) {
        return Promise.reject(createInterruptedError());
      }

      const existing = resolversRef.current.get(request.toolCallId);
      existing?.reject(createInterruptedError());

      const sessionBoundRequest = request.sessionId
        ? request
        : {
            ...request,
            ...(currentSessionIdRef.current
              ? { sessionId: currentSessionIdRef.current }
              : {}),
          };

      setPendingRequests((current) => [
        ...current.filter(
          (candidate) => candidate.toolCallId !== request.toolCallId,
        ),
        sessionBoundRequest,
      ]);

      return new Promise<ToolConfirmationDecision>((resolve, reject) => {
        const onAbort = () => {
          resolversRef.current.delete(request.toolCallId);
          removePendingRequest(request.toolCallId);
          reject(createInterruptedError());
        };

        signal?.addEventListener("abort", onAbort, { once: true });
        resolversRef.current.set(request.toolCallId, {
          resolve,
          reject,
          signal,
          onAbort,
        });
      });
    },
    [removePendingRequest],
  );

  const decide = useCallback(
    (toolCallId: string, decision: ToolConfirmationDecision) => {
      const resolver = resolversRef.current.get(toolCallId);
      if (!resolver) return false;

      if (resolver.signal && resolver.onAbort) {
        resolver.signal.removeEventListener("abort", resolver.onAbort);
      }
      resolversRef.current.delete(toolCallId);
      removePendingRequest(toolCallId);
      resolver.resolve(decision);
      return true;
    },
    [removePendingRequest],
  );

  const controller = useMemo<ToolConfirmationController>(
    () => ({
      requestConfirmation,
      isSessionApproved: (candidate) => {
        const { sessionId: candidateSessionId, ...approvalCandidate } =
          candidate;
        const targetSessionId =
          candidateSessionId || currentSessionIdRef.current;
        const context = targetSessionId
          ? sessionApprovalContextsRef.current.get(targetSessionId)
          : undefined;
        return (context?.approvals || approvalsRef.current).some((approval) =>
          matchesToolSessionApproval(approval, approvalCandidate),
        );
      },
      grantSessionApproval: (approval) => {
        const { sessionId: approvalSessionId, ...storedApproval } = approval;
        const targetSessionId =
          approvalSessionId || currentSessionIdRef.current;
        const context = targetSessionId
          ? sessionApprovalContextsRef.current.get(targetSessionId)
          : undefined;
        const current = context?.approvals || approvalsRef.current;
        if (
          current.some((candidate) =>
            matchesToolSessionApproval(candidate, storedApproval),
          )
        ) {
          return;
        }
        const next = [...current, storedApproval];
        if (targetSessionId && context) {
          sessionApprovalContextsRef.current.set(targetSessionId, {
            ...context,
            approvals: next,
          });
          context.onApprovalsChange(next);
        } else {
          approvalsRef.current = next;
          onApprovalsChangeRef.current(next);
        }
      },
    }),
    [requestConfirmation],
  );

  return {
    controller,
    pendingRequests,
    decide,
    interruptAll,
  };
}
