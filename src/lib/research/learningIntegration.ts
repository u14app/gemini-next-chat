import {
  applyResearchSourceAssessments,
  calculateResearchCoverage,
  createClaimRecordsFromLearningPackets,
  expandResearchFrontier,
} from "./orchestration";
import type {
  LearningPacket,
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchSourceType,
} from "./types";

function bindEvidenceToLearningPackets(
  evidence: readonly ResearchEvidence[],
  packets: readonly LearningPacket[],
  researchRunId: string,
  now: number = Date.now(),
): ResearchEvidence[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceBySourceId = new Map<string, ResearchEvidence[]>();
  for (const item of evidence) {
    const candidates = evidenceBySourceId.get(item.sourceId) || [];
    candidates.push(item);
    evidenceBySourceId.set(item.sourceId, candidates);
  }
  const latestEvidenceIdForSource = (sourceId: string) =>
    [...(evidenceBySourceId.get(sourceId) || [])]
      .sort((left, right) => {
        const leftUsable =
          left.availability !== "unavailable" && left.freshness !== "stale";
        const rightUsable =
          right.availability !== "unavailable" && right.freshness !== "stale";
        if (leftUsable !== rightUsable) return rightUsable ? 1 : -1;
        return right.retrievedAt - left.retrievedAt;
      })
      .at(0)?.id;
  const bindings = new Map<
    string,
    Map<
      string,
      {
        stepId: string;
        nodeId: string;
        claimIds: string[];
        stances: Set<string>;
      }
    >
  >();
  for (const packet of packets) {
    for (const learning of packet.learnings) {
      const explicitEvidence = learning.evidenceIds.flatMap((evidenceId) => {
        const item = evidenceById.get(evidenceId);
        return item ? [item] : [];
      });
      const representedSourceIds = new Set(
        explicitEvidence.map((item) => item.sourceId),
      );
      const targetEvidenceIds = Array.from(
        new Set([
          ...explicitEvidence.map((item) => item.id),
          ...learning.sourceIds.flatMap((sourceId) => {
            if (representedSourceIds.has(sourceId)) return [];
            const evidenceId = latestEvidenceIdForSource(sourceId);
            return evidenceId ? [evidenceId] : [];
          }),
        ]),
      );
      for (const evidenceId of targetEvidenceIds) {
        const sourceBindings = bindings.get(evidenceId) || new Map();
        const binding = sourceBindings.get(packet.nodeId) || {
          stepId: learning.stepId,
          nodeId: packet.nodeId,
          claimIds: [],
          stances: new Set<string>(),
        };
        binding.claimIds.push(learning.claimId);
        binding.stances.add(learning.stance);
        sourceBindings.set(packet.nodeId, binding);
        bindings.set(evidenceId, sourceBindings);
      }
    }
  }
  return evidence.map((item) => {
    const sourceBindings = bindings.get(item.id);
    if (!sourceBindings) return item;
    const nextRelations = [...sourceBindings.values()].map((binding) => ({
      researchRunId,
      stepId: binding.stepId,
      nodeId: binding.nodeId,
      claimIds: Array.from(new Set(binding.claimIds)),
      stance: binding.stances.has("contradicts")
        ? ("contradicts" as const)
        : binding.stances.has("supports")
          ? ("supports" as const)
          : ("context" as const),
      boundAt: now,
    }));
    const relationByIdentity = new Map(
      (item.relations || []).map((relation) => [
        `${relation.researchRunId}\u0000${relation.nodeId}`,
        relation,
      ]),
    );
    nextRelations.forEach((relation) =>
      relationByIdentity.set(
        `${relation.researchRunId}\u0000${relation.nodeId}`,
        relation,
      ),
    );
    const relations = [...relationByIdentity.values()]
      .sort((left, right) => left.boundAt - right.boundAt)
      .slice(-500);
    const primaryRelation = nextRelations.at(-1)!;
    return {
      ...item,
      stepId: primaryRelation.stepId,
      nodeId: primaryRelation.nodeId,
      claimIds: Array.from(
        new Set([
          ...item.claimIds,
          ...nextRelations.flatMap((r) => r.claimIds),
        ]),
      ).slice(-500),
      stance: primaryRelation.stance,
      relations,
    };
  });
}

