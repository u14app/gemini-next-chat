// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDiagramSvgIntrinsicSize,
  prepareDiagramSvgForPng,
  saveDiagramImage,
} from "@/lib/utils/diagramImageExport";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="100%" style="max-width: 100%"><foreignObject width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml">Node</div></foreignObject></svg>';

const objectUrls: string[] = [];
const imageSources: string[] = [];
let imageShouldFail = false;
const context = {
  scale: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
};

beforeEach(() => {
  imageShouldFail = false;
  objectUrls.length = 0;
  imageSources.length = 0;
  context.scale.mockClear();
  context.fillRect.mockClear();
  context.drawImage.mockClear();

  vi.stubGlobal(
    "Image",
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        imageSources.push(value);
        queueMicrotask(() => {
          if (imageShouldFail) this.onerror?.();
          else this.onload?.();
        });
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:diagram-${objectUrls.length + 1}`;
    objectUrls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["png"], { type: "image/png" })),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("diagram PNG export", () => {
  it("uses the complete viewBox and adds a readable themed background", () => {
    const document = new DOMParser().parseFromString(SVG, "image/svg+xml");
    expect(
      getDiagramSvgIntrinsicSize(
        document.documentElement as unknown as SVGSVGElement,
      ),
    ).toEqual({
      width: 320,
      height: 120,
    });

    const prepared = prepareDiagramSvgForPng(SVG, "dark");
    const exported = new DOMParser().parseFromString(
      prepared.svg,
      "image/svg+xml",
    );

    expect(prepared.size).toEqual({ width: 320, height: 120 });
    expect(exported.documentElement.getAttribute("width")).toBe("320");
    expect(exported.documentElement.getAttribute("height")).toBe("120");
    expect(prepared.background).toBe("#0b1220");
    expect(exported.documentElement.querySelector("rect")).toBeNull();
    expect(prepared.svg).not.toContain("max-width");
    expect(prepared.svg).toContain("foreignObject");
  });

  it("rasterizes the full diagram, downloads a PNG, and revokes both URLs", async () => {
    const createElement = vi.spyOn(document, "createElement");
    await saveDiagramImage({
      svg: SVG,
      filename: "mind-map",
      theme: "light",
      pixelRatio: 2,
    });

    const canvas = createElement.mock.results
      .map((result) => result.value)
      .find(
        (value): value is HTMLCanvasElement =>
          value instanceof HTMLCanvasElement,
      );
    expect(canvas?.width).toBe(640);
    expect(canvas?.height).toBe(240);
    expect(context.scale).toHaveBeenCalledWith(2, 2);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 320, 120);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      320,
      120,
    );
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download='mind-map.png']")).toBeNull();
    expect(imageSources[0]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u);
    expect(decodeURIComponent(imageSources[0].split(",", 2)[1])).toContain(
      "foreignObject",
    );
    expect(objectUrls).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(objectUrls[0]);
  });

  it("revokes the source URL when the SVG cannot be loaded", async () => {
    imageShouldFail = true;

    await expect(
      saveDiagramImage({
        svg: SVG,
        filename: "diagram.png",
        theme: "light",
      }),
    ).rejects.toThrow("could not be loaded");

    expect(imageSources[0]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u);
    expect(objectUrls).toHaveLength(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
