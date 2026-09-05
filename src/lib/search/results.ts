import type { ImageSource, Source } from "@/types";
import { SEARCH_RESULT_LIMITS } from "@/config/limits";
import { getSafeExternalHref, getSafeWebHref } from "../security/clientUrl";
import { getRemoteAttachmentUrlError } from "../security/remoteAttachment";

function trimString(value: unknown, maxChars: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxChars);
  return trimmed || fallback;
}

function normalizeSourceMetadata(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const normalized: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().slice(0, 100);
    if (!key) continue;

    if (typeof rawValue === "string") {
      normalized[key] = rawValue.slice(0, 1_000);
    } else if (
      typeof rawValue === "number" ||
      typeof rawValue === "boolean" ||
      rawValue === null
    ) {
      normalized[key] = rawValue;
    }

    if (Object.keys(normalized).length >= 20) break;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function normalizeSearchSource(
  value: unknown,
  { allowPlaceholderUrl = false }: { allowPlaceholderUrl?: boolean } = {},
): Source | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Partial<Source>;
  const title = trimString(
    raw.title,
    SEARCH_RESULT_LIMITS.maxTitleChars,
    "Untitled source",
  );
  const content = trimString(
    raw.content,
    SEARCH_RESULT_LIMITS.maxContentChars,
    title,
  );
  const rawUrl = trimString(raw.url, SEARCH_RESULT_LIMITS.maxUrlChars);
  const safeUrl =
    getSafeWebHref(rawUrl) ||
    (allowPlaceholderUrl && getSafeExternalHref(rawUrl) === "#" ? "#" : "");

  if (!safeUrl || !content) return null;

  const metadata = normalizeSourceMetadata(raw.metadata);

  return {
    title,
    content,
    url: safeUrl,
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeSearchSources(
  value: unknown,
  options?: { allowPlaceholderUrl?: boolean; maxSources?: number },
): Source[] {
  if (!Array.isArray(value)) return [];

  const maxSources = options?.maxSources ?? SEARCH_RESULT_LIMITS.maxSources;
  const normalized: Source[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const source = normalizeSearchSource(item, options);
    if (!source) continue;

    const key = `${source.url}\n${source.title}\n${source.content.slice(0, 200)}`;
    if (seen.has(key)) continue;

    normalized.push(source);
    seen.add(key);
    if (normalized.length >= maxSources) break;
  }

  return normalized;
}

export function normalizeImageSource(value: unknown): ImageSource | null {
  if (typeof value !== "string" && (!value || typeof value !== "object")) {
    return null;
  }

  const raw = (typeof value === "string" ? {} : value) as Partial<ImageSource> &
    Record<string, unknown>;
  const rawUrl = trimString(
    typeof value === "string" ? value : raw.url,
    SEARCH_RESULT_LIMITS.maxUrlChars,
  );
  if (getRemoteAttachmentUrlError(rawUrl)) return null;
  const url = new URL(rawUrl).toString();

  const description = trimString(
    raw.description,
    SEARCH_RESULT_LIMITS.maxImageDescriptionChars,
  );
  const sourceUrlCandidate =
    typeof raw.sourceUrl === "string"
      ? raw.sourceUrl
      : typeof raw.source_url === "string"
        ? raw.source_url
        : typeof raw.hostPageUrl === "string"
          ? raw.hostPageUrl
          : typeof raw.pageUrl === "string"
            ? raw.pageUrl
            : undefined;
  const sourceUrl = getSafeWebHref(
    trimString(sourceUrlCandidate, SEARCH_RESULT_LIMITS.maxUrlChars),
  );

  return {
    url,
    ...(description ? { description } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function normalizeImageSources(
  value: unknown,
  maxImages: number = SEARCH_RESULT_LIMITS.maxImages,
): ImageSource[] {
  if (!Array.isArray(value)) return [];

  const normalized: ImageSource[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const image = normalizeImageSource(item);
    if (!image || seen.has(image.url)) continue;

    normalized.push(image);
    seen.add(image.url);
    if (normalized.length >= maxImages) break;
  }

  return normalized;
}
