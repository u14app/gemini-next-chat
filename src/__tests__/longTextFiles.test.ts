import { describe, expect, it, vi } from "vitest";

import {
  cleanupCreatedLongTextFiles,
  persistLongTextOutputBlocks,
} from "@/lib/chat/longTextFiles";
import { getOutputBlockAttachmentUrls } from "@/lib/chat/attachmentReferences";
import type { MessageOutputBlock } from "@/types";

const createBlocks = (url?: string): MessageOutputBlock[] => [
  { id: "intro", type: "text", content: "Intro" },
  {
    id: "document",
    type: "text",
    content: "# Document\n\nComplete body.",
    presentation: {
      kind: "long_text",
      title: "Document",
      format: "markdown",
      document: {
        fileName: "Document.md",
        mimeType: "text/markdown",
        ...(url ? { url } : {}),
      },
    },
  },
];

describe("long text OPFS files", () => {
  it("creates a new file without turning it into a message attachment", async () => {
    const saveFile = vi.fn(async () =>
      Promise.resolve("opfs://chat/long-text/generated.md"),
    );
    const result = await persistLongTextOutputBlocks(createBlocks(), {
      saveFile,
    });

    expect(saveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Document.md",
        type: "text/markdown",
      }),
      "chat/long-text",
    );
    expect(result.createdUrls).toEqual(["opfs://chat/long-text/generated.md"]);
    expect(result.outputBlocks[1]).toMatchObject({
      type: "text",
      content: "# Document\n\nComplete body.",
      presentation: {
        document: { url: "opfs://chat/long-text/generated.md" },
      },
    });
    expect("attachments" in result).toBe(false);
  });

  it("rewrites an existing file after edits", async () => {
    const writeFile = vi.fn(async () => undefined);
    const saveFile = vi.fn();
    const result = await persistLongTextOutputBlocks(
      createBlocks("opfs://chat/long-text/existing.md"),
      { saveFile, writeFile },
    );

    expect(writeFile).toHaveBeenCalledWith(
      "opfs://chat/long-text/existing.md",
      "# Document\n\nComplete body.",
    );
    expect(saveFile).not.toHaveBeenCalled();
    expect(result.createdUrls).toEqual([]);

    const emptyBlocks = createBlocks("opfs://chat/long-text/existing.md").map(
      (block) =>
        block.type === "text" && block.presentation
          ? { ...block, content: "" }
          : block,
    );
    await persistLongTextOutputBlocks(emptyBlocks, { writeFile });
    expect(writeFile).toHaveBeenLastCalledWith(
      "opfs://chat/long-text/existing.md",
      "",
    );
  });

  it("keeps the body and records a non-blocking warning when saving fails", async () => {
    const result = await persistLongTextOutputBlocks(createBlocks(), {
      saveFile: vi.fn(async () => {
        throw new Error("OPFS unavailable");
      }),
    });

    expect(result.outputBlocks[1]).toMatchObject({
      content: "# Document\n\nComplete body.",
      presentation: {
        document: {
          localFileMissing: true,
          localFileError: "OPFS unavailable",
        },
      },
    });
  });

  it("removes a newly created file if the operation becomes stale", async () => {
    const controller = new AbortController();
    const deleteFile = vi.fn(async () => undefined);

    await expect(
      persistLongTextOutputBlocks(createBlocks(), {
        signal: controller.signal,
        saveFile: vi.fn(async () => {
          controller.abort();
          return "opfs://chat/long-text/stale.md";
        }),
        deleteFile,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(deleteFile).toHaveBeenCalledWith("opfs://chat/long-text/stale.md");

    await cleanupCreatedLongTextFiles(
      ["opfs://chat/long-text/orphan.md"],
      deleteFile,
    );
    expect(deleteFile).toHaveBeenCalledWith("opfs://chat/long-text/orphan.md");
  });

  it("includes document URLs in the existing output-block reference scan", () => {
    expect(
      getOutputBlockAttachmentUrls(
        createBlocks("opfs://chat/long-text/referenced.md"),
      ),
    ).toEqual(["opfs://chat/long-text/referenced.md"]);
  });
});