export function integrateLearningPackets({
  run,
  plan,
  evidence,
  packets,
  waveId,
  newEvidenceCount,
  expandFrontier,
  allowedSourceTypes,
}: {
  run: ResearchReportRun;
  plan: ResearchPlanVersion;
  evidence: ResearchEvidence[];
  packets: LearningPacket[];
  waveId: string;
  newEvidenceCount: number;
  expandFrontier: boolean;
  allowedSourceTypes: readonly ResearchSourceType[];
}): {
  run: ResearchReportRun;
  evidence: ResearchEvidence[];
  scopeExpansion?: {
    packetIds: string[];
    scheduledFollowUpIds: string[];
    unavailableSourceFollowUpIds: string[];
    duplicateFollowUpIds: string[];
    breadthLimitedFollowUpIds: string[];
    depthLimitedFollowUpIds: string[];
  };
} {
  const beforeVerified = run.claims.filter(
    (claim) => claim.verificationStatus === "verified",
  ).length;
  let nextRun = run;
  const expansionResults: Array<{
    packet: LearningPacket;
    result: ReturnType<typeof expandResearchFrontier>;
  }> = [];
  if (expandFrontier) {
    for (const packet of packets) {
      const result = expandResearchFrontier(nextRun, packet, Date.now(), {
        autoExpandScope: true,
        allowedSourceTypes,
      });
      expansionResults.push({ packet, result });
      nextRun = result.run;
    }
  } else {
    nextRun = {
      ...nextRun,
      learningPackets: [...nextRun.learningPackets, ...packets],
      nodes: nextRun.nodes.map((node) =>
        packets.some((packet) => packet.nodeId === node.id)
          ? {
              ...node,
              status: "completed" as const,
              learningPacketId:
                packets.find((packet) => packet.nodeId === node.id)?.id ||
                node.learningPacketId,
              updatedAt: Date.now(),
            }
          : node,
      ),
      updatedAt: Date.now(),
    };
  }
  let linkedEvidence = bindEvidenceToLearningPackets(evidence, packets, run.id);
  linkedEvidence = applyResearchSourceAssessments(linkedEvidence, packets);
  const generatedClaims = createClaimRecordsFromLearningPackets(
    nextRun.learningPackets,
    linkedEvidence,
  );
  const previousClaims = new Map(run.claims.map((claim) => [claim.id, claim]));
  const claims = generatedClaims.map((claim) => ({
    ...claim,
    createdAt: previousClaims.get(claim.id)?.createdAt ?? claim.createdAt,
  }));
  const evidenceBySource = new Map(
    linkedEvidence.map((item) => [item.sourceId, item]),
  );
  const packetByNode = new Map(
    packets.map((packet) => [packet.nodeId, packet]),
  );
  const nodes = nextRun.nodes.map((node) => {
    const packet = packetByNode.get(node.id);
    if (!packet) return node;
    const sourceIds = Array.from(
      new Set(packet.learnings.flatMap((learning) => learning.sourceIds)),
    );
    return {
      ...node,
      sourceIds: Array.from(new Set([...node.sourceIds, ...sourceIds])),
      evidenceIds: Array.from(
        new Set([
          ...node.evidenceIds,
          ...sourceIds.flatMap((sourceId) => {
            const item = evidenceBySource.get(sourceId);
            return item ? [item.id] : [];
          }),
        ]),
      ),
      claimIds: Array.from(
        new Set([
          ...node.claimIds,
          ...packet.learnings.map((learning) => learning.claimId),
        ]),
      ),
    };
  });
  const coverage = calculateResearchCoverage(plan.steps, nodes, claims);
  const afterVerified = claims.filter(
    (claim) => claim.verificationStatus === "verified",
  ).length;
  const completedAt = Date.now();
  const scopeFollowUpIds = new Set(
    packets.flatMap((packet) =>
      packet.followUps
        .filter((followUp) => followUp.scopeImpact !== "within")
        .map((followUp) => followUp.id),
    ),
  );
  const scopePacketIds = packets
    .filter((packet) =>
      packet.followUps.some((followUp) => followUp.scopeImpact !== "within"),
    )
    .map((packet) => packet.id);
  const onlyScopeFollowUps = (ids: readonly string[]) =>
    ids.filter((id) => scopeFollowUpIds.has(id));
  const scopeExpansion = scopeFollowUpIds.size
    ? {
        packetIds: scopePacketIds,
        scheduledFollowUpIds: expansionResults.flatMap(({ result }) =>
          onlyScopeFollowUps(result.scheduledFollowUpIds),
        ),
        unavailableSourceFollowUpIds: expansionResults.flatMap(
          ({ result }) => result.unavailableSourceFollowUpIds,
        ),
        duplicateFollowUpIds: expansionResults.flatMap(({ result }) =>
          onlyScopeFollowUps(result.duplicateFollowUpIds),
        ),
        breadthLimitedFollowUpIds: expandFrontier
          ? expansionResults.flatMap(({ result }) =>
              onlyScopeFollowUps(result.breadthLimitedFollowUpIds),
            )
          : [...scopeFollowUpIds],
        depthLimitedFollowUpIds: expansionResults.flatMap(({ result }) =>
          onlyScopeFollowUps(result.depthLimitedFollowUpIds),
        ),
      }
    : undefined;
  return {
    evidence: linkedEvidence,
    ...(scopeExpansion ? { scopeExpansion } : {}),
    run: {
      ...nextRun,
      nodes,
      claims,
      coverage,
      waves: nextRun.waves.map((wave) =>
        wave.id === waveId
          ? {
              ...wave,
              status: "completed" as const,
              newEvidenceCount,
              newVerifiedClaimCount: Math.max(
                0,
                afterVerified - beforeVerified,
              ),
              completedAt,
            }
          : wave,
      ),
      updatedAt: completedAt,
    },
  };
}
