import { SEARCH_CONFIG_LIMITS, SEARCH_RESULT_LIMITS } from "@/config/limits";
import {
  normalizeImageSources,
  normalizeSearchSources,
} from "@/lib/search/results";
import { getToolArgumentSensitivity } from "@/lib/plugin/risk";
import { createEvidenceSource } from "@/lib/agent/evidence";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { createSearchProvider } from "@/services/api/searchService";
import type { SearchTimeRange } from "@/types";

import type { BuiltinResearchQueryBudget, BuiltinToolBinding } from "./types";

const WEB_SEARCH_QUERY_MAX_CHARS = 4_000;

interface ResearchSearchBindingOptions {
  queryBudget?: BuiltinResearchQueryBudget;
}

function consumeResearchQueries(
  budget: BuiltinResearchQueryBudget | undefined,
  queries: string[],
): "ok" | "exhausted" | "duplicate" | "timed_out" {
  if (!budget) return "ok";
  if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt) {
    return "timed_out";
  }
  const normalized = queries.map((query) =>
    query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
  );
  const unique = new Set(normalized);
  if (
    unique.size !== normalized.length ||
    normalized.some((query) => budget.seenQueries?.has(query))
  ) {
    return "duplicate";
  }
  if (queries.length > budget.remainingQueries) return "exhausted";
  budget.remainingQueries -= queries.length;
  normalized.forEach((query) => budget.seenQueries?.add(query));
  budget.onQueriesExecuted?.([...queries]);
  return "ok";
}

function queryBudgetError(
  result: Exclude<ReturnType<typeof consumeResearchQueries>, "ok">,
) {
  if (result === "duplicate") {
    return errorResult(
      "RESEARCH_QUERY_DUPLICATE",
      "The normalized research query was already executed in this run.",
    );
  }
  if (result === "timed_out") {
    return errorResult(
      "RESEARCH_RECON_TIMEOUT",
      "The pre-approval reconnaissance deadline has elapsed.",
    );
  }
  return errorResult(
    "RESEARCH_QUERY_BUDGET_EXHAUSTED",
    "The approved research query budget is exhausted.",
  );
}

function createQuerySignal(
  parentSignal: AbortSignal | undefined,
  deadlineAt: number | undefined,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (deadlineAt === undefined) {
    return { signal: parentSignal, cleanup: () => undefined };
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeoutId = setTimeout(
    () =>
      controller.abort(new DOMException("Recon timed out.", "TimeoutError")),
    Math.max(0, deadlineAt - Date.now()),
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function errorResult(code: string, message: string) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      recoverable: true,
    },
  };
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
        const result = await createSearchProvider(
          { query, maxResults },
          querySignal.signal,
        );
        context.signal?.throwIfAborted();
        const sources = await Promise.all(
          normalizeSearchSources(result.sources, {
            maxSources: Math.min(
              maxResults ?? SEARCH_RESULT_LIMITS.maxSources,
              SEARCH_RESULT_LIMITS.maxSources,
            ),
          }).map((source) =>
            createEvidenceSource(source, { kind: "search", query }),
          ),
        );
        const images = normalizeImageSources(
          result.images,
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
          const message = "The pre-approval reconnaissance timed out.";
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
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Web search failed.";
        context.emit.search?.({ phase: "error", message });
        if (error instanceof Error && error.name === "TimeoutError") {
          return errorResult("RESEARCH_RECON_TIMEOUT", message);
        }
        return errorResult("WEB_SEARCH_FAILED", message);
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

function buildFilteredQuery(
  query: string,
  {
    domains,
    language,
    dateFrom,
    dateTo,
  }: {
    domains: string[];
    language?: string;
    dateFrom?: string;
    dateTo?: string;
  },
) {
  const domainFilter = domains.length
    ? ` (${domains.map((domain) => `site:${domain}`).join(" OR ")})`
    : "";
  const dateFilter = [
    dateFrom ? `after:${dateFrom}` : "",
    dateTo ? `before:${dateTo}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const languageFilter = language ? ` language:${language}` : "";
  return `${query}${domainFilter}${dateFilter ? ` ${dateFilter}` : ""}${languageFilter}`.slice(
    0,
    WEB_SEARCH_QUERY_MAX_CHARS,
  );
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
      const budgetResult = consumeResearchQueries(options.queryBudget, queries);
      if (budgetResult !== "ok") return queryBudgetError(budgetResult);
      const domains = readStringList(input.domains, 8, 253).filter((domain) =>
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
          domain,
        ),
      );
      const language =
        typeof input.language === "string" && input.language.trim()
          ? input.language.trim().slice(0, 20)
          : undefined;
      const dateFrom =
        typeof input.date_from === "string" ? input.date_from : undefined;
      const dateTo =
        typeof input.date_to === "string" ? input.date_to : undefined;
      const mode = input.mode === "news" ? "news" : "web";
      const timeRange = ["any", "day", "week", "month", "year"].includes(
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
        const batches = await mapWithConcurrency(queries, 3, async (query) => {
          const effectiveQuery = buildFilteredQuery(query, {
            domains,
            language,
            dateFrom,
            dateTo,
          });
          const result = await createSearchProvider(
            {
              query: effectiveQuery,
              scope: mode === "news" ? "news" : undefined,
              maxResults,
              timeRange,
            },
            querySignal.signal,
          );
          const normalized = normalizeSearchSources(result.sources, {
            maxSources: Math.min(
              maxResults ?? SEARCH_RESULT_LIMITS.maxSources,
              SEARCH_RESULT_LIMITS.maxSources,
            ),
          });
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
              result.images,
              SEARCH_RESULT_LIMITS.maxImages,
            ),
          };
        });
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
          filters: {
            domains,
            language,
            dateFrom,
            dateTo,
            timeRange,
            appliedAs:
              domains.length || language || dateFrom || dateTo
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
          const message = "The pre-approval reconnaissance timed out.";
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
        const message =
          error instanceof Error ? error.message : "Web search failed.";
        context.emit.search?.({ phase: "error", message });
        if (error instanceof Error && error.name === "TimeoutError") {
          return errorResult("RESEARCH_RECON_TIMEOUT", message);
        }
        return errorResult("WEB_SEARCH_FAILED", message);
      } finally {
        querySignal.cleanup();
      }
    },
  };
}
