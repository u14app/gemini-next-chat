import type {
  ClaimRecord,
  ResearchCoverage,
  ResearchNode,
  ResearchPlanStepV2,
} from "../types";

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export const RESEARCH_SUFFICIENT_CLAIM_RATIO = 0.8;

export function isResearchCoverageSufficient(
  coverage: ResearchCoverage,
  claimRatio: number = RESEARCH_SUFFICIENT_CLAIM_RATIO,
): boolean {
  const threshold = Math.min(1, Math.max(0, claimRatio));
  return (
    coverage.requiredStepCount > 0 &&
    coverage.majorClaimCount > 0 &&
    coverage.stepRatio === 1 &&
    coverage.claimRatio >= threshold
  );
}

export function calculateResearchCoverage(
  steps: readonly ResearchPlanStepV2[],
  nodes: readonly ResearchNode[],
  claims: readonly ClaimRecord[],
): ResearchCoverage {
  const highPrioritySteps = steps.filter((step) => step.priority === "high");
  const requiredSteps =
    highPrioritySteps.length > 0 ? highPrioritySteps : [...steps];
  const majorClaims = claims.filter((claim) => claim.importance === "major");
  const verifiedMajorClaims = majorClaims.filter(
    (claim) => claim.verificationStatus === "verified",
  );
  const unresolvedMajorClaims = majorClaims.filter(
    (claim) => claim.verificationStatus === "unresolved",
  );
  const coveredStepCount = requiredSteps.filter((step) => {
    const hasCompletedNode = nodes.some(
      (node) => node.stepId === step.id && node.status === "completed",
    );
    const hasVerifiedClaim = claims.some(
      (claim) =>
        claim.stepId === step.id &&
        claim.importance === "major" &&
        claim.verificationStatus === "verified",
    );
    return hasCompletedNode && hasVerifiedClaim;
  }).length;
  const stepRatio = ratio(coveredStepCount, requiredSteps.length);
  const claimRatio = ratio(verifiedMajorClaims.length, majorClaims.length);
  const complete =
    requiredSteps.length > 0 &&
    majorClaims.length > 0 &&
    stepRatio === 1 &&
    claimRatio === 1 &&
    unresolvedMajorClaims.length === 0;
  return {
    requiredStepCount: requiredSteps.length,
    coveredStepCount,
    majorClaimCount: majorClaims.length,
    verifiedMajorClaimCount: verifiedMajorClaims.length,
    unresolvedMajorClaimCount: unresolvedMajorClaims.length,
    stepRatio,
    claimRatio,
    overallRatio: Math.min(stepRatio, claimRatio),
    complete,
  };
}
