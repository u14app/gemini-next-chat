// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dir: vi.fn(),
  file: vi.fn(),
  write: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
}));

vi.mock("opfs-tools", () => mocks);

import {
  deleteFromOPFS,
  deleteOPFSDirectory,
  listOPFSDirectory,
  readTextFromOPFS,
  resolveOPFSBlob,
  resolveOPFSUrl,
  saveToOPFS,
  statOPFSFileSize,
  writeBlobToOPFS,
  writeToOPFS,
} from "../utils/opfs";

describe("browser OPFS operations", () => {
  beforeEach(() => {
    mocks.dir.mockReset();
    mocks.file.mockReset();
    mocks.write.mockReset();
    mocks.write.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the browser adapter lazily for writes while preserving path validation", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const file = {
      name: "note.txt",
      stream: vi.fn(() => stream),
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await writeToOPFS("opfs://chat/session/file.txt", "content");
    await saveToOPFS(file, "/chat/session/");
    await writeBlobToOPFS(
      "opfs://chat/session/data.bin",
      new Uint8Array([1, 2, 3]),
    );

    expect(mocks.write).toHaveBeenNthCalledWith(
      1,
      "chat/session/file.txt",
      "content",
    );
    expect(mocks.write).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^chat\/session\/[0-9a-f-]+\.txt$/),
      stream,
    );
    expect(mocks.write).toHaveBeenNthCalledWith(
      3,
      "chat/session/data.bin",
      expect.any(ArrayBuffer),
    );
    const bytes = mocks.write.mock.calls[2][1] as ArrayBuffer;
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));

    await expect(
      writeToOPFS("opfs://chat/../secret.txt", "content"),
    ).rejects.toThrow("Invalid OPFS URL");
    expect(mocks.write).toHaveBeenCalledTimes(3);
  });

  it("preserves file read and object URL operations", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const fileHandle = {
      exists: vi.fn(async () => true),
      getOriginFile: vi.fn(async () => blob),
      getSize: vi.fn(async () => 5),
      text: vi.fn(async () => "hello"),
    };
    mocks.file.mockReturnValue(fileHandle);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test-file"),
    });

    await expect(statOPFSFileSize("opfs://chat/file.txt")).resolves.toBe(5);
    await expect(readTextFromOPFS("opfs://chat/file.txt")).resolves.toBe(
      "hello",
    );
    await expect(resolveOPFSBlob("opfs://chat/file.txt")).resolves.toBe(blob);
    await expect(resolveOPFSUrl("opfs://chat/file.txt")).resolves.toBe(
      "blob:test-file",
    );
    expect(mocks.file).toHaveBeenCalledWith("chat/file.txt");
  });

  it("preserves recursive listing and forced deletion operations", async () => {
    const nestedDirectory = {
      exists: vi.fn(async () => true),
      children: vi.fn(async () => [
        { kind: "file", path: "/chat/nested/deep.txt" },
      ]),
    };
    const rootDirectory = {
      exists: vi.fn(async () => true),
      children: vi.fn(async () => [
        { kind: "file", path: "/chat/root.txt" },
        { kind: "dir", path: "/chat/nested" },
      ]),
      remove: vi.fn(async () => undefined),
    };
    mocks.dir.mockImplementation((path: string) => {
      if (path === "chat") return rootDirectory;
      if (path === "chat/nested") return nestedDirectory;
      throw new Error(`Unexpected directory: ${path}`);
    });

    const fileHandle = {
      exists: vi.fn(async () => true),
      remove: vi.fn(async () => undefined),
    };
    mocks.file.mockReturnValue(fileHandle);

    await expect(listOPFSDirectory("chat")).resolves.toEqual([
      "chat/root.txt",
      "chat/nested/deep.txt",
    ]);
    await deleteFromOPFS("opfs://chat/root.txt");
    await deleteOPFSDirectory("chat");

    expect(fileHandle.remove).toHaveBeenCalledWith({ force: true });
    expect(rootDirectory.remove).toHaveBeenCalledWith({ force: true });
  });
});
