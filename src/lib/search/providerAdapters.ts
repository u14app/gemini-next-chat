import type { ImageSource, SearchTimeRange, Source } from "@/types";
import { safeFetchJson } from "../security/safeFetch";
import {
  getSearchProviderPolicy,
  type SearchProvider,
} from "../security/searchPolicy";

type SafeFetchJson = typeof safeFetchJson;
type SafeFetchOptions = Parameters<SafeFetchJson>[2];

export interface SearchProviderResult {
  sources: Source[];
  images: ImageSource[];
}

export class SearchProviderError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SearchProviderError";
    this.status = status;
  }
}

interface SearchProviderContext {
  provider: SearchProvider;
  query: string;
  scope?: string;
  timeRange?: SearchTimeRange;
  apiKey?: string;
  baseUrl?: string;
  maxResultNumber: number;
  fetchJson?: SafeFetchJson;
  signal?: AbortSignal;
}

function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  if (!obj) return result;
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key];
    }
  });
  return result;
}

function sort<T>(array: T[], getter: (item: T) => number, desc = false): T[] {
  return [...array].sort((a, b) => {
    const valA = getter(a);
    const valB = getter(b);
    if (valA === valB) return 0;
    const comparison = valA > valB ? 1 : -1;
    return desc ? -comparison : comparison;
  });
}

function buildSearchHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function getFetchOptions(provider: SearchProvider): SafeFetchOptions {
  return {
    policy: getSearchProviderPolicy(provider),
    timeoutMs: 30_000,
    maxResponseBytes: 2 * 1024 * 1024,
  };
}

function assertSearchResponseOk(response: Response, message: string): void {
  if (!response.ok) {
    throw new SearchProviderError(message, response.status);
  }
}

const rewritingPrompt = `You are tasked with re-writing the following text to markdown. Ensure you do not change the meaning or story behind the text. 

**Respond only the updated markdown text, and no additional text before or after.**`;

const FIRECRAWL_TIME_FILTERS: Partial<Record<SearchTimeRange, string>> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

const FIRECRAWL_PUBLIC_SERVICE_URL = "https://api.firecrawl.dev";

function getFirecrawlFailureMessage({
  response,
  data,
  apiKey,
  baseUrl,
}: {
  response: Response;
  data: any;
  apiKey?: string;
  baseUrl?: string;
}): string {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, "").toLowerCase();
  const usesPublicService =
    !normalizedBaseUrl ||
    normalizedBaseUrl === FIRECRAWL_PUBLIC_SERVICE_URL.toLowerCase();
  const upstreamMessage =
    typeof data?.error === "string"
      ? data.error
      : typeof data?.message === "string"
        ? data.message
        : "";

  if (
    response.status === 403 &&
    !apiKey &&
    usesPublicService &&
    /(?:suspicious|without an api key)/i.test(upstreamMessage)
  ) {
    return "Firecrawl public search is unavailable from this network. Add a Firecrawl API key in Search settings or configure a self-hosted Firecrawl Base URL.";
  }

  return "Firecrawl search failed";
}

