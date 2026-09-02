import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: { marker: "slim-automerge" },
  initializeBase64Wasm: vi.fn(async () => undefined),
}));

vi.mock("@automerge/automerge/slim", () => ({
  ...mocks.api,
  initializeBase64Wasm: mocks.initializeBase64Wasm,
}));

vi.mock("@automerge/automerge/automerge.wasm.base64", () => ({
  automergeWasmBase64: "base64-wasm-fixture",
}));

describe("sync Automerge loader", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.initializeBase64Wasm.mockClear();
  });

  it("initializes the bundled base64 WASM once for concurrent callers", async () => {
    const { loadAutomerge } = await import("@/lib/sync/crdt");

    const [first, second] = await Promise.all([
      loadAutomerge(),
      loadAutomerge(),
    ]);

    expect(mocks.initializeBase64Wasm).toHaveBeenCalledOnce();
    expect(mocks.initializeBase64Wasm).toHaveBeenCalledWith(
      "base64-wasm-fixture",
    );
    expect(first).toBe(second);
    expect(first).toMatchObject(mocks.api);
  });
});
