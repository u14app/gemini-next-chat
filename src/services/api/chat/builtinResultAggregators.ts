import type { ImageSource, Source } from "@/types";
import { RAG_LIMITS, SEARCH_RESULT_LIMITS } from "@/config/limits";
import { mergeImages, mergeSources } from "@/lib/chat/searchUpdate";
import type { createMessageOutputBlockBuilder } from "@/lib/chat/messageOutputBlocks";
import type { RagQueryError } from "@/lib/knowledge/retrieveKnowledgeSources";
import type { BuiltinSearchEvent } from "./builtinTools";

type UpsertSearch = ReturnType<
  typeof createMessageOutputBlockBuilder
>["upsertSearch"];

/**
 * Aggregates per-tool-call builtin search events into a single search block.
 * Sources and images merge in call order; the newest error only surfaces when
 * no later call has succeeded.
 */
export function createBuiltinSearchAggregator({
  upsertSearch,
  emitOutputBlocks,
  onSearchStatus,
}: {
  upsertSearch: UpsertSearch;
  emitOutputBlocks: () => void;
  onSearchStatus?: (
    isSearching: boolean,
    results?: { sources: Source[]; images: ImageSource[] },
  ) => void;
}) {
  const states = new Map<
    string,
    {
      order: number;
      phase: BuiltinSearchEvent["phase"];
      sources: Source[];
      images: ImageSource[];
      error?: string;
    }
  >();

  return (toolCallId: string, order: number, event: BuiltinSearchEvent) => {
    const previous = states.get(toolCallId);
    states.set(toolCallId, {
      order,
      phase: event.phase,
      sources:
        event.phase === "complete" ? event.sources : previous?.sources || [],
      images:
        event.phase === "complete" ? event.images : previous?.images || [],
      ...(event.phase === "error" ? { error: event.message } : {}),
    });

    const orderedStates = [...states.values()].sort(
      (left, right) => left.order - right.order,
    );
    const activeBuiltinSearches = orderedStates.filter(
      (state) => state.phase === "start",
    ).length;
    let builtinSearchSources: Source[] = [];
    let builtinSearchImages: ImageSource[] = [];
    for (const state of orderedStates) {
      if (state.phase !== "complete") continue;
      builtinSearchSources = mergeSources(
        builtinSearchSources,
        state.sources,
      ).slice(0, SEARCH_RESULT_LIMITS.maxSources);
      builtinSearchImages = mergeImages(
        builtinSearchImages,
        state.images,
      ).slice(0, SEARCH_RESULT_LIMITS.maxImages);
    }
    const latestSuccessOrder = orderedStates.reduce(
      (latest, state) =>
        state.phase === "complete" ? Math.max(latest, state.order) : latest,
      -1,
    );
    const latestError = orderedStates
      .filter(
        (state) => state.phase === "error" && state.order > latestSuccessOrder,
      )
      .at(-1)?.error;
    const results = {
      sources: builtinSearchSources,
      images: builtinSearchImages,
    };
    upsertSearch({
      isSearching: activeBuiltinSearches > 0,
      ...(latestError ? { error: latestError } : {}),
      results,
    });
    emitOutputBlocks();
    onSearchStatus?.(activeBuiltinSearches > 0, results);
  };
}

/**
 * Aggregates per-tool-call builtin knowledge results, merging sources in call
 * order and surfacing the most recent RAG error.
 */
export function createBuiltinKnowledgeAggregator({
  onKnowledgeSources,
}: {
  onKnowledgeSources?: (sources: Source[], ragError?: RagQueryError) => void;
}) {
  const states = new Map<
    string,
    {
      order: number;
      sources: Source[];
      ragError?: RagQueryError;
    }
  >();

  return (
    toolCallId: string,
    order: number,
    sources: Source[],
    ragError?: RagQueryError,
  ) => {
    states.set(toolCallId, { order, sources, ragError });
    const orderedStates = [...states.values()].sort(
      (left, right) => left.order - right.order,
    );
    let aggregatedSources: Source[] = [];
    for (const state of orderedStates) {
      aggregatedSources = mergeSources(aggregatedSources, state.sources).slice(
        0,
        RAG_LIMITS.maxTopK,
      );
    }
    const latestRagError = orderedStates
      .filter((state) => state.ragError)
      .at(-1)?.ragError;
    onKnowledgeSources?.(aggregatedSources, latestRagError);
  };
}
