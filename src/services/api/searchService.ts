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
