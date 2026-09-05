import { SEARCH_CONFIG_LIMITS, SEARCH_RESULT_LIMITS } from "@/config/limits";
import {
  normalizeImageSources,
  normalizeSearchSources,
} from "@/lib/search/results";
import { getToolArgumentSensitivity } from "@/lib/plugin/risk";
import {
  normalizeResearchDate,
  normalizeResearchDomain,
  type ResearchSearchPolicy,
} from "@/lib/research/searchPolicy";
import { createEvidenceSource } from "@/lib/agent/evidence";
import {
  mapSettledWithConcurrency,
  mapWithConcurrency,
} from "@/lib/utils/concurrency";
import { describeSearchFailure } from "@/lib/search/errors";
import {
  createSearchProvider,
  type SearchOptions,
} from "@/services/api/searchService";
import type { ImageSource, SearchTimeRange } from "@/types";

import type { BuiltinResearchQueryBudget, BuiltinToolBinding } from "./types";

import {
  consumeResearchQueries,
  queryBudgetError,
  createQuerySignal,
  errorResult,
} from "./researchQueryBudget";

const WEB_SEARCH_QUERY_MAX_CHARS = 4_000;

interface ResearchSearchBindingOptions {
  queryBudget?: BuiltinResearchQueryBudget;
}

function search(
  options: SearchOptions,
  signal: AbortSignal | undefined,
  queryBudget: BuiltinResearchQueryBudget | undefined,
) {
  return queryBudget
    ? createSearchProvider(options, signal, {
        purpose: "research",
        deadlineAt: queryBudget.deadlineAt,
      })
    : createSearchProvider(options, signal);
}

export function createWebSearchBinding(
  options: ResearchSearchBindingOptions = {},
): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the public web with the configured external search provider. Use focused queries and refine them when needed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: WEB_SEARCH_QUERY_MAX_CHARS,
              description: "Focused web search query.",
            },
            max_results: {
              type: "integer",
              minimum: SEARCH_CONFIG_LIMITS.minResultsLimit,
              maximum: SEARCH_CONFIG_LIMITS.maxResultsLimit,
              description: "Maximum number of results to return.",
            },
          },
          required: ["query"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    resolveInvocationPolicy(args, descriptor) {
      return {
        effects: descriptor.effects,
        idempotency: descriptor.idempotency,
        sensitivity: getToolArgumentSensitivity(args),
        origin: descriptor.origin,
      };
    },
    displayKey: "webSearch",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const query =
        typeof input.query === "string"
          ? input.query.trim().slice(0, WEB_SEARCH_QUERY_MAX_CHARS)
          : "";
      if (!query) {
        return errorResult(
          "WEB_SEARCH_INVALID_QUERY",
          "web_search requires a non-empty query.",
        );
      }
      const scopedFilters = applyApprovedSearchPolicy(
        { domains: [] },
        options.queryBudget?.searchPolicy,
      );
      if (!scopedFilters.ok) {
        return errorResult(
          "RESEARCH_SEARCH_SCOPE_CONFLICT",
          "The requested web search conflicts with the approved research scope.",
        );
      }
      const budgetResult = consumeResearchQueries(options.queryBudget, [query]);
      if (budgetResult !== "ok") return queryBudgetError(budgetResult);

      const requestedMax =
        typeof input.max_results === "number" &&
        Number.isFinite(input.max_results)
          ? Math.round(input.max_results)
          : undefined;
      const maxResults =
        requestedMax === undefined
          ? options.queryBudget?.maxResultsPerQuery
          : Math.min(
              options.queryBudget?.maxResultsPerQuery ??
                SEARCH_CONFIG_LIMITS.maxResultsLimit,
              SEARCH_CONFIG_LIMITS.maxResultsLimit,
              Math.max(SEARCH_CONFIG_LIMITS.minResultsLimit, requestedMax),
            );

      context.emit.search?.({ phase: "start" });
      const querySignal = createQuerySignal(
        context.signal,
        options.queryBudget?.deadlineAt,
      );
      try {
        const effectiveQuery = buildFilteredQuery(query, scopedFilters);
        const result = await search(
          { query: effectiveQuery, maxResults },
          querySignal.signal,
          options.queryBudget,
        );
        context.signal?.throwIfAborted();
        const sources = await Promise.all(
          normalizeSearchSources(
            result.sources.filter((source) =>
              isAllowedSearchResult(
                source,
                scopedFilters.domains,
                scopedFilters.excludedDomains,
              ),
            ),
            {
              maxSources: Math.min(
                maxResults ?? SEARCH_RESULT_LIMITS.maxSources,
                SEARCH_RESULT_LIMITS.maxSources,
              ),
            },
          ).map((source) =>
            createEvidenceSource(source, { kind: "search", query }),
          ),
        );
        const images = normalizeImageSources(
          result.images.filter((image: ImageSource) =>
            isAllowedImageResult(
              image,
              scopedFilters.domains,
              scopedFilters.excludedDomains,
            ),
          ),
          Math.min(
            maxResults ?? SEARCH_RESULT_LIMITS.maxImages,
            SEARCH_RESULT_LIMITS.maxImages,
          ),
        );
        context.emit.search?.({ phase: "complete", sources, images });
        return { query, sources, images };
      } catch (error) {
        const timedOut =
          querySignal.signal?.aborted &&
          querySignal.signal.reason instanceof Error &&
          querySignal.signal.reason.name === "TimeoutError";
        if (timedOut) {
          const message = "The research search deadline elapsed.";
          context.emit.search?.({ phase: "error", message });
          return errorResult("RESEARCH_RECON_TIMEOUT", message);
        }
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          context.emit.search?.({ phase: "cancel" });
          if (context.signal?.aborted) context.signal.throwIfAborted();
          throw error;
        }
        const failure = describeSearchFailure(error);
        context.emit.search?.({ phase: "error", message: failure.message });
        return { ok: false, error: failure };
      } finally {
        querySignal.cleanup();
      }
    },
  };
}