export async function runSearchProvider({
  provider,
  query,
  scope,
  timeRange,
  apiKey,
  baseUrl,
  maxResultNumber,
  fetchJson = safeFetchJson,
  signal,
}: SearchProviderContext): Promise<SearchProviderResult> {
  const headers = buildSearchHeaders(apiKey);
  const fetchOptions = getFetchOptions(provider);

  if (provider === "tavily") {
    const endpoint = new URL(
      "/search",
      baseUrl || "https://api.tavily.com",
    ).toString();
    const { response, data } = await fetchJson<any>(
      endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: query.replace(/\\/g, "").replace(/"/g, ""),
          search_depth: "advanced",
          topic: scope || "general",
          max_results: maxResultNumber,
          include_images: true,
          include_image_descriptions: true,
          include_answer: false,
          include_raw_content: "markdown",
        }),
        signal,
      },
      fetchOptions,
    );

    assertSearchResponseOk(response, "Tavily search failed");
    const { results = [], images = [] } = data;
    return {
      sources: results
        .filter((item: any) => item.content && item.url)
        .map((result: any) => ({
          title: result.title,
          content: result.rawContent || result.raw_content || result.content,
          url: result.url,
        })),
      images,
    };
  }

  if (provider === "firecrawl") {
    const endpoint = new URL(
      "/v2/search",
      baseUrl || FIRECRAWL_PUBLIC_SERVICE_URL,
    ).toString();
    const { response, data } = await fetchJson<any>(
      endpoint,
      {
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
        signal,
      },
      fetchOptions,
    );

    assertSearchResponseOk(
      response,
      getFirecrawlFailureMessage({ response, data, apiKey, baseUrl }),
    );
    const resultData = data?.data;
    const results = Array.isArray(resultData?.web)
      ? resultData.web
      : Array.isArray(resultData)
        ? resultData
        : [];
    const imageResults = Array.isArray(resultData?.images)
      ? resultData.images
      : [];
    return {
      sources: results
        .filter(
          (item: any) =>
            item.url &&
            (item.markdown || item.description || item.snippet || item.title),
        )
        .map((result: any) => ({
          content:
            result.markdown ||
            result.description ||
            result.snippet ||
            result.title,
          url: result.url,
          title: result.title,
        })),
      images: imageResults
        .filter((item: any) => item.imageUrl)
        .map((result: any) => ({
          url: result.imageUrl,
          ...(result.title ? { description: result.title } : {}),
        })),
    };
  }

  if (provider === "exa") {
    const exaHeaders = { ...headers };
    if (apiKey) {
      exaHeaders["x-api-key"] = apiKey;
      delete exaHeaders.Authorization;
    }

    const endpoint = new URL(
      "/search",
      baseUrl || "https://api.exa.ai",
    ).toString();
    const { response, data } = await fetchJson<any>(
      endpoint,
      {
        method: "POST",
        headers: exaHeaders,
        body: JSON.stringify({
          query,
          category: scope || "research paper",
          contents: {
            text: true,
            summary: {
              query: `Given the following query from the user:\n<query>${query}</query>\n\n${rewritingPrompt}`,
            },
            numResults: maxResultNumber * 5,
            livecrawl: "auto",
            extras: {
              imageLinks: 3,
            },
          },
        }),
        signal,
      },
      fetchOptions,
    );

    assertSearchResponseOk(response, "Exa search failed");
    const { results = [] } = data;
    const images: ImageSource[] = [];

    return {
      sources: results
        .filter((item: any) => (item.summary || item.text) && item.url)
        .map((result: any) => {
          if (result.extras?.imageLinks?.length > 0) {
            result.extras.imageLinks.forEach((url: string) => {
              images.push({ url, description: result.text });
            });
          }
          return {
            content: result.summary || result.text,
            url: result.url,
            title: result.title,
          };
        }),
      images,
    };
  }

  if (provider === "bocha") {
    const endpoint = new URL(
      "/v1/web-search",
      baseUrl || "https://api.bochaai.com",
    ).toString();
    const { response, data } = await fetchJson<any>(
      endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          freshness: "noLimit",
          summary: true,
          count: maxResultNumber,
        }),
        signal,
      },
      fetchOptions,
    );

    assertSearchResponseOk(response, "Bocha search failed");
    const bochaData = data.data || {};
    const results = bochaData.webPages?.value || [];
    const imageResults = bochaData.images?.value || [];

    return {
      sources: results
        .filter((item: any) => item.snippet && item.url)
        .map((result: any) => ({
          content: result.summary || result.snippet,
          url: result.url,
          title: result.name,
        })),
      images: imageResults.map((item: any) => {
        const matchingResult = results.find(
          (result: any) => result.url === item.hostPageUrl,
        );
        return {
          url: item.contentUrl,
          description: item.name || matchingResult?.name,
        };
      }),
    };
  }

  if (provider === "searxng") {
    const params: Record<string, string> = {
      q: query,
      categories: scope === "academic" ? "science,images" : "general,images",
      engines:
        scope === "academic"
          ? "arxiv,google scholar,pubmed,wikispecies,google_images"
          : "google,bing,duckduckgo,brave,wikipedia,bing_images,google_images",
      lang: "auto",
      format: "json",
    };

    const searchQuery = new URLSearchParams(params);
    const endpoint = new URL(
      `/search?${searchQuery.toString()}`,
      baseUrl || "http://localhost:8080",
    ).toString();
    const { response, data } = await fetchJson<any>(
      endpoint,
      { method: "GET", signal },
      fetchOptions,
    );

    assertSearchResponseOk(response, "SearXNG search failed");
    const results = data.results || [];
    const rearrangedResults = sort(results, (item: any) => item.score, true);

    return {
      sources: rearrangedResults
        .filter(
          (item: any) =>
            (item.content || item.title) && item.url && item.score >= 0.5,
        )
        .slice(0, maxResultNumber * 2)
        .map((result: any) => pick(result, ["title", "content", "url"])),
      images: rearrangedResults
        .filter((item: any) => item.category === "images" && item.score >= 0.5)
        .slice(0, maxResultNumber)
        .map((result: any) => ({
          url: result.img_src,
          description: result.title,
        })),
    };
  }

  return { sources: [], images: [] };
}
