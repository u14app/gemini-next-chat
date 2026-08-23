import { create } from "zustand";

import { recoverInterruptedAgentRun, type AgentRun } from "@/lib/agent";
import { getAgentRunPersistence } from "@/services/agent";
import { logDevError } from "@/lib/utils/devLogger";

interface AgentRunState {
  runsById: Record<string, AgentRun>;
  loadedSessionIds: Record<string, true>;
  upsertRun: (run: AgentRun) => Promise<void>;
  loadSessionRuns: (sessionId: string) => Promise<void>;
  clearSessionRuns: (sessionId: string) => Promise<void>;
}

export const useAgentRunStore = create<AgentRunState>((set, get) => ({
  runsById: {},
  loadedSessionIds: {},

  upsertRun: async (run) => {
    set((state) => ({
      runsById: { ...state.runsById, [run.id]: run },
    }));
    try {
      await getAgentRunPersistence().save(run);
    } catch (error) {
      logDevError("Failed to persist Agent run", error);
    }
  },

  loadSessionRuns: async (sessionId) => {
    if (!sessionId || get().loadedSessionIds[sessionId]) return;
    try {
      const runs = await getAgentRunPersistence().list(sessionId);
      const recoveredRuns = runs.map((run) => recoverInterruptedAgentRun(run));
      await Promise.all(
        recoveredRuns.map((run, index) =>
          run === runs[index]
            ? Promise.resolve()
            : getAgentRunPersistence().save(run),
        ),
      );
      set((state) => ({
        runsById: Object.fromEntries([
          ...Object.entries(state.runsById),
          ...recoveredRuns.map((run) => [run.id, run] as const),
        ]),
        loadedSessionIds: {
          ...state.loadedSessionIds,
          [sessionId]: true,
        },
      }));
    } catch (error) {
      logDevError("Failed to load Agent runs", error);
    }
  },

  clearSessionRuns: async (sessionId) => {
    set((state) => ({
      runsById: Object.fromEntries(
        Object.entries(state.runsById).filter(
          ([, run]) => run.sessionId !== sessionId,
        ),
      ),
      loadedSessionIds: Object.fromEntries(
        Object.entries(state.loadedSessionIds).filter(
          ([id]) => id !== sessionId,
        ),
      ),
    }));
    try {
      await getAgentRunPersistence().clearSession(sessionId);
    } catch (error) {
      logDevError("Failed to clear Agent runs", error);
    }
  },
}));
