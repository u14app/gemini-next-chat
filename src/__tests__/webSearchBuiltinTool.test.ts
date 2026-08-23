import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_CONFIG_LIMITS, SEARCH_RESULT_LIMITS } from "../config/limits";
import type {
  BuiltinSearchEvent,
  BuiltinToolContext,
} from "../services/api/chat/builtinTools/types";

const mocks = vi.hoisted(() => ({
  createSearchProvider: vi.fn(),
}));

vi.mock("@/services/api/searchService", () => ({
  createSearchProvider: mocks.createSearchProvider,
}));

import {
  createSearchWebV2Binding,
  createWebSearchBinding,
} from "../services/api/chat/builtinTools/webSearch";

function createContext(
  search: (event: BuiltinSearchEvent) => void,
  signal?: AbortSignal,
): BuiltinToolContext {
  return {
    signal,
    sessionId: "session-1",
    emit: { search },
  };
}

function createSources(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Source ${index}`,
    content: `${index} ${"x".repeat(SEARCH_RESULT_LIMITS.maxContentChars + 10)}`,
    url: `https://example.com/source/${index}`,
  }));
}

function createImages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://images.example.com/${index}.png`,
    description: `Image ${index}`,
  }));
}

describe("web_search built-in binding", () => {
  beforeEach(() => {
    mocks.createSearchProvider.mockReset();
  });

  it("returns a structured error for an invalid query", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    const binding = createWebSearchBinding();

    await expect(
      binding.execute({ query: "   " }, createContext(emitSearch)),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "WEB_SEARCH_INVALID_QUERY",
        message: "web_search requires a non-empty query.",
        recoverable: true,
      },
    });
    expect(mocks.createSearchProvider).not.toHaveBeenCalled();
    expect(emitSearch).not.toHaveBeenCalled();
  });

  it("clamps the requested count and emits start then complete", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    mocks.createSearchProvider.mockResolvedValue({
      sources: createSources(SEARCH_CONFIG_LIMITS.maxResultsLimit + 5),
      images: createImages(SEARCH_CONFIG_LIMITS.maxResultsLimit + 5),
    });
    const binding = createWebSearchBinding();

    const result = await binding.execute(
      {
        query: "  focused query  ",
        max_results: Number.MAX_SAFE_INTEGER,
      },
      createContext(emitSearch),
    );

    expect(mocks.createSearchProvider).toHaveBeenCalledWith(
      {
        query: "focused query",
        maxResults: SEARCH_CONFIG_LIMITS.maxResultsLimit,
      },
      undefined,
    );
    expect(emitSearch.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "complete",
    ]);
    expect(emitSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: "complete",
        sources: expect.any(Array),
        images: expect.any(Array),
      }),
    );
    expect(result).toMatchObject({
      query: "focused query",
      sources: expect.any(Array),
      images: expect.any(Array),
    });
    expect((result as { sources: unknown[] }).sources).toHaveLength(
      SEARCH_CONFIG_LIMITS.maxResultsLimit,
    );
    expect((result as { images: unknown[] }).images).toHaveLength(
      SEARCH_CONFIG_LIMITS.maxResultsLimit,
    );
  });

  it("bounds the normalized query sent to the provider", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    mocks.createSearchProvider.mockResolvedValue({ sources: [], images: [] });
    const binding = createWebSearchBinding();

    await binding.execute(
      { query: ` ${"q".repeat(5_000)} ` },
      createContext(emitSearch),
    );

    const options = mocks.createSearchProvider.mock.calls[0]?.[0] as {
      query: string;
    };
    expect(options.query).toHaveLength(4_000);
  });

  it("normalizes and hard-bounds sources and images", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    mocks.createSearchProvider.mockResolvedValue({
      sources: createSources(SEARCH_RESULT_LIMITS.maxSources + 5),
      images: createImages(SEARCH_RESULT_LIMITS.maxImages + 5),
    });
    const binding = createWebSearchBinding();

    const result = (await binding.execute(
      { query: "bounded search" },
      createContext(emitSearch),
    )) as {
      sources: Array<{ content: string }>;
      images: unknown[];
    };

    expect(result.sources).toHaveLength(SEARCH_RESULT_LIMITS.maxSources);
    expect(result.images).toHaveLength(SEARCH_RESULT_LIMITS.maxImages);
    expect(result.sources[0]?.content).toHaveLength(
      SEARCH_RESULT_LIMITS.maxContentChars,
    );
    expect(emitSearch).toHaveBeenLastCalledWith({
      phase: "complete",
      sources: result.sources,
      images: result.images,
    });
  });

  it("emits an error and returns a structured provider failure", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    mocks.createSearchProvider.mockRejectedValue(new Error("search down"));
    const binding = createWebSearchBinding();

    await expect(
      binding.execute({ query: "provider failure" }, createContext(emitSearch)),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "WEB_SEARCH_FAILED",
        message: "search down",
        recoverable: true,
      },
    });
    expect(emitSearch.mock.calls.map(([event]) => event)).toEqual([
      { phase: "start" },
      { phase: "error", message: "search down" },
    ]);
  });

  it("propagates cancellation without emitting a search error", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    const controller = new AbortController();
    mocks.createSearchProvider.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const binding = createWebSearchBinding();

    await expect(
      binding.execute(
        { query: "cancelled search" },
        createContext(emitSearch, controller.signal),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(emitSearch.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "cancel",
    ]);
  });
});

describe("search_web v2 built-in binding", () => {
  beforeEach(() => mocks.createSearchProvider.mockReset());

  it("runs bounded batch queries with filters and Evidence metadata", async () => {
    const emitSearch = vi.fn<(event: BuiltinSearchEvent) => void>();
    mocks.createSearchProvider.mockResolvedValue({
      sources: [
        {
          title: "Filtered result",
          url: "https://example.com/result",
          content: "Evidence for the filtered query",
        },
      ],
      images: [],
    });

    const result = (await createSearchWebV2Binding().execute(
      {
        queries: ["release notes", "security notes"],
        mode: "news",
        domains: ["example.com", "invalid"],
        language: "en",
        date_from: "2026-08-01",
        date_to: "2026-08-23",
        time_range: "month",
        max_results_per_query: 3,
      },
      createContext(emitSearch),
    )) as {
      sources: Array<{ metadata?: Record<string, unknown> }>;
      filters: Record<string, unknown>;
    };

    expect(mocks.createSearchProvider).toHaveBeenCalledTimes(2);
    expect(mocks.createSearchProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("site:example.com"),
        scope: "news",
        maxResults: 3,
        timeRange: "month",
      }),
      undefined,
    );
    expect(result.filters).toMatchObject({
      domains: ["example.com"],
      language: "en",
      appliedAs: "query_operators",
    });
    expect(result.sources[0]?.metadata).toMatchObject({
      sourceId: expect.stringMatching(/^source-/),
      retrievedAt: expect.any(Number),
      contentHash: expect.stringMatching(/^(?:sha256|fnv1a):/),
      externalUntrusted: true,
    });
    expect(emitSearch.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "complete",
    ]);
  });
});
