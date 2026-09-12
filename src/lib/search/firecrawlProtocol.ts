import type {
  ImageSource,
  SearchServiceConfig,
  SearchTimeRange,
  Source,
} from "./types";

export const FIRECRAWL_PUBLIC_SERVICE_URL = "https://api.firecrawl.dev";

const FIRECRAWL_TIME_FILTERS: Partial<Record<SearchTimeRange, string>> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

export interface FirecrawlSearchRequest {
  url: string;
  init: Pick<RequestInit, "method" | "headers" | "body">;
}

export function isPublicFirecrawlBaseUrl(baseUrl?: string): boolean {
  const normalized = baseUrl?.trim().replace(/\/+$/, "").toLowerCase();
  return (
    !normalized || normalized === FIRECRAWL_PUBLIC_SERVICE_URL.toLowerCase()
  );
}

export function canUsePublicFirecrawlDirectly(
  config: SearchServiceConfig,
): boolean {
  return (
    !config.apiKey?.trim() &&
    !config.apiKeySecret &&
    isPublicFirecrawlBaseUrl(config.baseUrl)
  );
}

export function buildFirecrawlSearchRequest({
  query,
  maxResultNumber,
  timeRange,
  apiKey,
  baseUrl,
}: {
  query: string;
  maxResultNumber: number;
  timeRange?: SearchTimeRange;
  apiKey?: string;
  baseUrl?: string;
}): FirecrawlSearchRequest {
  const endpoint = new URL(
    "/v2/search",
    baseUrl || FIRECRAWL_PUBLIC_SERVICE_URL,
  ).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  return {
    url: endpoint,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        limit: maxResultNumber,
        sources: ["web", "images"],
        ...(timeRange && FIRECRAWL_TIME_FILTERS[timeRange]
          ? { tbs: FIRECRAWL_TIME_FILTERS[timeRange] }
          : {}),
        scrapeOptions: {
          formats: [{ type: "markdown" }],
        },
        timeout: 25_000,
      }),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function mapFirecrawlSearchResponse(data: unknown): {
  sources: Source[];
  images: ImageSource[];
} {
  const resultData = asRecord(data)?.data;
  const resultRecord = asRecord(resultData);
  const results = Array.isArray(resultRecord?.web)
    ? resultRecord.web
    : Array.isArray(resultData)
      ? resultData
      : [];
  const imageResults = Array.isArray(resultRecord?.images)
    ? resultRecord.images
    : [];

  return {
    sources: results
      .map((item) => asRecord(item))
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item?.url) &&
          Boolean(
            item?.markdown || item?.description || item?.snippet || item?.title,
          ),
      )
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        content: String(
          item.markdown || item.description || item.snippet || item.title,
        ),
        url: String(item.url),
      })),
    images: imageResults
      .map((item) => asRecord(item))
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item?.imageUrl === "string" && Boolean(item.imageUrl),
      )
      .map((item) => ({
        url: String(item.imageUrl),
        ...(typeof item.title === "string" ? { description: item.title } : {}),
        ...(item.sourceUrl || item.hostPageUrl || item.url
          ? {
              sourceUrl: String(item.sourceUrl || item.hostPageUrl || item.url),
            }
          : {}),
      })),
  };
}
