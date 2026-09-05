// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResearchOperation } from "@/lib/research/runtime/operations";
import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import type { ResearchTaskExecutionLease } from "@/services/research/taskExecutionLock";

const lazyModules = vi.hoisted(() => ({
  planningRequested: false,
  executionRequested: false,
  releasePlanning: undefined as (() => void) | undefined,
  releaseExecution: undefined as (() => void) | undefined,
  prepare: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined),
  leaseHeld: false,
}));
vi.mock("@/lib/research/runtime/preparePlan", async () => {
  lazyModules.planningRequested = true;
  await new Promise<void>((resolve) => {
    lazyModules.releasePlanning = resolve;
  });
  return { prepareResearchPlan: lazyModules.prepare };
});
vi.mock("@/lib/research/runtime/executeResearch", async () => {
  lazyModules.executionRequested = true;
  await new Promise<void>((resolve) => {
    lazyModules.releaseExecution = resolve;
  });
  return { executeResearchRun: lazyModules.execute };
});
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    getState: () => ({
      refreshTask: async () => ({ id: "task", status: "draft" }),
    }),
  },
}));
vi.mock("@/services/research/taskExecutionLock", () => ({
  withResearchTaskExecutionLock: async (
    _id: string,
    work: () => Promise<void>,
  ) => {
    lazyModules.leaseHeld = true;
    try {
      await work();
      return { acquired: true };
    } finally {
      lazyModules.leaseHeld = false;
    }
  },
}));

import { usePreparePlan } from "@/hooks/research/usePreparePlan";
import { useResearchExecution } from "@/hooks/research/useResearchExecution";

afterEach(cleanup);

function operationHarness() {
  let controller: AbortController | undefined;
  const runOperation: RunResearchOperation = async (_id, _kind, operation) => {
    controller = new AbortController();
    await operation(controller);
  };
  return { runOperation, getController: () => controller };
}

const t = ((key: string) => key) as ResearchTranslate;
const localizedRuntimeError = (_error: unknown, fallback: string) => fallback;

describe("lazy Research runtime loading", () => {
  it("registers planning cancellation before loading and retains the lease until it settles", async () => {
    const operation = operationHarness();
    const { result } = renderHook(() =>
      usePreparePlan({ ...operation, t, localizedRuntimeError }),
    );
    expect(lazyModules.planningRequested).toBe(false);
    let planning: Promise<void> | undefined;
    act(() => {
      planning = result.current("task");
    });
    await waitFor(() => expect(lazyModules.planningRequested).toBe(true));
    expect(lazyModules.leaseHeld).toBe(true);
    expect(operation.getController()).toBeDefined();
    operation.getController()!.abort();
    await act(async () => {
      lazyModules.releasePlanning!();
      await planning;
    });
    expect(lazyModules.prepare).not.toHaveBeenCalled();
    expect(lazyModules.leaseHeld).toBe(false);

    await act(async () => result.current("task", "refine", "provider:model"));
    expect(lazyModules.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task",
        adjustment: "refine",
        requestModel: "provider:model",
        controller: operation.getController(),
      }),
    );
  });

  it("does not execute a cancelled download and forwards the caller's lease on the next run", async () => {
    const operation = operationHarness();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useResearchExecution({
        ...operation,
        operationsRef: { current: new Map() },
        userInputController: { requestInput: vi.fn() },
        t,
        localizedRuntimeError,
        dependencyText: {
          offline: "offline",
          modelUnavailable: "model",
          toolCallingUnavailable: "tools",
          searchUnavailable: "search",
          searchDisabled: "disabled",
          checkpointUnavailable: "checkpoint",
          sourceUnavailable: (source) => source,
        },
        onError,
      }),
    );
    expect(lazyModules.executionRequested).toBe(false);
    const lease = { taskId: "task" } as ResearchTaskExecutionLease;
    let execution: Promise<void> | undefined;
    act(() => {
      execution = result.current.launchResearch("task", lease);
    });
    await waitFor(() => expect(lazyModules.executionRequested).toBe(true));
    operation.getController()!.abort();
    await act(async () => {
      lazyModules.releaseExecution!();
      await execution;
    });
    expect(lazyModules.execute).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    await act(async () => result.current.launchResearch("task", lease));
    expect(lazyModules.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task",
        lease,
        controller: operation.getController(),
      }),
    );
  });
});
