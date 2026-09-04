import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {
    search: {
      provider: "tavily",
      configs: { tavily: { baseUrl: "https://api.tavily.com" } },
      resultsLimit: 5,
      timeRange: "month",
    },
  },
  fetch: vi.fn(),
  runtimeConfig: vi.fn(),
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: { getState: () => mocks.settings },
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signedApiFetch: mocks.fetch,
}));
vi.mock("@/lib/byok/client", () => ({
  buildSearchRuntimeConfig: mocks.runtimeConfig,
  fetchWithByokRetry: (request: () => Promise<Response>) => request(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T00:00:00Z"));
  mocks.fetch.mockReset();
  mocks.runtimeConfig
    .mockReset()
    .mockImplementation(async (_provider, config) => config);
  mocks.settings.search.configs.tavily.baseUrl = "https://api.tavily.com";
  mocks.settings.search.timeRange = "month";
});
afterEach(() => vi.useRealTimers());

const context = (signal?: AbortSignal) => ({
  signal,
  sessionId: "session",
  model: "provider:model",
  emit: {},
});
const budget = () => ({
  remainingQueries: 8,
  maxResultsPerQuery: 5,
  seenQueries: new Set<string>(),
});

function successfulResponse(query: string) {
  return Response.json({
    sources: [
      {
        title: query,
        content: `Summary of ${query}`,
        url: `https://example.com/${encodeURIComponent(query)}`,
      },
    ],
    images: [],
  });
}

describe("Research search through the real bindings and service", () => {
  it("serializes aliases and batch queries with two seconds between starts", async () => {
    const starts: Array<{ query: string; time: number }> = [];
    let active = 0;
    let peak = 0;
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
      const { query, profile } = JSON.parse(String(init.body));
      expect(profile).toBe("research_summary");
      starts.push({ query, time: Date.now() });
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return successfulResponse(query);
    });
    const { createWebSearchBinding, createSearchWebV2Binding } =
      await import("@/services/api/chat/builtinTools/webSearch");
    const queryBudget = budget();
    const first = createSearchWebV2Binding({ queryBudget }).execute(
      { queries: ["solar efficiency", "battery chemistry"] },
      context(),
    );
    const second = createWebSearchBinding({ queryBudget }).execute(
      { query: "wind energy" },
      context(),
    );
    const completion = Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(5_000);
    const [batch, single] = await completion;
    expect(peak).toBe(1);
    expect(starts.map(({ query }) => query)).toEqual([
      "solar efficiency",
      "battery chemistry",
      "wind energy",
    ]);
    expect(
      starts.slice(1).map((entry, index) => entry.time - starts[index].time),
    ).toEqual([2_000, 2_000]);
    expect(batch).toMatchObject({ sources: expect.any(Array) });
    expect((batch as { sources: unknown[] }).sources).toHaveLength(2);
    expect(single).toMatchObject({ sources: expect.any(Array) });
  });

  it("retains successful batch results and identifies an upstream 504 separately", async () => {
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
      const { query } = JSON.parse(String(init.body));
      return query === "battery chemistry"
        ? Response.json(
            {
              error: "Tavily search failed",
              code: "SEARCH_UPSTREAM_ERROR",
              location: "provider",
            },
            { status: 504 },
          )
        : successfulResponse(query);
    });
    const { createSearchWebV2Binding } =
      await import("@/services/api/chat/builtinTools/webSearch");
    const result = createSearchWebV2Binding({ queryBudget: budget() }).execute(
      { queries: ["solar efficiency", "battery chemistry"] },
      context(),
    );
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await result).toMatchObject({
      sources: [expect.objectContaining({ title: "solar efficiency" })],
      partial: true,
      failedCount: 1,
      results: [
        expect.objectContaining({
          query: "solar efficiency",
          status: "completed",
        }),
        expect.objectContaining({
          query: "battery chemistry",
          status: "failed",
          error: expect.objectContaining({
            code: "SEARCH_UPSTREAM_ERROR",
            status: 504,
            location: "provider",
          }),
        }),
      ],
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("skips the same query locally across aliases without a second HTTP call", async () => {
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) =>
      successfulResponse(JSON.parse(String(init.body)).query),
    );
    const { createWebSearchBinding, createSearchWebV2Binding } =
      await import("@/services/api/chat/builtinTools/webSearch");
    const queryBudget = budget();
    const first = createWebSearchBinding({ queryBudget }).execute(
      { query: "solar efficiency" },
      context(),
    );
    const duplicate = createSearchWebV2Binding({ queryBudget }).execute(
      { queries: ["SOLAR efficiency"] },
      context(),
    );
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(await duplicate).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_QUERY_DUPLICATE" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(queryBudget.remainingQueries).toBe(7);
  });
});

