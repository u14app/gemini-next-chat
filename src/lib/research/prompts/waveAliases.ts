import type { ResearchEvidence, ResearchReportRun } from "../types";
import type {
  ResearchWaveAliasContext,
  ResearchWaveSourceAlias,
} from "./types";

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
  const sourceById = new Map<string, ResearchWaveSourceAlias>();
  for (const evidenceId of candidateEvidenceIds) {
    const item = evidenceById.get(evidenceId);
    if (!item) continue;
    const existing = sourceById.get(item.sourceId);
    if (existing) {
      if (!existing.evidenceIds.includes(item.id)) {
        existing.evidenceIds.push(item.id);
      }
      continue;
    }
    if (sourceById.size >= 80) continue;
    sourceById.set(item.sourceId, {
      key: `S${sourceById.size + 1}`,
      sourceId: item.sourceId,
      evidenceIds: [item.id],
      title: item.title,
      locator: item.locator,
      sourceType: item.sourceType,
      retrievedAt: item.retrievedAt,
    });
  }
  return { nodes, sources: Array.from(sourceById.values()) };
}
