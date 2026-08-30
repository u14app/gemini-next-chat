import type { ResearchEvidenceView } from "../types";
import type { AgentRun } from "@/lib/agent";
import type {
  ClaimRecord,
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchSourceType,
  ResearchTask,
} from "@/lib/research";

export function getActivePlan(task: ResearchTask) {
  return task.planVersions.find(
    (plan) => plan.version === task.activePlanVersion,
  );
}

export function getActiveReport(task: ResearchTask) {
  return (
    task.reportVersions.find(
      (report) => report.version === task.activeReportVersion,
    ) || task.reportVersions.at(-1)
  );
}

export const LIVE_PROGRESS_STATUSES = new Set<ResearchTask["status"]>([
  "researching",
  "verifying",
  "synthesizing",
]);

function getSourceDomain(locator: string): string | undefined {
  try {
    const url = new URL(locator);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return;
  }
}

function inferLiveEvidenceSourceType(
  retrievalKind: AgentRun["evidence"][number]["retrievalKind"],
): ResearchSourceType {
  if (retrievalKind === "attachment") return "attachment";
  if (retrievalKind === "mcp") return "mcp";
  return "web";
}

function getEvidenceVerificationStatus(
  evidence: Pick<ResearchEvidence, "claimIds">,
  claimsById: ReadonlyMap<string, ClaimRecord>,
): ResearchEvidenceView["verificationStatus"] {
  const statuses = evidence.claimIds.flatMap((claimId) => {
    const claim = claimsById.get(claimId);
    return claim ? [claim.verificationStatus] : [];
  });
  if (statuses.includes("unresolved")) return "unresolved";
  if (statuses.includes("unsupported")) return "unsupported";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("verified")) return "verified";
  return;
}

function getLinkedEvidenceClaims(
  claimIds: readonly string[],
  claimsById: ReadonlyMap<string, ClaimRecord>,
): ResearchEvidenceView["linkedClaims"] {
  const seen = new Set<string>();
  return claimIds.flatMap((claimId) => {
    const claim = claimsById.get(claimId);
    if (!claim || seen.has(claim.id)) return [];
    seen.add(claim.id);
    return [
      {
        id: claim.id,
        text: claim.text,
        importance: claim.importance,
        verificationStatus: claim.verificationStatus,
      },
    ];
  });
}

export function buildEvidenceViews(
  task: ResearchTask,
  journalRuns: AgentRun[],
  plan: ResearchPlanVersion | undefined,
  activeRun: ResearchReportRun | undefined,
): ResearchEvidenceView[] {
  const stepIndexById = new Map(
    (plan?.steps ?? []).map((step, index) => [step.id, index] as const),
  );
  const claimsById = new Map(
    (activeRun?.claims ?? []).map((claim) => [claim.id, claim] as const),
  );

  const viewsByIdentity = new Map<string, ResearchEvidenceView>();
  const evidenceOrder: string[] = [];
  const addEvidence = (identity: string, evidence: ResearchEvidenceView) => {
    const current = viewsByIdentity.get(identity);
    if (!current) {
      viewsByIdentity.set(identity, evidence);
      evidenceOrder.push(identity);
      return;
    }
    const questionIndexes = Array.from(
      new Set([
        ...(current.questionIndexes ?? []),
        ...(evidence.questionIndexes ?? []),
      ]),
    ).sort((left, right) => left - right);
    const linkedClaims = new Map(
      [...current.linkedClaims, ...evidence.linkedClaims].map((claim) => [
        claim.id,
        claim,
      ]),
    );
    viewsByIdentity.set(identity, {
      ...current,
      claimIds: Array.from(
        new Set([...(current.claimIds ?? []), ...(evidence.claimIds ?? [])]),
      ),
      linkedClaims: [...linkedClaims.values()],
      ...(questionIndexes.length ? { questionIndexes } : {}),
    });
  };

  for (const item of task.evidence) {
    const activeRelations = activeRun
      ? (item.relations || []).filter(
          (relation) => relation.researchRunId === activeRun.id,
        )
      : [];
    const activeRelation = activeRelations.at(-1);
    const stepId = activeRelation?.stepId || item.stepId;
    const nodeId = activeRelation?.nodeId || item.nodeId;
    const stance = activeRelation?.stance || item.stance;
    const claimIds =
      activeRun && item.relations
        ? Array.from(
            new Set(activeRelations.flatMap((relation) => relation.claimIds)),
          )
        : item.claimIds;
    const explicitStepIndex = stepIndexById.get(stepId);
    const questionIndexes =
      explicitStepIndex === undefined ? [] : [explicitStepIndex];
    const domain = getSourceDomain(item.locator);
    const verificationStatus = getEvidenceVerificationStatus(
      { ...item, claimIds },
      claimsById,
    );
    addEvidence(
      `${item.sourceId}\u0000${item.locator}\u0000${item.contentHash}`,
      {
        id: item.id,
        title: item.title || item.sourceId || item.locator,
        sourceType: item.sourceType,
        locator: item.locator,
        ...(item.locator.startsWith("http://") ||
        item.locator.startsWith("https://")
          ? { url: item.locator }
          : {}),
        retrievedAt: item.retrievedAt,
        stance,
        freshness: item.freshness,
        claimIds: [...claimIds],
        linkedClaims: getLinkedEvidenceClaims(claimIds, claimsById),
        stepId,
        nodeId,
        authority: item.authority,
        ...(verificationStatus ? { verificationStatus } : {}),
        ...(questionIndexes.length ? { questionIndexes } : {}),
        ...(domain ? { domain } : {}),
      },
    );
  }

  for (const run of journalRuns) {
    for (const record of run.evidence) {
      if (record.retrievalKind === "search") continue;
      const domain = getSourceDomain(record.url);
      addEvidence(
        `${record.sourceId}\u0000${record.url}\u0000${record.contentHash}`,
        {
          id: `live:${run.id}:${record.toolCallId}:${record.sourceId}`,
          title: record.title || record.sourceId || record.url,
          sourceType: inferLiveEvidenceSourceType(record.retrievalKind),
          locator: record.url,
          ...(record.url.startsWith("http://") ||
          record.url.startsWith("https://")
            ? { url: record.url }
            : {}),
          retrievedAt: record.retrievedAt,
          stance: "context",
          freshness: record.url.startsWith("http") ? "current" : "unknown",
          claimIds: [],
          linkedClaims: [],
          ...(domain ? { domain } : {}),
        },
      );
    }
  }

  return evidenceOrder.map((identity) => viewsByIdentity.get(identity)!);
}
