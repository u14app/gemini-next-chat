import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { MEMORY_LIMITS } from "@/config/limits";
import {
  normalizeMemoryRecord,
  normalizeMemoryRecords,
  searchMemoryRecords,
} from "@/lib/memory/entities";
import type {
  MemoryDreamStatus,
  MemoryRecord,
  MemorySettings,
} from "@/lib/memory/types";
import {
  STORAGE_KEYS,
  STORAGE_VERSION,
  getAppDbStorage,
} from "../storage/storageConfig";
import { logDevError } from "@/lib/utils/devLogger";
import { reportAppRestoreHydration } from "@/lib/data/appRestoreJournal";

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  searchEnabled: true,
  autoRecordEnabled: true,
  dreamEnabled: true,
  triggerCount: MEMORY_LIMITS.triggerCount,
  targetCount: MEMORY_LIMITS.targetCount,
};

const DEFAULT_DREAM_STATUS: MemoryDreamStatus = {
  isRunning: false,
};

function normalizeMemorySettings(value: unknown): MemorySettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<MemorySettings>)
      : {};

  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : DEFAULT_MEMORY_SETTINGS.enabled,
    searchEnabled:
      typeof input.searchEnabled === "boolean"
        ? input.searchEnabled
        : DEFAULT_MEMORY_SETTINGS.searchEnabled,
    autoRecordEnabled:
      typeof input.autoRecordEnabled === "boolean"
        ? input.autoRecordEnabled
        : DEFAULT_MEMORY_SETTINGS.autoRecordEnabled,
    dreamEnabled:
      typeof input.dreamEnabled === "boolean"
        ? input.dreamEnabled
        : DEFAULT_MEMORY_SETTINGS.dreamEnabled,
    triggerCount:
      typeof input.triggerCount === "number" &&
      Number.isFinite(input.triggerCount)
        ? Math.max(1, Math.floor(input.triggerCount))
        : DEFAULT_MEMORY_SETTINGS.triggerCount,
    targetCount:
      typeof input.targetCount === "number" &&
      Number.isFinite(input.targetCount)
        ? Math.max(1, Math.floor(input.targetCount))
        : DEFAULT_MEMORY_SETTINGS.targetCount,
  };
}

function normalizeDreamStatus(value: unknown): MemoryDreamStatus {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<MemoryDreamStatus>)
      : {};

  return {
    isRunning: false,
    ...(typeof input.lastRunAt === "number" && Number.isFinite(input.lastRunAt)
      ? { lastRunAt: input.lastRunAt }
      : {}),
    ...(typeof input.lastError === "string" && input.lastError
      ? { lastError: input.lastError.slice(0, 500) }
      : {}),
  };
}

interface MemoryState {
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  settings: MemorySettings;
  memories: MemoryRecord[];
  memoryTrash: MemoryRecord[];
  dreamStatus: MemoryDreamStatus;
  updateMemorySettings: (settings: Partial<MemorySettings>) => void;
  addMemory: (memory: Partial<MemoryRecord>) => MemoryRecord | null;
  upsertMemories: (memories: Partial<MemoryRecord>[]) => MemoryRecord[];
  updateMemory: (
    id: string,
    updates: Partial<Omit<MemoryRecord, "id" | "createdAt">>,
  ) => void;
  removeMemory: (id: string) => void;
  forgetMemory: (id: string) => MemoryRecord | null;
  restoreMemory: (id: string) => MemoryRecord | null;
  replaceMemories: (memories: Partial<MemoryRecord>[]) => void;
  searchMemories: (query: string, limit?: number) => MemoryRecord[];
  markMemoriesUsed: (ids: string[]) => void;
  startDream: () => void;
  finishDream: (error?: string) => void;
}

