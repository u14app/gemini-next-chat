import { isUsableResearchEvidence } from "../evidence";
import type {
  ClaimRecord,
  LearningPacket,
  ResearchClaimVerificationStatus,
  ResearchEvidence,
  ResearchReportRun,
} from "../types";
import { areResearchQueriesSimilar } from "./strategy";

function evidencePublisherIdentity(
  evidence: ResearchEvidence,
  evidenceBySourceId: ReadonlyMap<string, ResearchEvidence>,
  visitedSourceIds: ReadonlySet<string> = new Set(),
): string {
  if (visitedSourceIds.has(evidence.sourceId)) {
    return `mirror-cycle:${Array.from(
      new Set([...visitedSourceIds, evidence.sourceId]),
    )
      .sort()
      .join(",")}`;
  }
  if (evidence.mirrorOfSourceId) {
    const original = evidenceBySourceId.get(evidence.mirrorOfSourceId);
    if (original && original !== evidence) {
      return evidencePublisherIdentity(
        original,
        evidenceBySourceId,
        new Set([...visitedSourceIds, evidence.sourceId]),
      );
    }
    return `mirror:${evidence.mirrorOfSourceId}`;
  }
  if (evidence.publisherId?.trim()) {
    return `publisher:${evidence.publisherId.trim().toLowerCase()}`;
  }
  if (
    evidence.sourceType === "knowledge" ||
    evidence.sourceType === "attachment" ||
    evidence.sourceType === "workspace"
  ) {
    return `local:${evidence.sourceType}`;
  }
  try {
    return `host:${new URL(evidence.locator).hostname.toLowerCase()}`;
  } catch {
    return `source:${evidence.sourceId}`;
  }
}

function normalizedTitleTerms(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}

function probableSyndicatedCopy(
  left: ResearchEvidence,
  right: ResearchEvidence,
): boolean {
  const leftTerms = normalizedTitleTerms(left.title);
  const rightTerms = normalizedTitleTerms(right.title);
  const leftLength = Array.from(left.title?.replace(/\s+/g, "") ?? "").length;
  const rightLength = Array.from(right.title?.replace(/\s+/g, "") ?? "").length;
  if (
    (leftTerms.size < 4 || rightTerms.size < 4) &&
    (leftLength < 12 || rightLength < 12)
  ) {
    return false;
  }
  return areResearchQueriesSimilar(left.title ?? "", right.title ?? "");
}

export interface ResearchClaimVerification {
  status: ResearchClaimVerificationStatus;
  independentPublisherCount: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}

export function evaluateResearchClaimVerification(
  claim: Pick<
    ClaimRecord,
    "importance" | "supportingEvidenceIds" | "contradictingEvidenceIds"
  >,
  evidence: readonly ResearchEvidence[],
): ResearchClaimVerification {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceBySourceId = new Map(
    evidence.map((item) => [item.sourceId, item]),
  );
  const available = (ids: readonly string[]) =>
    Array.from(new Set(ids)).flatMap((id) => {
      const item = evidenceById.get(id);
      return item && isUsableResearchEvidence(item) ? [item] : [];
    });
  const supporting = available(claim.supportingEvidenceIds);
  const contradicting = available(claim.contradictingEvidenceIds);
  const uniqueSupporting: ResearchEvidence[] = [];
  for (const item of supporting) {
    if (
      uniqueSupporting.some(
        (existing) =>
          existing.contentHash === item.contentHash ||
          evidencePublisherIdentity(existing, evidenceBySourceId) ===
            evidencePublisherIdentity(item, evidenceBySourceId) ||
          probableSyndicatedCopy(existing, item),
      )
    ) {
      continue;
    }
    uniqueSupporting.push(item);
  }
  const publishers = new Set(
    uniqueSupporting.map((item) =>
      evidencePublisherIdentity(item, evidenceBySourceId),
    ),
  ).size;
  let status: ResearchClaimVerificationStatus;
  if (contradicting.length > 0) {
    status = "unresolved";
  } else if (supporting.length === 0) {
    status = "unsupported";
  } else if (
    claim.importance === "background" ||
    uniqueSupporting.some(
      (item) => item.authority === "primary" && !item.mirrorOfSourceId,
    )
  ) {
    status = "verified";
  } else {
    status = "pending";
  }
  return {
    status,
    independentPublisherCount: publishers,
    supportingEvidenceIds: supporting.map((item) => item.id),
    contradictingEvidenceIds: contradicting.map((item) => item.id),
  };
}

export type ResearchClaimConfidence =
  "corroborated" | "single_source" | "contested";

