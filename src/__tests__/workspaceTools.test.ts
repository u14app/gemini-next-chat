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
}));

vi.mock("../utils/opfs", () => mocks);

import { AGENT_WORKSPACE_LIMITS } from "../config/limits";
import { createWorkspaceBindings } from "../services/api/chat/builtinTools/workspace";

const SESSION = "0192f0a1-1111-7000-8000-abcdefabcdef";
const ROOT = `chat/workspace/${SESSION}`;

const bindings = () =>
  Object.fromEntries(
    createWorkspaceBindings().map((binding) => [
      binding.definition.function.name,
      binding,
    ]),
  );

const createContext = (
  emit: Record<string, unknown> = {},
  signal?: AbortSignal,
) => ({ sessionId: SESSION, emit, signal });

/** Seeds the mocked OPFS layer with a fixed set of workspace files. */
const seedFiles = (files: Record<string, string>) => {
  mocks.listOPFSDirectory.mockResolvedValue(
    Object.keys(files).map((path) => `${ROOT}/${path}`),
  );
  const sizeOf = (url: string) => {
    const path = url.replace(`opfs://${ROOT}/`, "");
    return path in files ? new TextEncoder().encode(files[path]).length : null;
  };
  mocks.statOPFSFileSize.mockImplementation(async (url: string) => sizeOf(url));
  mocks.readTextFromOPFS.mockImplementation(async (url: string) => {
    const path = url.replace(`opfs://${ROOT}/`, "");
    return path in files ? files[path] : null;
  });
  mocks.resolveOPFSBlob.mockImplementation(async (url: string) => {
    const path = url.replace(`opfs://${ROOT}/`, "");
    return path in files ? new Blob([files[path]]) : null;
  });
};

