import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOPFSDirectory: vi.fn(),
  statOPFSFileSize: vi.fn(),
  readTextFromOPFS: vi.fn(),
  writeToOPFS: vi.fn(),
  writeBlobToOPFS: vi.fn(),
  resolveOPFSBlob: vi.fn(),
  deleteFromOPFS: vi.fn(),
  deleteOPFSDirectory: vi.fn(),
  signedApiFetch: vi.fn(),
}));

vi.mock("../utils/opfs", () => ({
  listOPFSDirectory: mocks.listOPFSDirectory,
  statOPFSFileSize: mocks.statOPFSFileSize,
  readTextFromOPFS: mocks.readTextFromOPFS,
  writeToOPFS: mocks.writeToOPFS,
  writeBlobToOPFS: mocks.writeBlobToOPFS,
  resolveOPFSBlob: mocks.resolveOPFSBlob,
  deleteFromOPFS: mocks.deleteFromOPFS,
  deleteOPFSDirectory: mocks.deleteOPFSDirectory,
}));
vi.mock("../lib/api/client", () => ({ signedApiFetch: mocks.signedApiFetch }));

import { createFetchUrlBinding } from "../services/api/chat/builtinTools/fetchUrl";

const SESSION = "0192f0a1-1111-7000-8000-abcdefabcdef";
const ROOT = `chat/workspace/${SESSION}`;

const context = () => ({ sessionId: SESSION, emit: {} });

const respondWith = (content: string, truncated = false) => {
  mocks.signedApiFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      url: "https://example.com/page",
      title: "Example",
      content,
      truncated,
      contentType: "text/html",
    }),
  });
};

describe("fetch_url saveToPath", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listOPFSDirectory.mockResolvedValue([]);
    mocks.statOPFSFileSize.mockResolvedValue(null);
    mocks.writeToOPFS.mockResolvedValue(undefined);
  });

  it("returns the full body inline when no path is given", async () => {
    respondWith("a".repeat(5_000));

    const result = (await createFetchUrlBinding().execute(
      { url: "https://example.com/page" },
      context(),
    )) as { content: string; savedTo?: string };

    expect(result.content).toHaveLength(5_000);
    expect(result.savedTo).toBeUndefined();
    expect(mocks.writeToOPFS).not.toHaveBeenCalled();
  });

  it("writes the page to the workspace and returns only an excerpt", async () => {
    const body = "b".repeat(5_000);
    respondWith(body);

    const result = (await createFetchUrlBinding().execute(
      { url: "https://example.com/page", saveToPath: "sources/page.md" },
      context(),
    )) as {
      ok: true;
      savedTo: string;
      bytes: number;
      excerpt: string;
      content?: string;
    };

    expect(mocks.writeToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/sources/page.md`,
      body,
    );
    expect(result.savedTo).toBe("sources/page.md");
    expect(result.bytes).toBe(5_000);
    // The whole page must not reach the transcript.
    expect(result.content).toBeUndefined();
    expect(result.excerpt).toHaveLength(1_000);
  });

  it("refuses a traversing save path instead of writing outside the workspace", async () => {
    respondWith("hello");

    const result = (await createFetchUrlBinding().execute(
      { url: "https://example.com/page", saveToPath: "../escape.md" },
      context(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_INVALID_PATH");
    expect(mocks.writeToOPFS).not.toHaveBeenCalled();
  });

  it("surfaces a write failure rather than claiming the page was saved", async () => {
    respondWith("hello");
    mocks.writeToOPFS.mockRejectedValue(new Error("disk full"));

    const result = (await createFetchUrlBinding().execute(
      { url: "https://example.com/page", saveToPath: "page.md" },
      context(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_WRITE_FAILED");
  });
});
