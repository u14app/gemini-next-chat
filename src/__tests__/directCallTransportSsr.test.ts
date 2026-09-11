import { describe, expect, it, vi } from "vitest";

const browserClientsState = vi.hoisted(() => ({ imported: false }));

vi.mock("@/lib/providers/browserClients", () => {
  browserClientsState.imported = true;
  return {};
});

describe("direct call transport SSR boundary", () => {
  it("does not import browser clients when the transport module is loaded on the server", async () => {
    expect(typeof window).toBe("undefined");

    await import("@/services/api/chat/transport");

    expect(browserClientsState.imported).toBe(false);
  });

  it("rejects browser-only runtime loads during SSR without importing browser clients", async () => {
    const {
      fetchDirectProviderModels,
      getBrowserImageRuntime,
      getBrowserProviderRuntime,
    } = await import("@/services/api/chat/transport");

    await expect(getBrowserProviderRuntime()).rejects.toThrow(
      "Browser provider clients are only available in the browser.",
    );
    await expect(getBrowserImageRuntime()).rejects.toThrow(
      "Browser provider clients are only available in the browser.",
    );
    await expect(
      fetchDirectProviderModels(
        {} as Parameters<typeof fetchDirectProviderModels>[0],
      ),
    ).rejects.toThrow(
      "Browser provider clients are only available in the browser.",
    );

    expect(browserClientsState.imported).toBe(false);
  });
});