export interface CitableResearchClaim {
  claim: ClaimRecord;
  confidence: ResearchClaimConfidence;
  supportingEvidence: ResearchEvidence[];
}

/**
 * Claims a report may cite: anything still backed by retrievable evidence.
 * Corroboration is reported as confidence rather than used as a gate, so a
 * single-source finding still reaches the reader.
 */
export function getCitableResearchClaims(
  run: Pick<ResearchReportRun, "claims">,
  evidence: readonly ResearchEvidence[],
): CitableResearchClaim[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return run.claims.flatMap((claim) => {
    if (claim.verificationStatus === "unsupported") return [];
    const supportingEvidence = Array.from(
      new Set(claim.supportingEvidenceIds),
    ).flatMap((id) => {
      const item = evidenceById.get(id);
      return item && isUsableResearchEvidence(item) ? [item] : [];
    });
    if (supportingEvidence.length === 0) return [];
    const confidence: ResearchClaimConfidence =
      claim.verificationStatus === "unresolved"
        ? "contested"
        : claim.verificationStatus === "verified"
          ? "corroborated"
          : "single_source";
    return [{ claim, confidence, supportingEvidence }];
  });
}

export function applyResearchSourceAssessments(
  evidence: readonly ResearchEvidence[],
  packets: readonly LearningPacket[],
): ResearchEvidence[] {
  const assessments = new Map(
    packets.flatMap((packet) =>
      packet.sourceAssessments.map(
        (assessment) => [assessment.sourceId, assessment] as const,
      ),
    ),
  );
  return evidence.map((item) => {
    const assessment = assessments.get(item.sourceId);
    if (!assessment) return item;
    let publisherId = assessment.publisherId;
    if (item.sourceType === "web") {
      try {
        publisherId = new URL(item.locator).hostname.toLowerCase();
      } catch {
        // Non-URL web locators keep the bounded assessment fallback.
      }
    }
    return {
      ...item,
      authority: assessment.authority,
      ...(publisherId ? { publisherId } : {}),
      ...(assessment.mirrorOfSourceId
        ? { mirrorOfSourceId: assessment.mirrorOfSourceId }
        : {}),
    };
  });
}

export function createClaimRecordsFromLearningPackets(
  packets: readonly LearningPacket[],
  evidence: readonly ResearchEvidence[],
  now: number = Date.now(),
): ClaimRecord[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceBySourceId = new Map(
    evidence.map((item) => [item.sourceId, item]),
  );
  const candidates = new Map<
    string,
    Omit<ClaimRecord, "verificationStatus" | "independentPublisherCount">
  >();
  for (const packet of packets) {
    for (const learning of packet.learnings) {
      const linkedEvidence = Array.from(
        new Set([
          ...learning.evidenceIds,
          ...learning.sourceIds.flatMap((sourceId) => {
            const item = evidenceBySourceId.get(sourceId);
            return item ? [item.id] : [];
          }),
        ]),
      ).filter((evidenceId) => evidenceById.has(evidenceId));
      const existing = candidates.get(learning.claimId);
      const supportingEvidenceIds = new Set(
        existing?.supportingEvidenceIds || [],
      );
      const contradictingEvidenceIds = new Set(
        existing?.contradictingEvidenceIds || [],
      );
      if (learning.stance === "supports") {
        linkedEvidence.forEach((evidenceId) =>
          supportingEvidenceIds.add(evidenceId),
        );
      } else if (learning.stance === "contradicts") {
        linkedEvidence.forEach((evidenceId) =>
          contradictingEvidenceIds.add(evidenceId),
        );
      }
      candidates.set(learning.claimId, {
        id: learning.claimId,
        text: existing?.text || learning.claimText,
        importance:
          existing?.importance === "major" || learning.importance === "major"
            ? "major"
            : "background",
        stepId: existing?.stepId || learning.stepId,
        nodeIds: Array.from(
          new Set([...(existing?.nodeIds || []), packet.nodeId]),
        ),
        supportingEvidenceIds: [...supportingEvidenceIds],
        contradictingEvidenceIds: [...contradictingEvidenceIds],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }
  return [...candidates.values()].map((candidate) => {
    const verification = evaluateResearchClaimVerification(candidate, evidence);
    return {
      ...candidate,
      supportingEvidenceIds: verification.supportingEvidenceIds,
      contradictingEvidenceIds: verification.contradictingEvidenceIds,
      verificationStatus: verification.status,
      independentPublisherCount: verification.independentPublisherCount,
    };
  });
}
