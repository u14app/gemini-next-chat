import { v7 as uuidv7 } from "uuid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  diffAgentProfiles,
  normalizeAgentProfileRevision,
  type AgentProfileRevision,
} from "@/lib/assistant/profileHistory";
import type { AgentProfileV2 } from "@/types";
import {
  getAppDbStorage,
  STORAGE_KEYS,
  STORAGE_VERSION,
} from "@/store/storage/storageConfig";

const MAX_REVISIONS_PER_PROFILE = 20;

interface AgentProfileRevisionState {
  revisionsByProfileId: Record<string, AgentProfileRevision[]>;
  recordRevision: (profileId: string, profile: AgentProfileV2) => void;
  clearProfileRevisions: (profileId: string) => void;
}

function normalizeRevisionMap(
  value: unknown,
): Record<string, AgentProfileRevision[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(
      ([profileId, revisions]) => {
        if (!profileId.trim() || !Array.isArray(revisions)) return [];
        const normalized = revisions
          .map(normalizeAgentProfileRevision)
          .filter(
            (revision): revision is AgentProfileRevision =>
              revision !== null && revision.profileId === profileId,
          )
          .sort((left, right) => right.sequence - left.sequence)
          .slice(0, MAX_REVISIONS_PER_PROFILE);
        return normalized.length ? [[profileId, normalized]] : [];
      },
    ),
  );
}

export const useAgentProfileRevisionStore = create<AgentProfileRevisionState>()(
  persist(
    (set) => ({
      revisionsByProfileId: {},
      recordRevision: (profileId, profile) =>
        set((state) => {
          const current = state.revisionsByProfileId[profileId] || [];
          const previous = current[0];
          const changes = diffAgentProfiles(previous?.profile, profile);
          if (previous && changes.length === 0) return state;
          const revision: AgentProfileRevision = {
            id: uuidv7(),
            profileId,
            sequence: (previous?.sequence || 0) + 1,
            createdAt: Date.now(),
            profile,
            changes,
          };
          return {
            revisionsByProfileId: {
              ...state.revisionsByProfileId,
              [profileId]: [revision, ...current].slice(
                0,
                MAX_REVISIONS_PER_PROFILE,
              ),
            },
          };
        }),
      clearProfileRevisions: (profileId) =>
        set((state) => ({
          revisionsByProfileId: Object.fromEntries(
            Object.entries(state.revisionsByProfileId).filter(
              ([id]) => id !== profileId,
            ),
          ),
        })),
    }),
    {
      name: STORAGE_KEYS.AGENT_PROFILE_REVISIONS,
      storage: createJSONStorage(getAppDbStorage),
      version: STORAGE_VERSION,
      migrate: (persisted) => {
        const value = persisted as Partial<AgentProfileRevisionState>;
        return {
          revisionsByProfileId: normalizeRevisionMap(
            value.revisionsByProfileId,
          ),
        } as AgentProfileRevisionState;
      },
      partialize: (state) => ({
        revisionsByProfileId: state.revisionsByProfileId,
      }),
    },
  ),
);
