import { Source, ImageSource } from "@/types";
import { useSettingsStore } from "@/store/core/settingsStore";
import { readJsonResponseOrThrow, signedApiFetch } from "@/lib/api/client";
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

export interface SearchOptions {
  query: string;
  scope?: string;
  maxResults?: number;
  timeRange?: import("@/types").SearchTimeRange;
}

export async function createSearchProvider(
  { query, scope, maxResults, timeRange }: SearchOptions,
  signal?: AbortSignal,
) {
  const { search } = useSettingsStore.getState();
  const provider = search.provider;
  if (provider === "google") {
    return { sources: [], images: [] };
  }

  const config = search.configs[provider] || {};
  const configuredResultCount = search.resultsLimit || 5;
  const requestedResultCount =
    typeof maxResults === "number" && Number.isFinite(maxResults)
      ? Math.round(maxResults)
      : configuredResultCount;
  const maxResult = Math.min(
    SEARCH_CONFIG_LIMITS.maxResultsLimit,
    Math.max(SEARCH_CONFIG_LIMITS.minResultsLimit, requestedResultCount),
  );

  try {
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
          timeRange: timeRange || search.timeRange,
          config: await buildSearchRuntimeConfig(provider, config, signal),
          maxResult,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error("Search request failed");
    }

    const data = await readJsonResponseOrThrow<{
      sources?: Source[];
      images?: ImageSource[];
    }>(response, "Search request failed");
    return {
      sources: normalizeSearchSources(data.sources),
      images: normalizeImageSources(data.images),
    };
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