function readStringList(value: unknown, maxItems: number, maxChars: number) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxChars))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

function isSameOrSubdomain(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

function isAllowedSearchResult(
  source: { url?: string },
  domains: readonly string[],
  excludedDomains: readonly string[],
): boolean {
  if (domains.length === 0 && excludedDomains.length === 0) return true;
  if (!source.url) return false;
  try {
    const hostname = new URL(source.url).hostname.toLowerCase();
    if (
      excludedDomains.some((excluded) => isSameOrSubdomain(hostname, excluded))
    ) {
      return false;
    }
    return (
      domains.length === 0 ||
      domains.some((domain) => isSameOrSubdomain(hostname, domain))
    );
  } catch {
    return false;
  }
}

function isAllowedImageResult(
  image: Pick<ImageSource, "url" | "sourceUrl">,
  domains: readonly string[],
  excludedDomains: readonly string[],
): boolean {
  if (domains.length === 0 && excludedDomains.length === 0) return true;
  // Prefer the provider's source page when available; otherwise apply the
  // approved domain policy to the image host itself. This keeps providers
  // that omit page provenance usable without allowing a known out-of-scope
  // source page to be hidden behind an in-scope CDN URL.
  return Boolean(
    isAllowedSearchResult(
      { url: image.sourceUrl || image.url },
      domains,
      excludedDomains,
    ),
  );
}

function applyApprovedSearchPolicy(
  requested: {
    domains: string[];
    dateFrom?: string;
    dateTo?: string;
  },
  policy: ResearchSearchPolicy | undefined,
):
  | {
      ok: true;
      domains: string[];
      excludedDomains: string[];
      dateFrom?: string;
      dateTo?: string;
    }
  | { ok: false } {
  if (!policy) {
    return { ok: true, ...requested, excludedDomains: [] };
  }
  const requestedDomains = requested.domains.flatMap((value) => {
    const domain = normalizeResearchDomain(value);
    return domain ? [domain] : [];
  });
  const domains = (
    policy.preferredDomains.length > 0
      ? requestedDomains.length > 0
        ? requestedDomains.filter((domain) =>
            policy.preferredDomains.some((preferred) =>
              isSameOrSubdomain(domain, preferred),
            ),
          )
        : policy.preferredDomains
      : requestedDomains
  ).filter(
    (domain) =>
      !policy.excludedDomains.some((excluded) =>
        isSameOrSubdomain(domain, excluded),
      ),
  );
  if (policy.preferredDomains.length > 0 && domains.length === 0) {
    return { ok: false };
  }
  const dateFrom =
    policy.dateFrom && requested.dateFrom
      ? policy.dateFrom > requested.dateFrom
        ? policy.dateFrom
        : requested.dateFrom
      : policy.dateFrom || requested.dateFrom;
  const dateTo =
    policy.dateTo && requested.dateTo
      ? policy.dateTo < requested.dateTo
        ? policy.dateTo
        : requested.dateTo
      : policy.dateTo || requested.dateTo;
  if (dateFrom && dateTo && dateFrom > dateTo) return { ok: false };
  return {
    ok: true,
    domains: Array.from(new Set(domains)).slice(0, 8),
    excludedDomains: [...policy.excludedDomains],
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
}

function buildFilteredQuery(
  query: string,
  {
    domains,
    excludedDomains,
    language,
    dateFrom,
    dateTo,
  }: {
    domains: string[];
    excludedDomains?: string[];
    language?: string;
    dateFrom?: string;
    dateTo?: string;
  },
) {
  const domainFilter = domains.length
    ? ` (${domains.map((domain) => `site:${domain}`).join(" OR ")})`
    : "";
  const excludedDomainFilter = excludedDomains?.length
    ? ` ${excludedDomains.map((domain) => `-site:${domain}`).join(" ")}`
    : "";
  const dateFilter = [
    dateFrom ? `after:${dateFrom}` : "",
    dateTo ? `before:${dateTo}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const languageFilter = language ? ` language:${language}` : "";
  const filterSuffix = `${domainFilter}${excludedDomainFilter}${dateFilter ? ` ${dateFilter}` : ""}${languageFilter}`;
  const queryLimit = Math.max(
    0,
    WEB_SEARCH_QUERY_MAX_CHARS - filterSuffix.length,
  );
  return `${query.slice(0, queryLimit)}${filterSuffix}`;
}

/** V2 search while retaining web_search as a compatibility alias. */
export function createSearchWebV2Binding(
  options: ResearchSearchBindingOptions = {},
): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "search_web",
        description:
          "Search the public web or news with up to four queries and explicit domain, date, language, and result limits. Returns evidence source IDs, retrieval times, and content hashes.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            queries: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 1_000 },
            },
            mode: { type: "string", enum: ["web", "news"] },
            domains: {
              type: "array",
              maxItems: 8,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 253 },
            },
            language: { type: "string", maxLength: 20 },
            date_from: {
              type: "string",
              pattern: "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$",
            },
            date_to: {
              type: "string",
              pattern: "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$",
            },
            time_range: {
              type: "string",
              enum: ["any", "day", "week", "month", "year"],
            },
            max_results_per_query: {
              type: "integer",
              minimum: SEARCH_CONFIG_LIMITS.minResultsLimit,
              maximum: SEARCH_CONFIG_LIMITS.maxResultsLimit,
            },
          },
          required: ["queries"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    resolveInvocationPolicy(args, descriptor) {
      return {
        effects: descriptor.effects,
        idempotency: descriptor.idempotency,
        sensitivity: getToolArgumentSensitivity(args),
        origin: descriptor.origin,
      };
    },
    displayKey: "searchWebV2",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const queries = readStringList(input.queries, 4, 1_000);
      if (queries.length === 0) {
        return errorResult(
          "WEB_SEARCH_INVALID_QUERY",
          "search_web requires between one and four non-empty queries.",
        );
      }
      const requestedDomains = readStringList(input.domains, 8, 253).filter(
        (domain) => normalizeResearchDomain(domain),
      );
      const language =
        typeof input.language === "string" && input.language.trim()
          ? input.language.trim().slice(0, 20)
          : undefined;
      const requestedDateFrom = normalizeResearchDate(
        typeof input.date_from === "string" ? input.date_from : undefined,
      );
      const requestedDateTo = normalizeResearchDate(
        typeof input.date_to === "string" ? input.date_to : undefined,
      );
      const scopedFilters = applyApprovedSearchPolicy(
        {
          domains: requestedDomains,
          ...(requestedDateFrom ? { dateFrom: requestedDateFrom } : {}),
          ...(requestedDateTo ? { dateTo: requestedDateTo } : {}),
        },
        options.queryBudget?.searchPolicy,
      );
      if (!scopedFilters.ok) {
        return errorResult(
          "RESEARCH_SEARCH_SCOPE_CONFLICT",
          "The requested web search conflicts with the approved research scope.",
        );
      }
      const budgetResult = consumeResearchQueries(options.queryBudget, queries);
      if (budgetResult !== "ok") return queryBudgetError(budgetResult);
      const { domains, excludedDomains, dateFrom, dateTo } = scopedFilters;
      const mode = input.mode === "news" ? "news" : "web";
      const timeRange =
        dateFrom || dateTo
          ? undefined
          : ["any", "day", "week", "month", "year"].includes(
                String(input.time_range),
              )
            ? (input.time_range as SearchTimeRange)
            : undefined;
      const maxResults = Number.isInteger(input.max_results_per_query)
        ? Math.min(
            options.queryBudget?.maxResultsPerQuery ??
              SEARCH_CONFIG_LIMITS.maxResultsLimit,
            SEARCH_CONFIG_LIMITS.maxResultsLimit,
            Math.max(
              SEARCH_CONFIG_LIMITS.minResultsLimit,
              Number(input.max_results_per_query),
            ),
          )
        : options.queryBudget?.maxResultsPerQuery;

      context.emit.search?.({ phase: "start" });
      const querySignal = createQuerySignal(
        context.signal,
        options.queryBudget?.deadlineAt,
      );
      try {
        const runQuery = async (query: string) => {
          const effectiveQuery = buildFilteredQuery(query, {
            domains,
            excludedDomains,
            language,
            dateFrom,
            dateTo,
          });
          const result = await search(
            {
              query: effectiveQuery,
              scope: mode === "news" ? "news" : undefined,
              maxResults,
              timeRange,
            },
            querySignal.signal,
            options.queryBudget,
          );
          const normalized = normalizeSearchSources(
            result.sources.filter((source) =>
              isAllowedSearchResult(source, domains, excludedDomains),
            ),
            {
              maxSources: Math.min(
                maxResults ?? SEARCH_RESULT_LIMITS.maxSources,
                SEARCH_RESULT_LIMITS.maxSources,
              ),
            },
          );
          return {
            query,
            sources: await Promise.all(
              normalized.map((source) =>
                createEvidenceSource(source, {
                  kind: "search",
                  query,
                }),
              ),
            ),
            images: normalizeImageSources(
              result.images.filter((image: ImageSource) =>
                isAllowedImageResult(image, domains, excludedDomains),
              ),
              SEARCH_RESULT_LIMITS.maxImages,
            ),
          };
        };
        const settled = options.queryBudget
          ? await mapSettledWithConcurrency(queries, 4, runQuery)
          : (await mapWithConcurrency(queries, 3, runQuery)).map((value) => ({
              status: "fulfilled" as const,
              value,
            }));
        // A deadline may end a later query after an earlier one succeeded.
        // Preserve those results; explicit user cancellation still aborts all.
        const stageTimedOut =
          options.queryBudget &&
          context.signal?.aborted &&
          context.signal.reason instanceof Error &&
          context.signal.reason.name === "TimeoutError";
        if (!stageTimedOut) context.signal?.throwIfAborted();
        const batches = settled.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const results = settled.map((result, index) =>
          result.status === "fulfilled"
            ? {
                query: queries[index],
                status: "completed" as const,
                sourceCount: result.value.sources.length,
              }
            : {
                query: queries[index],
                status: "failed" as const,
                error: describeSearchFailure(result.reason),
              },
        );
        const failedCount = settled.length - batches.length;
        if (batches.length === 0) {
          const failed = settled.find((result) => result.status === "rejected");
          throw failed?.reason ?? new Error("Web search failed.");
        }
        const sources = [
          ...new Map(
            batches
              .flatMap((batch) => batch.sources)
              .map((source) => [source.url, source] as const),
          ).values(),
        ].slice(0, SEARCH_RESULT_LIMITS.maxSources);
        const images = [
          ...new Map(
            batches
              .flatMap((batch) => batch.images)
              .map((image) => [image.url, image] as const),
          ).values(),
        ].slice(0, SEARCH_RESULT_LIMITS.maxImages);
        context.emit.search?.({ phase: "complete", sources, images });
        return {
          queries,
          mode,
          sources,
          images,
          ...(failedCount > 0 ? { partial: true, failedCount, results } : {}),
          filters: {
            domains,
            excludedDomains,
            language,
            dateFrom,
            dateTo,
            timeRange,
            appliedAs:
              domains.length ||
              excludedDomains.length ||
              language ||
              dateFrom ||
              dateTo
                ? "query_operators"
                : timeRange
                  ? "provider_time_range"
                  : "none",
          },
        };
      } catch (error) {
        const timedOut =
          querySignal.signal?.aborted &&
          querySignal.signal.reason instanceof Error &&
          querySignal.signal.reason.name === "TimeoutError";
        if (timedOut) {
          const message = "The research search deadline elapsed.";
          context.emit.search?.({ phase: "error", message });
          return errorResult("RESEARCH_RECON_TIMEOUT", message);
        }
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          context.emit.search?.({ phase: "cancel" });
          throw error;
        }
        const failure = describeSearchFailure(error);
        context.emit.search?.({ phase: "error", message: failure.message });
        return { ok: false, error: failure };
      } finally {
        querySignal.cleanup();
      }
    },
  };
}
