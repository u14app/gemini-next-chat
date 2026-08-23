import { MEMORY_LIMITS } from "@/config/limits";
import { searchMemoryRecords } from "@/lib/memory/entities";
import type { MemoryRecord, MemoryScope, MemoryType } from "@/types";
import { useMemoryStore } from "@/store/core/memoryStore";

import type { BuiltinToolBinding } from "./types";

const MEMORY_TYPES: MemoryType[] = [
  "fact",
  "preference",
  "instruction",
  "project",
  "warning",
  "decision",
  "context",
];
const MEMORY_SCOPES: MemoryScope[] = [
  "global",
  "workspace",
  "agent",
  "session",
];

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function error(code: string, message: string) {
  return { ok: false as const, error: { code, message, recoverable: true } };
}

export function createAgentMemoryBindings({
  allowedScopes,
  scopeIds,
}: {
  allowedScopes: readonly MemoryScope[];
  scopeIds: { workspace?: string; agent?: string; session?: string };
}): BuiltinToolBinding[] {
  const allowed = new Set(allowedScopes);
  const scopeId = (scope: MemoryScope) =>
    scope === "workspace"
      ? scopeIds.workspace
      : scope === "agent"
        ? scopeIds.agent
        : scope === "session"
          ? scopeIds.session
          : undefined;
  const canUseScope = (scope: MemoryScope) =>
    allowed.has(scope) && (scope === "global" || Boolean(scopeId(scope)));
  const isVisible = (memory: MemoryRecord) => {
    const scope = memory.scope || "global";
    return (
      canUseScope(scope) &&
      (scope === "global" || memory.scopeId === scopeId(scope))
    );
  };
  const getVisible = () => useMemoryStore.getState().memories.filter(isVisible);
  const readDescriptor: NonNullable<BuiltinToolBinding["descriptor"]> = {
    version: 2,
    effects: ["local_read"],
    idempotency: "idempotent",
    sensitivity: "user_data",
    origin: "builtin",
  };
  const writeDescriptor: NonNullable<BuiltinToolBinding["descriptor"]> = {
    ...readDescriptor,
    effects: ["local_write"],
  };

  return [
    {
      definition: {
        type: "function",
        function: {
          name: "memory_list",
          description:
            "List Memory records visible in the current Profile scopes with their source and scope provenance.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              scope: { type: "string", enum: [...allowed] },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: MEMORY_LIMITS.maxSearchResults,
              },
            },
          },
        },
      },
      risk: "read",
      descriptor: readDescriptor,
      displayKey: "memoryList",
      agentOnly: true,
      async execute(args) {
        const input = inputRecord(args);
        const requestedScope = MEMORY_SCOPES.includes(
          input.scope as MemoryScope,
        )
          ? (input.scope as MemoryScope)
          : undefined;
        if (requestedScope && !canUseScope(requestedScope)) {
          return error(
            "MEMORY_SCOPE_DENIED",
            "The requested Memory scope is not allowed by this Agent Profile.",
          );
        }
        const limit = Number.isInteger(input.limit)
          ? Math.min(
              MEMORY_LIMITS.maxSearchResults,
              Math.max(1, Number(input.limit)),
            )
          : MEMORY_LIMITS.defaultSearchResults;
        const memories = getVisible()
          .filter(
            (memory) => !requestedScope || memory.scope === requestedScope,
          )
          .slice(0, limit);
        return { memories, allowedScopes: [...allowed] };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "memory_search",
          description:
            "Search Memory records visible in the current global, workspace, Agent, or session scopes.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", minLength: 1, maxLength: 1_000 },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: MEMORY_LIMITS.maxSearchResults,
              },
            },
            required: ["query"],
          },
        },
      },
      risk: "read",
      descriptor: readDescriptor,
      displayKey: "memorySearch",
      agentOnly: true,
      async execute(args) {
        const input = inputRecord(args);
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query)
          return error("MEMORY_QUERY_INVALID", "A query is required.");
        const limit = Number.isInteger(input.limit)
          ? Number(input.limit)
          : MEMORY_LIMITS.defaultSearchResults;
        const memories = searchMemoryRecords(getVisible(), query, limit);
        useMemoryStore
          .getState()
          .markMemoriesUsed(memories.map((memory) => memory.id));
        return { memories };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "remember",
          description:
            "Store one durable Memory in an explicitly allowed scope. Never store credentials, secrets, or external content without the user's intent.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              content: {
                type: "string",
                minLength: 1,
                maxLength: MEMORY_LIMITS.maxContentChars,
              },
              type: { type: "string", enum: MEMORY_TYPES },
              scope: { type: "string", enum: [...allowed] },
              importance: { type: "integer", minimum: 1, maximum: 5 },
              tags: {
                type: "array",
                maxItems: MEMORY_LIMITS.maxTags,
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: MEMORY_LIMITS.maxTagChars,
                },
              },
            },
            required: ["content", "scope"],
          },
        },
      },
      risk: "read",
      descriptor: { ...writeDescriptor, idempotency: "non_idempotent" },
      displayKey: "memoryRemember",
      agentOnly: true,
      async execute(args, context) {
        const input = inputRecord(args);
        const scope = input.scope as MemoryScope;
        if (!MEMORY_SCOPES.includes(scope) || !canUseScope(scope)) {
          return error(
            "MEMORY_SCOPE_DENIED",
            "The requested Memory scope is not allowed by this Agent Profile.",
          );
        }
        const content =
          typeof input.content === "string" ? input.content.trim() : "";
        if (!content)
          return error("MEMORY_CONTENT_INVALID", "Content is required.");
        const record = useMemoryStore.getState().addMemory({
          content,
          type: MEMORY_TYPES.includes(input.type as MemoryType)
            ? (input.type as MemoryType)
            : "fact",
          scope,
          ...(scopeId(scope) ? { scopeId: scopeId(scope) } : {}),
          importance:
            typeof input.importance === "number" ? input.importance : 3,
          tags: Array.isArray(input.tags) ? input.tags : [],
          source: "ai",
          sourceSessionId: context.sessionId,
        });
        return record
          ? {
              memory: record,
              provenance: { source: "ai", sessionId: context.sessionId },
            }
          : error("MEMORY_STORE_FAILED", "The Memory could not be stored.");
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "memory_update",
          description:
            "Update one visible Memory using its expected updatedAt value to prevent stale overwrites.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 160 },
              expectedUpdatedAt: { type: "integer", minimum: 1 },
              content: {
                type: "string",
                minLength: 1,
                maxLength: MEMORY_LIMITS.maxContentChars,
              },
              importance: { type: "integer", minimum: 1, maximum: 5 },
              tags: {
                type: "array",
                maxItems: MEMORY_LIMITS.maxTags,
                items: { type: "string", maxLength: MEMORY_LIMITS.maxTagChars },
              },
            },
            required: ["id", "expectedUpdatedAt"],
          },
        },
      },
      risk: "read",
      descriptor: writeDescriptor,
      displayKey: "memoryUpdate",
      agentOnly: true,
      async execute(args) {
        const input = inputRecord(args);
        const current = getVisible().find((memory) => memory.id === input.id);
        if (!current)
          return error("MEMORY_NOT_FOUND", "Memory is not visible.");
        if (current.updatedAt !== input.expectedUpdatedAt) {
          return error(
            "MEMORY_REVISION_CONFLICT",
            `Memory changed; latest updatedAt is ${current.updatedAt}.`,
          );
        }
        useMemoryStore.getState().updateMemory(current.id, {
          ...(typeof input.content === "string"
            ? { content: input.content }
            : {}),
          ...(typeof input.importance === "number"
            ? { importance: input.importance }
            : {}),
          ...(Array.isArray(input.tags)
            ? { tags: input.tags as string[] }
            : {}),
          source: "ai",
        });
        const memory = useMemoryStore
          .getState()
          .memories.find((candidate) => candidate.id === current.id);
        return { memory, previousUpdatedAt: current.updatedAt };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "forget",
          description:
            "Move one visible Memory to recoverable local trash. Returns an undo token; this does not permanently erase it.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 160 },
              expectedUpdatedAt: { type: "integer", minimum: 1 },
            },
            required: ["id", "expectedUpdatedAt"],
          },
        },
      },
      risk: "read",
      descriptor: { ...writeDescriptor, idempotency: "non_idempotent" },
      displayKey: "memoryForget",
      agentOnly: true,
      async execute(args) {
        const input = inputRecord(args);
        const current = getVisible().find((memory) => memory.id === input.id);
        if (!current)
          return error("MEMORY_NOT_FOUND", "Memory is not visible.");
        if (current.updatedAt !== input.expectedUpdatedAt) {
          return error(
            "MEMORY_REVISION_CONFLICT",
            `Memory changed; latest updatedAt is ${current.updatedAt}.`,
          );
        }
        const forgotten = useMemoryStore.getState().forgetMemory(current.id);
        return forgotten
          ? {
              forgotten: true,
              id: forgotten.id,
              scope: forgotten.scope || "global",
              undoToken: forgotten.id,
              source: forgotten.source,
            }
          : error("MEMORY_FORGET_FAILED", "Memory could not be forgotten.");
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "memory_restore",
          description:
            "Restore a Memory from recoverable local trash by undo token.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              undoToken: { type: "string", minLength: 1, maxLength: 160 },
            },
            required: ["undoToken"],
          },
        },
      },
      risk: "read",
      descriptor: writeDescriptor,
      displayKey: "memoryRestore",
      agentOnly: true,
      async execute(args) {
        const input = inputRecord(args);
        const memory = useMemoryStore
          .getState()
          .restoreMemory(String(input.undoToken || ""));
        if (!memory || !isVisible(memory)) {
          if (memory) useMemoryStore.getState().forgetMemory(memory.id);
          return error(
            "MEMORY_RESTORE_DENIED",
            "The Memory is unavailable or outside the current scopes.",
          );
        }
        return { restored: true, memory };
      },
    },
  ];
}
