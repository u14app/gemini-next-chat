import type { ToolCall } from "@/types";

import { normalizeResearchQuery } from "./orchestration";
import type { ResearchSourceType } from "./types";

export function getPublisherIdentity(
  locator: string,
  fallback?: string,
): string {
  try {
    const hostname = new URL(locator).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return hostname || fallback || locator;
  } catch {
    return fallback || locator;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getToolResultData(
  toolCall: ToolCall,
): Record<string, unknown> | null {
  const result = toolCall.result;
  if (!isRecord(result)) return null;
  if (result.ok === true && isRecord(result.data)) return result.data;
  return result;
}

export function getToolResultError(
  toolCall: ToolCall,
): Record<string, unknown> | null {
  const result = toolCall.result;
  if (!isRecord(result) || result.ok !== false || !isRecord(result.error)) {
    return null;
  }
  return result.error;
}

export function getResearchQueriesFromToolCalls(
  toolCalls: readonly ToolCall[],
): string[] {
  const queries = toolCalls.flatMap((toolCall) => {
    if (!isRecord(toolCall.args)) return [];
    if (
      toolCall.name === "web_search" &&
      typeof toolCall.args.query === "string"
    ) {
      return [toolCall.args.query];
    }
    if (
      toolCall.name === "search_web" &&
      Array.isArray(toolCall.args.queries)
    ) {
      return toolCall.args.queries.filter(
        (query): query is string => typeof query === "string",
      );
    }
    return [];
  });
  return Array.from(
    new Map(
      queries
        .map((query) => query.trim())
        .filter(Boolean)
        .map((query) => [normalizeResearchQuery(query), query] as const),
    ).values(),
  );
}

export function getResearchSourceLocatorsFromToolCalls(
  toolCalls: readonly ToolCall[],
): string[] {
  return Array.from(
    new Set(
      toolCalls.flatMap((toolCall) => {
        if (!isRecord(toolCall.args)) return [];
        if (
          toolCall.name === "fetch_url" &&
          typeof toolCall.args.url === "string"
        ) {
          return [toolCall.args.url];
        }
        if (
          toolCall.name === "fetch_urls" &&
          Array.isArray(toolCall.args.urls)
        ) {
          return toolCall.args.urls.filter(
            (url): url is string => typeof url === "string",
          );
        }
        return [];
      }),
    ),
  );
}

export function getSourceDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.flatMap((item) => {
        if (!isRecord(item) || typeof item.url !== "string") return [];
        try {
          return [new URL(item.url).hostname.toLowerCase()];
        } catch {
          return [];
        }
      }),
    ),
  );
}

export function inferEvidenceSourceType(
  toolName: string | undefined,
  pluginId: string | undefined,
  locator: string,
): ResearchSourceType {
  if (toolName === "search_knowledge") return "knowledge";
  if (toolName?.includes("attachment")) return "attachment";
  if (toolName?.includes("workspace")) return "workspace";
  if (toolName?.includes("mcp") || locator.startsWith("mcp://")) return "mcp";
  if (pluginId) return "plugin";
  return "web";
}
