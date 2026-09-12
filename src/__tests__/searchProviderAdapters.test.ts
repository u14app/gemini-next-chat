import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runSearchProvider } from "../lib/search/providerAdapters";

describe("search provider adapters", () => {
  it("builds Tavily requests and normalizes source and image results", async () => {
    const controller = new AbortController();
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        results: [
          {
            title: "Neo",
            content: "fallback content",
            raw_content: "markdown content",
            url: "https://example.com/neo",
          },
          {
            title: "Missing content",
            url: "https://example.com/empty",
          },
        ],
        images: [
          {
            url: "https://example.com/neo.png",
            description: "Neo",
            sourceUrl: "https://example.com/neo",
          },
        ],
      },
    });

    const result = await runSearchProvider({
      provider: "tavily",
      query: '"neo\\chat"',
      scope: "news",
      apiKey: "tvly-key",
      maxResultNumber: 2,
      fetchJson,
      signal: controller.signal,
    });

    expect(fetchJson).toHaveBeenCalledOnce();
    const [url, init, options] = fetchJson.mock.calls[0]!;
    expect(url).toBe("https://api.tavily.com/search");
    expect(init).toMatchObject({
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tvly-key",
      },
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      query: "neochat",
      topic: "news",
      max_results: 2,
      include_images: true,
    });
    expect(options).toMatchObject({ timeoutMs: 30_000 });
    expect(result).toEqual({
      sources: [
        {
          title: "Neo",
          content: "markdown content",
          url: "https://example.com/neo",
        },
      ],
      images: [
        {
          url: "https://example.com/neo.png",
          description: "Neo",
          sourceUrl: "https://example.com/neo",
        },
      ],
    });
  });

  it("maps Bocha image descriptions from matching web results", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: {
          webPages: {
            value: [
              {
                name: "Bocha Result",
                summary: "summary",
                snippet: "snippet",
                url: "https://example.com/result",
              },
            ],
          },
          images: {
            value: [
              {
                contentUrl: "https://example.com/image.jpg",
                hostPageUrl: "https://example.com/result",
              },
            ],
          },
        },
      },
    });

    const result = await runSearchProvider({
      provider: "bocha",
      query: "neo chat",
      maxResultNumber: 3,
      fetchJson,
    });

    expect(result.images).toEqual([
      {
        url: "https://example.com/image.jpg",
        description: "Bocha Result",
        sourceUrl: "https://example.com/result",
      },
    ]);
  });

  it("builds Firecrawl v2 requests without an API key and maps web and image results", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        data: {
          web: [
            {
              title: "Firecrawl Result",
              description: "snippet",
              markdown: "# Full result",
              url: "https://example.com/firecrawl",
            },
            {
              title: "Missing URL",
              description: "skip",
            },
          ],
          images: [
            {
              title: "Firecrawl image",
              imageUrl: "https://example.com/firecrawl.png",
              url: "https://example.com/firecrawl",
            },
          ],
        },
      },
    });

    const result = await runSearchProvider({
      provider: "firecrawl",
      query: "neo chat",
      maxResultNumber: 4,
      fetchJson,
    });

    expect(fetchJson).toHaveBeenCalledOnce();
    const [url, init] = fetchJson.mock.calls[0]!;
    expect(url).toBe("https://api.firecrawl.dev/v2/search");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      undefined,
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      query: "neo chat",
      limit: 4,
      sources: ["web", "images"],
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("tbs");
    expect(result).toEqual({
      sources: [
        {
          title: "Firecrawl Result",
          content: "# Full result",
          url: "https://example.com/firecrawl",
        },
      ],
      images: [
        {
          url: "https://example.com/firecrawl.png",
          description: "Firecrawl image",
          sourceUrl: "https://example.com/firecrawl",
        },
      ],
    });
  });

  it("sends an explicit Firecrawl time filter when configured", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: { data: { web: [], images: [] } },
    });

    await runSearchProvider({
      provider: "firecrawl",
      query: "recent docs",
      timeRange: "month",
      maxResultNumber: 4,
      fetchJson,
    });

    const [, init] = fetchJson.mock.calls[0]!;
    expect(JSON.parse(init.body as string)).toMatchObject({ tbs: "qdr:m" });
  });

  it("adds Firecrawl authentication only when an optional key is configured", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: { data: { web: [], images: [] } },
    });

    await runSearchProvider({
      provider: "firecrawl",
      query: "neo chat",
      apiKey: "firecrawl-key",
      baseUrl: "http://firecrawl.internal",
      maxResultNumber: 4,
      fetchJson,
    });

    const [url, init] = fetchJson.mock.calls[0]!;
    expect(url).toBe("http://firecrawl.internal/v2/search");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer firecrawl-key",
    });
  });

  it("explains when Firecrawl rejects keyless public-service traffic", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 403 }),
      data: {
        success: false,
        error:
          "Your IP address looks suspicious, so Firecrawl cannot be used without an API key.",
      },
    });

    await expect(
      runSearchProvider({
        provider: "firecrawl",
        query: "neo chat",
        maxResultNumber: 5,
        fetchJson,
      }),
    ).rejects.toMatchObject({
      name: "SearchProviderError",
      status: 403,
      message: expect.stringMatching(/add a Firecrawl API key/i),
    });
  });

  it("throws provider errors with the upstream status", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 503 }),
      data: {},
    });

    await expect(
      runSearchProvider({
        provider: "firecrawl",
        query: "neo chat",
        maxResultNumber: 5,
        fetchJson,
      }),
    ).rejects.toMatchObject({
      name: "SearchProviderError",
      message: "Firecrawl search failed",
      status: 503,
    });
  });

  it("builds You.com requests and normalizes search results with API key", async () => {
    const controller = new AbortController();
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        results: [
          {
            title: "Neo Chat Documentation",
            snippet: "Neo Chat is a local-first AI chat workspace",
            url: "https://example.com/neo-chat",
          },
          {
            title: "Missing snippet",
            url: "https://example.com/no-snippet",
          },
        ],
        images: [
          { 
            url: "https://example.com/neo.png", 
            description: "Neo Chat interface"
          },
        ],
      },
    });

    const result = await runSearchProvider({
      provider: "youcom",
      query: "neo chat documentation",
      scope: "github.com",
      timeRange: "week",
      apiKey: "ydc-key",
      baseUrl: "https://api.you.com",
      maxResultNumber: 2,
      fetchJson,
      signal: controller.signal,
    });

    expect(fetchJson).toHaveBeenCalledOnce();
    const [url, init] = fetchJson.mock.calls[0]!;
    expect(url).toBe("https://api.you.com/search");
    expect(init).toMatchObject({
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "ydc-key",
        "User-Agent": "neo-chat/(you.com search integration)",
      },
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      query: "neo chat documentation",
      num_results: 2,
      include_domains: ["github.com"],
      time_range: "7d",
    });

    expect(result).toEqual({
      sources: [
        {
          title: "Neo Chat Documentation",
          content: "Neo Chat is a local-first AI chat workspace",
          url: "https://example.com/neo-chat",
        },
      ],
      images: [
        {
          url: "https://example.com/neo.png",
          description: "Neo Chat interface",
        },
      ],
    });
  });

  it("builds You.com requests for keyless mode without API key", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        results: [
          {
            title: "Search Result",
            snippet: "Content without authentication",
            url: "https://example.com/result",
          },
        ],
        images: [],
      },
    });

    await runSearchProvider({
      provider: "youcom",
      query: "test search",
      maxResultNumber: 1,
      fetchJson,
    });

    const [, init] = fetchJson.mock.calls[0]!;
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "User-Agent": "neo-chat/(you.com search integration)",
    });
    expect(init.headers).not.toHaveProperty("X-API-Key");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("handles You.com x402 payment challenges for keyless mode", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 402 }),
      data: {},
    });

    await expect(
      runSearchProvider({
        provider: "youcom",
        query: "test search",
        maxResultNumber: 1,
        fetchJson,
      }),
    ).rejects.toMatchObject({
      name: "SearchProviderError",
      message: "You.com search requires payment for enhanced features. Consider adding an API key for full access.",
      status: 402,
    });
  });
});
