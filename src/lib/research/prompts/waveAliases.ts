import type { ResearchEvidence, ResearchReportRun } from "../types";
import type {
  ResearchWaveAliasContext,
  ResearchWaveSourceAlias,
} from "./types";

export const RESEARCH_WAVE_SOURCE_LIMIT = 80;
export const RESEARCH_WAVE_SOURCE_KEY_PATTERN = /^S(?:[1-9]|[1-7][0-9]|80)$/;

export function createResearchWaveAliasContext({
  run,
  nodeIds,
  evidence,
  preferredEvidenceIds = [],
}: {
  run: ResearchReportRun;
  nodeIds: readonly string[];
  evidence: readonly ResearchEvidence[];
  preferredEvidenceIds?: readonly string[];
}): ResearchWaveAliasContext {
  const selectedNodeIds = new Set(nodeIds);
  const nodes = nodeIds.flatMap((nodeId, index) => {
    const node = run.nodes.find((candidate) => candidate.id === nodeId);
    return node
      ? [
          {
            key: `N${index + 1}`,
            nodeId: node.id,
            stepId: node.stepId,
            objective: node.objective,
          },
        ]
      : [];
  });
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const candidateEvidenceIds = [
    ...preferredEvidenceIds,
    ...run.nodes
      .filter((node) => selectedNodeIds.has(node.id))
      .flatMap((node) => node.evidenceIds),
    ...run.claims
      .filter((claim) =>
        claim.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)),
      )
      .flatMap((claim) => [
        ...claim.supportingEvidenceIds,
        ...claim.contradictingEvidenceIds,
      ]),
    ...evidence
      .filter((item) => selectedNodeIds.has(item.nodeId))
      .map((item) => item.id),
  ];
  const sourceById = new Map<
    string,
    ResearchWaveSourceAlias & {
      evidenceIds: string[];
      aliasSourceIds: string[];
    }
  >();
  for (const evidenceId of candidateEvidenceIds) {
    const item = evidenceById.get(evidenceId);
    if (!item) continue;
    const existing = sourceById.get(item.sourceId);
    if (existing) {
      if (!existing.evidenceIds.includes(item.id)) {
        existing.evidenceIds.push(item.id);
      }
      existing.aliasSourceIds = Array.from(
        new Set([...existing.aliasSourceIds, ...(item.aliasSourceIds || [])]),
      );
      continue;
    }
    if (sourceById.size >= RESEARCH_WAVE_SOURCE_LIMIT) continue;
    sourceById.set(item.sourceId, {
      key: `S${sourceById.size + 1}`,
      sourceId: item.sourceId,
      aliasSourceIds: [...(item.aliasSourceIds || [])],
      evidenceIds: [item.id],
      title: item.title,
      locator: item.locator,
      sourceType: item.sourceType,
      retrievedAt: item.retrievedAt,
    });
  }
  return Object.freeze({
    nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
    sources: Object.freeze(
      Array.from(sourceById.values(), (source) =>
        Object.freeze({
          ...source,
          evidenceIds: Object.freeze(source.evidenceIds),
          aliasSourceIds: Object.freeze(source.aliasSourceIds),
        }),
      ),
    ),
  });
}

/** Only exact, unambiguous identities in this wave's frozen index may resolve. */
export function createResearchWaveSourceReferenceResolver(
  sources: ResearchWaveAliasContext["sources"],
) {
  const sourceKeys = new Set(sources.map((source) => source.key));
  const keysByReference = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const reference of [
      source.key,
      source.sourceId,
      ...source.evidenceIds,
      ...(source.aliasSourceIds || []),
    ]) {
      const keys = keysByReference.get(reference) || new Set<string>();
      keys.add(source.key);
      keysByReference.set(reference, keys);
    }
  }
  return (reference: string): { key: string } | { error: string } => {
    const trimmed = reference.trim();
    // A missing or malformed short alias must never fall back to an internal ID.
    if (/^s\d+$/i.test(trimmed) && !sourceKeys.has(trimmed)) {
      return { error: "Source alias is not in the current host index." };
    }
    const keys = keysByReference.get(trimmed);
    if (!keys?.size) {
      return { error: "Source reference is not in the current host index." };
    }
    if (keys.size !== 1) {
      return { error: "Source reference matches multiple host sources." };
    }
    return { key: keys.values().next().value! };
  };
}
