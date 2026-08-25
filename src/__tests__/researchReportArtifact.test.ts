import { beforeEach, describe, expect, it, vi } from "vitest";

const opfs = vi.hoisted(() => ({
  files: new Map<string, Blob>(),
  workspaceContent: "first report",
  deletedUrls: [] as string[],
  deletedWorkspaceFiles: [] as string[],
  listedPaths: new Map<string, string[]>(),
}));

vi.mock("@/utils/opfs", () => ({
  statOPFSFileSize: vi.fn(
    async (url: string) => opfs.files.get(url)?.size ?? null,
  ),
  writeBlobToOPFS: vi.fn(async (url: string, blob: Blob) => {
    opfs.files.set(url, blob);
  }),
  resolveOPFSBlob: vi.fn(async (url: string) => opfs.files.get(url) ?? null),
  deleteFromOPFS: vi.fn(async (url: string) => {
    opfs.deletedUrls.push(url);
    opfs.files.delete(url);
  }),
  listOPFSDirectory: vi.fn(
    async (path: string) => opfs.listedPaths.get(path) || [],
  ),
}));

vi.mock("@/services/workspace/sessionWorkspace", () => ({
  readWorkspaceBlob: vi.fn(async (_sessionId: string, path: string) => {
    const blob = new Blob([opfs.workspaceContent], {
      type: "text/markdown",
    });
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
  deleteWorkspaceFile: vi.fn(async (sessionId: string, path: string) => {
    opfs.deletedWorkspaceFiles.push(`${sessionId}:${path}`);
  }),
}));

import {
  deleteResearchReportArtifact,
  pruneUnreferencedResearchStorage,
  publishResearchReportArtifact,
  readResearchReportArtifact,
} from "@/services/research/reportArtifact";

describe("research report Artifacts", () => {
  beforeEach(() => {
    opfs.files.clear();
    opfs.deletedUrls.length = 0;
    opfs.deletedWorkspaceFiles.length = 0;
    opfs.listedPaths.clear();
    opfs.workspaceContent = "first report";
  });

  it("deduplicates identical reports across sessions", async () => {
    const first = await publishResearchReportArtifact(
      "session-1",
      "research/task/report-v1.md",
    );
    const copied = await publishResearchReportArtifact(
      "session-2",
      "research/task/report-v1.md",
    );

    expect(first.ok).toBe(true);
    expect(copied.ok).toBe(true);
    if (!first.ok || !copied.ok) return;
    expect(first.value.url).toBe(copied.value.url);
    expect(first.value.url).toMatch(
      /^opfs:\/\/chat\/research-artifacts\/(?:[a-f0-9]{8}|[a-f0-9]{64})\.md$/,
    );
    expect(opfs.files.size).toBe(1);
  });

  it("keeps new report bytes immutable and only deletes its own namespace", async () => {
    const first = await publishResearchReportArtifact(
      "session-1",
      "research/task/report-v1.md",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    opfs.workspaceContent = "second report";
    const second = await publishResearchReportArtifact(
      "session-1",
      "research/task/report-v2.md",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.url).not.toBe(first.value.url);
    expect(await opfs.files.get(first.value.url)?.text()).toBe("first report");

    await deleteResearchReportArtifact(first.value.url);
    await deleteResearchReportArtifact("opfs://chat/artifacts/session/file.md");
    expect(opfs.deletedUrls).toEqual([first.value.url]);
  });

  it("resolves report text without exposing OPFS handles", async () => {
    const artifactId = "opfs://chat/research-artifacts/report.md";
    opfs.files.set(
      artifactId,
      new Blob(["# Local report"], { type: "text/markdown" }),
    );

    await expect(readResearchReportArtifact(artifactId)).resolves.toEqual({
      artifactId,
      markdown: "# Local report",
      bytes: 14,
      mimeType: "text/markdown",
    });
    await expect(
      readResearchReportArtifact("opfs://chat/research-artifacts/missing.md"),
    ).resolves.toBeNull();
  });

  it("prunes only unreferenced Research Artifacts and checkpoints", async () => {
    const retained = "opfs://chat/research-artifacts/retained.md";
    const orphaned = "opfs://chat/research-artifacts/orphaned.md";
    opfs.listedPaths.set("chat/research-artifacts", [
      "chat/research-artifacts/retained.md",
      "chat/research-artifacts/orphaned.md",
    ]);
    opfs.listedPaths.set("chat/workspace", [
      "chat/workspace/session-1/research/checkpoints/retained.json",
      "chat/workspace/session-2/research/checkpoints/orphaned.json",
      "chat/workspace/session-2/user-notes.md",
    ]);

    await pruneUnreferencedResearchStorage([
      {
        reportVersions: [{ artifactId: retained }],
        sessionId: "session-1",
        checkpoint: { historyPath: "research/checkpoints/retained.json" },
      } as never,
    ]);

    expect(opfs.deletedUrls).toEqual([orphaned]);
    expect(opfs.deletedWorkspaceFiles).toEqual([
      "session-2:research/checkpoints/orphaned.json",
    ]);
  });
});
