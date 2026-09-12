import type { ImageSource, SearchTimeRange, Source } from "@/types";
import { safeFetchText, type safeFetchJson } from "../security/safeFetch";
import { parseSearchRetryAfter, SearchRequestError } from "./errors";
import {
  RESEARCH_SEARCH_LIMITS,
  type SearchRequestProfile,
} from "./requestPolicy";
import {
  getSearchProviderPolicy,
  type SearchProvider,
} from "../security/searchPolicy";
import {
  buildFirecrawlSearchRequest,
  isPublicFirecrawlBaseUrl,
  mapFirecrawlSearchResponse,
} from "./firecrawlProtocol";

type SafeFetchJson = typeof safeFetchJson;
type SafeFetchOptions = Parameters<SafeFetchJson>[2];

export interface SearchProviderResult {
  sources: Source[];
  images: ImageSource[];
}

export class SearchProviderError extends SearchRequestError {
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(
      message,
      status,
      status === 429 ? "SEARCH_RATE_LIMITED" : "SEARCH_UPSTREAM_ERROR",
      "provider",
      retryAfterMs,
    );
    this.name = "SearchProviderError";
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
  profile?: SearchRequestProfile;
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

function getFetchOptions(
  provider: SearchProvider,
  profile?: SearchRequestProfile,
): SafeFetchOptions {
  return {
    policy: getSearchProviderPolicy(provider),
    timeoutMs:
      provider === "tavily" && profile === "research_summary"
        ? RESEARCH_SEARCH_LIMITS.requestTimeoutMs
        : 30_000,
    maxResponseBytes: 2 * 1024 * 1024,
  };
}

function assertSearchResponseOk(response: Response, message: string): void {
  if (!response.ok) {
    throw new SearchProviderError(
      message,
      response.status,
      parseSearchRetryAfter(response.headers.get("Retry-After")),
    );
  }
}

// Gateways commonly return HTML for 504. Keep its HTTP status on parse failure,
// while retaining JSON error bodies used by provider-specific diagnostics.
const fetchSearchJson: SafeFetchJson = async <T>(
  input: string | URL,
  init?: RequestInit,
  options?: SafeFetchOptions,
) => {
  const { response, text, url } = await safeFetchText(input, init, options);
  try {
    return { response, data: JSON.parse(text) as T, url };
  } catch {
    if (!response.ok) return { response, data: {} as T, url };
    throw new Error("Expected a JSON response from upstream service");
  }
};

const rewritingPrompt = `You are tasked with re-writing the following text to markdown. Ensure you do not change the meaning or story behind the text. 

**Respond only the updated markdown text, and no additional text before or after.**`;

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
  const usesPublicService = isPublicFirecrawlBaseUrl(baseUrl);
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
  fetchJson = fetchSearchJson,
  signal,
  profile,
}: SearchProviderContext): Promise<SearchProviderResult> {
  const headers = buildSearchHeaders(apiKey);
  const fetchOptions = getFetchOptions(provider, profile);

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
          // Research reports can use provider images as illustrative material.
          // Keep descriptions enabled so the synthesis pass can write useful
          // alt text and captions without guessing.
          include_images: true,
          include_image_descriptions: true,
          include_answer: false,
          include_raw_content:
            profile === "research_summary" ? false : "markdown",
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
    const request = buildFirecrawlSearchRequest({
      query,
      maxResultNumber,
      timeRange,
      apiKey,
      baseUrl,
    });
    const { response, data } = await fetchJson<any>(
      request.url,
      {
        ...request.init,
        signal,
      },
      fetchOptions,
    );

    assertSearchResponseOk(
      response,
      getFirecrawlFailureMessage({ response, data, apiKey, baseUrl }),
    );
    return mapFirecrawlSearchResponse(data);
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
              images.push({
                url,
                description: result.text,
                sourceUrl: result.url,
              });
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
          ...(item.hostPageUrl || matchingResult?.url
            ? { sourceUrl: item.hostPageUrl || matchingResult?.url }
            : {}),
        };
      }),
    };
  }

  if (provider === "youcom") {
    const endpoint = new URL(
      "/search",
      baseUrl || "https://api.you.com",
    ).toString();
    
    // Build request body based on You.com API
    const requestBody: Record<string, unknown> = {
      query,
      num_results: maxResultNumber,
      include_domains: scope ? [scope] : undefined,
    };

    // Add time range filter if specified
    if (timeRange && timeRange !== "any") {
      const timeFilters: Record<string, string> = {
        day: "24h",
        week: "7d", 
        month: "30d",
        year: "365d",
      };
      requestBody.time_range = timeFilters[timeRange];
    }

    const { response, data } = await fetchJson<any>(
      endpoint,
      {
        method: "POST",
        headers: apiKey 
          ? {
              ...headers,
              "X-API-Key": apiKey,
              "User-Agent": "neo-chat/(you.com search integration)",
            }
          : {
              "Content-Type": "application/json",
              "User-Agent": "neo-chat/(you.com search integration)",
            },
        body: JSON.stringify(requestBody),
        signal,
      },
      fetchOptions,
    );

    // Handle both authenticated and keyless responses
    if (!response.ok) {
      if (response.status === 402) {
        // Handle x402 payment challenge for keyless mode
        throw new SearchProviderError(
          apiKey 
            ? "You.com search API request failed"
            : "You.com search requires payment for enhanced features. Consider adding an API key for full access.",
          response.status
        );
      }
      throw new SearchProviderError("You.com search failed", response.status);
    }

    const results = data?.results || data?.hits || [];
    const images = data?.images || [];

    return {
      sources: results
        .filter((item: any) => item.url && (item.snippet || item.description) && item.title)
        .map((result: any) => ({
          title: result.title || result.name || "Untitled",
          content: result.snippet || result.description || result.title || "",
          url: result.url,
        })),
      images: images
        .filter((item: any) => item.url || item.image_url)
        .map((image: any) => ({
          url: image.url || image.image_url,
          description: image.title || image.description || image.alt_text,
        })),
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
          ...(result.url || result.source_url
            ? { sourceUrl: result.source_url || result.url }
            : {}),
        })),
    };
  }

  return { sources: [], images: [] };
}
