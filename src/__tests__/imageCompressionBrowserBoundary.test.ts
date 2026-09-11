/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compressImageFile,
  type ImageCompressionConfig,
} from "../lib/utils/imageCompression";

const mocks = vi.hoisted(() => ({
  compress: vi.fn(),
}));

vi.mock("browser-image-compression", () => ({
  default: mocks.compress,
}));

const DEFAULT_CONFIG: ImageCompressionConfig = {
  enabled: true,
  maxSizeMB: 1,
  maxWidthOrHeight: 1024,
};

function createImageFile(size = 1024 * 1024 + 1): File {
  return new File([new Uint8Array(size)], "image.png", {
    type: "image/png",
  });
}

const oversizedDimensions = async () => ({ width: 1600, height: 900 });

afterEach(() => {
  mocks.compress.mockReset();
});

describe("browser image compression boundary", () => {
  it("loads and invokes the default compressor in the browser", async () => {
    const file = createImageFile();
    mocks.compress.mockResolvedValue(
      new File([new Uint8Array(4)], "ignored.png", { type: "image/png" }),
    );

    const result = await compressImageFile(file, DEFAULT_CONFIG, {
      readDimensions: oversizedDimensions,
    });

    expect(result).not.toBe(file);
    expect(result).toMatchObject({ size: 4, type: "image/png" });
    expect(mocks.compress).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxSizeMB: 1,
        maxWidthOrHeight: 1024,
        useWebWorker: false,
      }),
    );
  });

  it("keeps the existing fallback and allows a later attempt to retry", async () => {
    const file = createImageFile();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.compress
      .mockRejectedValueOnce(new Error("temporary compressor failure"))
      .mockResolvedValueOnce(
        new File([new Uint8Array(4)], "ignored.png", { type: "image/png" }),
      );

    try {
      await expect(
        compressImageFile(file, DEFAULT_CONFIG, {
          readDimensions: oversizedDimensions,
        }),
      ).resolves.toBe(file);
      await expect(
        compressImageFile(file, DEFAULT_CONFIG, {
          readDimensions: oversizedDimensions,
        }),
      ).resolves.toMatchObject({ size: 4, type: "image/png" });
      expect(mocks.compress).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
