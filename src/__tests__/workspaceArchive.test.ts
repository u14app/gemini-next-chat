import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

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

import { AGENT_ARCHIVE_LIMITS } from "../config/limits";
import { createArchiveBinding } from "../services/api/chat/builtinTools/archive";
import { createWorkspaceBindings } from "../services/api/chat/builtinTools/workspace";
import { normalizeArchivePresentation } from "../lib/agent/workspace";

const SESSION = "0192f0a1-1111-7000-8000-abcdefabcdef";
const WORKSPACE_ROOT = `chat/workspace/${SESSION}`;
const ARCHIVE_ROOT = `chat/archives/${SESSION}`;

const archiveTool = () => createArchiveBinding();
const listTool = () =>
  createWorkspaceBindings().find(
    (binding) => binding.definition.function.name === "list_workspace_files",
  )!;

const createContext = (
  emit: Record<string, unknown> = {},
  signal?: AbortSignal,
) => ({ sessionId: SESSION, model: "openai:test-model", emit, signal });

/** Seeds workspace files; archive paths are tracked separately. */
const seedFiles = (files: Record<string, string>) => {
  const archives: Record<string, Uint8Array> = {};

  mocks.listOPFSDirectory.mockImplementation(async (path: string) =>
    path === ARCHIVE_ROOT
      ? Object.keys(archives).map((name) => `${ARCHIVE_ROOT}/${name}`)
      : Object.keys(files).map((file) => `${WORKSPACE_ROOT}/${file}`),
  );
  mocks.statOPFSFileSize.mockImplementation(async (url: string) => {
    const path = url.replace(`opfs://${WORKSPACE_ROOT}/`, "");
    return path in files ? new TextEncoder().encode(files[path]).length : null;
  });
  mocks.readTextFromOPFS.mockImplementation(async (url: string) => {
    const path = url.replace(`opfs://${WORKSPACE_ROOT}/`, "");
    return path in files ? files[path] : null;
  });
  mocks.resolveOPFSBlob.mockImplementation(async (url: string) => {
    const path = url.replace(`opfs://${WORKSPACE_ROOT}/`, "");
    return path in files ? new Blob([files[path]]) : null;
  });
  mocks.writeBlobToOPFS.mockImplementation(
    async (url: string, content: Uint8Array) => {
      archives[url.replace(`opfs://${ARCHIVE_ROOT}/`, "")] = content;
    },
  );
  mocks.deleteFromOPFS.mockImplementation(async (url: string) => {
    delete archives[url.replace(`opfs://${ARCHIVE_ROOT}/`, "")];
  });

  return archives;
};

