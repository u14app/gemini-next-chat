import { describe, expect, it, vi } from "vitest";
import type { Message, Session } from "@/types";
import type { ResearchTask } from "@/lib/research/types";
import { prepareSessionShare } from "@/services/sharing/snapshot";
import { SHARE_LIMITS } from "@/lib/sharing/types";

const session: Session = {
  id: "session",
  title: "My conversation",
  model: "test",
  messageCount: 1,
  updatedAt: 1,
  systemInstruction: "private system instruction",
  config: { toolApprovals: [] },
};
const message = (content: string): Message => ({
  id: "m",
  role: "model",
  timestamp: 1,
  content,
});
const image = () =>
  new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: "image/png",
  });
const imageDependencies = () => ({
  readImage: vi.fn(async () => image()),
  prepareImage: vi.fn(async (blob: Blob) => blob),
});

describe("public conversation projection", () => {
  it("never publishes temporary conversations", async () => {
    await expect(
      prepareSessionShare({
        session: { ...session, retention: "temporary" },
        messages: [message("temporary")],
      }),
    ).rejects.toMatchObject({ code: "SHARE_TEMPORARY_SESSION" });
  });
  it("includes only the supplied visible path and excludes execution, memory, reasoning and system fields", async () => {
    const input = {
      ...message("Visible answer"),
      reasoning: "private reasoning",
      memoryContext: {
        injectedMemoryIds: ["memory"],
        promptContext: "private memory",
      },
      toolCalls: [
        {
          id: "tool",
          name: "search",
          status: "success" as const,
          args: { password: "private args" },
          result: "private result",
          auth: { type: "bearer" as const, value: "private token" },
        },
      ],
    };
    const result = await prepareSessionShare({ session, messages: [input] });
    expect(result.snapshot.messages).toHaveLength(1);
    expect(result.snapshot.messages[0].blocks).toEqual([
      { type: "text", content: "Visible answer" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(input.content).toBe("Visible answer");
  });

  it("mirrors inline, reference-style and HTML images while leaving code examples intact", async () => {
    const deps = imageDependencies();
    const content =
      '![one](https://example.com/one.png)\n\n![two][ref]\n\n[ref]: https://example.com/two.png?token=secret\n\n<img src="https://example.com/three.png" onerror="alert(1)" />\n\n```md\n![example](https://example.com/code.png)\n```';
    const result = await prepareSessionShare(
      { session, messages: [message(content)] },
      deps,
    );
    const text = JSON.stringify(result.snapshot);
    expect(result.assets).toHaveLength(1);
    expect(deps.readImage).toHaveBeenCalledTimes(3);
    expect(text.match(/share-asset:/g)).toHaveLength(3);
    expect(text).not.toContain("token=secret");
    expect(text).not.toContain("onerror");
    expect(text).toContain("https://example.com/code.png");
  });

  it("shares image attachments, but exposes only names for other attachments and archives", async () => {
    const result = await prepareSessionShare(
      {
        session,
        messages: [
          {
            ...message(""),
            attachments: [
              {
                id: "photo",
                fileName: "photo.png",
                mimeType: "image/png",
                url: "opfs://chat/photo.png",
              },
              {
                id: "doc",
                fileName: "private/path/report.pdf",
                mimeType: "application/pdf",
                url: "opfs://private/report.pdf",
                data: "secret",
              },
            ],
            outputBlocks: [
              {
                id: "archive",
                type: "workspace_archive",
                archive: {
                  fileName: "files.zip",
                  bytes: 5,
                  entryCount: 1,
                  url: "opfs://chat/private.zip",
                },
              },
            ],
          },
        ],
      },
      imageDependencies(),
    );
    expect(result.snapshot.messages[0].blocks).toEqual([
      { type: "image", assetId: result.assets[0].id, alt: "photo.png" },
      { type: "attachment", fileName: "report.pdf" },
      { type: "attachment", fileName: "files.zip" },
    ]);
    expect(JSON.stringify(result)).not.toContain("opfs:");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("preserves image-like literals inside inline and block math", async () => {
    const deps = imageDependencies();
    const content =
      "$![literal](https://example.com/inline.png)$\n\n$$\n![literal](https://example.com/block.png)\n$$";
    const result = await prepareSessionShare(
      { session, messages: [message(content)] },
      deps,
    );
    expect(result.snapshot.messages[0].blocks).toEqual([
      { type: "text", content },
    ]);
    expect(deps.readImage).not.toHaveBeenCalled();
    expect(result.assets).toEqual([]);
  });

  it("keeps definitions used by ordinary links when publishing image references", async () => {
    const content =
      "![Photo][source]\n\n[View original][source]\n\n[source]: https://example.com/photo.png";
    const result = await prepareSessionShare(
      { session, messages: [message(content)] },
      imageDependencies(),
    );
    const block = result.snapshot.messages[0].blocks[0];
    expect(block.type).toBe("text");
    if (block.type !== "text") throw new Error("Missing text block");
    expect(block.content).toContain("[View original][source]");
    expect(block.content).toContain("[source]: https://example.com/photo.png");
    expect(block.content).toContain("share-asset:");
  });

  it("does not read arbitrary OPFS paths mentioned by generated Markdown", async () => {
    const deps = imageDependencies();
    await expect(
      prepareSessionShare(
        {
          session,
          messages: [message("![leak](opfs://knowledge-base/unrelated.png)")],
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "SHARE_IMAGE_MISSING" });
    expect(deps.readImage).not.toHaveBeenCalled();
  });

  it("resolves the active report artifact and snapshots its content", async () => {
    const loadResearchTask = vi.fn(
      async () =>
        ({
          sessionId: session.id,
          goal: "Research",
          activeReportVersion: 2,
          reportVersions: [
            { version: 1, artifactId: "old" },
            { version: 2, artifactId: "new" },
          ],
        }) as unknown as ResearchTask,
    );
    const readReport = vi.fn(async () => ({
      markdown: "# Finished report",
      bytes: 17,
    }));
    const result = await prepareSessionShare(
      {
        session,
        messages: [
          {
            ...message(""),
            outputBlocks: [
              { id: "research", type: "research_task", taskId: "task" },
            ],
          },
        ],
      },
      { loadResearchTask, readReport },
    );
    expect(readReport).toHaveBeenCalledWith("new");
    expect(result.snapshot.messages[0].blocks).toEqual([
      { type: "report", title: "Research", content: "# Finished report" },
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain("artifactId");
  });

  it("fails publication rather than silently losing unavailable media", async () => {
    await expect(
      prepareSessionShare(
        {
          session,
          messages: [message("![image](https://example.com/missing.png)")],
        },
        {
          ...imageDependencies(),
          readImage: async () => {
            throw new Error("image missing");
          },
        },
      ),
    ).rejects.toThrow("image missing");
  });

  it("publishes only the selected report version's images with public provenance", async () => {
    const deps = imageDependencies();
    const loadResearchTask = vi.fn(
      async () =>
        ({
          sessionId: session.id,
          goal: "Research",
          activeReportVersion: 1,
          imageSources: [{ url: "https://example.com/unpublished.png" }],
          reportVersions: [
            {
              version: 1,
              artifactId: "selected",
              imageSources: [
                {
                  id: "internal-image-id",
                  researchRunId: "private-run",
                  retrievedAt: 1,
                  url: "https://example.com/selected.png",
                  description: "Observed illustration",
                  sourceUrl: "https://example.com/source",
                },
              ],
            },
            {
              version: 2,
              artifactId: "latest",
              imageSources: [{ url: "https://example.com/latest.png" }],
            },
          ],
        }) as unknown as ResearchTask,
    );
    const result = await prepareSessionShare(
      {
        session,
        messages: [
          {
            ...message(""),
            outputBlocks: [
              { id: "research", type: "research_task", taskId: "task" },
            ],
          },
        ],
      },
      {
        ...deps,
        loadResearchTask,
        readReport: async () => ({
          markdown: "![Inline](https://example.com/selected.png)",
          bytes: 49,
        }),
      },
    );
    expect(deps.readImage).toHaveBeenCalledTimes(1);
    expect(deps.readImage).toHaveBeenCalledWith(
      "https://example.com/selected.png",
      undefined,
    );
    expect(result.snapshot.messages[0].blocks[1]).toEqual({
      type: "image",
      assetId: result.assets[0].id,
      alt: "Observed illustration",
      sourceUrl: "https://example.com/source",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-run|internal-image-id|unpublished\.png|latest\.png/,
    );
  });

  it("enforces the post-compression per-image limit", async () => {
    await expect(
      prepareSessionShare(
        {
          session,
          messages: [message("![image](https://example.com/huge.png)")],
        },
        {
          ...imageDependencies(),
          prepareImage: async () =>
            new Blob([new Uint8Array(SHARE_LIMITS.imageBytes + 1)], {
              type: "image/png",
            }),
        },
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects oversized metadata instead of silently truncating the snapshot", async () => {
    const input = { ...session, title: "x".repeat(513) };
    await expect(
      prepareSessionShare({
        session: input,
        messages: [message("Complete text")],
      }),
    ).rejects.toMatchObject({ code: "SHARE_TOO_LARGE", status: 413 });
    expect(input.title).toHaveLength(513);
  });
});
