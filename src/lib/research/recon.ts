import type { ToolCall } from "@/types";

import {
  getSourceDomains,
  getToolResultData,
  getToolResultError,
  isRecord,
} from "./toolCallInsights";
import type { ResearchReconSnapshot } from "./types";

export function buildResearchReconSnapshot({
  enabled,
  providerId,
  startedAt,
  completedAt,
  executedQueries,
  toolCalls,
}: {
  enabled: boolean;
  providerId?: string;
  startedAt: number;
  completedAt: number;
  executedQueries: readonly string[];
  toolCalls: readonly ToolCall[];
}): ResearchReconSnapshot {
  const searchCalls = toolCalls.filter((call) => call.name === "web_search");
  const queries = executedQueries.slice(0, 2).map((query) => {
    const call = searchCalls.find(
      (candidate) =>
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
        : !call || call.status === "error" || error
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
  const completedCount = queries.filter(
    (query) => query.status === "completed",
  ).length;
  const resultCount = queries.reduce(
    (total, query) => total + query.resultCount,
    0,
  );
  return {
    status: !enabled
      ? "unavailable"
      : completedCount === queries.length && completedCount > 0
        ? "completed"
        : "partial",
    sourceFeasibility: completedCount > 0 ? "verified" : "unverified",
    startedAt,
    completedAt,
    timeoutMs: 30_000,
    queryLimit: 2,
    resultsPerQuery: 5,
    usage: {
      queryCount: queries.length,
      resultCount,
      wallTimeMs: Math.max(0, completedAt - startedAt),
    },
    queries,
    ...(providerId ? { providerId } : {}),
  };
}
