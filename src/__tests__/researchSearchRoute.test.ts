import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ fetchText: vi.fn() }));
vi.mock("@/lib/security/safeFetch", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  safeFetchText: mocks.fetchText,
  safeFetchJson: async (...args: unknown[]) => {
    const result = await mocks.fetchText(...args);
    return {
      response: result.response,
      data: JSON.parse(result.text),
      url: result.url,
    };
  },
}));
vi.mock("@/lib/byok/server", () => ({
  decryptOptionalSecret: async () => undefined,
}));
vi.mock("@/lib/defaultConfig/server", () => ({
  getDefaultSearchRuntimeConfig: () => ({
    provider: "tavily",
    apiKey: "fixture-key",
  }),
}));
vi.mock("@/lib/utils/safeServerLog", () => ({ safeServerLogError: vi.fn() }));

import { POST } from "@/app/api/search/route";
import { ResponseTimeoutError } from "@/lib/errors";

const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest("http://localhost/api/search", {
    method: "POST",
    body: JSON.stringify({
      provider: "tavily",
      query: "public topic",
      ...extra,
    }),
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  mocks.fetchText.mockReset();
});

it.each(["tavily", "default"])(
  "uses the fixed 90s summary profile for effective Tavily (%s)",
  async (provider) => {
    mocks.fetchText.mockResolvedValue({
      response: Response.json({}),
      text: JSON.stringify({
        results: [
          { title: "Source", content: "Summary", url: "https://example.com" },
        ],
      }),
      url: "https://api.tavily.com/search",
    });
    const response = await POST(
      request({ provider, profile: "research_summary" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.fetchText).toHaveBeenCalledOnce();
    const [, init, options] = mocks.fetchText.mock.calls[0];
    expect(options.timeoutMs).toBe(90_000);
    expect(JSON.parse(init.body)).toMatchObject({
      search_depth: "advanced",
      include_raw_content: false,
      include_images: true,
      include_image_descriptions: true,
    });
    expect(await response.json()).toMatchObject({
      sources: [{ content: "Summary" }],
    });
  },
);

it.each([{ profile: "unbounded" }, { timeoutMs: 600_000 }])(
  "rejects arbitrary timeout/profile input: %j",
  async (extra) => {
    const response = await POST(request(extra));
    expect(response.status).toBe(400);
    expect(mocks.fetchText).not.toHaveBeenCalled();
  },
);

describe("search errors across the actual route and adapter", () => {
  it.each([
    JSON.stringify({ error: "Gateway timeout" }),
    "<html>Gateway timeout</html>",
  ])("preserves upstream HTTP 504 even for non-JSON body: %s", async (body) => {
    mocks.fetchText.mockResolvedValue({
      response: new Response(body, { status: 504 }),
      text: body,
      url: "https://api.tavily.com/search",
    });
    const response = await POST(request());
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      code: "SEARCH_UPSTREAM_ERROR",
      location: "provider",
      statusCode: 504,
    });
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });

  it("identifies a local response timeout separately", async () => {
    mocks.fetchText.mockRejectedValue(new ResponseTimeoutError(90_000));
    const response = await POST(request({ profile: "research_summary" }));
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      code: "RESPONSE_TIMEOUT",
      location: "search_transport",
      details: { timeoutMs: 90_000 },
    });
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });

  it("forwards upstream 429 cooldown without retrying", async () => {
    mocks.fetchText.mockResolvedValue({
      response: Response.json(
        {},
        { status: 429, headers: { "Retry-After": "7" } },
      ),
      text: "{}",
      url: "https://api.tavily.com/search",
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(await response.json()).toMatchObject({
      code: "SEARCH_RATE_LIMITED",
      location: "provider",
      retryAfterMs: 7_000,
    });
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });
});
