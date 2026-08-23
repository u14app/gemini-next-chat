import { describe, expect, it } from "vitest";

import {
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
});
