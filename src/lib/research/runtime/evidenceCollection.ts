import { v7 as uuidv7 } from "uuid";

import type { Source } from "@/types";
import {
  getPublisherIdentity,
  getResearchEvidenceDedupKeys,
  hashText,
  inferEvidenceSourceType,
  type ResearchEvidence,
  type ResearchTask,
} from "@/lib/research";
import { getEvidenceMetadata } from "@/lib/agent";
import { useAgentRunStore } from "@/store/core/agentRunStore";

export async function collectTaskEvidence({
  task,
  runIds,
  webSources,
  knowledgeSources,
  defaultStepId,
  defaultNodeId,
}: {
  task: ResearchTask;
  runIds: string[];
  webSources: Source[];
  knowledgeSources: Source[];
  defaultStepId: string;
  defaultNodeId: string;
}): Promise<{
  evidence: ResearchEvidence[];
  newEvidenceIds: string[];
  searchOnlyCount: number;
}> {
  const runState = useAgentRunStore.getState().runsById;
  const collected: ResearchEvidence[] = [...task.evidence];
  const existingIds = new Set(collected.map((item) => item.id));
  const searchDiscoveryUrls = new Set<string>();
  const evidenceIndexByDedupKey = new Map<string, number>();
  collected.forEach((item, index) => {
    getResearchEvidenceDedupKeys(item).forEach((key) =>
      evidenceIndexByDedupKey.set(key, index),
    );
  });
  const mergeEvidence = (candidate: ResearchEvidence) => {
    const candidateKeys = getResearchEvidenceDedupKeys(candidate);
    const duplicateIndex = candidateKeys.reduce<number | undefined>(
      (found, key) => found ?? evidenceIndexByDedupKey.get(key),
      undefined,
    );
    if (duplicateIndex !== undefined) {
      const previous = collected[duplicateIndex];
      const previousKeys = new Set(getResearchEvidenceDedupKeys(previous));
      const sameLineage = candidateKeys.some(
        (key) =>
          (key.startsWith("locator-content:") ||
            key.startsWith("source-content:")) &&
          previousKeys.has(key),
      );
      collected[duplicateIndex] = {
        ...previous,
        aliasSourceIds: Array.from(
          new Set([
            ...(previous.aliasSourceIds || []),
            ...(candidate.aliasSourceIds || []),
            ...(candidate.sourceId !== previous.sourceId
              ? [candidate.sourceId]
              : []),
          ]),
        ).slice(-500),
        aliasLocators: Array.from(
          new Set([
            ...(previous.aliasLocators || []),
            ...(candidate.aliasLocators || []),
            ...(candidate.locator !== previous.locator
              ? [candidate.locator]
              : []),
          ]),
        ).slice(-500),
        retrievedAt: Math.max(previous.retrievedAt, candidate.retrievedAt),
        freshness: candidate.freshness ?? previous.freshness,
        availability: candidate.availability ?? previous.availability,
        ...(sameLineage && candidate.title ? { title: candidate.title } : {}),
        ...(sameLineage && candidate.toolCallId
          ? { toolCallId: candidate.toolCallId }
          : {}),
        ...(sameLineage && candidate.agentRunId
          ? { agentRunId: candidate.agentRunId }
          : {}),
      };
      getResearchEvidenceDedupKeys(collected[duplicateIndex]).forEach((key) =>
        evidenceIndexByDedupKey.set(key, duplicateIndex),
      );
      return;
    }
    const nextIndex = collected.length;
    collected.push(candidate);
    candidateKeys.forEach((key) => evidenceIndexByDedupKey.set(key, nextIndex));
  };
  for (const runId of runIds) {
    const run = runState[runId];
    if (!run) continue;
    const executions = new Map(
      run.toolExecutions.map((execution) => [execution.callId, execution]),
    );
    for (const record of run.evidence) {
      if (record.retrievalKind === "search") {
        searchDiscoveryUrls.add(record.url);
        continue;
      }
      const execution = executions.get(record.toolCallId);
      const sourceType = inferEvidenceSourceType(
        execution?.toolName,
        execution?.pluginId,
        record.url,
      );
      mergeEvidence({
        id: uuidv7(),
        sourceId: record.sourceId,
        sourceType,
        ...(record.title ? { title: record.title } : {}),
        stepId: defaultStepId,
        nodeId: defaultNodeId,
        locator: record.url,
        retrievedAt: record.retrievedAt,
        contentHash: record.contentHash,
        ...(sourceType === "web" ||
        sourceType === "plugin" ||
        sourceType === "mcp"
          ? {
              publisherId: getPublisherIdentity(
                record.url,
                execution?.pluginId,
              ),
            }
          : {}),
        authority: "unknown",
        toolCallId: record.toolCallId,
        agentRunId: runId,
        claimIds: [],
        stance: "context",
        freshness: record.url.startsWith("http") ? "current" : "unknown",
        availability: "available",
      });
    }
  }
  for (const [sourceType, sources] of [
    ["web", webSources],
    ["knowledge", knowledgeSources],
  ] as const) {
    for (const source of sources) {
      if (!source.url) continue;
      const metadata = getEvidenceMetadata(source);
      if (metadata?.retrievalKind === "search") {
        searchDiscoveryUrls.add(source.url);
        continue;
      }
      const contentHash = await hashText(`${source.url}\n${source.content}`);
      const sourceId =
        metadata?.sourceId ||
        `source-${contentHash.replace(/^[^:]+:/, "").slice(0, 20)}`;
      mergeEvidence({
        id: uuidv7(),
        sourceId,
        sourceType,
        title: source.title,
        stepId: defaultStepId,
        nodeId: defaultNodeId,
        locator: source.url,
        retrievedAt: Date.now(),
        contentHash,
        ...(sourceType === "web"
          ? { publisherId: getPublisherIdentity(source.url) }
          : {}),
        authority: "unknown",
        claimIds: [],
        stance: "context",
        freshness: sourceType === "web" ? "current" : "unknown",
        availability: "available",
      });
    }
  }
  const formalLocators = new Set(
    collected.flatMap((item) => [item.locator, ...(item.aliasLocators || [])]),
  );
  return {
    evidence: collected.slice(0, 2_000),
    newEvidenceIds: collected
      .filter((item) => !existingIds.has(item.id))
      .map((item) => item.id),
    searchOnlyCount: [...searchDiscoveryUrls].filter(
      (url) => !formalLocators.has(url),
    ).length,
  };
}