describe("workspace built-in tools", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.writeToOPFS.mockResolvedValue(undefined);
    mocks.writeBlobToOPFS.mockResolvedValue(undefined);
    mocks.deleteFromOPFS.mockResolvedValue(undefined);
    seedFiles({});
  });

  it("registers every workspace tool as an auto-approved agent-only read", () => {
    for (const binding of createWorkspaceBindings()) {
      expect(binding.risk).toBe("read");
      expect(binding.agentOnly).toBe(true);
      expect(binding.executionGroup).toBe("workspace");
      expect(
        (
          binding.definition.function.parameters as {
            additionalProperties?: boolean;
          }
        ).additionalProperties,
      ).toBe(false);
    }
  });

  it("lists files with sizes and usage", async () => {
    seedFiles({ "notes.md": "hello", "uploads/data.csv": "a,b" });

    const result = await bindings().list_workspace_files.execute(
      {},
      createContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      files: [
        { path: "notes.md", bytes: 5, mimeType: "text/markdown" },
        { path: "uploads/data.csv", bytes: 3, mimeType: "text/csv" },
      ],
      usage: { fileCount: 2, totalBytes: 8 },
    });
  });

  it("filters the listing by directory prefix", async () => {
    seedFiles({ "notes.md": "hello", "uploads/data.csv": "a,b" });

    const result = (await bindings().list_workspace_files.execute(
      { path: "uploads" },
      createContext(),
    )) as { files: Array<{ path: string }> };

    expect(result.files.map((file) => file.path)).toEqual(["uploads/data.csv"]);
  });

  it("reads a line window from a text file", async () => {
    seedFiles({ "notes.md": "one\ntwo\nthree" });

    const result = await bindings().read_workspace_file.execute(
      { path: "notes.md", offset: 1, limit: 1 },
      createContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "two",
      totalLines: 3,
      truncated: true,
    });
  });

  it("reports a missing file as a recoverable error", async () => {
    const result = await bindings().read_workspace_file.execute(
      { path: "absent.md" },
      createContext(),
    );

    expect(result).toEqual({
      error: {
        code: "WORKSPACE_FILE_NOT_FOUND",
        message: expect.stringContaining("absent.md"),
        recoverable: true,
      },
    });
  });

  it("refuses to escape the session workspace", async () => {
    const result = (await bindings().read_workspace_file.execute(
      { path: "../../knowledge-base/secret.txt" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_INVALID_PATH");
    expect(mocks.readTextFromOPFS).not.toHaveBeenCalled();
  });

  it("writes a file inside the session root", async () => {
    const result = await bindings().write_workspace_file.execute(
      { path: "out/report.md", content: "# Report" },
      createContext(),
    );

    expect(mocks.writeToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/out/report.md`,
      "# Report",
    );
    expect(result).toMatchObject({ ok: true, path: "out/report.md", bytes: 8 });
  });

  it("refuses to create over an existing file", async () => {
    seedFiles({ "notes.md": "hello" });

    const result = (await bindings().write_workspace_file.execute(
      { path: "notes.md", content: "x", mode: "create" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_FILE_EXISTS");
    expect(mocks.writeToOPFS).not.toHaveBeenCalled();
  });

  it("appends to an existing file", async () => {
    seedFiles({ "log.txt": "first\n" });

    await bindings().write_workspace_file.execute(
      { path: "log.txt", content: "second", mode: "append" },
      createContext(),
    );

    expect(mocks.writeToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/log.txt`,
      "first\nsecond",
    );
  });

  it("rejects a write that exceeds the per-file limit", async () => {
    const result = (await bindings().write_workspace_file.execute(
      {
        path: "big.txt",
        content: "x".repeat(AGENT_WORKSPACE_LIMITS.maxFileBytes + 1),
      },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_FILE_TOO_LARGE");
    expect(mocks.writeToOPFS).not.toHaveBeenCalled();
  });

  it("rejects a write once the file count limit is reached", async () => {
    seedFiles(
      Object.fromEntries(
        Array.from({ length: AGENT_WORKSPACE_LIMITS.maxFiles }, (_, index) => [
          `f${index}.txt`,
          "x",
        ]),
      ),
    );

    const result = (await bindings().write_workspace_file.execute(
      { path: "one-too-many.txt", content: "x" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_QUOTA_EXCEEDED");
  });

  it("edits an exact match in place", async () => {
    seedFiles({ "notes.md": "hello world" });

    const result = await bindings().edit_workspace_file.execute(
      { path: "notes.md", oldString: "world", newString: "there" },
      createContext(),
    );

    expect(mocks.writeToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/notes.md`,
      "hello there",
    );
    expect(result).toMatchObject({ ok: true, replacements: 1 });
  });

  it("refuses an ambiguous edit without writing", async () => {
    seedFiles({ "notes.md": "a a" });

    const result = (await bindings().edit_workspace_file.execute(
      { path: "notes.md", oldString: "a", newString: "b" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_EDIT_AMBIGUOUS");
    expect(mocks.writeToOPFS).not.toHaveBeenCalled();
  });

  it("deletes an existing file", async () => {
    seedFiles({ "notes.md": "hello" });

    const result = await bindings().delete_workspace_file.execute(
      { path: "notes.md" },
      createContext(),
    );

    expect(mocks.deleteFromOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/notes.md`,
    );
    expect(result).toEqual({ ok: true, path: "notes.md" });
  });

  it("emits a shareable file reference", async () => {
    seedFiles({ "out/report.md": "# Report" });
    const workspaceFile = vi.fn();

    const result = await bindings().share_workspace_file.execute(
      { path: "out/report.md", title: "Quarterly report" },
      createContext({ workspaceFile }),
    );

    expect(workspaceFile).toHaveBeenCalledWith({
      path: "out/report.md",
      url: `opfs://${ROOT}/out/report.md`,
      fileName: "report.md",
      mimeType: "text/markdown",
      bytes: 8,
      revision: expect.any(String),
      title: "Quarterly report",
    });
    expect(result).toMatchObject({ ok: true, shared: true });
  });

  it("emits a fresh revision whenever the same workspace URL is shared", async () => {
    seedFiles({ "out/report.md": "# Report" });
    const workspaceFile = vi.fn();

    await bindings().share_workspace_file.execute(
      { path: "out/report.md" },
      createContext({ workspaceFile }),
    );
    await bindings().share_workspace_file.execute(
      { path: "out/report.md" },
      createContext({ workspaceFile }),
    );

    expect(workspaceFile.mock.calls[0][0].url).toBe(
      workspaceFile.mock.calls[1][0].url,
    );
    expect(workspaceFile.mock.calls[0][0].revision).not.toBe(
      workspaceFile.mock.calls[1][0].revision,
    );
  });

  it("reports an unshareable file rather than pretending it was shared", async () => {
    seedFiles({ "notes.md": "hello" });

    const result = (await bindings().share_workspace_file.execute(
      { path: "notes.md" },
      createContext({}),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_SHARE_UNAVAILABLE");
  });

  it("finds matching lines across text files", async () => {
    seedFiles({
      "notes.md": "alpha\nbeta gamma\n",
      "uploads/data.csv": "x,y\nbeta,2\n",
    });

    const result = (await bindings().search_workspace_files.execute(
      { query: "beta" },
      createContext(),
    )) as { ok: true; matches: Array<{ path: string; line: number }> };

    expect(result.matches).toEqual([
      { path: "notes.md", line: 2, text: "beta gamma" },
      { path: "uploads/data.csv", line: 2, text: "beta,2" },
    ]);
  });

  it("restricts a search to a directory prefix and is case-insensitive by default", async () => {
    seedFiles({ "notes.md": "Beta\n", "uploads/data.csv": "beta\n" });

    const result = (await bindings().search_workspace_files.execute(
      { query: "BETA", path: "uploads" },
      createContext(),
    )) as { ok: true; matches: Array<{ path: string }> };

    expect(result.matches).toEqual([
      { path: "uploads/data.csv", line: 1, text: "beta" },
    ]);
  });

  it("skips binary files when searching", async () => {
    seedFiles({ "scan.pdf": "beta", "notes.md": "beta" });

    const result = (await bindings().search_workspace_files.execute(
      { query: "beta" },
      createContext(),
    )) as { ok: true; matches: Array<{ path: string }>; filesSearched: number };

    expect(result.matches.map((match) => match.path)).toEqual(["notes.md"]);
    expect(result.filesSearched).toBe(1);
  });

  it("caps search results and reports truncation", async () => {
    const line = "beta\n";
    seedFiles({
      "notes.md": line.repeat(AGENT_WORKSPACE_LIMITS.maxSearchMatches + 5),
    });

    const result = (await bindings().search_workspace_files.execute(
      { query: "beta" },
      createContext(),
    )) as { ok: true; matches: unknown[]; truncated: boolean };

    expect(result.matches).toHaveLength(
      AGENT_WORKSPACE_LIMITS.maxSearchMatches,
    );
    expect(result.truncated).toBe(true);
  });

  it("refuses a traversing search prefix rather than escaping the workspace", async () => {
    seedFiles({ "notes.md": "beta" });

    const result = (await bindings().search_workspace_files.execute(
      { query: "beta", path: "../../etc" },
      createContext(),
    )) as { ok: true; matches: unknown[] };

    // The prefix simply matches nothing; it never resolves outside the root.
    expect(result.matches).toEqual([]);
  });

  it("moves a file and removes the original", async () => {
    seedFiles({ "notes.md": "hello" });

    const result = await bindings().move_workspace_file.execute(
      { from: "notes.md", to: "archive/notes.md" },
      createContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      from: "notes.md",
      entry: { path: "archive/notes.md", bytes: 5 },
    });
    expect(mocks.deleteFromOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/notes.md`,
    );
  });

  it("moves a new destination when the workspace is at the file-count limit", async () => {
    const files = Object.fromEntries(
      Array.from({ length: AGENT_WORKSPACE_LIMITS.maxFiles }, (_, index) => [
        `file-${index}.txt`,
        "x",
      ]),
    );
    seedFiles(files);

    const result = await bindings().move_workspace_file.execute(
      { from: "file-0.txt", to: "moved/file-0.txt" },
      createContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      entry: { path: "moved/file-0.txt" },
    });
    expect(mocks.deleteFromOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/file-0.txt`,
    );
  });

  it("does not double-count source bytes when moving a full workspace", async () => {
    const paths = Array.from(
      { length: 4 },
      (_, index) => `${ROOT}/file-${index}.bin`,
    );
    mocks.listOPFSDirectory.mockResolvedValue(paths);
    mocks.statOPFSFileSize.mockImplementation(async (url: string) =>
      paths.includes(url.replace("opfs://", ""))
        ? AGENT_WORKSPACE_LIMITS.maxFileBytes
        : null,
    );
    mocks.resolveOPFSBlob.mockResolvedValue(
      new Blob([new Uint8Array(AGENT_WORKSPACE_LIMITS.maxFileBytes)]),
    );

    const result = await bindings().move_workspace_file.execute(
      { from: "file-0.bin", to: "moved/file-0.bin" },
      createContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      entry: {
        path: "moved/file-0.bin",
        bytes: AGENT_WORKSPACE_LIMITS.maxFileBytes,
      },
    });
  });

  it("refuses to move onto an existing file unless overwrite is set", async () => {
    seedFiles({ "notes.md": "hello", "other.md": "there" });

    const result = (await bindings().move_workspace_file.execute(
      { from: "notes.md", to: "other.md" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_FILE_EXISTS");
    expect(mocks.deleteFromOPFS).not.toHaveBeenCalled();
  });

  it("keeps the source when the destination write fails", async () => {
    seedFiles({ "notes.md": "hello" });
    mocks.writeBlobToOPFS.mockRejectedValue(new Error("disk full"));

    const result = (await bindings().move_workspace_file.execute(
      { from: "notes.md", to: "archive/notes.md" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_WRITE_FAILED");
    expect(mocks.deleteFromOPFS).not.toHaveBeenCalled();
  });

  it("refuses a traversing move destination", async () => {
    seedFiles({ "notes.md": "hello" });

    const result = (await bindings().move_workspace_file.execute(
      { from: "notes.md", to: "../escape.md" },
      createContext(),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_INVALID_PATH");
    expect(mocks.deleteFromOPFS).not.toHaveBeenCalled();
  });

  it("honours an aborted request signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      bindings().list_workspace_files.execute(
        {},
        createContext({}, controller.signal),
      ),
    ).rejects.toThrow();
  });
});
