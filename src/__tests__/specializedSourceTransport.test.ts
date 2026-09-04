import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const shared = vi.hoisted(() => vi.fn());
vi.mock("@/lib/security/sharedStoreFetch", () => ({
  safeFetchSharedStoreJson: shared,
}));
import {
  createResearchSourceFetch,
  clearResearchSourceTransportForTests,
} from "@/lib/plugin/researchSources/transport";
import type { safeFetchText } from "@/lib/security/safeFetch";
const ok = (text = "body") => ({
  response: new Response(text),
  text,
  url: "https://export.arxiv.org/api/query",
});

beforeEach(() => {
  clearResearchSourceTransportForTests();
  vi.stubEnv("DEPLOYMENT_MODE", "local");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  shared.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("source request coordination", () => {
  it("restricts hosts, disables redirects and bounds body and request duration", async () => {
    const fetchText = vi.fn<typeof safeFetchText>().mockResolvedValue(ok());
    const fetch = createResearchSourceFetch("arxiv", undefined, fetchText);
    await expect(
      fetch("https://evil.export.arxiv.org/api/query"),
    ).rejects.toMatchObject({ code: "SOURCE_ENDPOINT_INVALID" });
    await fetch("https://export.arxiv.org/api/query?q=fixture");
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText.mock.calls[0][2]).toMatchObject({
      timeoutMs: 15_000,
      maxResponseBytes: 8 * 1024 * 1024,
      policy: { maxRedirects: 0, allowedHosts: ["export.arxiv.org"] },
    });
  });
  it("reuses only matching successful responses and partitions credentials", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test");
    shared.mockResolvedValue({
      response: new Response(),
      data: { result: "OK" },
    });
    const fetchText = vi.fn<typeof safeFetchText>().mockResolvedValue(ok());
    const fetch = createResearchSourceFetch("pubmed", undefined, fetchText);
    await fetch(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?id=1",
      { headers: { "x-test": "first" } },
    );
    await fetch(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?id=1",
      { headers: { "x-test": "first" } },
    );
    expect(fetchText).toHaveBeenCalledTimes(1);
    await fetch(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?id=1",
      { headers: { "x-test": "second" } },
    );
    expect(fetchText).toHaveBeenCalledTimes(2);
    const commands = shared.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(commands[0]).toMatchObject([
      "SET",
      "neo:research-source:lease:pubmed",
      expect.any(String),
      "NX",
      "PX",
      35000,
    ]);
    expect(commands[1][0]).toBe("EVAL");
    expect(commands[1].at(-1)).toBe(400);
  });
  it("fails closed without shared coordination in hosted mode", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    const fetchText = vi.fn<typeof safeFetchText>();
    await expect(
      createResearchSourceFetch(
        "arxiv",
        undefined,
        fetchText,
      )("https://export.arxiv.org/api/query"),
    ).rejects.toMatchObject({ code: "SOURCE_COORDINATION_UNAVAILABLE" });
    expect(fetchText).not.toHaveBeenCalled();
  });
  it("keeps arXiv requests serial and waits at least three seconds after completion", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
      new Uint8Array(32).buffer,
    );
    let finish: ((value: ReturnType<typeof ok>) => void) | undefined;
    const calls: number[] = [];
    const fetchText = vi
      .fn<typeof safeFetchText>()
      .mockImplementationOnce(() => {
        calls.push(Date.now());
        return new Promise((resolve) => {
          finish = resolve;
        });
      })
      .mockImplementationOnce(async () => {
        calls.push(Date.now());
        return ok();
      });
    const fetch = createResearchSourceFetch("arxiv", undefined, fetchText);
    const first = fetch(
      "https://export.arxiv.org/api/query?a=1",
      {},
      { cache: false },
    );
    await vi.advanceTimersByTimeAsync(1);
    const second = fetch(
      "https://export.arxiv.org/api/query?a=2",
      {},
      { cache: false },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchText).toHaveBeenCalledTimes(1);
    finish!(ok());
    await first;
    const finishedAt = Date.now();
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchText).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(151);
    await second;
    expect(calls[1] - finishedAt).toBeGreaterThanOrEqual(3000);
  });
  it("honors cancellation while waiting and does not dispatch a second request", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
      new Uint8Array(32).buffer,
    );
    const controller = new AbortController();
    const fetchText = vi.fn<typeof safeFetchText>().mockResolvedValue(ok());
    const fetch = createResearchSourceFetch(
      "arxiv",
      controller.signal,
      fetchText,
    );
    await fetch("https://export.arxiv.org/api/query?a=1", {}, { cache: false });
    const second = fetch(
      "https://export.arxiv.org/api/query?a=2",
      {},
      { cache: false },
    );
    const assertion = expect(second).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await assertion;
    expect(fetchText).toHaveBeenCalledTimes(1);
  });
  it("preserves upstream long Retry-After rather than retrying early", async () => {
    const fetchText = vi.fn<typeof safeFetchText>().mockResolvedValue({
      response: new Response("private details", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
      text: "private details",
      url: "https://export.arxiv.org/api/query",
    });
    await expect(
      createResearchSourceFetch(
        "arxiv",
        undefined,
        fetchText,
      )("https://export.arxiv.org/api/query"),
    ).rejects.toMatchObject({ code: "SOURCE_RATE_LIMITED" });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });
});
