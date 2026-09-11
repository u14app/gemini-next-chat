import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  getSafeOPFSPath,
  isOPFSUrl,
  resolveOPFSUrl,
  writeToOPFS,
} from "../utils/opfs";

const opfsToolsMock = vi.hoisted(() => ({ factoryCalls: 0 }));

vi.mock("opfs-tools", () => {
  opfsToolsMock.factoryCalls += 1;
  return {
    dir: vi.fn(),
    file: vi.fn(),
    write: vi.fn(),
  };
});

describe("OPFS URL path validation", () => {
  it("extracts safe relative OPFS paths", () => {
    expect(getSafeOPFSPath("opfs://chat/session/file.txt")).toBe(
      "chat/session/file.txt",
    );
  });

  it("rejects non-OPFS URLs", () => {
    expect(getSafeOPFSPath("https://example.com/file.txt")).toBeNull();
  });

  it("rejects empty, absolute, and traversal paths", () => {
    expect(getSafeOPFSPath("opfs://")).toBeNull();
    expect(getSafeOPFSPath("opfs:///absolute/file.txt")).toBeNull();
    expect(getSafeOPFSPath("opfs://chat/../secret.txt")).toBeNull();
    expect(getSafeOPFSPath("opfs://chat/./file.txt")).toBeNull();
    expect(getSafeOPFSPath("opfs://chat//file.txt")).toBeNull();
  });

  it("rejects backslashes and null bytes", () => {
    expect(getSafeOPFSPath("opfs://chat\\file.txt")).toBeNull();
    expect(getSafeOPFSPath("opfs://chat/file\u0000.txt")).toBeNull();
  });

  it("keeps URL helpers and validation available during SSR without loading opfs-tools", async () => {
    expect(isOPFSUrl("opfs://chat/session/file.txt")).toBe(true);
    expect(isOPFSUrl("https://example.com/file.txt")).toBe(false);
    expect(await resolveOPFSUrl("https://example.com/file.txt")).toBe(
      "https://example.com/file.txt",
    );
    await expect(
      writeToOPFS("opfs://chat/session/file.txt", "content"),
    ).rejects.toThrow("OPFS tools are only available in a browser environment");
    expect(opfsToolsMock.factoryCalls).toBe(0);
  });

  it("ships the OPFS worker without a dangling source map reference", () => {
    const entryPath = fileURLToPath(import.meta.resolve("opfs-tools"));
    const source = readFileSync(entryPath, "utf8");
    const payload = source.match(/const J = "([A-Za-z0-9+/=]+)",/)?.[1];
    expect(payload).toBeTruthy();
    const workerSource = Buffer.from(payload!, "base64").toString("utf8");
    expect(workerSource).not.toContain(
      "sourceMappingURL=opfs-worker-F4RWlqc_.js.map",
    );
  });
});
