import type { ImageSource } from "@/lib/search/types";
import { normalizeImageSources } from "@/lib/search/results";

import { canonicalizeResearchLocator } from "./evidence";
import type { ResearchImageSource } from "./types/images";

function stableImageHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function imageKey(image: Pick<ImageSource, "url">): string {
  return canonicalizeResearchLocator(image.url);
}

export function getResearchImageSourceId(
  image: Pick<ImageSource, "url">,
): string {
  return `research-image-${stableImageHash(imageKey(image))}`;
}

/** Convert provider images into bounded, stable, run-associated records. */
export function normalizeResearchImageSources(
  value: unknown,
  researchRunId: string,
  retrievedAt: number = Date.now(),
): ResearchImageSource[] {
  if (!researchRunId.trim()) return [];
  const images = normalizeImageSources(value);
  const seen = new Set<string>();
  const normalized: ResearchImageSource[] = [];
  for (const item of images) {
    const candidate = item;
    const key = imageKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      ...candidate,
      id: getResearchImageSourceId(candidate),
      retrievedAt,
      researchRunId,
    });
  }
  return normalized;
}

/** Merge images by canonical URL while preserving the first discovery run. */
export function mergeResearchImageSources(
  existing: readonly ResearchImageSource[],
  incoming: readonly ResearchImageSource[],
): ResearchImageSource[] {
  const merged: ResearchImageSource[] = [];
  const indexByKey = new Map<string, number>();
  for (const image of [...existing, ...incoming]) {
    const key = imageKey(image);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...image });
      continue;
    }
    const previous = merged[index];
    merged[index] = {
      ...previous,
      ...(image.description ? { description: image.description } : {}),
      ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
      retrievedAt: Math.max(previous.retrievedAt, image.retrievedAt),
    };
  }
  return merged;
}

/**
 * Serialize only the allow-listed image catalog for the closed-book report
 * synthesis pass. The model must use exact URLs from this catalog.
 */
export function formatResearchImageCatalog(
  images: readonly ResearchImageSource[],
): string {
  return JSON.stringify(
    images.map((image) => ({
      id: image.id,
      url: image.url,
      ...(image.description ? { description: image.description } : {}),
      ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
      retrievedAt: image.retrievedAt,
      researchRunId: image.researchRunId,
    })),
  );
}
