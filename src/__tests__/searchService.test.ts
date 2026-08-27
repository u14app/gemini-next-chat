import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  signedApiFetch: vi.fn(),
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
    mocks.getState.mockReset();
    mocks.signedApiFetch.mockReset();
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
});
