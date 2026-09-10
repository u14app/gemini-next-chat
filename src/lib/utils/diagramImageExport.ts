export type DiagramImageTheme = "light" | "dark";

export interface DiagramSvgIntrinsicSize {
  width: number;
  height: number;
}

export interface SaveDiagramImageOptions {
  svg: string;
  filename: string;
  theme: DiagramImageTheme;
  pixelRatio?: number;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LIGHT_BACKGROUND = "#ffffff";
const DARK_BACKGROUND = "#0b1220";
const DEFAULT_PIXEL_RATIO = 2;

function parsePositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readViewBoxSize(value: string | null): DiagramSvgIntrinsicSize | null {
  if (!value) return null;
  const values = value
    .trim()
    .split(/[\s,]+/u)
    .map((entry) => Number.parseFloat(entry));
  const width = values[2];
  const height = values[3];
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Reads the full SVG drawing size. The viewBox takes precedence so a
 * responsive inline SVG cannot make an export depend on its current viewport.
 */
export function getDiagramSvgIntrinsicSize(
  svgElement: SVGSVGElement,
): DiagramSvgIntrinsicSize {
  const viewBoxSize = readViewBoxSize(svgElement.getAttribute("viewBox"));
  if (viewBoxSize) return viewBoxSize;

  const width = parsePositiveNumber(svgElement.getAttribute("width"));
  const height = parsePositiveNumber(svgElement.getAttribute("height"));
  if (width && height) return { width, height };

  throw new Error("The diagram SVG does not have an intrinsic size.");
}

function getBackgroundColor(theme: DiagramImageTheme): string {
  return theme === "dark" ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

function removeResponsiveRootStyles(root: Element) {
  const style = root.getAttribute("style");
  if (!style) return;

  const cleaned = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(
      (declaration) =>
        declaration && !/^(?:max-)?(?:width|height)\s*:/iu.test(declaration),
    )
    .join("; ");
  if (cleaned) root.setAttribute("style", cleaned);
  else root.removeAttribute("style");
}

/**
 * Makes the SVG self-contained for rasterization and returns its full drawing
 * size. The background is returned for the canvas so even SVGs whose viewBox
 * starts at a negative coordinate are filled completely.
 */
export function prepareDiagramSvgForPng(
  svg: string,
  theme: DiagramImageTheme,
): {
  svg: string;
  size: DiagramSvgIntrinsicSize;
  background: string;
} {
  if (
    typeof DOMParser === "undefined" ||
    typeof XMLSerializer === "undefined"
  ) {
    throw new Error("SVG image export is only available in a browser.");
  }

  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") {
    throw new Error("The diagram SVG could not be parsed.");
  }

  const size = getDiagramSvgIntrinsicSize(root as unknown as SVGSVGElement);
  const background = getBackgroundColor(theme);

  root.setAttribute("xmlns", SVG_NAMESPACE);
  root.setAttribute("width", String(size.width));
  root.setAttribute("height", String(size.height));
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  removeResponsiveRootStyles(root);

  return {
    svg: new XMLSerializer().serializeToString(root),
    size,
    background,
  };
}

function loadSvgImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The diagram SVG could not be loaded."));
    image.src = source;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The diagram PNG could not be created."));
      }
    }, "image/png");
  });
}

function normalizePixelRatio(pixelRatio: number | undefined): number {
  if (!pixelRatio || !Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    return DEFAULT_PIXEL_RATIO;
  }
  return Math.min(Math.max(pixelRatio, 1), 4);
}

function normalizeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "diagram.png";
  return /\.png$/iu.test(trimmed) ? trimmed : `${trimmed}.png`;
}

function createSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Rasterizes a complete diagram SVG and starts a browser PNG download.
 * The temporary PNG object URL is revoked on every success and failure path.
 */
export async function saveDiagramImage({
  svg,
  filename,
  theme,
  pixelRatio,
}: SaveDiagramImageOptions): Promise<void> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("SVG image export is only available in a browser.");
  }

  const prepared = prepareDiagramSvgForPng(svg, theme);
  const scale = normalizePixelRatio(pixelRatio);
  const svgDataUrl = createSvgDataUrl(prepared.svg);
  let image: HTMLImageElement | null = null;
  let pngUrl: string | null = null;
  let link: HTMLAnchorElement | null = null;

  try {
    image = await loadSvgImage(svgDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(prepared.size.width * scale));
    canvas.height = Math.max(1, Math.round(prepared.size.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The diagram PNG canvas is unavailable.");

    context.scale(scale, scale);
    context.fillStyle = prepared.background;
    context.fillRect(0, 0, prepared.size.width, prepared.size.height);
    context.drawImage(image, 0, 0, prepared.size.width, prepared.size.height);

    const pngBlob = await canvasToPngBlob(canvas);
    pngUrl = URL.createObjectURL(pngBlob);
    link = document.createElement("a");
    link.href = pngUrl;
    link.download = normalizeFilename(filename);
    document.body.appendChild(link);
    link.click();
  } finally {
    if (link) link.remove();
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    }
    if (pngUrl) URL.revokeObjectURL(pngUrl);
  }
}
