import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeUrlPolicy } from "../lib/security/urlPolicy";
import { safeFetchText } from "../lib/security/safeFetch";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

describe("safe fetch DNS timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    lookupMock.mockReset();
  });

  it("times out stalled DNS resolution before fetch dispatch", async () => {
    vi.useFakeTimers();
    lookupMock.mockReturnValue(new Promise(() => {}));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const result = safeFetchText(
      "https://example.com/openapi.json",
      { method: "GET" },
      { policy: getSafeUrlPolicy("plugin"), timeoutMs: 25 },
    );
    const expectation = expect(result).rejects.toMatchObject({
      name: "ResponseTimeoutError",
      code: "RESPONSE_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(25);

    await expectation;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revalidates DNS before dispatch without blocking private or Fake-IP results", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "198.18.0.1", family: 4 }]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(
      safeFetchText(
        "https://registry.npmmirror.com/agents.json",
        { method: "GET" },
        { policy: getSafeUrlPolicy("agent"), timeoutMs: 1_000 },
      ),
    ).resolves.toMatchObject({ text: '{"ok":true}' });

    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a web fetch when any resolved address is non-public", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      safeFetchText(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PROXY_BLOCKED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows local Fake-IP DNS proxy resolutions for public hostnames", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    lookupMock.mockResolvedValue([{ address: "198.18.0.10", family: 4 }]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("proxied page", { status: 200 }));

    await expect(
      safeFetchText(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).resolves.toMatchObject({ text: "proxied page" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Fake-IP DNS proxy resolutions blocked in hosted mode", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ALLOW_LOCAL_NETWORK_PROXY", "false");
    lookupMock.mockResolvedValue([{ address: "198.18.0.10", family: 4 }]);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      safeFetchText(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PROXY_BLOCKED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows local deployments to opt out of Fake-IP DNS proxying", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.stubEnv("ALLOW_LOCAL_NETWORK_PROXY", "false");
    lookupMock.mockResolvedValue([{ address: "198.18.0.10", family: 4 }]);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      safeFetchText(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PROXY_BLOCKED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-public IP literal before fetch dispatch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      safeFetchText(
        "http://169.254.169.254/latest/meta-data",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/public network addresses/i);

    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revalidates a web-fetch redirect before following it", async () => {
    lookupMock.mockImplementation(async (hostname: string) => [
      {
        address: hostname === "internal.example" ? "10.0.0.8" : "93.184.216.34",
        family: 4,
      },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://internal.example/admin" },
      }),
    );

    await expect(
      safeFetchText(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PROXY_BLOCKED" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows a web fetch when every resolved address is public", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      {
        address: "2606:2800:220:1:248:1893:25c8:1946",
        family: 6,
      },
    ]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("public page", { status: 200 }));

    await expect(
      safeFetchText(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch"), timeoutMs: 1_000 },
      ),
    ).resolves.toMatchObject({ text: "public page" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
