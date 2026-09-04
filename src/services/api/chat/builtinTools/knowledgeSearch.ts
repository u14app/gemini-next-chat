import { PROMPT_CONTEXT_LIMITS, RAG_LIMITS } from "@/config/limits";
import { createEvidenceSource } from "@/lib/agent/evidence";
import {
  retrieveKnowledgeSources,
  type KnowledgeLexicalIndexCache,
  type RagQueryError,
} from "@/lib/knowledge/retrieveKnowledgeSources";
import {
  isKnowledgeCollectionAttachment,
  isKnowledgeFileAttachment,
  parseKnowledgeFileAttachmentData,
} from "@/lib/utils/knowledgeAttachments";
import type { Attachment, Source } from "@/types";

import {
  consumeBuiltinResearchSourceBodies,
  type BuiltinKnowledgeScope,
  type BuiltinResearchQueryBudget,
  type BuiltinResearchSourceBudget,
  type BuiltinToolBinding,
} from "./types";
import {
  consumeResearchQueries,
  createQuerySignal,
  queryBudgetError,
} from "./researchQueryBudget";

const KNOWLEDGE_QUERY_MAX_CHARS = 4_000;
const MAX_COLLECTION_FILTERS = 20;
const MAX_COLLECTION_ID_CHARS = 120;

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

function normalizeCollectionIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const id = item.trim().slice(0, MAX_COLLECTION_ID_CHARS);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_COLLECTION_FILTERS) break;
  }
  return ids;
}

function filterScopeAttachments(
  scope: BuiltinKnowledgeScope,
  collectionIds: readonly string[],
): Attachment[] {
  if (collectionIds.length === 0) return scope.attachments;
  const allowed = new Set(collectionIds);

  return scope.attachments.filter((attachment) => {
    if (isKnowledgeCollectionAttachment(attachment)) {
      return Boolean(attachment.data && allowed.has(attachment.data));
    }
    if (!isKnowledgeFileAttachment(attachment)) return false;
    const file = parseKnowledgeFileAttachmentData(attachment);
    return Boolean(file && allowed.has(file.collectionId));
  });
}

function normalizeMetadata(
  value: Source["metadata"],
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const metadata: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().slice(0, 100);
    if (!key) continue;
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean" ||
      rawValue === null
    ) {
      metadata[key] =
        typeof rawValue === "string" ? rawValue.slice(0, 1_000) : rawValue;
    } else if (
      Array.isArray(rawValue) &&
      rawValue.every((item) => typeof item === "string")
    ) {
      metadata[key] = rawValue.slice(0, 20).map((item) => item.slice(0, 200));
    }
    if (Object.keys(metadata).length >= 20) break;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function boundKnowledgeSources(sources: readonly Source[]): Source[] {
  return sources.slice(0, RAG_LIMITS.maxTopK).map((source) => {
    const metadata = normalizeMetadata(source.metadata);
    return {
      title: source.title
        .trim()
        .slice(0, PROMPT_CONTEXT_LIMITS.maxSourceTitleChars),
      url: source.url.slice(0, 4_096),
      content: source.content
        .trim()
        .slice(0, PROMPT_CONTEXT_LIMITS.maxSourceContentChars),
      ...(metadata ? { metadata } : {}),
    };
  });
}

function createRagFailure(message: string): RagQueryError {
  return { code: "RAG_QUERY_FAILED", message };
}

