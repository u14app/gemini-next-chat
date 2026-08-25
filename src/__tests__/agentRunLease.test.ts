import { describe, expect, it } from "vitest";

import {
  AgentRunLeaseConflictError,
  acquireAgentRunLease,
  checkpointAgentRunLease,
  releaseAgentRunLease,
} from "@/services/agent/runLease";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("Agent run tab lease", () => {
  it("prevents a second tab from taking an active session lease", () => {
    const storage = createStorage();
    const first = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-1",
      ownerId: "tab-a",
      now: 100,
      ttlMs: 100,
      storage,
    });
    expect(first.acquired).toBe(true);

    const second = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-2",
      ownerId: "tab-b",
      now: 150,
      ttlMs: 100,
      storage,
    });
    expect(second).toMatchObject({
      acquired: false,
      holder: { ownerId: "tab-a", runId: "run-1" },
    });
  });

  it("renews on an event checkpoint and releases only its own lease", () => {
    const storage = createStorage();
    const acquired = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-1",
      ownerId: "tab-a",
      now: 100,
      ttlMs: 100,
      storage,
    });
    if (!acquired.acquired) throw new Error("lease acquisition failed");

    const renewed = checkpointAgentRunLease(acquired.lease, {
      now: 180,
      ttlMs: 100,
      storage,
    });
    expect(renewed.expiresAt).toBe(280);
    releaseAgentRunLease(renewed, storage);

    expect(
      acquireAgentRunLease({
        sessionId: "session-1",
        runId: "run-2",
        ownerId: "tab-b",
        now: 181,
        storage,
      }).acquired,
    ).toBe(true);
  });

  it("allows takeover only after the prior lease expires", () => {
    const storage = createStorage();
    acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-1",
      ownerId: "tab-a",
      now: 100,
      ttlMs: 100,
      storage,
    });

    expect(
      acquireAgentRunLease({
        sessionId: "session-1",
        runId: "run-2",
        ownerId: "tab-b",
        now: 201,
        storage,
      }).acquired,
    ).toBe(true);
  });

  it("lets one tab nest a second run on the same session", () => {
    const storage = createStorage();
    const outer = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-outer",
      ownerId: "tab-a",
      now: 100,
      ttlMs: 100,
      storage,
    });
    if (!outer.acquired) throw new Error("outer acquisition failed");

    // Deep Research prepares its plan inside the chat turn that started it.
    const inner = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-inner",
      ownerId: "tab-a",
      now: 120,
      ttlMs: 100,
      storage,
    });
    expect(inner).toMatchObject({ acquired: true });
    if (!inner.acquired) throw new Error("inner acquisition failed");
    expect(inner.lease.runId).toBe("run-inner");
    expect(inner.lease.runIds).toEqual(["run-outer", "run-inner"]);
    expect(inner.lease.expiresAt).toBe(220);

    // Another tab is still locked out while either run holds the lease.
    expect(
      acquireAgentRunLease({
        sessionId: "session-1",
        runId: "run-other",
        ownerId: "tab-b",
        now: 150,
        storage,
      }).acquired,
    ).toBe(false);

    // Both runs can checkpoint independently without evicting each other.
    const renewedOuter = checkpointAgentRunLease(outer.lease, {
      now: 160,
      ttlMs: 100,
      storage,
    });
    expect(renewedOuter.runId).toBe("run-outer");
    expect(renewedOuter.runIds).toEqual(["run-outer", "run-inner"]);
    const renewedInner = checkpointAgentRunLease(inner.lease, {
      now: 170,
      ttlMs: 100,
      storage,
    });
    expect(renewedInner.runIds).toEqual(["run-outer", "run-inner"]);
  });

  it("keeps the lease alive until every nested run releases it", () => {
    const storage = createStorage();
    const outer = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-outer",
      ownerId: "tab-a",
      now: 100,
      ttlMs: 100,
      storage,
    });
    const inner = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-inner",
      ownerId: "tab-a",
      now: 110,
      ttlMs: 100,
      storage,
    });
    if (!outer.acquired || !inner.acquired) throw new Error("acquire failed");

    releaseAgentRunLease(outer.lease, storage);
    expect(
      acquireAgentRunLease({
        sessionId: "session-1",
        runId: "run-other",
        ownerId: "tab-b",
        now: 150,
        storage,
      }).acquired,
    ).toBe(false);
    // The surviving run can still checkpoint after the first run released.
    expect(() =>
      checkpointAgentRunLease(inner.lease, { now: 155, ttlMs: 100, storage }),
    ).not.toThrow();

    releaseAgentRunLease(inner.lease, storage);
    expect(
      acquireAgentRunLease({
        sessionId: "session-1",
        runId: "run-other",
        ownerId: "tab-b",
        now: 160,
        storage,
      }).acquired,
    ).toBe(true);
  });

  it("rejects a checkpoint for a run the stored lease no longer holds", () => {
    const storage = createStorage();
    const acquired = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-1",
      ownerId: "tab-a",
      now: 100,
      ttlMs: 100,
      storage,
    });
    if (!acquired.acquired) throw new Error("lease acquisition failed");
    releaseAgentRunLease(acquired.lease, storage);
    acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-2",
      ownerId: "tab-b",
      now: 120,
      ttlMs: 100,
      storage,
    });

    expect(() =>
      checkpointAgentRunLease(acquired.lease, { now: 130, storage }),
    ).toThrow(AgentRunLeaseConflictError);
  });

  it("reads a lease written before nesting was supported", () => {
    const storage = createStorage();
    storage.setItem(
      "neo-chat:agent-run-lease:session-1",
      JSON.stringify({
        version: 1,
        sessionId: "session-1",
        runId: "run-legacy",
        ownerId: "tab-a",
        acquiredAt: 100,
        checkpointAt: 100,
        expiresAt: 200,
      }),
    );

    // Cross-tab exclusion still applies to the legacy record.
    expect(
      acquireAgentRunLease({
        sessionId: "session-1",
        runId: "run-2",
        ownerId: "tab-b",
        now: 150,
        storage,
      }).acquired,
    ).toBe(false);

    const nested = acquireAgentRunLease({
      sessionId: "session-1",
      runId: "run-nested",
      ownerId: "tab-a",
      now: 150,
      ttlMs: 100,
      storage,
    });
    if (!nested.acquired) throw new Error("nested acquisition failed");
    expect(nested.lease.runIds).toEqual(["run-legacy", "run-nested"]);
  });
});
