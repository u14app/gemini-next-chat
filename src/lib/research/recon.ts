import type { ToolCall } from "@/types";

import {
  getSourceDomains,
  getToolResultData,
  getToolResultError,
  isRecord,
} from "./toolCallInsights";
import type { ResearchReconSnapshot } from "./types";
import { RESEARCH_RECON_LIMITS } from "./orchestration/strategy";

export function buildResearchReconSnapshot({
  enabled,
  requested = true,
  failed = false,
  providerId,
  startedAt,
  completedAt,
  executedQueries,
  knowledgeQueries = [],
  toolCalls,
}: {
  enabled: boolean;
  requested?: boolean;
  failed?: boolean;
  providerId?: string;
  startedAt: number;
  completedAt: number;
  executedQueries: readonly string[];
  knowledgeQueries?: readonly string[];
  toolCalls: readonly ToolCall[];
}): ResearchReconSnapshot {
  const describeQueries = (names: readonly string[], toolName: string) =>
    names.slice(0, 2).map((query) => {
      const call = toolCalls.find(
        (candidate) =>
          candidate.name === toolName &&
          isRecord(candidate.args) &&
          typeof candidate.args.query === "string" &&
          candidate.args.query.trim() === query.trim(),
      );
      const result = call ? getToolResultData(call) : null;
      const error = call ? getToolResultError(call) : null;
      const sources = result?.sources;
      const status =
        typeof error?.code === "string" &&
        error.code.toLowerCase().includes("timeout")
          ? "timed_out"
          : !call || call.status !== "success" || error
            ? "failed"
            : "completed";
      return {
        query,
        status,
        resultCount: Array.isArray(sources) ? Math.min(5, sources.length) : 0,
        domains: getSourceDomains(sources),
        ...(error && typeof error.message === "string"
          ? { error: error.message.slice(0, 1_000) }
          : {}),
      } as const;
    });
  const queries = describeQueries(executedQueries, "web_search");
  const knowledge = describeQueries(knowledgeQueries, "search_knowledge").map(
    ({ query, status, resultCount, error }) => ({
      query,
      status,
      resultCount,
      ...(error ? { error } : {}),
    }),
  );
  const allQueries = [...queries, ...knowledge];
  const completedCount = allQueries.filter(
    (query) => query.status === "completed",
  ).length;
  const resultCount = queries.reduce(
    (total, query) => total + query.resultCount,
    0,
  );
  return {
    status: failed
      ? "partial"
      : !requested
        ? "skipped"
        : allQueries.length === 0
          ? enabled
            ? "skipped"
            : "unavailable"
          : completedCount === allQueries.length
            ? "completed"
            : "partial",
    sourceFeasibility: completedCount > 0 ? "verified" : "unverified",
    startedAt,
    completedAt,
    timeoutMs: RESEARCH_RECON_LIMITS.timeoutMs,
    queryLimit: 2,
    resultsPerQuery: 5,
    usage: {
      queryCount: queries.length,
      resultCount,
      wallTimeMs: Math.max(0, completedAt - startedAt),
    },
    queries,
    ...(knowledge.length ? { knowledgeQueries: knowledge } : {}),
    ...(providerId ? { providerId } : {}),
  };
}