describe("create_archive", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.writeToOPFS.mockResolvedValue(undefined);
    mocks.deleteFromOPFS.mockResolvedValue(undefined);
    seedFiles({});
  });

  it("is an auto-approved agent-only read tool", () => {
    const binding = archiveTool();
    expect(binding.risk).toBe("read");
    expect(binding.agentOnly).toBe(true);
    expect(binding.executionGroup).toBe("workspace");
  });

  it("zips the requested files and emits a download card", async () => {
    const archives = seedFiles({ "a.md": "alpha", "out/b.csv": "x,y" });
    const archiveFile = vi.fn();

    const result = await archiveTool().execute(
      { paths: ["a.md", "out/b.csv"], archiveName: "bundle", title: "Results" },
      createContext({ archiveFile }),
    );

    expect(result).toMatchObject({
      ok: true,
      fileName: "bundle.zip",
      entryCount: 2,
      shared: true,
    });
    expect(archiveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "bundle.zip",
        entryCount: 2,
        title: "Results",
        url: expect.stringMatching(
          new RegExp(`^opfs://${ARCHIVE_ROOT}/[0-9a-f-]+\\.zip$`),
        ),
      }),
    );

    const [storedName] = Object.keys(archives);
    expect(storedName).not.toBe("bundle.zip");
    const unzipped = unzipSync(archives[storedName]);
    expect(strFromU8(unzipped["a.md"])).toBe("alpha");
    expect(strFromU8(unzipped["out/b.csv"])).toBe("x,y");
  });

  it("writes outside the workspace, so archives never appear in the file list", async () => {
    seedFiles({ "a.md": "alpha" });

    await archiveTool().execute(
      { paths: ["a.md"], archiveName: "bundle" },
      createContext({ archiveFile: vi.fn() }),
    );

    const listed = (await listTool().execute({}, createContext())) as {
      ok: true;
      files: Array<{ path: string }>;
      usage: { totalBytes: number };
    };

    expect(listed.files.map((file) => file.path)).toEqual(["a.md"]);
    // The archive contributes nothing to the workspace quota.
    expect(listed.usage.totalBytes).toBe(5);
  });

  it("refuses a traversing path instead of reading outside the workspace", async () => {
    seedFiles({ "a.md": "alpha" });

    const result = (await archiveTool().execute(
      { paths: ["../../etc/passwd"] },
      createContext({ archiveFile: vi.fn() }),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_INVALID_PATH");
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });

  it("refuses more entries than the archive limit allows", async () => {
    seedFiles({ "a.md": "alpha" });

    const result = (await archiveTool().execute(
      {
        paths: Array.from(
          { length: AGENT_ARCHIVE_LIMITS.maxEntries + 1 },
          () => "a.md",
        ),
      },
      createContext({ archiveFile: vi.fn() }),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_FILE_TOO_LARGE");
  });

  it("refuses when the selected files exceed the uncompressed input limit", async () => {
    const big = "x".repeat(1024 * 1024);
    const files: Record<string, string> = {};
    for (let index = 0; index < 60; index += 1) files[`f${index}.txt`] = big;
    seedFiles(files);

    const result = (await archiveTool().execute(
      { paths: Object.keys(files) },
      createContext({ archiveFile: vi.fn() }),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_FILE_TOO_LARGE");
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });

  it("reports a missing file rather than silently skipping it", async () => {
    seedFiles({ "a.md": "alpha" });

    const result = (await archiveTool().execute(
      { paths: ["a.md", "missing.md"] },
      createContext({ archiveFile: vi.fn() }),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_FILE_NOT_FOUND");
  });

  it("refuses to build an archive the user could never receive", async () => {
    seedFiles({ "a.md": "alpha" });

    const result = (await archiveTool().execute(
      { paths: ["a.md"] },
      createContext({}),
    )) as { error: { code: string } };

    expect(result.error.code).toBe("WORKSPACE_SHARE_UNAVAILABLE");
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });

  it("reduces a traversing archive name to a safe single segment", async () => {
    seedFiles({ "a.md": "alpha" });

    const result = (await archiveTool().execute(
      { paths: ["a.md"], archiveName: "../../etc" },
      createContext({ archiveFile: vi.fn() }),
    )) as { ok: true; fileName: string };

    expect(result.fileName).toBe("etc.zip");
    expect(mocks.writeBlobToOPFS).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^opfs://${ARCHIVE_ROOT}/[0-9a-f-]+\\.zip$`),
      ),
      expect.anything(),
    );
  });

  it("falls back to a default name when nothing usable survives sanitisation", async () => {
    seedFiles({ "a.md": "alpha" });

    const result = (await archiveTool().execute(
      { paths: ["a.md"], archiveName: "..." },
      createContext({ archiveFile: vi.fn() }),
    )) as { ok: true; fileName: string };

    expect(result.fileName).toBe("workspace.zip");
  });

  it("keeps repeated friendly names at immutable historical URLs", async () => {
    const files = { "a.md": "alpha" };
    const archives = seedFiles(files);
    const archiveFile = vi.fn();

    await archiveTool().execute(
      { paths: ["a.md"], archiveName: "bundle" },
      createContext({ archiveFile }),
    );
    files["a.md"] = "beta";
    await archiveTool().execute(
      { paths: ["a.md"], archiveName: "bundle" },
      createContext({ archiveFile }),
    );

    const first = archiveFile.mock.calls[0][0] as { url: string };
    const second = archiveFile.mock.calls[1][0] as { url: string };
    expect(first.url).not.toBe(second.url);
    expect(Object.keys(archives)).toHaveLength(2);
    expect(
      strFromU8(
        unzipSync(archives[first.url.replace(`opfs://${ARCHIVE_ROOT}/`, "")])[
          "a.md"
        ],
      ),
    ).toBe("alpha");
    expect(
      strFromU8(
        unzipSync(archives[second.url.replace(`opfs://${ARCHIVE_ROOT}/`, "")])[
          "a.md"
        ],
      ),
    ).toBe("beta");
  });

  it("retains only the newest per-session archive URLs", async () => {
    const archives = seedFiles({ "a.md": "alpha" });
    const archiveFile = vi.fn();

    for (
      let index = 0;
      index < AGENT_ARCHIVE_LIMITS.maxArchivesPerSession + 1;
      index += 1
    ) {
      await archiveTool().execute(
        { paths: ["a.md"], archiveName: `bundle-${index}` },
        createContext({ archiveFile }),
      );
    }

    expect(Object.keys(archives)).toHaveLength(
      AGENT_ARCHIVE_LIMITS.maxArchivesPerSession,
    );
    const newestUrl = (archiveFile.mock.lastCall?.[0] as { url: string }).url;
    expect(
      Object.prototype.hasOwnProperty.call(
        archives,
        newestUrl.replace(`opfs://${ARCHIVE_ROOT}/`, ""),
      ),
    ).toBe(true);
  });
});

describe("normalizeArchivePresentation", () => {
  const valid = {
    fileName: "bundle.zip",
    bytes: 120,
    entryCount: 2,
    url: `opfs://${ARCHIVE_ROOT}/bundle.zip`,
  };

  it("accepts a well-formed archive block", () => {
    expect(normalizeArchivePresentation(valid)).toMatchObject(valid);
  });

  it("drops a block whose URL points outside the archive root", () => {
    expect(
      normalizeArchivePresentation({
        ...valid,
        url: `opfs://${WORKSPACE_ROOT}/bundle.zip`,
      }),
    ).toBeUndefined();
  });

  it("accepts an immutable storage URL distinct from its friendly name", () => {
    expect(
      normalizeArchivePresentation({
        ...valid,
        url: `opfs://${ARCHIVE_ROOT}/0192f0a1-2222-7000-8000-abcdefabcdef.zip`,
      }),
    ).toMatchObject({
      fileName: "bundle.zip",
      url: `opfs://${ARCHIVE_ROOT}/0192f0a1-2222-7000-8000-abcdefabcdef.zip`,
    });
  });

  it("drops a block whose storage URL contains extra path segments", () => {
    expect(
      normalizeArchivePresentation({
        ...valid,
        url: `opfs://${ARCHIVE_ROOT}/nested/bundle.zip`,
      }),
    ).toBeUndefined();
  });

  it("drops a block with a traversing file name", () => {
    expect(
      normalizeArchivePresentation({ ...valid, fileName: "../escape.zip" }),
    ).toBeUndefined();
  });
});
