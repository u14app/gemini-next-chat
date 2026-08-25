import { describe, expect, it, vi } from "vitest";

import {
  createAgentRun,
  failToolExecution,
  markToolExecutionRunning,
  prepareToolExecution,
  recordAgentEvidence,
} from "@/lib/agent/run";
import type { ToolInvocationPolicy } from "@/lib/plugin/types";
import {
  createAgentRunPersistence,
  parseStoredAgentRun,
  toPersistedAgentRun,
} from "@/services/agent";

const readPolicy: ToolInvocationPolicy = {
  effects: ["local_read"],
  idempotency: "idempotent",
  sensitivity: "none",
  origin: "builtin",
};

function createRun(id: string, sessionId: string, now: number) {
  return createAgentRun({ id, sessionId, now });
}

describe("AgentRun local persistence", () => {
  it("round-trips the shared Research journal discriminator", async () => {
    const persistence = createAgentRunPersistence({ indexedDb: null });
    const run = createAgentRun({
      id: "research-run",
      sessionId: "session-1",
      workflowKind: "research",
      now: 100,
    });

    await persistence.save(run);

    expect(await persistence.get(run.id)).toMatchObject({
      id: run.id,
      workflowKind: "research",
    });
    persistence.close();
  });

  it("redacts secret-like error values and never adds raw tool payloads", () => {
    let run = prepareToolExecution(createRun("run-1", "session-1", 100), {
      id: "execution-1",
      callId: "call-1",
      toolName: "example_tool",
      definitionFingerprint: "definition-hash",
      argumentsHash: "arguments-hash",
      round: 2,
      policy: readPolicy,
      at: 110,
    });
    run = markToolExecutionRunning(run, "execution-1", 120);
    run = failToolExecution(
      run,
      "execution-1",
      {
        code: "REMOTE_ERROR",
        message:
          "Authorization: Bearer private-token apiKey=private-key password=hunter2",
        recoverable: true,
      },
      130,
    );

    const persisted = toPersistedAgentRun(run);
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private-key");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).toContain("[REDACTED]");
    expect(persisted.toolExecutions[0]).not.toHaveProperty("args");
    expect(persisted.toolExecutions[0]).not.toHaveProperty("result");
    expect(persisted.toolExecutions[0].round).toBe(2);
    expect(run.toolExecutions[0].error?.message).toContain("private-token");
  });

  it("redacts credential query parameters from persisted Evidence URLs", () => {
    const run = recordAgentEvidence(
      createRun("run-1", "session-1", 100),
      [
        {
          sourceId: "source-1",
          url: "https://example.com/page?token=private-token&view=full",
          retrievedAt: 110,
          contentHash: "sha256:content",
          retrievalKind: "fetch",
          toolCallId: "call-1",
        },
      ],
      110,
    );

    const serialized = JSON.stringify(toPersistedAgentRun(run));
    expect(serialized).not.toContain("private-token");
    expect(serialized).toContain("%5BREDACTED%5D");
    expect(serialized).toContain("view=full");
  });

  it("falls back to an explicit in-memory mode when IndexedDB is unavailable", async () => {
    const persistence = createAgentRunPersistence({ indexedDb: null });
    const earlier = createRun("run-1", "session-1", 100);
    const later = createRun("run-2", "session-1", 200);
    const other = createRun("run-3", "session-2", 300);

    await persistence.save(earlier);
    await persistence.save(later);
    await persistence.save(other);

    expect(persistence.getStatus()).toEqual({
      mode: "memory",
      durable: false,
      fallbackReason: "indexeddb_unavailable",
    });
    expect((await persistence.get("run-1"))?.id).toBe("run-1");
    expect((await persistence.list("session-1")).map((run) => run.id)).toEqual([
      "run-2",
      "run-1",
    ]);

    await persistence.remove("run-1");
    expect(await persistence.get("run-1")).toBeNull();
    await persistence.clearSession("session-1");
    expect(await persistence.list()).toHaveLength(1);
    expect((await persistence.list())[0].id).toBe("run-3");
  });

  it("keeps the memory mirror and reports loss of durability after an IDB failure", async () => {
    const open = vi.fn(() => {
      throw new Error("storage disabled");
    });
    const persistence = createAgentRunPersistence({
      indexedDb: { open } as unknown as IDBFactory,
    });

    await persistence.save(createRun("run-1", "session-1", 100));

    expect(open).toHaveBeenCalledOnce();
    expect(persistence.getStatus()).toEqual({
      mode: "memory",
      durable: false,
      fallbackReason: "indexeddb_operation_failed",
    });
    expect((await persistence.get("run-1"))?.id).toBe("run-1");
  });

  it("rejects malformed or unsupported persisted records", () => {
    expect(parseStoredAgentRun(null)).toBeNull();
    expect(
      parseStoredAgentRun({
        storageVersion: 99,
        runId: "run-1",
        sessionId: "session-1",
        updatedAt: 100,
        run: createRun("run-1", "session-1", 100),
      }),
    ).toBeNull();
  });
});
