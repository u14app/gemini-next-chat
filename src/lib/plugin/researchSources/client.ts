import type { Source, ToolCall } from "@/types";
import { createEvidenceSource } from "@/lib/agent/evidence";
import {
  areResearchQueriesSimilar,
  normalizeResearchQuery,
} from "@/lib/research/orchestration/strategy";
import type { ResearchSearchPolicy } from "@/lib/research/searchPolicy";
import type { BuiltinResearchQueryBudget } from "@/services/api/chat/builtinTools/types";
import {
  getResearchSourceOperation,
  isResearchSourceProvider,
  type ResearchSourceProvider,
} from "./catalog";
import type { ResearchSourceResult } from "./types";

const DOMAINS: Record<ResearchSourceProvider, string> = {
  arxiv: "arxiv.org",
  pubmed: "pubmed.ncbi.nlm.nih.gov",
  "epo-ops": "worldwide.espacenet.com",
  "sec-edgar": "www.sec.gov",
};
const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message, recoverable: true },
});
const withinDomain = (host: string, parent: string) =>
  host === parent || host.endsWith(`.${parent}`);
export function isAllowedSpecializedDocument(
  url: string,
  publishedAt: string | undefined,
  policy?: ResearchSearchPolicy,
): boolean {
  if (!policy) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (policy.excludedDomains.some((domain) => withinDomain(host, domain)))
    return false;
  if (
    policy.preferredDomains.length &&
    !policy.preferredDomains.some((domain) => withinDomain(host, domain))
  )
    return false;
  if ((policy.dateFrom || policy.dateTo) && !publishedAt) return false;
  return (
    (!policy.dateFrom || publishedAt! >= policy.dateFrom) &&
    (!policy.dateTo || publishedAt! <= policy.dateTo)
  );
}
/** Called before dispatch. Budget reservations are synchronous across tool batches. */
export function prepareSpecializedSourceCall(
  provider: ResearchSourceProvider,
  operation: "search" | "read",
  args: Record<string, unknown>,
  budget?: BuiltinResearchQueryBudget,
):
  | { args: Record<string, unknown>; queryKey?: string }
  | { error: ReturnType<typeof failure> } {
  const policy = budget?.searchPolicy;
  if (
    policy &&
    !isAllowedSpecializedDocument(
      `https://${DOMAINS[provider]}`,
      policy.dateFrom ?? policy.dateTo,
      policy,
    )
  )
    return {
      error: failure(
        "RESEARCH_SOURCE_SCOPE_DENIED",
        "This source is outside the approved domain scope.",
      ),
    };
  if (operation === "read") return { args };
  const from = [
    policy?.dateFrom,
    typeof args.dateFrom === "string" ? args.dateFrom : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const to = [
    policy?.dateTo,
    typeof args.dateTo === "string" ? args.dateTo : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  if (from && to && from > to)
    return {
      error: failure(
        "RESEARCH_SOURCE_SCOPE_DENIED",
        "The requested date range is outside the approved scope.",
      ),
    };
  const queryKey = `${provider}:${normalizeResearchQuery(String(args.query ?? ""))}:${from ?? ""}:${to ?? ""}:${String(args.form ?? "")}`;
  if (budget) {
    if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt)
      return {
        error: failure(
          "RESEARCH_RECON_TIMEOUT",
          "The approved search deadline has elapsed.",
        ),
      };
    if (budget.remainingQueries <= 0)
      return {
        error: failure(
          "RESEARCH_QUERY_BUDGET_EXHAUSTED",
          "The approved research query budget is exhausted.",
        ),
      };
    if (
      [...(budget.seenQueries ?? [])].some((q) =>
        areResearchQueriesSimilar(q, queryKey),
      )
    )
      return {
        error: failure(
          "RESEARCH_QUERY_DUPLICATE",
          "This source query was already executed in the run.",
        ),
      };
    budget.remainingQueries--;
    budget.seenQueries?.add(queryKey);
    budget.onQueriesExecuted?.([queryKey]);
  }
  return {
    args: {
      ...args,
      limit: Math.min(
        typeof args.limit === "number" ? args.limit : 5,
        budget?.maxResultsPerQuery ?? 20,
      ),
      ...(from ? { dateFrom: from } : {}),
      ...(to ? { dateTo: to } : {}),
    },
    queryKey,
  };
}
export async function normalizeSpecializedSourceResult(
  value: unknown,
  provider: ResearchSourceProvider,
  operation: "search" | "read",
  policy?: ResearchSearchPolicy,
): Promise<unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { ok?: unknown }).ok === false
  )
    return value;
  const result = value as ResearchSourceResult;
  if (
    result.provider !== provider ||
    result.operation !== operation ||
    !Array.isArray(result.documents)
  )
    return failure(
      "SOURCE_RESPONSE_INVALID",
      "Source returned an invalid document collection.",
    );
  const sources: Source[] = [];
  for (const item of result.documents.slice(0, 20)) {
    if (
      !item ||
      typeof item.url !== "string" ||
      typeof item.title !== "string" ||
      typeof item.content !== "string" ||
      !isAllowedSpecializedDocument(item.url, item.publishedAt, policy)
    )
      continue;
    sources.push(
      await createEvidenceSource(
        {
          title: item.title,
          url: item.url,
          content: item.content,
          metadata: {
            provider,
            documentId: item.id,
            publishedAt: item.publishedAt,
            coverage: item.coverage,
            truncated: item.truncated,
            missing: item.missing,
          },
        },
        { kind: operation === "search" ? "search" : "fetch" },
      ),
    );
  }
  if (operation === "read" && !sources.length)
    return failure(
      "RESEARCH_SOURCE_SCOPE_DENIED",
      "The document is unavailable or outside the approved date and domain scope.",
    );
  return {
    ...result,
    documents: result.documents.filter((item) =>
      sources.some((source) => source.url === item.url),
    ),
    sources,
  };
}
export function getSpecializedCallLocator(
  pluginId: string,
  args: Record<string, unknown>,
): string {
  return `plugin://${encodeURIComponent(pluginId)}/document/${encodeURIComponent(String(args.id ?? "unknown"))}`;
}
export function getSpecializedCheckpointUsage(calls: readonly ToolCall[]): {
  queries: string[];
  locators: string[];
} {
  const queries: string[] = [];
  const locators: string[] = [];
  for (const call of calls) {
    if (!isResearchSourceProvider(call.pluginId)) continue;
    const operation = getResearchSourceOperation(call.pluginId, call.name);
    if (operation === "read")
      locators.push(getSpecializedCallLocator(call.pluginId, call.args ?? {}));
    else if (operation === "search") {
      const a = call.args ?? {};
      queries.push(
        `${call.pluginId}:${normalizeResearchQuery(String(a.query ?? ""))}:${String(a.dateFrom ?? "")}:${String(a.dateTo ?? "")}:${String(a.form ?? "")}`,
      );
    }
  }
  return { queries, locators };
}
