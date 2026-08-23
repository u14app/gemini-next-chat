import { beforeEach, describe, expect, it, vi } from "vitest";

const opfs = vi.hoisted(() => ({
  files: new Map<string, Blob>(),
  workspaceContent: "first",
}));

vi.mock("@/utils/opfs", () => ({
  listOPFSDirectory: vi.fn(async (root: string) =>
    [...opfs.files.keys()]
      .filter((url) => url.startsWith(`opfs://${root}/`))
      .map((url) => url.replace(/^opfs:\/\//, "")),
  ),
  deleteOPFSDirectory: vi.fn(async (root: string) => {
    for (const key of opfs.files.keys()) {
      if (key.startsWith(`opfs://${root}/`)) opfs.files.delete(key);
    }
  }),
  statOPFSFileSize: vi.fn(
    async (url: string) => opfs.files.get(url)?.size ?? null,
  ),
  resolveOPFSBlob: vi.fn(async (url: string) => opfs.files.get(url) ?? null),
  writeBlobToOPFS: vi.fn(async (url: string, blob: Blob) => {
    opfs.files.set(url, blob);
  }),
}));

vi.mock("@/services/workspace/sessionWorkspace", () => ({
  readWorkspaceBlob: vi.fn(async (_sessionId: string, path: string) => {
    const blob = new Blob([opfs.workspaceContent], { type: "text/markdown" });
    return {
      ok: true,
      value: {
        entry: {
          path,
          url: `opfs://chat/workspace/session/${path}`,
          fileName: path,
          mimeType: "text/markdown",
          bytes: blob.size,
        },
        blob,
      },
    };
  }),
}));

import {
  deleteSessionArtifacts,
  duplicateSessionArtifacts,
  listSessionArtifacts,
  publishWorkspaceArtifact,
} from "../services/workspace/sessionArtifact";

describe("publishWorkspaceArtifact", () => {
  beforeEach(() => {
    opfs.files.clear();
    opfs.workspaceContent = "first";
  });

  it("publishes immutable content-addressed files and reuses identical bytes", async () => {
    const first = await publishWorkspaceArtifact("session", "report.md");
    const second = await publishWorkspaceArtifact("session", "report.md");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.url).toBe(second.value.url);
    expect(first.value.revision).toMatch(/^(?:sha256|fnv1a):/);
    expect(opfs.files.size).toBe(1);
  });

  it("keeps an old published card immutable after the scratch file changes", async () => {
    const first = await publishWorkspaceArtifact("session", "report.md");
    opfs.workspaceContent = "second";
    const second = await publishWorkspaceArtifact("session", "report.md");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.url).not.toBe(first.value.url);
    expect(await opfs.files.get(first.value.url)?.text()).toBe("first");
    expect(await opfs.files.get(second.value.url)?.text()).toBe("second");
  });

  it("lists published content-addressed Artifacts without mutable paths", async () => {
    const published = await publishWorkspaceArtifact("session", "report.md");
    expect(published.ok).toBe(true);

    const listed = await listSessionArtifacts("session");
    expect(listed).toMatchObject({
      ok: true,
      value: [
        {
          fileName: "report.md",
          mimeType: "text/markdown",
          contentHash: expect.stringMatching(/^sha256:/),
          revision: expect.stringMatching(/^sha256:/),
        },
      ],
    });
  });

  it("lists fallback-hashed Artifacts when Web Crypto is unavailable", async () => {
    const url = "opfs://chat/artifacts/session/1a2b3c4d-report.md";
    opfs.files.set(url, new Blob(["fallback"]));

    await expect(listSessionArtifacts("session")).resolves.toMatchObject({
      ok: true,
      value: [
        {
          fileName: "report.md",
          contentHash: "fnv1a:1a2b3c4d",
          revision: "fnv1a:1a2b3c4d",
        },
      ],
    });
  });

  it("hides restore transaction markers from published Artifact names", async () => {
    const hash = "a".repeat(64);
    const url = `opfs://chat/artifacts/session/${hash}-__restore_tx123_000002__report.md`;
    opfs.files.set(url, new Blob(["restored"]));

    await expect(listSessionArtifacts("session")).resolves.toMatchObject({
      ok: true,
      value: [{ fileName: "report.md", contentHash: `sha256:${hash}` }],
    });
  });

  it("copies transcript artifacts before the source session is deleted", async () => {
    const sourceUrl = "opfs://chat/artifacts/source/hash-report.md";
    opfs.files.set(sourceUrl, new Blob(["report"]));

    const copied = await duplicateSessionArtifacts("source", "copy", [
      sourceUrl,
    ]);
    const copiedUrl = copied.get(sourceUrl);

    expect(copiedUrl).toBe("opfs://chat/artifacts/copy/hash-report.md");
    await deleteSessionArtifacts("source");
    expect(opfs.files.has(sourceUrl)).toBe(false);
    expect(opfs.files.get(copiedUrl!)).toBeInstanceOf(Blob);
  });

  it("migrates a legacy mutable workspace card while duplicating", async () => {
    const legacyUrl = "opfs://chat/workspace/source/report.md";

    const copied = await duplicateSessionArtifacts("source", "copy", [
      legacyUrl,
    ]);
    const copiedUrl = copied.get(legacyUrl);

    expect(copiedUrl).toMatch(
      /^opfs:\/\/chat\/artifacts\/copy\/.+-report\.md$/,
    );
    expect(await opfs.files.get(copiedUrl!)?.text()).toBe("first");
  });
});
