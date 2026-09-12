import { Source, ImageSource } from "@/types";
import { useSettingsStore } from "@/store/core/settingsStore";
import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import {
  normalizeImageSources,
  normalizeSearchSources,
} from "@/lib/search/results";
import {
  buildFirecrawlSearchRequest,
  canUsePublicFirecrawlDirectly,
  mapFirecrawlSearchResponse,
} from "@/lib/search/firecrawlProtocol";
import {
  buildSearchRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import { logDevError } from "@/lib/utils/devLogger";
import { SEARCH_CONFIG_LIMITS } from "@/config/limits";
import {
  SearchRequestError,
  parseSearchRetryAfter,
  type SearchErrorLocation,
} from "@/lib/search/errors";
import { dispatchResearchSearch } from "./researchSearchDispatcher";

export interface SearchOptions {
  query: string;
  scope?: string;
  maxResults?: number;
  timeRange?: import("@/types").SearchTimeRange;
}

export async function createSearchProvider(
  { query, scope, maxResults, timeRange }: SearchOptions,
  signal?: AbortSignal,
  runtime?: { purpose: "research"; deadlineAt?: number },
) {
  const { search } = useSettingsStore.getState();
  const provider = search.provider;
  if (provider === "google") {
    return { sources: [], images: [] };
  }

  // Freeze the logical configuration before a request waits in the queue.
  // Encryption stays inside the retry factory for public-key refreshes.
  const config = structuredClone(search.configs[provider] || {});
  const useBrowserFirecrawl =
    typeof window !== "undefined" &&
    provider === "firecrawl" &&
    canUsePublicFirecrawlDirectly(config);
  const effectiveTimeRange = timeRange || search.timeRange;
  const configuredResultCount = search.resultsLimit || 5;
  const requestedResultCount =
    typeof maxResults === "number" && Number.isFinite(maxResults)
      ? Math.round(maxResults)
      : configuredResultCount;
  const maxResult = Math.min(
    SEARCH_CONFIG_LIMITS.maxResultsLimit,
    Math.max(SEARCH_CONFIG_LIMITS.minResultsLimit, requestedResultCount),
  );

  const request = async (requestSignal?: AbortSignal) => {
    requestSignal?.throwIfAborted();
    if (useBrowserFirecrawl) {
      const firecrawlRequest = buildFirecrawlSearchRequest({
        query,
        maxResultNumber: maxResult,
        timeRange: effectiveTimeRange,
      });
      let response: Response;
      try {
        response = await fetch(firecrawlRequest.url, {
          ...firecrawlRequest.init,
          signal: requestSignal,
        });
      } catch (error) {
        if (
          requestSignal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        throw new SearchRequestError(
          error instanceof Error
            ? error.message
            : "Firecrawl browser request failed",
          0,
          "SEARCH_NETWORK_ERROR",
          "client",
        );
      }

      if (!response.ok) {
        const details = await response
          .clone()
          .json()
          .catch(() => null);
        throw new SearchRequestError(
          await getResponseErrorMessage(response, "Firecrawl search failed"),
          response.status,
          typeof details?.code === "string"
            ? details.code
            : response.status === 429
              ? "SEARCH_RATE_LIMITED"
              : "SEARCH_HTTP_ERROR",
          "client",
          parseSearchRetryAfter(response.headers.get("Retry-After")),
        );
      }

      let data: unknown;
      try {
        data = await readJsonResponseOrThrow<unknown>(
          response,
          "Firecrawl returned an invalid response",
        );
      } catch (error) {
        throw new SearchRequestError(
          error instanceof Error
            ? error.message
            : "Firecrawl returned an invalid response",
          response.status,
          "SEARCH_INVALID_RESPONSE",
          "client",
        );
      }
      const result = mapFirecrawlSearchResponse(data);
      return {
        sources: normalizeSearchSources(result.sources),
        images: normalizeImageSources(result.images),
      };
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          query,
          scope,
          timeRange: effectiveTimeRange,
          config: await buildSearchRuntimeConfig(
            provider,
            config,
            requestSignal,
          ),
          maxResult,
          ...(runtime ? { profile: "research_summary" } : {}),
        }),
        signal: requestSignal,
      }),
    );

    if (!response.ok) {
      const details = await response
        .clone()
        .json()
        .catch(() => null);
      const location: SearchErrorLocation = [
        "provider",
        "search_transport",
        "search_api",
        "client",
      ].includes(details?.location)
        ? details.location
        : "search_api";
      throw new SearchRequestError(
        await getResponseErrorMessage(response, "Search request failed"),
        response.status,
        typeof details?.code === "string" ? details.code : "SEARCH_HTTP_ERROR",
        location,
        parseSearchRetryAfter(response.headers.get("Retry-After")),
      );
    }

    const data = await readJsonResponseOrThrow<{
      sources?: Source[];
      images?: ImageSource[];
    }>(response, "Search request failed");
    return {
      sources: normalizeSearchSources(data.sources),
      images: normalizeImageSources(data.images),
    };
  };
  try {
    return await (runtime
      ? dispatchResearchSearch(request, {
          signal,
          deadlineAt: runtime.deadlineAt,
        })
      : request(signal));
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    logDevError("Search error:", error);
    throw error;
  }
}
