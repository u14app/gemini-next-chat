import { IMAGE_PREVIEW_LIMITS } from "@/config/limits";
import { getSafeMarkdownImageSrc } from "../security/clientUrl";
import { getRegisteredShareImageSrc } from "../security/shareImageUrl";

export interface PreviewImageInput {
  url: string;
  alt?: string;
  description?: string;
}

export interface NormalizedImagePreview {
  images: PreviewImageInput[];
  currentIndex: number;
}

function trimOptionalText(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxChars);
  return trimmed || undefined;
}

export function normalizeImagePreviewState(
  images: PreviewImageInput[],
  startIndex = 0,
  registeredImageUrls: readonly string[] = [],
): NormalizedImagePreview | null {
  if (!Array.isArray(images) || images.length === 0) return null;

  const requestedIndex = Math.max(0, Math.floor(startIndex));
  const requestedImage = images[requestedIndex];
  const resolveUrl = (url: string | undefined) =>
    getRegisteredShareImageSrc(url, registeredImageUrls) ||
    getSafeMarkdownImageSrc(url);
  const requestedUrl = resolveUrl(requestedImage?.url);
  const normalized: Array<PreviewImageInput & { originalIndex: number }> = [];
  const seen = new Set<string>();

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const safeUrl = resolveUrl(image?.url);
    if (!safeUrl || seen.has(safeUrl)) continue;

    normalized.push({
      url: safeUrl,
      alt: trimOptionalText(image.alt, IMAGE_PREVIEW_LIMITS.maxAltChars),
      description: trimOptionalText(
        image.description,
        IMAGE_PREVIEW_LIMITS.maxDescriptionChars,
      ),
      originalIndex: index,
    });
    seen.add(safeUrl);

    if (normalized.length >= IMAGE_PREVIEW_LIMITS.maxImages) break;
  }

  if (normalized.length === 0) return null;

  let currentIndex = normalized.findIndex(
    (image) => image.originalIndex === requestedIndex,
  );
  if (currentIndex === -1 && requestedUrl) {
    currentIndex = normalized.findIndex((image) => image.url === requestedUrl);
  }
  if (currentIndex === -1) {
    currentIndex = Math.min(requestedIndex, normalized.length - 1);
  }

  return {
    images: normalized.map((image) => ({
      url: image.url,
      alt: image.alt,
      description: image.description,
    })),
    currentIndex,
  };
}
