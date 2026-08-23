import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEMORY_LIMITS } from "../config/limits";
import type { MemoryRecord } from "../lib/memory/types";
import { collectBuiltinTools } from "../services/api/chat/builtinTools";

interface MockMemoryState {
  _hasHydrated: boolean;
  settings: {
    enabled: boolean;
    searchEnabled: boolean;
  };
  memories: MemoryRecord[];
  markMemoriesUsed: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  memoryState: {} as MockMemoryState,
}));

vi.mock("@/store/core/memoryStore", () => ({
  useMemoryStore: {
    getState: () => mocks.memoryState,
  },
}));

function createMemory(index: number): MemoryRecord {
  return {
    id: `mem_${index}`,
    type: "project",
    content: `Keep document parser ${index} as the configured default.`,
    createdAt: index,
    updatedAt: index,
    importance: 5,
    tags: ["document", "parser"],
    source: "manual",
  };
}

describe("built-in tool registry", () => {
  beforeEach(() => {
    mocks.memoryState = {
      _hasHydrated: true,
      settings: {
        enabled: true,
        searchEnabled: true,
      },
      memories: Array.from(
        { length: MEMORY_LIMITS.maxSearchResults + 2 },
        (_, index) => createMemory(index),
      ),
      markMemoriesUsed: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collects memory search as a request-scoped read binding", () => {
    const collected = collectBuiltinTools({
      message: "What do you remember about my document parser?",
    });

    expect(collected.definitions).toHaveLength(2);
    expect(collected.definitions[0]?.function.name).toBe("memory_search");
    expect([...collected.bindingsByName.keys()]).toEqual([
      "memory_search",
      "start_long_text_output",
    ]);
    expect(collected.bindingsByName.get("memory_search")).toMatchObject({
      risk: "read",
      displayKey: "memorySearch",
    });
  });

  it("preserves all memory-search collection gates", () => {
    expect(
      collectBuiltinTools({ message: "Which parser should I use?" })
        .definitions,
    ).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: "start_long_text_output" }),
      }),
    ]);

    mocks.memoryState.settings.searchEnabled = false;
    expect(
      collectBuiltinTools({
        message: "What do you remember about my parser?",
      }).definitions,
    ).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: "start_long_text_output" }),
      }),
    ]);

    mocks.memoryState.settings.searchEnabled = true;
    mocks.memoryState.settings.enabled = false;
    expect(
      collectBuiltinTools({
        message: "What do you remember about my parser?",
      }).definitions,
    ).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: "start_long_text_output" }),
      }),
    ]);

    mocks.memoryState.settings.enabled = true;
    vi.stubGlobal("window", {});
    mocks.memoryState._hasHydrated = false;
    expect(
      collectBuiltinTools({
        message: "What do you remember about my parser?",
      }).definitions,
    ).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: "start_long_text_output" }),
      }),
    ]);

    mocks.memoryState._hasHydrated = true;
    expect(
      collectBuiltinTools({
        message: "What do you remember about my parser?",
        disabled: true,
      }).definitions,
    ).toEqual([]);
  });

  it("rechecks live memory availability before execution", async () => {
    const collected = collectBuiltinTools({
      message: "Recall my document parser decision.",
    });
    const binding = collected.bindingsByName.get("memory_search");
    expect(binding).toBeDefined();

    mocks.memoryState.settings.searchEnabled = false;
    await expect(
      binding!.execute(
        { query: "document parser" },
        {
          signal: new AbortController().signal,
          sessionId: "session-1",
          emit: {},
        },
      ),
    ).resolves.toEqual({ memories: [] });
    expect(mocks.memoryState.markMemoriesUsed).not.toHaveBeenCalled();
  });

  it("keeps memory result bounds and usage marking unchanged", async () => {
    const collected = collectBuiltinTools({
      message: "What do you remember about my document parser?",
    });
    const binding = collected.bindingsByName.get("memory_search");

    const result = await binding!.execute(
      { query: "document parser", limit: Number.MAX_SAFE_INTEGER },
      {
        signal: new AbortController().signal,
        sessionId: "session-1",
        emit: {},
      },
    );

    expect(result).toMatchObject({
      memories: expect.arrayContaining([
        expect.objectContaining({ id: "mem_11" }),
      ]),
    });
    expect((result as { memories: unknown[] }).memories).toHaveLength(
      MEMORY_LIMITS.maxSearchResults,
    );
    expect(mocks.memoryState.markMemoriesUsed).toHaveBeenCalledWith(
      expect.arrayContaining(["mem_11"]),
    );
  });

  it("fails closed when execution starts with an aborted request", async () => {
    const collected = collectBuiltinTools({
      message: "What do you remember about my document parser?",
    });
    const binding = collected.bindingsByName.get("memory_search");
    const controller = new AbortController();
    controller.abort();

    await expect(
      binding!.execute(
        { query: "document parser" },
        { signal: controller.signal, sessionId: "session-1", emit: {} },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.memoryState.markMemoriesUsed).not.toHaveBeenCalled();
  });

  it("registers long text output outside Agent mode and enforces one declaration", async () => {
    mocks.memoryState.settings.enabled = false;
    const collected = collectBuiltinTools({ message: "Write a report" });
    const binding = collected.bindingsByName.get("start_long_text_output");
    const emitLongText = vi.fn(() => ({ ok: true as const }));

    expect(collected.definitions.map((item) => item.function.name)).toEqual([
      "start_long_text_output",
    ]);
    expect(binding?.definition.function.parameters).toMatchObject({
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { minLength: 1, maxLength: 180 },
        format: { enum: ["markdown", "plain_text"], default: "markdown" },
      },
    });

    await expect(
      binding!.execute(
        { title: "Architecture notes" },
        {
          sessionId: "session-1",
          emit: { longText: emitLongText },
        },
      ),
    ).resolves.toEqual({ ok: true, capture: "next_model_text" });
    expect(emitLongText).toHaveBeenCalledWith({
      title: "Architecture notes",
      format: "markdown",
    });

    await expect(
      binding!.execute(
        { title: "Second document" },
        { sessionId: "session-1", emit: { longText: emitLongText } },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "LONG_TEXT_OUTPUT_ALREADY_STARTED",
        recoverable: true,
      },
    });
  });

  it("collects Agent capabilities only under their effective availability rules", () => {
    mocks.memoryState.settings.enabled = false;

    expect(
      collectBuiltinTools({
        message: "Research this",
        agentModeEnabled: false,
        useSearch: true,
        searchMode: "external",
      }).definitions,
    ).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: "start_long_text_output" }),
      }),
    ]);

    const agentTools = collectBuiltinTools({
      message: "Research this",
      agentModeEnabled: true,
      useSearch: true,
      searchMode: "external",
      knowledgeScope: {
        attachments: [
          {
            id: "kb",
            mimeType: "application/vnd.neo-chat.collection",
            fileName: "Docs",
            data: "collection-1",
          },
        ],
        collections: [],
        ragConfig: { enabled: false },
      },
    }).definitions.map((definition) => definition.function.name);

    expect(agentTools).toEqual([
      "start_long_text_output",
      "update_task_plan",
      "web_search",
      "search_knowledge",
      "run_javascript",
      "fetch_url",
      "list_workspace_files",
      "search_workspace_files",
      "read_workspace_file",
      "write_workspace_file",
      "edit_workspace_file",
      "move_workspace_file",
      "delete_workspace_file",
      "share_workspace_file",
      "create_archive",
    ]);
  });

  it("serializes every built-in that can observe or mutate workspace state", () => {
    mocks.memoryState.settings.enabled = false;
    const collected = collectBuiltinTools({
      message: "Build and share a report",
      agentModeEnabled: true,
    });

    for (const name of [
      "run_javascript",
      "fetch_url",
      "list_workspace_files",
      "search_workspace_files",
      "read_workspace_file",
      "write_workspace_file",
      "edit_workspace_file",
      "move_workspace_file",
      "delete_workspace_file",
      "share_workspace_file",
      "create_archive",
    ]) {
      expect(collected.bindingsByName.get(name)?.executionGroup, name).toBe(
        "workspace",
      );
    }
    expect(
      collected.bindingsByName.get("update_task_plan")?.executionGroup,
    ).toBeUndefined();
  });

  it("does not advertise native search as the Agent web_search tool", () => {
    mocks.memoryState.settings.enabled = false;

    const names = collectBuiltinTools({
      message: "Research this",
      agentModeEnabled: true,
      useSearch: true,
      searchMode: "openai-web",
    }).definitions.map((definition) => definition.function.name);

    expect(names).toEqual([
      "start_long_text_output",
      "update_task_plan",
      "run_javascript",
      "fetch_url",
      "list_workspace_files",
      "search_workspace_files",
      "read_workspace_file",
      "write_workspace_file",
      "edit_workspace_file",
      "move_workspace_file",
      "delete_workspace_file",
      "share_workspace_file",
      "create_archive",
    ]);
    expect(names).not.toContain("web_search");
  });
});
