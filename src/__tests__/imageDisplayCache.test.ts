import { describe, expect, it, vi } from "vitest";
import {
  ensureImageDisplayCache,
  getAttachmentSourceFingerprint,
  resolveAttachmentDisplayBlobUrl,
  stripAttachmentDisplayCacheForModel,
  stripMessageDisplayCacheForModel,
} from "../lib/utils/imageDisplayCache";
import type { Attachment } from "../types";

type SaveFileMock = (file: File, prefix?: string) => Promise<string>;

const imageAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: "img_1",
  mimeType: "image/png",
  data: "aGVsbG8=",
  fileName: "image.png",
  ...overrides,
});

describe("image display cache", () => {
  it("writes base64 images to OPFS and records a matching source fingerprint", async () => {
    const saveFile = vi.fn<SaveFileMock>(
      async () => "opfs://images/generated/cache.png",
    );
    const attachment = imageAttachment();

    const cached = await ensureImageDisplayCache(attachment, {
      saveFile,
      now: () => 123,
    });

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0]).toMatchObject({
      name: "image.png",
      type: "image/png",
    });
    expect(saveFile.mock.calls[0][1]).toBe("images");
    expect(cached).toMatchObject({
      displayCache: {
        opfsUrl: "opfs://images/generated/cache.png",
        sourceKind: "data",
        sourceFingerprint: await getAttachmentSourceFingerprint(attachment),
        createdAt: 123,
      },
    });
    expect(cached.data).toBe(attachment.data);
  });

  it("removes a newly written cache file when cancellation wins the save race", async () => {
    const controller = new AbortController();
    const deleteFile = vi.fn(async () => undefined);
    const saveFile = vi.fn<SaveFileMock>(async () => {
      controller.abort();
      return "opfs://images/generated/orphan.png";
    });

    await expect(
      ensureImageDisplayCache(imageAttachment(), {
        saveFile,
        deleteFile,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(deleteFile).toHaveBeenCalledWith(
      "opfs://images/generated/orphan.png",
    );
  });

  it("reuses a fresh display cache and rebuilds a stale one", async () => {
    const original = imageAttachment();
    const fingerprint = await getAttachmentSourceFingerprint(original);
    expect(fingerprint).toBeTruthy();
    const saveFile = vi.fn<SaveFileMock>(
      async () => "opfs://images/generated/new.png",
    );

    const reused = await ensureImageDisplayCache(
      imageAttachment({
        displayCache: {
          opfsUrl: "opfs://images/generated/existing.png",
          sourceKind: "data",
          sourceFingerprint: fingerprint!,
          createdAt: 1,
        },
      }),
      { saveFile },
    );
    expect(reused.displayCache?.opfsUrl).toBe(
      "opfs://images/generated/existing.png",
    );
    expect(saveFile).not.toHaveBeenCalled();

    const rebuilt = await ensureImageDisplayCache(
      imageAttachment({
        data: "bmV3LWltYWdl",
        displayCache: {
          opfsUrl: "opfs://images/generated/stale.png",
          sourceKind: "data",
          sourceFingerprint: fingerprint!,
          createdAt: 1,
        },
      }),
      { saveFile },
    );
    expect(rebuilt.displayCache?.opfsUrl).toBe(
      "opfs://images/generated/new.png",
    );
    expect(saveFile).toHaveBeenCalledTimes(1);
  });

  it("resolves cached OPFS images to Blob URLs and falls back to base64 Blob URLs", async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:from-cache")
      .mockReturnValueOnce("blob:from-data");
    const resolveOPFSBlob = vi.fn(async () => new Blob(["cached"]));

    await expect(
      resolveAttachmentDisplayBlobUrl(
        imageAttachment({
          displayCache: {
            opfsUrl: "opfs://images/generated/cache.png",
            sourceKind: "data",
            sourceFingerprint: "fingerprint",
            createdAt: 1,
          },
        }),
        {
          resolveOPFSBlob,
          createObjectURL,
        },
      ),
    ).resolves.toBe("blob:from-cache");
    expect(resolveOPFSBlob).toHaveBeenCalledWith(
      "opfs://images/generated/cache.png",
    );

    await expect(
      resolveAttachmentDisplayBlobUrl(imageAttachment(), {
        resolveOPFSBlob,
        createObjectURL,
      }),
    ).resolves.toBe("blob:from-data");
  });

  it("strips display cache but keeps OPFS images file-backed for model requests", async () => {
    const cached = imageAttachment({
      displayCache: {
        opfsUrl: "opfs://images/generated/cache.png",
        sourceKind: "data",
        sourceFingerprint: "fingerprint",
        createdAt: 1,
      },
    });

    expect(await stripAttachmentDisplayCacheForModel(cached)).toEqual({
      id: "img_1",
      mimeType: "image/png",
      data: "aGVsbG8=",
      fileName: "image.png",
    });

    const legacy = imageAttachment({
      data: undefined,
      url: "opfs://images/generated/legacy.png",
    });

    const converted = await stripAttachmentDisplayCacheForModel(legacy, {
      resolveOPFSBlob: async () => new Blob(["legacy"], { type: "image/png" }),
    });
    expect(converted).toEqual({
      id: "img_1",
      mimeType: "image/png",
      fileName: "image.png",
      url: "opfs://images/generated/legacy.png",
    });
    expect(converted).not.toHaveProperty("data");
  });

  it("removes display-only tool result images from model history", async () => {
    const toolCall = {
      id: "call_1",
      name: "generate_image",
      args: {},
      status: "success" as const,
      result: { imageBase64: "[image omitted]", imageCount: 1 },
      resultImages: [imageAttachment()],
    };

    const stripped = await stripMessageDisplayCacheForModel({
      id: "message_1",
      role: "model",
      content: "Generated.",
      timestamp: 1,
      toolCalls: [toolCall],
      outputBlocks: [
        {
          id: "tools_1",
          type: "tool_group",
          toolCalls: [toolCall],
        },
      ],
    });

    expect(stripped.toolCalls?.[0]).not.toHaveProperty("resultImages");
    const toolGroup = stripped.outputBlocks?.find(
      (block) => block.type === "tool_group",
    );
    expect(toolGroup?.type).toBe("tool_group");
    if (toolGroup?.type === "tool_group") {
      expect(toolGroup.toolCalls[0]).not.toHaveProperty("resultImages");
    }
  });

  it("keeps full long text content while stripping local document metadata from model history", async () => {
    const stripped = await stripMessageDisplayCacheForModel({
      id: "long-text-message",
      role: "model",
      content: "Full document body",
      timestamp: 1,
      outputBlocks: [
        {
          id: "long-text",
          type: "text",
          content: "Full document body",
          presentation: {
            kind: "long_text",
            title: "Document",
            format: "markdown",
            document: {
              fileName: "Document.md",
              mimeType: "text/markdown",
              url: "opfs://chat/long-text/document.md",
            },
          },
        },
      ],
    });

    expect(stripped.content).toBe("Full document body");
    expect(stripped.outputBlocks).toEqual([
      {
        id: "long-text",
        type: "text",
        content: "Full document body",
      },
    ]);
  });
});
