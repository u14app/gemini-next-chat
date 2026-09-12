import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeUrlPolicy } from "../lib/security/urlPolicy";

vi.mock("server-only", () => ({}));

function mockWorkerDns({
  ipv4 = [],
  ipv6 = [],
}: {
  ipv4?: string[];
  ipv6?: string[];
}) {
  const lookup = vi.fn(async () => {
    throw new Error("Not implemented");
  });
  const resolve4 = vi.fn(async () => ipv4);
  const resolve6 = vi.fn(async () => ipv6);

  vi.doMock("node:dns/promises", () => ({
    lookup,
    resolve4,
    resolve6,
  }));

  return { lookup, resolve4, resolve6 };
}

describe("safeFetch Worker DNS compatibility", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("uses resolve4 and resolve6 when dns.lookup is unavailable", async () => {
    vi.resetModules();
    const dns = mockWorkerDns({ ipv4: ["93.184.216.34"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ ok: true }),
    );
    const { safeFetch } = await import("../lib/security/safeFetch");

    await expect(
      safeFetch(
        "https://example.com/openapi.json",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch") },
      ),
    ).resolves.toBeInstanceOf(Response);

    expect(dns.lookup).toHaveBeenCalledWith("example.com", {
      all: true,
      verbatim: true,
    });
    expect(dns.resolve4).toHaveBeenCalledWith("example.com");
    expect(dns.resolve6).toHaveBeenCalledWith("example.com");
  });

  it("allows private addresses resolved through Worker DNS", async () => {
    vi.resetModules();
    mockWorkerDns({ ipv4: ["127.0.0.1"] });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const { safeFetch } = await import("../lib/security/safeFetch");

    await expect(
      safeFetch(
        "https://example.com/openapi.json",
        { method: "GET" },
        { policy: getSafeUrlPolicy("plugin") },
      ),
    ).resolves.toBeInstanceOf(Response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["provider", "search", "rag", "sync"] as const)(
    "skips unavailable DNS for hosted %s proxy requests",
    async (context) => {
      vi.resetModules();
      vi.stubEnv("DEPLOYMENT_MODE", "hosted");
      const dns = mockWorkerDns({});
      dns.resolve4.mockRejectedValue(new Error("Not implemented"));
      dns.resolve6.mockRejectedValue(new Error("Not implemented"));
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ ok: true }));
      const { safeFetch } = await import("../lib/security/safeFetch");
      await expect(
        safeFetch(
          "https://provider.example/v1",
          { method: "POST" },
          { policy: getSafeUrlPolicy(context) },
        ),
      ).resolves.toBeInstanceOf(Response);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(dns.lookup).not.toHaveBeenCalled();
      expect(dns.resolve4).not.toHaveBeenCalled();
    },
  );

  it("rejects private addresses resolved through Worker DNS for web fetches", async () => {
    vi.resetModules();
    mockWorkerDns({ ipv4: ["127.0.0.1"] });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { safeFetch } = await import("../lib/security/safeFetch");

    await expect(
      safeFetch(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch") },
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PROXY_BLOCKED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for web fetches when Worker DNS is unavailable", async () => {
    vi.resetModules();
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    vi.doMock("node:dns/promises", () => ({
      lookup: undefined,
      resolve4: undefined,
      resolve6: undefined,
    }));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { safeFetch } = await import("../lib/security/safeFetch");

    await expect(
      safeFetch(
        "https://example.com/page",
        { method: "GET" },
        { policy: getSafeUrlPolicy("webFetch") },
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PROXY_BLOCKED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for hosted image requests when DNS validation is unavailable", async () => {
    vi.resetModules();
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ALLOW_LOCAL_NETWORK_PROXY", "false");
    vi.doMock("node:dns/promises", () => ({
      lookup: undefined,
      resolve4: undefined,
      resolve6: undefined,
    }));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { safeFetch } = await import("../lib/security/safeFetch");

    await expect(
      safeFetch(
        "https://example.com/image.png",
        { method: "GET" },
        { policy: getSafeUrlPolicy("image") },
      ),
    ).rejects.toMatchObject({
      code: "HOSTED_PROXY_BLOCKED",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
