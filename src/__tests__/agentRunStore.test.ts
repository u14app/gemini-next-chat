import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRun, type AgentRun } from "../lib/agent";

const persistence = vi.hoisted(() => ({
  save: vi.fn(async () => undefined),
  list: vi.fn<() => Promise<AgentRun[]>>(async () => []),
  clearSession: vi.fn(async () => undefined),
}));

vi.mock("@/services/agent", () => ({
  getAgentRunPersistence: () => persistence,
}));

import { useAgentRunStore } from "../store/core/agentRunStore";

describe("agentRunStore", () => {
  beforeEach(() => {
    persistence.save.mockClear();
    persistence.list.mockReset();
    persistence.list.mockResolvedValue([]);
    persistence.clearSession.mockClear();
    useAgentRunStore.setState({ runsById: {}, loadedSessionIds: {} });
  });

  it("updates visible state before persisting a checkpoint", async () => {
    const run = createAgentRun({ id: "run-1", sessionId: "session-1", now: 1 });
    const pending = useAgentRunStore.getState().upsertRun(run);

    expect(useAgentRunStore.getState().runsById[run.id]).toEqual(run);
    await pending;
    expect(persistence.save).toHaveBeenCalledWith(run);
  });

  it("loads each session once and clears its persisted runs", async () => {
    const run = createAgentRun({ id: "run-1", sessionId: "session-1", now: 1 });
    persistence.list.mockResolvedValue([run]);

    await useAgentRunStore.getState().loadSessionRuns("session-1");
    await useAgentRunStore.getState().loadSessionRuns("session-1");
    expect(persistence.list).toHaveBeenCalledTimes(1);

    await useAgentRunStore.getState().clearSessionRuns("session-1");
    expect(useAgentRunStore.getState().runsById).toEqual({});
    expect(persistence.clearSession).toHaveBeenCalledWith("session-1");
  });
});
