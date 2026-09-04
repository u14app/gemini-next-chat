import { areResearchQueriesSimilar } from "@/lib/research/orchestration/strategy";
import type { BuiltinResearchQueryBudget } from "./types";

export function consumeResearchQueries(
  budget: BuiltinResearchQueryBudget | undefined,
  queries: string[],
): "ok" | "exhausted" | "duplicate" | "timed_out" | "out_of_scope" {
  if (!budget) return "ok";
  if (
    budget.allowedQueries &&
    queries.some((query) => !budget.allowedQueries!.has(query))
  ) {
    return "out_of_scope";
  }
  if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt) {
    return "timed_out";
  }
  const normalized = queries.map((query) =>
    query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
  );
  for (const [index, query] of normalized.entries()) {
    if (
      normalized
        .slice(0, index)
        .some((candidate) => areResearchQueriesSimilar(query, candidate)) ||
      (budget.seenQueries &&
        [...budget.seenQueries].some((candidate) =>
          areResearchQueriesSimilar(query, candidate),
        ))
    ) {
      return "duplicate";
    }
  }
  if (queries.length > budget.remainingQueries) return "exhausted";
  budget.remainingQueries -= queries.length;
  normalized.forEach((query) => budget.seenQueries?.add(query));
  budget.onQueriesExecuted?.([...queries]);
  return "ok";
}

export function queryBudgetError(
  result: Exclude<ReturnType<typeof consumeResearchQueries>, "ok">,
) {
  if (result === "out_of_scope") {
    return errorResult(
      "RESEARCH_QUERY_NOT_ALLOWED",
      "Only the exact planning queries fixed before knowledge lookup are allowed.",
    );
  }
  if (result === "duplicate") {
    return errorResult(
      "RESEARCH_QUERY_DUPLICATE",
      "The same research intent was already queried in this run.",
    );
  }
  if (result === "timed_out") {
    return errorResult(
      "RESEARCH_RECON_TIMEOUT",
      "The research query deadline has elapsed.",
    );
  }
  return errorResult(
    "RESEARCH_QUERY_BUDGET_EXHAUSTED",
    "The approved research query budget is exhausted.",
  );
}

export function createQuerySignal(
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
  const expire = () =>
    controller.abort(
      new DOMException("Research lookup timed out.", "TimeoutError"),
    );
  const remaining = deadlineAt - Date.now();
  const timeoutId = remaining > 0 ? setTimeout(expire, remaining) : undefined;
  if (remaining <= 0) expire();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

export function errorResult(code: string, message: string) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      recoverable: true,
    },
  };
}
