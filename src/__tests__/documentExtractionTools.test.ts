import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readWorkspaceBlob: vi.fn(),
  getWorkspaceFileEntry: vi.fn(),
  writeWorkspaceText: vi.fn(),
  parseDocumentFile: vi.fn(),
  resolveDocumentParseToken: vi.fn(),
  settings: {
    rag: {
      documentParseProvider: "mineru",
      useDefaultDocumentProcessing: true,
      serverDocumentProcessingAvailable: true,
    },
  },
}));

vi.mock("../services/workspace/sessionWorkspace", () => ({
  readWorkspaceBlob: mocks.readWorkspaceBlob,
  getWorkspaceFileEntry: mocks.getWorkspaceFileEntry,
  writeWorkspaceText: mocks.writeWorkspaceText,
}));
vi.mock("../services/api/docParseService", () => ({
  parseDocumentFile: mocks.parseDocumentFile,
}));
vi.mock("../lib/security/localSecretResolvers", () => ({
  resolveDocumentParseToken: mocks.resolveDocumentParseToken,
}));
vi.mock("../store/core/settingsStore", () => ({
  useSettingsStore: { getState: () => mocks.settings },
}));

import { createDocumentExtractionBindings } from "../services/api/chat/builtinTools/documentExtraction";

const context = {
  sessionId: "session-1",
  model: "openai:test-model",
  signal: new AbortController().signal,
  emit: {},
};

const entry = {
  path: "uploads/report.pdf",
  url: "opfs://chat/workspace/session-1/uploads/report.pdf",
  fileName: "report.pdf",
  mimeType: "application/pdf",
  bytes: 8,
  contentHash: "sha256:content",
  revision: "revision-1",
  updatedAt: 100,
  source: "attachment",
};

const bindings = () =>
  Object.fromEntries(
    createDocumentExtractionBindings().map((binding) => [
      binding.definition.function.name,
      binding,
    ]),
  );

describe("document extraction Tools", () => {
  beforeEach(() => {
    Object.values(mocks)
      .filter((value) => typeof value === "function")
      .forEach((mock) => (mock as ReturnType<typeof vi.fn>).mockReset());
    mocks.readWorkspaceBlob.mockResolvedValue({
      ok: true,
      value: {
        entry,
        blob: new Blob(["pdf-data"], { type: "application/pdf" }),
      },
    });
    mocks.getWorkspaceFileEntry.mockResolvedValue({ ok: true, value: entry });
    mocks.parseDocumentFile.mockResolvedValue("## Page 1\n\nExtracted text");
    mocks.writeWorkspaceText.mockResolvedValue({
      ok: true,
      value: {
        ...entry,
        path: "extracted/report.md",
        fileName: "report.md",
        mimeType: "text/markdown",
        revision: "revision-2",
      },
    });
  });

  it("inspects only seeded uploads without external parsing", async () => {
    await expect(
      bindings().inspect_attachment.execute(
        { path: "uploads/report.pdf" },
        context,
      ),
    ).resolves.toMatchObject({
      path: "uploads/report.pdf",
      mimeType: "application/pdf",
      contentHash: "sha256:content",
      revision: "revision-1",
      source: "attachment",
    });
    expect(mocks.parseDocumentFile).not.toHaveBeenCalled();

    mocks.readWorkspaceBlob.mockResolvedValueOnce({
      ok: true,
      value: {
        entry: { ...entry, path: "private/report.pdf" },
        blob: new Blob(),
      },
    });
    await expect(
      bindings().inspect_attachment.execute(
        { path: "private/report.pdf" },
        context,
      ),
    ).resolves.toMatchObject({ error: { code: "ATTACHMENT_SCOPE_DENIED" } });
  });

  it("fails before parsing when the source revision is stale", async () => {
    await expect(
      bindings().extract_document.execute(
        {
          path: "uploads/report.pdf",
          sourceRevision: "stale",
          outputPath: "extracted/report.md",
        },
        context,
      ),
    ).resolves.toMatchObject({
      error: { code: "WORKSPACE_REVISION_CONFLICT" },
    });
    expect(mocks.parseDocumentFile).not.toHaveBeenCalled();
    expect(mocks.writeWorkspaceText).not.toHaveBeenCalled();
  });

  it("checks the source again and writes extraction provenance", async () => {
    await expect(
      bindings().extract_document.execute(
        {
          path: "uploads/report.pdf",
          sourceRevision: "revision-1",
          outputPath: "extracted/report.md",
        },
        context,
      ),
    ).resolves.toMatchObject({
      sourcePath: "uploads/report.pdf",
      sourceRevision: "revision-1",
      parser: "mineru",
      output: { path: "extracted/report.md", revision: "revision-2" },
      provenancePreserved: true,
    });
    expect(mocks.resolveDocumentParseToken).not.toHaveBeenCalled();
    expect(mocks.parseDocumentFile).toHaveBeenCalledWith(expect.any(File), {
      provider: "mineru",
      apiKey: undefined,
      useDefault: true,
    });
    expect(mocks.writeWorkspaceText).toHaveBeenCalledWith(
      "session-1",
      "extracted/report.md",
      expect.stringContaining("<!-- source-revision: revision-1 -->"),
      "create",
      { expectedRevision: undefined },
    );
  });
});
