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

import {
  getWorkspaceFileEntry,
  readWorkspaceText,
  writeWorkspaceBlob,
} from "../services/workspace/sessionWorkspace";
import { seedWorkspaceAttachments } from "../services/workspace/seedAttachments";
import type { Attachment } from "../types";

const SESSION = "0192f0a1-1111-7000-8000-abcdefabcdef";
const ROOT = `chat/workspace/${SESSION}`;

const attachment = (overrides: Partial<Attachment>): Attachment =>
  ({
    id: "a1",
    fileName: "file.txt",
    mimeType: "text/plain",
    size: 4,
    ...overrides,
  }) as Attachment;

describe("workspace binary layer", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listOPFSDirectory.mockResolvedValue([]);
    mocks.statOPFSFileSize.mockResolvedValue(null);
    mocks.writeToOPFS.mockResolvedValue(undefined);
    mocks.writeBlobToOPFS.mockResolvedValue(undefined);
  });

  it("writes a binary file and reports its size and mime type", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);

    const written = await writeWorkspaceBlob(SESSION, "uploads/scan.pdf", blob);

    expect(written).toMatchObject({
      ok: true,
      value: {
        path: "uploads/scan.pdf",
        mimeType: "application/pdf",
        bytes: 4,
      },
    });
    expect(mocks.writeBlobToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/uploads/scan.pdf`,
      blob,
    );
  });

  it("counts a binary file against the workspace quota", async () => {
    mocks.listOPFSDirectory.mockResolvedValue([`${ROOT}/uploads/scan.pdf`]);
    mocks.statOPFSFileSize.mockResolvedValue(19 * 1024 * 1024);

    const written = await writeWorkspaceBlob(
      SESSION,
      "uploads/other.pdf",
      new Blob([new Uint8Array(2 * 1024 * 1024)]),
    );

    expect(written).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_QUOTA_EXCEEDED" },
    });
  });

  it("refuses a traversing binary write", async () => {
    const written = await writeWorkspaceBlob(
      SESSION,
      "../escape.pdf",
      new Blob(["x"]),
    );

    expect(written).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_INVALID_PATH" },
    });
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });

  it("still refuses to read a binary file as text", async () => {
    mocks.statOPFSFileSize.mockResolvedValue(4);

    const read = await readWorkspaceText(SESSION, "uploads/scan.pdf");

    expect(read).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED" },
    });
  });

  it("lists a binary file like any other entry", async () => {
    mocks.listOPFSDirectory.mockResolvedValue([`${ROOT}/uploads/logo.png`]);
    mocks.statOPFSFileSize.mockImplementation(async (url: string) =>
      url === `opfs://${ROOT}/uploads/logo.png` ? 1_024 : null,
    );
    mocks.resolveOPFSBlob.mockResolvedValue(new Blob([new Uint8Array(1_024)]));

    const entry = await getWorkspaceFileEntry(SESSION, "uploads/logo.png");

    expect(entry).toMatchObject({
      ok: true,
      value: { mimeType: "image/png", bytes: 1_024 },
    });
  });
});

describe("binary attachment seeding", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listOPFSDirectory.mockResolvedValue([]);
    mocks.statOPFSFileSize.mockResolvedValue(null);
    mocks.writeToOPFS.mockResolvedValue(undefined);
    mocks.writeBlobToOPFS.mockResolvedValue(undefined);
  });

  it("copies an approved binary attachment into uploads/", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    mocks.resolveOPFSBlob.mockResolvedValue(blob);

    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "scan.pdf",
        mimeType: "application/pdf",
        url: "opfs://chat/files/scan.pdf",
      }),
    ]);

    expect(seeded).toEqual(["uploads/scan.pdf"]);
    expect(mocks.writeBlobToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/uploads/scan.pdf`,
      blob,
    );
  });

  it("copies a localized binary attachment without losing its extension", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    mocks.resolveOPFSBlob.mockResolvedValue(blob);

    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "报告.pdf",
        mimeType: "application/pdf",
        url: "opfs://chat/files/report.pdf",
      }),
    ]);

    expect(seeded).toEqual(["uploads/报告.pdf"]);
    expect(mocks.writeBlobToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/uploads/报告.pdf`,
      blob,
    );
  });

  it("copies the original PDF when its message payload contains parsed Markdown", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    mocks.resolveOPFSBlob.mockResolvedValue(blob);

    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "报告.pdf",
        mimeType: "text/markdown",
        data: btoa("# Parsed report"),
        url: "opfs://chat/documents/report.pdf",
      }),
    ]);

    expect(seeded).toEqual(["uploads/报告.pdf"]);
    expect(mocks.writeBlobToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/uploads/报告.pdf`,
      blob,
    );
    expect(mocks.writeToOPFS).not.toHaveBeenCalledWith(
      `opfs://${ROOT}/uploads/报告.pdf`,
      expect.any(String),
    );
  });

  it("skips a binary type that is not on the allowlist", async () => {
    mocks.resolveOPFSBlob.mockResolvedValue(new Blob(["x"]));

    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "clip.mp4",
        mimeType: "video/mp4",
        url: "opfs://chat/files/clip.mp4",
      }),
    ]);

    expect(seeded).toEqual([]);
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });

  it("skips a binary attachment whose extension contradicts its mime type", async () => {
    mocks.resolveOPFSBlob.mockResolvedValue(new Blob(["x"]));

    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "scan.png",
        mimeType: "application/pdf",
        url: "opfs://chat/files/scan.png",
      }),
    ]);

    expect(seeded).toEqual([]);
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });

  it("still seeds text attachments as text", async () => {
    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "notes.md",
        mimeType: "text/markdown",
        data: btoa("hello"),
      }),
    ]);

    expect(seeded).toEqual(["uploads/notes.md"]);
    expect(mocks.writeToOPFS).toHaveBeenCalledWith(
      `opfs://${ROOT}/uploads/notes.md`,
      "hello",
    );
  });

  it("keeps a failed binary copy non-fatal for the other attachments", async () => {
    mocks.resolveOPFSBlob.mockRejectedValueOnce(new Error("gone"));

    const seeded = await seedWorkspaceAttachments(SESSION, [
      attachment({
        fileName: "scan.pdf",
        mimeType: "application/pdf",
        url: "opfs://chat/files/scan.pdf",
      }),
      attachment({
        fileName: "notes.md",
        mimeType: "text/markdown",
        data: btoa("hello"),
      }),
    ]);

    expect(seeded).toEqual(["uploads/notes.md"]);
  });
});