export function createKnowledgeSearchBinding({
  sourceBudget,
  queryBudget,
}: {
  sourceBudget?: BuiltinResearchSourceBudget;
  queryBudget?: BuiltinResearchQueryBudget;
} = {}): BuiltinToolBinding {
  const lexicalCache: KnowledgeLexicalIndexCache = new Map();

  return {
    definition: {
      type: "function",
      function: {
        name: "search_knowledge",
        description:
          "Search only the knowledge collections or files selected for this conversation. Refine the query when the first results are insufficient.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: KNOWLEDGE_QUERY_MAX_CHARS,
              description: "Focused query for the selected knowledge scope.",
            },
            collection_ids: {
              type: "array",
              items: {
                type: "string",
                maxLength: MAX_COLLECTION_ID_CHARS,
              },
              maxItems: MAX_COLLECTION_FILTERS,
              description:
                "Optional subset of collection IDs already selected by the user.",
            },
          },
          required: ["query"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "knowledgeSearch",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const query =
        typeof input.query === "string"
          ? input.query.trim().slice(0, KNOWLEDGE_QUERY_MAX_CHARS)
          : "";
      if (!query) {
        return errorResult(
          "KNOWLEDGE_SEARCH_INVALID_QUERY",
          "search_knowledge requires a non-empty query.",
        );
      }

      const collectionIds = normalizeCollectionIds(input.collection_ids);
      if (!collectionIds) {
        return errorResult(
          "KNOWLEDGE_SEARCH_INVALID_SCOPE",
          "collection_ids must be an array of collection IDs.",
        );
      }
      if (!context.knowledgeScope?.attachments.length) {
        return errorResult(
          "KNOWLEDGE_SEARCH_SCOPE_UNAVAILABLE",
          "No knowledge collection or file is selected for this request.",
        );
      }

      const scopeAttachments = filterScopeAttachments(
        context.knowledgeScope,
        collectionIds,
      );
      if (scopeAttachments.length === 0) {
        return errorResult(
          "KNOWLEDGE_SEARCH_SCOPE_UNAVAILABLE",
          "The requested collection_ids are outside the selected knowledge scope.",
        );
      }
      if (sourceBudget && sourceBudget.remainingSourceBodies <= 0) {
        return errorResult(
          "RESEARCH_SOURCE_BUDGET_EXHAUSTED",
          "The approved full-source reading budget is exhausted.",
        );
      }

      const budgetResult = consumeResearchQueries(queryBudget, [query]);
      if (budgetResult !== "ok") return queryBudgetError(budgetResult);
      const querySignal = createQuerySignal(
        context.signal,
        queryBudget?.deadlineAt,
      );
      try {
        const result = await retrieveKnowledgeSources({
          queries: [query],
          scopeAttachments,
          collections: context.knowledgeScope.collections,
          ragConfig: {
            ...context.knowledgeScope.ragConfig,
            ...(queryBudget
              ? {
                  topK: Math.min(
                    context.knowledgeScope.ragConfig.topK ||
                      queryBudget.maxResultsPerQuery,
                    queryBudget.maxResultsPerQuery,
                  ),
                }
              : {}),
          },
          signal: querySignal.signal,
          lexicalCache,
        });
        context.signal?.throwIfAborted();
        querySignal.signal?.throwIfAborted();
        if (sourceBudget && sourceBudget.remainingSourceBodies <= 0) {
          return errorResult(
            "RESEARCH_SOURCE_BUDGET_EXHAUSTED",
            "The approved full-source reading budget is exhausted.",
          );
        }
        const boundedSources = boundKnowledgeSources(result.sources).slice(
          0,
          Math.min(
            sourceBudget?.remainingSourceBodies ?? RAG_LIMITS.maxTopK,
            queryBudget?.maxResultsPerQuery ?? RAG_LIMITS.maxTopK,
          ),
        );
        const sources = await Promise.all(
          boundedSources.map((source, index) =>
            createEvidenceSource(
              {
                ...source,
                url:
                  source.url ||
                  `knowledge://search/${encodeURIComponent(query)}/${index + 1}`,
              },
              {
                kind: "attachment",
                query,
              },
            ),
          ),
        );
        if (
          !consumeBuiltinResearchSourceBodies(
            sourceBudget,
            sources.map((source) => source.url),
          )
        ) {
          return errorResult(
            "RESEARCH_SOURCE_BUDGET_EXHAUSTED",
            "The approved full-source reading budget is exhausted.",
          );
        }
        context.emit.knowledgeSources?.(sources, result.ragError);
        return {
          query,
          sources,
          ...(result.ragError ? { warning: result.ragError } : {}),
        };
      } catch (error) {
        if (
          !context.signal?.aborted &&
          querySignal.signal?.aborted &&
          querySignal.signal.reason instanceof Error &&
          querySignal.signal.reason.name === "TimeoutError"
        ) {
          return errorResult(
            "RESEARCH_RECON_TIMEOUT",
            "The planning knowledge lookup timed out.",
          );
        }
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        const message =
          error instanceof Error && error.message
            ? error.message
            : "The selected knowledge base could not be queried.";
        const ragError = createRagFailure(message);
        context.emit.knowledgeSources?.([], ragError);
        return errorResult("KNOWLEDGE_SEARCH_FAILED", message);
      } finally {
        querySignal.cleanup();
      }
    },
  };
}
