import { MEMORY_LIMITS } from "@/config/limits";
import {
  searchMemoryRecords,
  shouldExposeMemorySearchTool,
} from "@/lib/memory/entities";
import { formatMemoryToolResult, MEMORY_SEARCH_TOOL } from "@/lib/memory/tools";
import { useMemoryStore } from "@/store/core/memoryStore";

import type { ChatToolDefinition } from "../types";
import type { BuiltinToolBinding } from "./types";

function coerceToolDefinition(tool: unknown): ChatToolDefinition {
  return tool as ChatToolDefinition;
}

export function isBrowserMemoryStorePendingHydration(
  hasHydrated: boolean,
): boolean {
  return typeof window !== "undefined" && !hasHydrated;
}

export function isMemorySearchEnabled(): boolean {
  const { _hasHydrated, settings } = useMemoryStore.getState();
  return Boolean(
    !isBrowserMemoryStorePendingHydration(_hasHydrated) &&
    settings.enabled &&
    settings.searchEnabled,
  );
}

function getNumberArg(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function executeMemorySearch(args: unknown): Promise<unknown> {
  const state = useMemoryStore.getState();
  const { _hasHydrated, settings, memories } = state;
  if (
    isBrowserMemoryStorePendingHydration(_hasHydrated) ||
    !settings.enabled ||
    !settings.searchEnabled
  ) {
    return { memories: [] };
  }

  const input =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const query =
    typeof input.query === "string" && input.query.trim() ? input.query : "";
  const limit = getNumberArg(input.limit, MEMORY_LIMITS.defaultSearchResults);
  const results = searchMemoryRecords(memories, query, limit);
  state.markMemoriesUsed(results.map((memory) => memory.id));
  return formatMemoryToolResult(results);
}

export function collectMemorySearchBinding(
  message: string,
): BuiltinToolBinding | null {
  if (!isMemorySearchEnabled()) return null;
  if (!shouldExposeMemorySearchTool(message)) return null;

  return {
    definition: coerceToolDefinition(MEMORY_SEARCH_TOOL),
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "memorySearch",
    execute: async (args, { signal }) => {
      signal?.throwIfAborted();
      const result = await executeMemorySearch(args);
      signal?.throwIfAborted();
      return result;
    },
  };
}
