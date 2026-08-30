import type { ResearchTaskViewModel } from "../types";
import type {
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchStopReason,
  ResearchTask,
} from "@/lib/research";

export function getActiveResearchRun(
  task: ResearchTask,
  plan: ResearchPlanVersion | undefined,
): ResearchReportRun | undefined {
  const runs = task.reportRuns ?? [];
  return (
    runs.find((run) => run.id === task.activeReportRunId) ??
    [...runs]
      .reverse()
      .find((run) => !plan || run.planVersion === plan.version) ??
    runs.at(-1)
  );
}

function toStopReasonView(reason: ResearchStopReason | undefined) {
  if (!reason) return;
  return {
    code: reason.code,
    ...(reason.detail ? { detail: reason.detail } : {}),
  };
}

export const ACTIVE_NODE_STATUSES = new Set<string>([
  "searching",
  "reading",
  "learning",
]);

function toRunItemStatus(
  status:
    | ResearchReportRun["nodes"][number]["status"]
    | ResearchReportRun["waves"][number]["status"],
): NonNullable<ResearchTaskViewModel["run"]>["nodes"][number]["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "blocked" || status === "paused") return "blocked";
  if (status === "skipped") return "skipped";
  if (
    status === "running" ||
    status === "searching" ||
    status === "reading" ||
    status === "learning"
  ) {
    return "in_progress";
  }
  return "pending";
}

export function createRunView(
  run: ResearchReportRun | undefined,
  plan: ResearchPlanVersion | undefined,
  taskEndedAt: number | undefined,
): ResearchTaskViewModel["run"] {
  if (!run) return;
  const packetByNodeId = new Map(
    run.learningPackets.map((packet) => [packet.nodeId, packet] as const),
  );
  const claimById = new Map(
    run.claims.map((claim) => [claim.id, claim] as const),
  );
  const waveIdByNodeId = new Map<string, string>();
  for (const wave of run.waves) {
    wave.nodeIds.forEach((nodeId) => waveIdByNodeId.set(nodeId, wave.id));
  }
  const nodes = run.nodes.map((node) => {
    const packet = packetByNodeId.get(node.id);
    const claims = node.claimIds.flatMap((claimId) => {
      const claim = claimById.get(claimId);
      return claim ? [claim] : [];
    });
    const scopeImpact = packet?.followUps.some(
      (followUp) => followUp.scopeImpact === "scope_expansion",
    )
      ? ("scope_expansion" as const)
      : packet?.followUps.some(
            (followUp) => followUp.scopeImpact === "source_expansion",
          )
        ? ("source_expansion" as const)
        : packet?.followUps.length
          ? ("within" as const)
          : undefined;
    return {
      id: node.id,
      ...(node.parentNodeId ? { parentId: node.parentNodeId } : {}),
      waveId: node.waveId ?? waveIdByNodeId.get(node.id) ?? "unassigned",
      stepId: node.stepId,
      depth: node.depth,
      objective: node.objective,
      ...(node.query ? { query: node.query } : {}),
      status: toRunItemStatus(node.status),
      evidenceIds: [...node.evidenceIds],
      claimIds: [...node.claimIds],
      verifiedClaimCount: claims.filter(
        (claim) => claim.verificationStatus === "verified",
      ).length,
      conflictingClaimCount: claims.filter(
        (claim) => claim.contradictingEvidenceIds.length > 0,
      ).length,
      learnings: packet?.learnings.map((learning) => learning.statement) ?? [],
      followUps: packet?.followUps.map((followUp) => followUp.question) ?? [],
      ...(node.stopReason
        ? { stopReason: toStopReasonView(node.stopReason) }
        : {}),
      ...(scopeImpact ? { scopeImpact } : {}),
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const sortedWaves = [...run.waves].sort(
    (left, right) => left.index - right.index,
  );
  const waves = sortedWaves.map((wave, index) => {
    return {
      id: wave.id,
      index: index + 1,
      depth: wave.depth,
      status: toRunItemStatus(wave.status),
      nodeIds: [...wave.nodeIds],
      queryCount: wave.nodeIds.filter((nodeId) =>
        Boolean(nodeById.get(nodeId)?.query),
      ).length,
      sourceCount: wave.newEvidenceCount,
      verifiedClaimCount: wave.newVerifiedClaimCount,
      ...(wave.packetStatus ? { packetStatus: wave.packetStatus } : {}),
      ...(wave.degradedNodeIds
        ? { degradedNodeIds: [...wave.degradedNodeIds] }
        : {}),
    };
  });
  const activeWaveIndex = sortedWaves.findIndex(
    (wave) => wave.status === "running",
  );
  const activeDepths = run.nodes
    .filter((node) => ACTIVE_NODE_STATUSES.has(node.status))
    .map((node) => node.depth);
  const currentDepth =
    activeDepths.length > 0
      ? Math.max(...activeDepths)
      : (sortedWaves.at(-1)?.depth ?? 0);
  const verifiedClaims = run.claims.filter(
    (claim) => claim.verificationStatus === "verified",
  ).length;
  const conflictingClaims = run.claims.filter(
    (claim) => claim.contradictingEvidenceIds.length > 0,
  ).length;

  return {
    id: run.id,
    phase: run.phase,
    startedAt: run.startedAt,
    ...(run.endedAt !== undefined || taskEndedAt !== undefined
      ? { endedAt: run.endedAt ?? taskEndedAt }
      : {}),
    ...(waves.length
      ? {
          currentWave:
            activeWaveIndex >= 0 ? activeWaveIndex + 1 : waves.length,
        }
      : {}),
    currentDepth,
    maxDepth: run.strategy.maxDepth,
    queryUsage: {
      used: run.usage.queryCount,
      limit: run.strategy.maxQueries,
      reservedForValidation: Math.max(
        2,
        Math.ceil(run.strategy.maxQueries * 0.15),
      ),
      planningUsed: plan?.recon.usage.queryCount ?? 0,
    },
    claimCounts: {
      total: run.claims.length,
      verified: verifiedClaims,
      conflicting: conflictingClaims,
      unresolved: run.claims.filter(
        (claim) => claim.verificationStatus === "unresolved",
      ).length,
    },
    coverage: {
      coveredStepCount: run.coverage.coveredStepCount,
      requiredStepCount: run.coverage.requiredStepCount,
      ratio: run.coverage.stepRatio,
    },
    waves,
    nodes,
    ...(run.stopReason ? { stopReason: toStopReasonView(run.stopReason) } : {}),
  };
}
