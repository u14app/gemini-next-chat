import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../types";
import {
  compressImageAttachment,
  compressImageFile,
  convertHeicToJpegFile,
  getImageCompressionConfig,
  ImageAttachmentPreparationError,
  prepareImageFileForAttachment,
  prepareConversationImageAttachments,
  prepareGeneratedImageAttachments,
  type ImageCompressionConfig,
  type ImageCompressor,
  type ImageDimensions,
} from "../lib/utils/imageCompression";
import { IMAGE_ATTACHMENT_LIMITS } from "../config/limits";

const DEFAULT_CONFIG: ImageCompressionConfig = {
  enabled: true,
  maxSizeMB: 1,
  maxWidthOrHeight: 1024,
};

function createImageFile({
  size = 1024,
  type = "image/png",
  name = "image.png",
}: {
  size?: number;
  type?: string;
  name?: string;
} = {}): File {
  return new File([new Uint8Array(size)], name, { type });
}

function createSuccessfulCompressor(
  calls: BrowserImageCompressionCall[],
): ImageCompressor {
  return async (file, options) => {
    calls.push({ file, options });
    return createImageFile({
      size: Math.max(1, file.size - 1),
      type: file.type,
      name: "changed-name.jpg",
    });
  };
}

type BrowserImageCompressionCall = {
  file: File;
  options: Parameters<ImageCompressor>[1];
};

async function compressWithDimensions(
  dimensions: ImageDimensions,
  file = createImageFile(),
) {
  const calls: BrowserImageCompressionCall[] = [];
  const compressed = await compressImageFile(file, DEFAULT_CONFIG, {
    readDimensions: async () => dimensions,
    compress: createSuccessfulCompressor(calls),
  });
  return { calls, compressed, file };
}

