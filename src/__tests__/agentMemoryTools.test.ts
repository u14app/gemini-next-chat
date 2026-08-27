import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryRecord } from "../types";

const memoryState = vi.hoisted(() => ({
  memories: [] as MemoryRecord[],
  memoryTrash: [] as MemoryRecord[],
  markMemoriesUsed: vi.fn(),
  addMemory: vi.fn(),
  updateMemory: vi.fn(),
  forgetMemory: vi.fn(),
  restoreMemory: vi.fn(),
}));

vi.mock("../store/core/memoryStore", () => ({
  useMemoryStore: { getState: () => memoryState },
}));

import { createAgentMemoryBindings } from "../services/api/chat/builtinTools/agentMemory";

const context = {
  sessionId: "session-1",
  model: "openai:test-model",
  signal: new AbortController().signal,
  emit: {},
};

function record(
  id: string,
  scope: MemoryRecord["scope"],
  scopeId?: string,
): MemoryRecord {
  return {
    id,
    type: "decision",
    content: `${id} content`,
    createdAt: 100,
    updatedAt: 100,
    importance: 4,
    tags: ["agent"],
    source: "manual",
    scope,
    ...(scopeId ? { scopeId } : {}),
  };
}

const bindings = () =>
  Object.fromEntries(
    createAgentMemoryBindings({
      allowedScopes: ["global", "session"],
      scopeIds: { session: "session-1" },
    }).map((binding) => [binding.definition.function.name, binding]),
  );

describe("Agent Memory tools", () => {
  beforeEach(() => {
    memoryState.memories = [
      record("global", "global"),
      record("visible", "session", "session-1"),
      record("hidden", "session", "session-2"),
    ];
    memoryState.memoryTrash = [];
    memoryState.markMemoriesUsed.mockReset();
    memoryState.addMemory.mockReset();
    memoryState.updateMemory.mockReset();
    memoryState.forgetMemory.mockReset();
    memoryState.restoreMemory.mockReset();
    memoryState.addMemory.mockImplementation((input: Partial<MemoryRecord>) => {
      const next = {
        ...record("created", input.scope || "global", input.scopeId),
        ...input,
      } as MemoryRecord;
      memoryState.memories = [next, ...memoryState.memories];
      return next;
    });
    memoryState.updateMemory.mockImplementation(
      (id: string, updates: Partial<MemoryRecord>) => {
        memoryState.memories = memoryState.memories.map((memory) =>
          memory.id === id
            ? { ...memory, ...updates, updatedAt: memory.updatedAt + 1 }
            : memory,
        );
      },
    );
    memoryState.forgetMemory.mockImplementation((id: string) => {
      const found = memoryState.memories.find((memory) => memory.id === id);
      if (!found) return null;
      memoryState.memories = memoryState.memories.filter(
        (memory) => memory.id !== id,
      );
      memoryState.memoryTrash = [found, ...memoryState.memoryTrash];
      return found;
    });
    memoryState.restoreMemory.mockImplementation((id: string) => {
      const found = memoryState.memoryTrash.find((memory) => memory.id === id);
      if (!found) return null;
      memoryState.memoryTrash = memoryState.memoryTrash.filter(
        (memory) => memory.id !== id,
      );
      memoryState.memories = [found, ...memoryState.memories];
      return found;
    });
  });

  it("lists only records inside the effective scopes and IDs", async () => {
    await expect(
      bindings().memory_list.execute({}, context),
    ).resolves.toMatchObject({
      allowedScopes: ["global", "session"],
      memories: [
        expect.objectContaining({ id: "global" }),
        expect.objectContaining({ id: "visible" }),
      ],
    });
  });

  it("rejects cross-scope writes instead of widening permission", async () => {
    await expect(
      bindings().remember.execute(
        { content: "Workspace secret", scope: "workspace" },
        context,
      ),
    ).resolves.toMatchObject({ error: { code: "MEMORY_SCOPE_DENIED" } });
    expect(memoryState.addMemory).not.toHaveBeenCalled();
  });

  it("requires the latest revision and supports recoverable forget/restore", async () => {
    await expect(
      bindings().memory_update.execute(
        { id: "visible", expectedUpdatedAt: 99, content: "stale" },
        context,
      ),
    ).resolves.toMatchObject({ error: { code: "MEMORY_REVISION_CONFLICT" } });

    const forgotten = await bindings().forget.execute(
      { id: "visible", expectedUpdatedAt: 100 },
      context,
    );
    expect(forgotten).toMatchObject({
      forgotten: true,
      undoToken: "visible",
      scope: "session",
    });
    expect(memoryState.memories.map((memory) => memory.id)).not.toContain(
      "visible",
    );

    await expect(
      bindings().memory_restore.execute({ undoToken: "visible" }, context),
    ).resolves.toMatchObject({
      restored: true,
      memory: { id: "visible", scopeId: "session-1" },
    });
  });
});
