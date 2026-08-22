import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "@/types";
import { SERVER_DEFAULT_PROVIDER_ID } from "@/lib/defaultConfig/shared";
import { assertDirectProviderUrl } from "@/lib/providers/browserClients";
import {
  getBrowserImageRuntime,
  hydrateDirectProviderImageFiles,
  shouldUseDirectCall,
} from "@/services/api/chat/transport";

function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "custom",
    name: "Custom",
    type: "OpenAI Compatible",
    baseUrl: "https://example.com/v1",
    apiKey: "sk-test",
    enabled: true,
    models: [],
    ...overrides,
  };
}

describe("shouldUseDirectCall", () => {
  it("is opt-in: false unless directCall is exactly true", () => {
    expect(shouldUseDirectCall(makeProvider())).toBe(false);
    expect(shouldUseDirectCall(makeProvider({ directCall: false }))).toBe(
      false,
    );
    expect(shouldUseDirectCall(makeProvider({ directCall: true }))).toBe(true);
  });

  it("never applies to the server default provider", () => {
    expect(
      shouldUseDirectCall(
        makeProvider({ directCall: true, isServerDefault: true }),
      ),
    ).toBe(false);
    expect(
      shouldUseDirectCall(
        makeProvider({ directCall: true, id: SERVER_DEFAULT_PROVIDER_ID }),
      ),
    ).toBe(false);
  });
});

describe("direct provider URL policy", () => {
  it.each([
    "http://localhost:11434/v1",
    "http://api.localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://10.0.0.2/v1",
    "http://172.16.0.2/v1",
    "http://192.168.1.2/v1",
    "http://169.254.10.20/v1",
    "http://[::1]:11434/v1",
    "http://[fd00::2]/v1",
    "http://[fe80::2]/v1",
    "http://[::ffff:192.168.1.2]/v1",
    "https://provider.example/v1",
  ])("allows an approved direct endpoint: %s", (url) => {
    expect(assertDirectProviderUrl(url).toString()).toBe(
      new URL(url).toString(),
    );
  });

  it.each([
    "http://provider.example/v1",
    "http://93.184.216.34/v1",
    "http://100.64.0.1/v1",
    "http://198.18.0.1/v1",
    "http://0.0.0.0/v1",
    "http://[2606:2800:220:1:248:1893:25c8:1946]/v1",
  ])("rejects an external or non-LAN HTTP endpoint: %s", (url) => {
    expect(() => assertDirectProviderUrl(url)).toThrow(/must use HTTPS/);
  });
});

describe("direct provider image hydration", () => {
  it("hydrates shared OPFS images once across history and current attachments", async () => {
    const attachment = {
      id: "image-1",
      mimeType: "image/png",
      fileName: "local.png",
      url: "opfs://chat/images/local.png",
    };
    const resolve = vi.fn(
      async () => new Blob(["image"], { type: "image/png" }),
    );

    const hydrated = await hydrateDirectProviderImageFiles(
      [
        {
          id: "message-1",
          role: "user",
          content: "look",
          timestamp: 0,
          attachments: [attachment],
        },
      ],
      [attachment],
      { resolveOPFSBlob: resolve },
    );

    const historyFile = (hydrated.history[0].attachments?.[0] as any).file;
    expect(historyFile).toBeInstanceOf(File);
    expect(hydrated.attachments[0].file).toBe(historyFile);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a persisted local image is unavailable", async () => {
    await expect(
      hydrateDirectProviderImageFiles(
        [],
        [
          {
            id: "missing",
            mimeType: "image/png",
            fileName: "missing.png",
            url: "opfs://chat/images/missing.png",
          },
        ],
        { resolveOPFSBlob: async () => null },
      ),
    ).rejects.toThrow(/no longer available/);
  });
});

describe("browser image response parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects malformed successful JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const runtime = await getBrowserImageRuntime();

    await expect(
      runtime.fetchJson("https://provider.example/v1/images/generations", {}),
    ).rejects.toThrow("Expected a JSON response from upstream service");
  });

  it("preserves AbortError while reading the response body", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: vi.fn(async () => {
          throw abortError;
        }),
      })),
    );
    const runtime = await getBrowserImageRuntime();

    await expect(
      runtime.fetchJson("https://provider.example/v1/images/generations", {}),
    ).rejects.toBe(abortError);
  });
});
