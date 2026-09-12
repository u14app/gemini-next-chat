import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

describe("MCP client cancellation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    lookupMock.mockReset();
  });

  it("passes transport cancellation to fetch without a DNS preflight", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      });
    const controller = new AbortController();
    const { createSafeMcpFetch } = await import("../lib/mcp/client");
    const safeFetch = createSafeMcpFetch();

    const request = safeFetch("https://example.com/mcp", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
