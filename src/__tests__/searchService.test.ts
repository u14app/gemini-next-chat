import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  signedApiFetch: vi.fn(),
  browserFetch: vi.fn(),
}));

vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: {
    getState: mocks.getState,
  },
}));

vi.mock("../lib/api/client", async () => {
  const actual = await vi.importActual("../lib/api/client");
  return {
    ...actual,
    signedApiFetch: mocks.signedApiFetch,
  };
});

vi.mock("../lib/byok/client", () => ({
  buildSearchRuntimeConfig: vi.fn(async () => ({})),
  fetchWithByokRetry: vi.fn((requestFactory) => requestFactory()),
}));

describe("search service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.getState.mockReset();
    mocks.signedApiFetch.mockReset();
    mocks.browserFetch.mockReset();
  });

  it("surfaces provider failures instead of returning empty successful results", async () => {
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
        resultsLimit: 5,
      },
    });
    mocks.signedApiFetch.mockResolvedValue(
      Response.json({ error: "upstream unavailable" }, { status: 503 }),
    );

    const { createSearchProvider } =
      await import("../services/api/searchService");

    await expect(createSearchProvider({ query: "neo chat" })).rejects.toThrow(
      /upstream unavailable/i,
    );
  });

  it("passes AbortSignal to the search route", async () => {
    const controller = new AbortController();
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
        resultsLimit: 5,
      },
    });
    mocks.signedApiFetch.mockImplementation(async () =>
      Response.json({ sources: [], images: [] }),
    );
    const { createSearchProvider } =
      await import("../services/api/searchService");

    await createSearchProvider({ query: "neo chat" }, controller.signal);

    expect(mocks.signedApiFetch).toHaveBeenCalledWith(
      "/api/search",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("clamps an explicit Agent result count before calling the search route", async () => {
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
        resultsLimit: 5,
      },
    });
    mocks.signedApiFetch.mockImplementation(async () =>
      Response.json({ sources: [], images: [] }),
    );
    const { createSearchProvider } =
      await import("../services/api/searchService");

    await createSearchProvider({
      query: "neo chat",
      maxResults: Number.MAX_SAFE_INTEGER,
    });
    await createSearchProvider({
      query: "neo chat",
      maxResults: Number.MIN_SAFE_INTEGER,
    });

    const requests = mocks.signedApiFetch.mock.calls.map(
      (call) => call[1] as RequestInit,
    );
    expect(requests.map((request) => JSON.parse(String(request.body)))).toEqual(
      [
        expect.objectContaining({ maxResult: 10 }),
        expect.objectContaining({ maxResult: 1 }),
      ],
    );
  });

  it("keeps the configured result count when no override is supplied", async () => {
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
        resultsLimit: 7,
        timeRange: "month",
      },
    });
    mocks.signedApiFetch.mockResolvedValue(
      Response.json({ sources: [], images: [] }),
    );
    const { createSearchProvider } =
      await import("../services/api/searchService");

    await createSearchProvider({ query: "neo chat" });

    const request = mocks.signedApiFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      maxResult: 7,
      timeRange: "month",
    });
  });

  it("sends keyless public Firecrawl requests directly from the browser", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", mocks.browserFetch);
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: { baseUrl: "https://api.firecrawl.dev/" } },
        resultsLimit: 4,
        timeRange: "week",
      },
    });
    mocks.browserFetch.mockResolvedValue(
      Response.json({
        data: {
          web: [
            {
              title: "Direct result",
              markdown: "Result body",
              url: "https://example.com/result",
            },
          ],
          images: [
            {
              title: "Direct image",
              imageUrl: "https://example.com/result.png",
              sourceUrl: "https://example.com/result",
            },
          ],
        },
      }),
    );

    const { createSearchProvider } =
      await import("../services/api/searchService");
    const result = await createSearchProvider({ query: "neo chat" });

    expect(mocks.browserFetch).toHaveBeenCalledOnce();
    expect(mocks.browserFetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "neo chat",
          limit: 4,
          sources: ["web", "images"],
          tbs: "qdr:w",
          scrapeOptions: { formats: [{ type: "markdown" }] },
          timeout: 25_000,
        }),
      }),
    );
    expect(mocks.signedApiFetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      sources: [
        {
          title: "Direct result",
          content: "Result body",
          url: "https://example.com/result",
        },
      ],
      images: [
        {
          url: "https://example.com/result.png",
          description: "Direct image",
          sourceUrl: "https://example.com/result",
        },
      ],
    });
  });

  it("keeps Firecrawl HTTP status, Retry-After, and client error location", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", mocks.browserFetch);
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
        resultsLimit: 5,
      },
    });
    mocks.browserFetch.mockResolvedValue(
      Response.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "7" } },
      ),
    );

    const { createSearchProvider } =
      await import("../services/api/searchService");
    await expect(
      createSearchProvider({ query: "neo chat" }),
    ).rejects.toMatchObject({
      name: "SearchRequestError",
      status: 429,
      code: "SEARCH_RATE_LIMITED",
      location: "client",
      retryAfterMs: 7_000,
    });
    expect(mocks.signedApiFetch).not.toHaveBeenCalled();
  });

  it("does not proxy browser network failures through the server", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", mocks.browserFetch);
    mocks.getState.mockReturnValue({
      search: {
        provider: "firecrawl",
        configs: { firecrawl: {} },
        resultsLimit: 5,
      },
    });
    mocks.browserFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const { createSearchProvider } =
      await import("../services/api/searchService");
    await expect(
      createSearchProvider({ query: "neo chat" }),
    ).rejects.toMatchObject({
      status: 0,
      code: "SEARCH_NETWORK_ERROR",
      location: "client",
    });
    expect(mocks.signedApiFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["Firecrawl API key", "firecrawl", { apiKey: "firecrawl-key" }],
    [
      "custom Firecrawl URL",
      "firecrawl",
      { baseUrl: "https://firecrawl.internal" },
    ],
    ["encrypted Firecrawl API key", "firecrawl", { apiKeySecret: { v: 1 } }],
    ["explicit server default", "default", { serverAvailable: true }],
  ])(
    "keeps %s requests on the server route",
    async (_label, provider, config) => {
      vi.stubGlobal("window", {});
      mocks.getState.mockReturnValue({
        search: {
          provider,
          configs: { [provider]: config },
          resultsLimit: 5,
        },
      });
      mocks.signedApiFetch.mockResolvedValue(
        Response.json({ sources: [], images: [] }),
      );

      const { createSearchProvider } =
        await import("../services/api/searchService");
      await createSearchProvider({ query: "neo chat" });

      expect(mocks.signedApiFetch).toHaveBeenCalledWith(
        "/api/search",
        expect.any(Object),
      );
      expect(mocks.browserFetch).not.toHaveBeenCalled();
    },
  );
});