describe("image compression", () => {
  it.each([
    ["image/heic", "photo.heic"],
    ["image/heif", "photo.heif"],
    ["", "PHOTO.HEIC"],
  ])("converts %s %s images to JPEG before compression", async (type, name) => {
    const file = createImageFile({ type, name });
    const convertHeic = vi.fn(async () =>
      createImageFile({ size: 512, type: "image/jpeg", name: "ignored.jpg" }),
    );
    const onStage = vi.fn();

    const converted = await convertHeicToJpegFile(file, {
      convertHeic,
      onStage,
    });

    expect(convertHeic).toHaveBeenCalledWith({
      blob: file,
      type: "image/jpeg",
      quality: 0.9,
    });
    expect(onStage).toHaveBeenCalledWith("converting");
    expect(converted).toMatchObject({
      name: name.replace(/\.(?:heic|heif)$/i, ".jpg"),
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  });

  it("does not load the HEIC converter for ordinary images", async () => {
    const file = createImageFile({ type: "image/jpeg", name: "photo.jpg" });
    const convertHeic = vi.fn();

    await expect(convertHeicToJpegFile(file, { convertHeic })).resolves.toBe(
      file,
    );
    expect(convertHeic).not.toHaveBeenCalled();
  });

  it("restores common mobile image MIME types from file extensions", async () => {
    const file = createImageFile({ type: "", name: "camera.JPG" });
    const compress = vi.fn<ImageCompressor>();

    const prepared = await prepareImageFileForAttachment(
      file,
      { ...DEFAULT_CONFIG, enabled: false },
      { compress },
    );

    expect(prepared).toMatchObject({
      name: "camera.JPG",
      type: "image/jpeg",
    });
    expect(compress).not.toHaveBeenCalled();
  });

  it("forces 10-20 MiB images through compression even when disabled", async () => {
    const file = createImageFile({
      size: IMAGE_ATTACHMENT_LIMITS.compressionThresholdBytes + 1,
      type: "image/jpeg",
      name: "large.jpg",
    });
    const compress = vi.fn<ImageCompressor>(async () =>
      createImageFile({
        size: IMAGE_ATTACHMENT_LIMITS.maxCompressedBytes,
        type: "image/jpeg",
        name: "large.jpg",
      }),
    );
    const onStage = vi.fn();

    const prepared = await prepareImageFileForAttachment(
      file,
      { ...DEFAULT_CONFIG, enabled: false, maxSizeMB: 5 },
      {
        readDimensions: async () => ({ width: 4000, height: 3000 }),
        compress,
        onStage,
      },
    );

    expect(compress).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith("compressing");
    expect(prepared.size).toBe(IMAGE_ATTACHMENT_LIMITS.maxCompressedBytes);
  });

  it("rejects forced compression that remains over 5 MiB", async () => {
    const file = createImageFile({
      size: IMAGE_ATTACHMENT_LIMITS.compressionThresholdBytes + 1,
      type: "image/jpeg",
      name: "large.jpg",
    });

    await expect(
      prepareImageFileForAttachment(file, DEFAULT_CONFIG, {
        readDimensions: async () => ({ width: 4000, height: 3000 }),
        compress: async () =>
          createImageFile({
            size: IMAGE_ATTACHMENT_LIMITS.maxCompressedBytes + 1,
            type: "image/jpeg",
            name: "large.jpg",
          }),
      }),
    ).rejects.toMatchObject({
      code: "compressed-too-large",
      limitBytes: IMAGE_ATTACHMENT_LIMITS.maxCompressedBytes,
    } satisfies Partial<ImageAttachmentPreparationError>);
  });

  it("rejects images over 20 MiB without conversion or compression", async () => {
    const file = createImageFile({
      size: IMAGE_ATTACHMENT_LIMITS.maxSourceBytes + 1,
      type: "image/heic",
      name: "too-large.heic",
    });
    const convertHeic = vi.fn();
    const compress = vi.fn<ImageCompressor>();

    await expect(
      prepareImageFileForAttachment(file, DEFAULT_CONFIG, {
        convertHeic,
        compress,
      }),
    ).rejects.toMatchObject({ code: "source-too-large" });
    expect(convertHeic).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
  });

  it("derives normalized defaults and preserves an explicit disabled value", () => {
    expect(getImageCompressionConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(
      getImageCompressionConfig({
        enableAutoImageCompression: false,
        imageCompressionMaxSizeMB: 99,
        imageCompressionMaxWidthOrHeight: 1,
      }),
    ).toEqual({
      enabled: false,
      maxSizeMB: 5,
      maxWidthOrHeight: 512,
    });
  });

  it.each([
    ["landscape", { width: 1600, height: 900 }],
    ["portrait", { width: 900, height: 1600 }],
  ])(
    "applies maxWidthOrHeight to a normal %s image",
    async (_label, dimensions) => {
      const { calls } = await compressWithDimensions(dimensions);

      expect(calls).toHaveLength(1);
      expect(calls[0].options).toMatchObject({
        maxSizeMB: 1,
        maxWidthOrHeight: 1024,
        useWebWorker: false,
        preserveExif: false,
        fileType: "image/png",
      });
    },
  );

  it.each([
    ["horizontal", { width: 5001, height: 1000 }],
    ["vertical", { width: 1000, height: 5001 }],
  ])(
    "omits maxWidthOrHeight for a %s image over the 5:1 boundary",
    async (_label, dimensions) => {
      const { calls } = await compressWithDimensions(
        dimensions,
        createImageFile({ size: 1024 * 1024 + 1 }),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].options).toHaveProperty("maxSizeMB", 1);
      expect(calls[0].options).not.toHaveProperty("maxWidthOrHeight");
    },
  );

  it.each([
    ["5:1", { width: 5120, height: 1024 }],
    ["1:5", { width: 1024, height: 5120 }],
  ])(
    "keeps maxWidthOrHeight for an image at exactly %s",
    async (_label, dimensions) => {
      const { calls } = await compressWithDimensions(dimensions);

      expect(calls[0].options).toHaveProperty(
        "maxWidthOrHeight",
        DEFAULT_CONFIG.maxWidthOrHeight,
      );
    },
  );

  it("still applies maxSizeMB to a long image", async () => {
    const file = createImageFile({
      size: DEFAULT_CONFIG.maxSizeMB * 1024 * 1024 + 1,
    });
    const { calls } = await compressWithDimensions(
      { width: 6000, height: 1000 },
      file,
    );

    expect(calls[0].options).toHaveProperty("maxSizeMB", 1);
    expect(calls[0].options).not.toHaveProperty("maxWidthOrHeight");
  });

  it("skips images that already satisfy both constraints", async () => {
    const file = createImageFile();
    const compress = vi.fn<ImageCompressor>();

    const result = await compressImageFile(file, DEFAULT_CONFIG, {
      readDimensions: async () => ({ width: 800, height: 600 }),
      compress,
    });

    expect(result).toBe(file);
    expect(compress).not.toHaveBeenCalled();
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/bmp"])(
    "compresses the supported %s format",
    async (type) => {
      const file = createImageFile({ type });
      const compress = vi.fn<ImageCompressor>(async () =>
        createImageFile({ size: file.size - 1, type }),
      );

      const result = await compressImageFile(file, DEFAULT_CONFIG, {
        readDimensions: async () => ({ width: 1600, height: 900 }),
        compress,
      });

      expect(result).not.toBe(file);
      expect(result.type).toBe(type);
      expect(compress).toHaveBeenCalledTimes(1);
    },
  );

  it("skips compression when the setting is disabled", async () => {
    const file = createImageFile();
    const readDimensions = vi.fn();
    const compress = vi.fn<ImageCompressor>();

    const result = await compressImageFile(
      file,
      { ...DEFAULT_CONFIG, enabled: false },
      { readDimensions, compress },
    );

    expect(result).toBe(file);
    expect(readDimensions).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
  });

  it("preserves the original file when compression grows the payload", async () => {
    const file = createImageFile({ size: 100 });
    const result = await compressImageFile(file, DEFAULT_CONFIG, {
      readDimensions: async () => ({ width: 1600, height: 900 }),
      compress: async () => createImageFile({ size: 101 }),
    });

    expect(result).toBe(file);
  });

  it("preserves the original when the compressor changes MIME type", async () => {
    const file = createImageFile({ type: "image/png" });
    const result = await compressImageFile(file, DEFAULT_CONFIG, {
      readDimensions: async () => ({ width: 1600, height: 900 }),
      compress: async () =>
        createImageFile({ size: file.size - 1, type: "image/jpeg" }),
    });

    expect(result).toBe(file);
  });

  it("passes unsupported formats through without decoding or compression", async () => {
    const file = createImageFile({ type: "image/gif", name: "animated.gif" });
    const readDimensions = vi.fn();
    const compress = vi.fn<ImageCompressor>();

    const result = await compressImageFile(file, DEFAULT_CONFIG, {
      readDimensions,
      compress,
    });

    expect(result).toBe(file);
    expect(readDimensions).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
  });

  it("falls back on processing failure", async () => {
    const file = createImageFile();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await compressImageFile(file, DEFAULT_CONFIG, {
      readDimensions: async () => ({ width: 1600, height: 900 }),
      compress: async () => {
        throw new Error("compression failed");
      },
    });

    expect(result).toBe(file);
    warn.mockRestore();
  });

  it("falls back when the default compressor is requested during SSR", async () => {
    const file = createImageFile({ size: 1024 * 1024 + 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        compressImageFile(file, DEFAULT_CONFIG, {
          readDimensions: async () => ({ width: 1600, height: 900 }),
        }),
      ).resolves.toBe(file);
      expect(warn).toHaveBeenCalledWith(
        "Failed to compress image; using the original file",
        expect.objectContaining({
          message: "Image compression is only available in the browser.",
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("propagates cancellation", async () => {
    const file = createImageFile();
    const controller = new AbortController();
    const abortError = new DOMException("cancelled", "AbortError");

    await expect(
      compressImageFile(file, DEFAULT_CONFIG, {
        signal: controller.signal,
        readDimensions: async () => ({ width: 1600, height: 900 }),
        compress: async () => {
          throw abortError;
        },
      }),
    ).rejects.toBe(abortError);
  });

  it("preserves the original MIME type and filename", async () => {
    const { compressed } = await compressWithDimensions(
      { width: 1600, height: 900 },
      createImageFile({
        size: 1024,
        type: "image/png",
        name: "transparent-source.png",
      }),
    );

    expect(compressed.name).toBe("transparent-source.png");
    expect(compressed.type).toBe("image/png");
  });

  it("does not download or rewrite URL-only images", async () => {
    const attachment: Attachment = {
      id: "remote",
      mimeType: "image/png",
      fileName: "remote.png",
      url: "https://cdn.example.com/remote.png",
    };
    const resolveOPFSBlob = vi.fn();
    const compress = vi.fn<ImageCompressor>();

    const result = await compressImageAttachment(attachment, DEFAULT_CONFIG, {
      resolveOPFSBlob,
      readDimensions: async () => ({ width: 1600, height: 900 }),
      compress,
    });

    expect(result).toBe(attachment);
    expect(resolveOPFSBlob).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
  });

  it("keeps request-time compressed images as Files instead of Base64", async () => {
    const attachment: Attachment = {
      id: "legacy-inline",
      mimeType: "image/png",
      fileName: "legacy.png",
      data: Buffer.from(new Uint8Array(10)).toString("base64"),
    };

    const result = (await compressImageAttachment(attachment, DEFAULT_CONFIG, {
      readDimensions: async () => ({ width: 1600, height: 900 }),
      compress: async () => createImageFile({ size: 5 }),
    })) as Attachment & { file?: File };

    expect(result.file).toBeInstanceOf(File);
    expect(result.file).toMatchObject({ size: 5, type: "image/png" });
    expect(result).not.toHaveProperty("data");
    expect(result).not.toHaveProperty("url");
  });

  it("compresses legacy OPFS images before creating the conversation cache", async () => {
    const originalBytes = new Uint8Array(10);
    const compressedBytes = new Uint8Array(5);
    const savedSizes: number[] = [];
    const prepared = await prepareConversationImageAttachments(
      [
        {
          id: "legacy",
          mimeType: "image/png",
          fileName: "legacy.png",
          url: "opfs://workspaces/legacy.png",
        },
      ],
      DEFAULT_CONFIG,
      {
        resolveOPFSBlob: async () =>
          new Blob([originalBytes], { type: "image/png" }),
        readDimensions: async () => ({ width: 1600, height: 900 }),
        compress: async () =>
          createImageFile({ size: compressedBytes.byteLength }),
        saveFile: async (file) => {
          savedSizes.push(file.size);
          return "opfs://chat/images/compressed.png";
        },
        now: () => 789,
      },
    );

    expect(savedSizes).toEqual([compressedBytes.byteLength]);
    expect(prepared[0]).toMatchObject({
      id: "legacy",
      url: "opfs://chat/images/compressed.png",
    });
    expect(prepared[0]).not.toHaveProperty("data");
    expect(prepared[0]).not.toHaveProperty("displayCache");
  });

  it("compresses and caches generated inline images sequentially", async () => {
    const firstData = Buffer.from(new Uint8Array(10)).toString("base64");
    const secondData = Buffer.from(new Uint8Array(10)).toString("base64");
    let active = 0;
    let maxActive = 0;
    const compress: ImageCompressor = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return createImageFile({ size: 5 });
    };
    const saveFile = vi
      .fn()
      .mockResolvedValueOnce("opfs://images/generated/first.png")
      .mockResolvedValueOnce("opfs://images/generated/second.png");

    const prepared = await prepareGeneratedImageAttachments(
      [
        {
          id: "first",
          mimeType: "image/png",
          fileName: "first.png",
          data: firstData,
        },
        {
          id: "second",
          mimeType: "image/png",
          fileName: "second.png",
          data: secondData,
        },
      ],
      DEFAULT_CONFIG,
      {
        readDimensions: async () => ({ width: 1600, height: 900 }),
        compress,
        saveFile,
        now: () => 456,
      },
    );

    expect(maxActive).toBe(1);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      url: "opfs://images/generated/first.png",
    });
    expect(prepared[0]).not.toHaveProperty("data");
    expect(prepared[0]).not.toHaveProperty("displayCache");
    expect(saveFile).toHaveBeenCalledTimes(2);
  });
});