function mergeMemoryRecords(
  current: MemoryRecord[],
  incoming: MemoryRecord[],
): MemoryRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));

  for (const record of incoming) {
    const duplicate = current.find(
      (item) =>
        item.content.toLowerCase().trim() ===
          record.content.toLowerCase().trim() &&
        (item.scope || "global") === (record.scope || "global") &&
        item.scopeId === record.scopeId,
    );
    if (duplicate) {
      byId.set(duplicate.id, {
        ...duplicate,
        ...record,
        id: duplicate.id,
        createdAt: duplicate.createdAt,
        updatedAt: Math.max(duplicate.updatedAt, record.updatedAt),
      });
      continue;
    }
    byId.set(record.id, record);
  }

  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MEMORY_LIMITS.maxMemories);
}

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      settings: { ...DEFAULT_MEMORY_SETTINGS },
      memories: [],
      memoryTrash: [],
      dreamStatus: { ...DEFAULT_DREAM_STATUS },

      updateMemorySettings: (settings) =>
        set((state) => ({
          settings: normalizeMemorySettings({ ...state.settings, ...settings }),
        })),

      addMemory: (memory) => {
        const record = normalizeMemoryRecord(memory);
        if (!record) return null;
        set((state) => ({
          memories: mergeMemoryRecords(state.memories, [record]),
        }));
        return record;
      },

      upsertMemories: (memories) => {
        const normalized = normalizeMemoryRecords(memories);
        if (normalized.length === 0) return [];
        set((state) => ({
          memories: mergeMemoryRecords(state.memories, normalized),
        }));
        return normalized;
      },

      updateMemory: (id, updates) => {
        const current = get().memories.find((record) => record.id === id);
        if (!current) return;
        const next = normalizeMemoryRecord({
          ...current,
          ...updates,
          id: current.id,
          createdAt: current.createdAt,
          updatedAt: Date.now(),
        });
        if (!next) return;
        set((state) => ({
          memories: state.memories.map((record) =>
            record.id === id ? next : record,
          ),
        }));
      },

      removeMemory: (id) =>
        set((state) => ({
          memories: state.memories.filter((record) => record.id !== id),
        })),

      forgetMemory: (id) => {
        const record = get().memories.find((candidate) => candidate.id === id);
        if (!record) return null;
        set((state) => ({
          memories: state.memories.filter((candidate) => candidate.id !== id),
          memoryTrash: [
            record,
            ...state.memoryTrash.filter((candidate) => candidate.id !== id),
          ].slice(0, MEMORY_LIMITS.maxMemories),
        }));
        return record;
      },

      restoreMemory: (id) => {
        const record = get().memoryTrash.find(
          (candidate) => candidate.id === id,
        );
        if (!record) return null;
        set((state) => ({
          memories: mergeMemoryRecords(state.memories, [record]),
          memoryTrash: state.memoryTrash.filter(
            (candidate) => candidate.id !== id,
          ),
        }));
        return record;
      },

      replaceMemories: (memories) =>
        set({
          memories: normalizeMemoryRecords(memories).slice(
            0,
            get().settings.targetCount,
          ),
        }),

      searchMemories: (query, limit = MEMORY_LIMITS.defaultSearchResults) =>
        searchMemoryRecords(get().memories, query, limit),

      markMemoriesUsed: (ids) => {
        const used = new Set(ids);
        if (used.size === 0) return;
        const now = Date.now();
        set((state) => ({
          memories: state.memories.map((record) =>
            used.has(record.id) ? { ...record, lastUsedAt: now } : record,
          ),
        }));
      },

      startDream: () =>
        set((state) => ({
          dreamStatus: {
            ...state.dreamStatus,
            isRunning: true,
            lastError: undefined,
          },
        })),

      finishDream: (error) =>
        set({
          dreamStatus: {
            isRunning: false,
            lastRunAt: Date.now(),
            ...(error ? { lastError: error.slice(0, 500) } : {}),
          },
        }),
    }),
    {
      name: STORAGE_KEYS.MEMORY,
      storage: createJSONStorage(getAppDbStorage),
      version: STORAGE_VERSION,
      migrate: async (persistedState) => {
        const state = persistedState as Partial<MemoryState>;
        return {
          ...state,
          settings: normalizeMemorySettings(state.settings),
          memories: normalizeMemoryRecords(state.memories),
          memoryTrash: normalizeMemoryRecords(state.memoryTrash),
          dreamStatus: normalizeDreamStatus(state.dreamStatus),
        } as MemoryState;
      },
      partialize: (state) => ({
        settings: state.settings,
        memories: state.memories,
        memoryTrash: state.memoryTrash,
        dreamStatus: state.dreamStatus,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (typeof window === "undefined") return;
        if (error) logDevError("Memory hydration failed:", error);
        void reportAppRestoreHydration("memory", error).then(
          () => state?.setHasHydrated(true),
          (restoreError) => {
            logDevError(
              "Restored memory data failed startup validation:",
              restoreError,
            );
            window.location.reload();
          },
        );
      },
    },
  ),
);
