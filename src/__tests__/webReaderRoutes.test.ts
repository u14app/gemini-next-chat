import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("@/lib/byok/server", () => ({
  decryptOptionalSecret: vi.fn(async () => "reader-test-secret"),
}));

import { POST as fetchUrl } from "@/app/api/agents/fetch-url/route";
import { POST as executePlugin } from "@/app/api/plugins/execute/route";

const TARGET = "https://example.com/article";

function request(path: string, body: unknown, signal?: AbortSignal) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function readWithJina(url = TARGET, signal?: AbortSignal) {
  return executePlugin(
    request(
      "/api/plugins/execute",
      {
        pluginId: "jina-web-reader",
        functionName: "read_webpage",
        args: { url },
      },
      signal,
    ),
  );
}

function networkFailure(code = "ECONNRESET") {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("Transport failed"), { code }),
  });
}

function page(content = "<h1>Article</h1><p>Readable body.</p>") {
  const response = new Response(content, {
    headers: { "Content-Type": "text/html" },
  });
  Object.defineProperty(response, "url", {
    value: "https://example.com/final",
  });
  return response;
}

function waitUntilAborted(
  _url: unknown,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
      once: true,
    });
  });
}

describe("web reader routes", () => {
  beforeEach(() => {
    vi.stubEnv("DEPLOYMENT_MODE", "local");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["ECONNRESET", 502, "WEB_FETCH_NETWORK"],
    ["UND_ERR_CONNECT_TIMEOUT", 504, "RESPONSE_TIMEOUT"],
  ])(
    "classifies a native %s failure at the direct route",
    async (code, status, errorCode) => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(networkFailure(code));
      const response = await fetchUrl(
        request("/api/agents/fetch-url", { url: TARGET }),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code: errorCode });
    },
  );

  it("does not turn an unrelated TypeError into a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Invalid implementation state"),
    );
    const response = await fetchUrl(
      request("/api/agents/fetch-url", { url: TARGET }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("rejects an HTTP 200 challenge before returning direct page content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Verify you are human", {
        headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" },
      }),
    );
    const response = await fetchUrl(
      request("/api/agents/fetch-url", { url: TARGET }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "WEB_PAGE_CHALLENGE" });
  });

  it("keeps an ordinary article about Cloudflare readable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      page(
        "<h1>Cloudflare guide</h1><p>Use cf-mitigated to detect a challenge or HTTP 403.</p>",
      ),
    );
    const response = await fetchUrl(
      request("/api/agents/fetch-url", { url: TARGET }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: "https://example.com/final",
      content: expect.stringContaining("Cloudflare guide"),
    });
  });

  it("reports the direct redirect limit and closes every discarded response body", async () => {
    const cancel = vi.fn();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 302,
          headers: { location: "https://example.com/again" },
        }),
    );
    const response = await fetchUrl(
      request("/api/agents/fetch-url", { url: TARGET }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "WEB_FETCH_REDIRECT_LIMIT",
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(cancel).toHaveBeenCalledTimes(4);
  });

  it("uses one public direct fallback without forwarding Reader authorization", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValueOnce(page());
    const response = await readWithJina();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: expect.stringContaining("URL Source: https://example.com/final"),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain("https://r.jina.ai/");
    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).get("authorization"),
    ).toBe("Bearer reader-test-secret");
    expect(String(fetch.mock.calls[1][0])).toBe(TARGET);
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get("authorization"),
    ).toBeNull();
  });

  it.each([200, 403])(
    "falls back once when the Reader service returns a %s challenge",
    async (status) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response("<title>Just a moment...</title>", {
            status,
            headers: {
              "cf-mitigated": "challenge",
              "Content-Type": "text/html",
            },
          }),
        )
        .mockResolvedValueOnce(page());
      expect((await readWithJina()).status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("falls back on a Reader application service error inside HTTP 200", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ code: 503, message: "Reader unavailable" }),
      )
      .mockResolvedValueOnce(page());
    expect((await readWithJina()).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429])(
    "does not retry a Reader %s error without service challenge evidence",
    async (status) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          Response.json({ code: status, message: "Request refused" }),
        );
      const response = await readWithJina();
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        code: "JINA_READER_ERROR",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not bypass a target challenge reported by Reader, even with a service challenge header", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          code: 200,
          data: {
            title: "Just a moment...",
            content:
              "Warning: Target URL returned error 403: Forbidden\n\nVerify you are human",
          },
        },
        { headers: { "cf-mitigated": "challenge" } },
      ),
    );
    const response = await readWithJina();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "WEB_PAGE_CHALLENGE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    "does not retry a target %s refusal reported in a Reader text envelope",
    async (status) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(
            `Title: Protected article\nURL Source: ${TARGET}\nWarning: Target URL returned error ${status}: Refused\nMarkdown Content:\nAccess requires permission.`,
          ),
        );
      const response = await readWithJina();
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        code: "WEB_PAGE_ACCESS_DENIED",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not mistake a Reader error example inside a technical article for a target refusal", async () => {
    const content =
      "# Jina troubleshooting\n\nAn example error:\n```text\nWarning: Target URL returned error 403: Forbidden\n```";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: 200, data: { content } }),
    );
    expect(await (await readWithJina()).json()).toEqual({ result: content });
  });

  it("rejects invalid Reader JSON instead of presenting it as a successful source", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ code: 200, data: {} }));
    const response = await readWithJina();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "JINA_READER_ERROR" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["plain Markdown", "# Article\n\nReadable body."],
    [
      "Reader JSON",
      JSON.stringify({
        code: 200,
        data: { content: "# Article\n\nReadable body." },
      }),
    ],
  ])("preserves the successful %s result string", async (_label, body) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(body));
    expect(await (await readWithJina()).json()).toEqual({
      result: "# Article\n\nReadable body.",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reserves the remaining 15 seconds for a single fallback", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(waitUntilAborted)
      .mockResolvedValueOnce(page());
    const pending = readWithJina();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await pending).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends two stalled attempts within the overall 30 second deadline", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(waitUntilAborted);
    const pending = readWithJina();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).status).toBe(504);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches asynchronous cancellation and never starts a fallback", async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    expect((await readWithJina(TARGET, controller.signal)).status).toBe(499);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not start fallback after the overall deadline has already elapsed", async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 30_000);
      throw networkFailure();
    });
    const response = await readWithJina();
    expect(response.status).toBe(504);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts the direct fallback when the caller cancels", async () => {
    const controller = new AbortController();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkFailure())
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      });
    expect((await readWithJina(TARGET, controller.signal)).status).toBe(499);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not hide a Reader implementation TypeError or retry it as a network problem", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Invalid implementation state"));
    const response = await readWithJina();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never dispatches a direct request to a private original target", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(networkFailure());
    expect((await readWithJina("http://127.0.0.1/admin")).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a private redirect during the direct fallback", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        }),
      );
    expect((await readWithJina()).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the direct original requires authorization", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    const response = await readWithJina();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "WEB_FETCH_HTTP_ERROR",
      details: { upstreamStatus: 403 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not return a verification page from the direct fallback", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValueOnce(
        page(
          "<title>Just a moment...</title><p>Enable JavaScript and cookies to continue</p>",
        ),
      );
    const response = await readWithJina();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "WEB_PAGE_CHALLENGE" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps truncation explicit in the fallback Markdown result", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValueOnce(page("<p>" + "a".repeat(40_100) + "</p>"));
    const payload = await (await readWithJina()).json();
    expect(payload.result).toContain("Content truncated");
    expect(payload.result).not.toContain("a".repeat(40_001));
  });
});
