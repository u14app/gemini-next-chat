// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useToolConfirmationController } from "@/hooks/useToolConfirmationController";
import type { ToolConfirmationRequest, ToolSessionApproval } from "@/types";

const request: ToolConfirmationRequest = {
  toolCallId: "call-1",
  pluginId: "plugin-1",
  pluginTitle: "Example Plugin",
  functionName: "create_item",
  functionFingerprint: "fingerprint-1",
  risk: "write",
  approvedAt: 1,
  args: { title: "Example" },
};

describe("useToolConfirmationController", () => {
  it("waits for and resolves an inline decision", async () => {
    const { result } = renderHook(() =>
      useToolConfirmationController({
        sessionId: "session-1",
        approvals: [],
        onApprovalsChange: vi.fn(),
      }),
    );

    let decisionPromise!: Promise<string>;
    act(() => {
      decisionPromise = result.current.controller.requestConfirmation(request);
    });

    expect(result.current.pendingRequests).toEqual([
      { ...request, sessionId: "session-1" },
    ]);

    act(() => {
      expect(result.current.decide("call-1", "allow_once")).toBe(true);
    });

    await expect(decisionPromise).resolves.toBe("allow_once");
    expect(result.current.pendingRequests).toEqual([]);
  });

  it("persists and reuses a matching session approval", () => {
    const onApprovalsChange = vi.fn();
    const approvals: ToolSessionApproval[] = [];
    const { result } = renderHook(() =>
      useToolConfirmationController({
        sessionId: "session-1",
        approvals,
        onApprovalsChange,
      }),
    );

    act(() => {
      result.current.controller.grantSessionApproval?.({
        pluginId: request.pluginId,
        functionName: request.functionName,
        functionFingerprint: request.functionFingerprint,
        risk: request.risk,
        approvedAt: 2,
      });
    });

    expect(onApprovalsChange).toHaveBeenCalledTimes(1);
    expect(
      result.current.controller.isSessionApproved?.({
        pluginId: request.pluginId,
        functionName: request.functionName,
        functionFingerprint: request.functionFingerprint,
        risk: request.risk,
      }),
    ).toBe(true);
  });

  it("keeps a pending decision bound to its source session", async () => {
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useToolConfirmationController({
          sessionId,
          approvals: [],
          onApprovalsChange: vi.fn(),
        }),
      { initialProps: { sessionId: "session-1" } },
    );

    let decisionPromise!: Promise<string>;
    act(() => {
      decisionPromise = result.current.controller.requestConfirmation(request);
    });
    rerender({ sessionId: "session-2" });

    expect(result.current.pendingRequests).toEqual([
      { ...request, sessionId: "session-1" },
    ]);
    act(() => {
      expect(result.current.decide("call-1", "deny")).toBe(true);
    });
    await expect(decisionPromise).resolves.toBe("deny");
    expect(result.current.pendingRequests).toEqual([]);
  });
});
