import type { ResearchEvidence } from "./types";

const QUESTION_CLAIM_ID = /^(?:q|question[-_:]?)(\d+)(?:$|[-_:])/i;

export interface ResearchEvidenceFilter {
  questionIndex?: number;
  stance?: NonNullable<ResearchEvidence["stance"]>;
}

/**
 * Question-linked evidence uses one-based `Qn` claim IDs while public tool
 * arguments use zero-based question indexes, matching plan arrays.
 */
export function getResearchEvidenceQuestionIndexes(
  evidence: Pick<ResearchEvidence, "claimIds">,
): number[] {
  const indexes = new Set<number>();
  for (const claimId of evidence.claimIds) {
    const match = QUESTION_CLAIM_ID.exec(claimId.trim());
    if (!match) continue;
    const index = Number.parseInt(match[1], 10) - 1;
    if (index >= 0) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}

export function filterResearchEvidence(
  evidence: readonly ResearchEvidence[],
  filter: ResearchEvidenceFilter,
): ResearchEvidence[] {
  return evidence.filter(
    (item) =>
      (filter.stance === undefined ||
        item.stance === filter.stance ||
        item.relations?.some(
          (relation) => relation.stance === filter.stance,
        )) &&
      (filter.questionIndex === undefined ||
        getResearchEvidenceQuestionIndexes(item).includes(
          filter.questionIndex,
        )),
  );
}

export function getResearchEvidenceIdentity(
  evidence: Pick<ResearchEvidence, "contentHash" | "locator">,
): string {
  return `${evidence.contentHash}\u0000${canonicalizeResearchLocator(
    evidence.locator,
  )}`;
}

export function canonicalizeResearchLocator(locator: string): string {
  const trimmed = locator.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    if (url.pathname.length > 1)
      url.pathname = url.pathname.replace(/\/+$/, "");
    url.searchParams.sort();
    return url.toString();
  } catch {
    return trimmed.normalize("NFKC");
  }
}

export function getResearchEvidenceDedupKeys(
  evidence: Pick<
    ResearchEvidence,
    | "contentHash"
    | "locator"
    | "sourceId"
    | "publisherId"
    | "aliasSourceIds"
    | "aliasLocators"
  >,
): string[] {
  const contentHash = evidence.contentHash.trim();
  return [
    `locator-content:${canonicalizeResearchLocator(evidence.locator)}:${contentHash}`,
    `source-content:${evidence.sourceId}:${contentHash}`,
    `content:${contentHash}`,
    ...(evidence.aliasLocators || []).map(
      (locator) =>
        `locator-content:${canonicalizeResearchLocator(locator)}:${contentHash}`,
    ),
    ...(evidence.aliasSourceIds || []).map(
      (sourceId) => `source-content:${sourceId}:${contentHash}`,
    ),
    ...(evidence.publisherId
      ? [
          `publisher-content:${evidence.publisherId.trim().toLowerCase()}:${contentHash}`,
        ]
      : []),
  ];
}

export function markMutableResearchEvidenceStale(
  evidence: readonly ResearchEvidence[],
): ResearchEvidence[] {
  return evidence.map((item) =>
    item.sourceType === "web" ||
    item.sourceType === "plugin" ||
    item.sourceType === "mcp"
      ? { ...item, freshness: "stale" }
      : item,
  );
}

/** Counts claims whose evidence index still contains opposing stances. */
export function countUnresolvedResearchEvidenceConflicts(
  evidence: readonly ResearchEvidence[],
): number {
  const stancesByClaim = new Map<string, Set<ResearchEvidence["stance"]>>();
  for (const item of evidence) {
    if (item.stance !== "supports" && item.stance !== "contradicts") continue;
    for (const claimId of item.claimIds) {
      const stances = stancesByClaim.get(claimId) || new Set();
      stances.add(item.stance);
      stancesByClaim.set(claimId, stances);
    }
  }
  return [...stancesByClaim.values()].filter(
    (stances) => stances.has("supports") && stances.has("contradicts"),
  ).length;
}