describe("Research queue boundaries", () => {
  it.each([
    { header: "7", wait: 7_000 },
    { header: undefined, wait: 60_000 },
    { header: "Fri, 04 Sep 2026 00:00:09 GMT", wait: 9_000 },
  ])(
    "uses 429 cooldown $wait ms without retrying the failed query",
    async ({ header, wait }) => {
      mocks.fetch
        .mockResolvedValueOnce(
          Response.json(
            { error: "rate limited" },
            { status: 429, headers: header ? { "Retry-After": header } : {} },
          ),
        )
        .mockImplementation(async (_url, init: RequestInit) =>
          successfulResponse(JSON.parse(String(init.body)).query),
        );
      const { createSearchProvider } =
        await import("@/services/api/searchService");
      const first = createSearchProvider({ query: "limited" }, undefined, {
        purpose: "research",
      });
      const failure = expect(first).rejects.toMatchObject({ status: 429 });
      const second = createSearchProvider({ query: "later" }, undefined, {
        purpose: "research",
      });
      await vi.advanceTimersByTimeAsync(wait - 1);
      await failure;
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await second;
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(
        mocks.fetch.mock.calls.map(
          ([, init]) => JSON.parse(String(init.body)).query,
        ),
      ).toEqual(["limited", "later"]);
    },
  );

  it("cancels a queued request immediately without sending it or blocking the next one", async () => {
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return successfulResponse(JSON.parse(String(init.body)).query);
    });
    const { createSearchProvider } =
      await import("@/services/api/searchService");
    const controller = new AbortController();
    const first = createSearchProvider({ query: "first" }, undefined, {
      purpose: "research",
    });
    const cancelled = createSearchProvider(
      { query: "cancelled" },
      controller.signal,
      { purpose: "research" },
    );
    const rejected = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    const third = createSearchProvider({ query: "third" }, undefined, {
      purpose: "research",
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    await Promise.all([first, third]);
    expect(
      mocks.fetch.mock.calls.map(
        ([, init]) => JSON.parse(String(init.body)).query,
      ),
    ).toEqual(["first", "third"]);
  });

  it("does not dispatch after the absolute budget expires in the queue", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ error: "rate limited" }, { status: 429 }),
    );
    const { createSearchProvider } =
      await import("@/services/api/searchService");
    const limited = expect(
      createSearchProvider({ query: "limited" }, undefined, {
        purpose: "research",
      }),
    ).rejects.toMatchObject({ status: 429 });
    const expires = expect(
      createSearchProvider({ query: "deadline" }, undefined, {
        purpose: "research",
        deadlineAt: Date.now() + 5_000,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([limited, expires]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([90_000, 4_000])(
    "aborts in-flight transport at the 90s request or shorter remaining deadline (%i)",
    async (duration) => {
      let requestSignal: AbortSignal | undefined;
      mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
        requestSignal = init.signal!;
        return new Promise((_resolve, reject) =>
          init.signal!.addEventListener(
            "abort",
            () => reject(init.signal!.reason),
            { once: true },
          ),
        );
      });
      const { createSearchProvider } =
        await import("@/services/api/searchService");
      const operation = createSearchProvider({ query: "slow" }, undefined, {
        purpose: "research",
        ...(duration < 90_000 ? { deadlineAt: Date.now() + duration } : {}),
      });
      const rejected = expect(operation).rejects.toMatchObject(
        duration === 90_000
          ? { code: "RESEARCH_SEARCH_TIMEOUT", location: "client" }
          : { name: "TimeoutError" },
      );
      await vi.advanceTimersByTimeAsync(duration - 1);
      expect(requestSignal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(requestSignal!.aborted).toBe(true);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("forwards user cancellation in flight and retains the slot until the transport settles", async () => {
    let finishFirst!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    mocks.fetch
      .mockImplementationOnce(async (_url, init: RequestInit) => {
        requestSignal = init.signal!;
        return new Promise<Response>((resolve) => {
          finishFirst = resolve;
        });
      })
      .mockResolvedValue(successfulResponse("second"));
    const { createSearchProvider } =
      await import("@/services/api/searchService");
    const controller = new AbortController();
    const cancelled = expect(
      createSearchProvider({ query: "first" }, controller.signal, {
        purpose: "research",
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const second = createSearchProvider({ query: "second" }, undefined, {
      purpose: "research",
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await cancelled;
    expect(requestSignal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    finishFirst(successfulResponse("ignored late result"));
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("captures configuration before queueing and leaves ordinary Chat unqueued", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return successfulResponse("ok");
    });
    const { createSearchProvider } =
      await import("@/services/api/searchService");
    const first = createSearchProvider({ query: "first" }, undefined, {
      purpose: "research",
    });
    const queued = createSearchProvider({ query: "queued" }, undefined, {
      purpose: "research",
    });
    mocks.settings.search.configs.tavily.baseUrl =
      "https://changed.example.com";
    mocks.settings.search.timeRange = "year";
    const chat = createSearchProvider({ query: "chat" });
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, chat]);
    expect(bodies.map(({ query }) => query)).toContain("chat");
    expect(bodies.find(({ query }) => query === "chat")).not.toHaveProperty(
      "profile",
    );
    expect(bodies.map(({ query }) => query)).not.toContain("queued");
    await vi.advanceTimersByTimeAsync(2_000);
    await queued;
    expect(bodies.find(({ query }) => query === "queued")).toMatchObject({
      config: { baseUrl: "https://api.tavily.com" },
      timeRange: "month",
      profile: "research_summary",
    });
  });
});

describe("partial search at a deadline", () => {
  it.each([90_000, 4_000])(
    "retains a successful query when a later request reaches its %i ms limit",
    async (duration) => {
      mocks.fetch
        .mockImplementationOnce(async (_url, init: RequestInit) =>
          successfulResponse(JSON.parse(String(init.body)).query),
        )
        .mockImplementation(
          async (_url, init: RequestInit) =>
            new Promise((_resolve, reject) =>
              init.signal!.addEventListener(
                "abort",
                () =>
                  reject(
                    new DOMException("Aborted by transport", "AbortError"),
                  ),
                { once: true },
              ),
            ),
        );
      const { createSearchWebV2Binding } =
        await import("@/services/api/chat/builtinTools/webSearch");
      const queryBudget = {
        ...budget(),
        ...(duration < 90_000 ? { deadlineAt: Date.now() + duration } : {}),
      };
      const result = createSearchWebV2Binding({ queryBudget }).execute(
        { queries: ["solar efficiency", "battery chemistry"] },
        context(),
      );
      await vi.advanceTimersByTimeAsync(
        duration + (duration === 90_000 ? 2_000 : 0),
      );
      expect(await result).toMatchObject({
        partial: true,
        failedCount: 1,
        sources: [{ title: "solar efficiency" }],
        results: [
          { query: "solar efficiency", status: "completed" },
          {
            query: "battery chemistry",
            status: "failed",
            error: {
              code:
                duration === 90_000
                  ? "RESEARCH_SEARCH_TIMEOUT"
                  : "RESEARCH_RECON_TIMEOUT",
            },
          },
        ],
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps completed results when a stage deadline aborts its context signal", async () => {
    mocks.fetch
      .mockResolvedValueOnce(successfulResponse("solar efficiency"))
      .mockImplementation(
        async (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            ),
          ),
      );
    const { createSearchWebV2Binding } =
      await import("@/services/api/chat/builtinTools/webSearch");
    const controller = new AbortController();
    const result = createSearchWebV2Binding({ queryBudget: budget() }).execute(
      { queries: ["solar efficiency", "battery chemistry"] },
      context(controller.signal),
    );
    await vi.advanceTimersByTimeAsync(2_001);
    controller.abort(
      new DOMException("Stage deadline elapsed", "TimeoutError"),
    );
    expect(await result).toMatchObject({
      partial: true,
      sources: [{ title: "solar efficiency" }],
    });
  });

  it("stops delivery and cancels remaining queued queries on user cancellation", async () => {
    mocks.fetch
      .mockResolvedValueOnce(successfulResponse("solar efficiency"))
      .mockImplementation(
        async (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            ),
          ),
      );
    const { createSearchWebV2Binding } =
      await import("@/services/api/chat/builtinTools/webSearch");
    const controller = new AbortController();
    const emit = vi.fn();
    const result = createSearchWebV2Binding({ queryBudget: budget() }).execute(
      { queries: ["solar efficiency", "battery chemistry", "wind energy"] },
      { ...context(controller.signal), emit: { search: emit } },
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(2_001);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "cancel",
    ]);
  });
});
