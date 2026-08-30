import { getCitableResearchClaims } from "../orchestration";
import type {
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
} from "../types";

function getCitableStepIds(
  run: ResearchReportRun,
  evidence: readonly ResearchEvidence[],
): Set<string> {
  return new Set(
    getCitableResearchClaims(run, evidence)
      .filter((citable) => citable.claim.importance === "major")
      .map((citable) => citable.claim.stepId),
  );
}

export function getDegradedResearchStepIds(
  run: ResearchReportRun,
  evidence: readonly ResearchEvidence[],
): string[] {
  const degradedNodeIds = new Set(
    run.waves.flatMap((wave) => wave.degradedNodeIds || []),
  );
  const stepIds = new Set<string>();
  const coveredStepIds = getCitableStepIds(run, evidence);
  for (const node of run.nodes) {
    if (degradedNodeIds.has(node.id) && !coveredStepIds.has(node.stepId)) {
      stepIds.add(node.stepId);
    }
  }
  return Array.from(stepIds);
}

export function getCoveredResearchStepIds(
  plan: ResearchPlanVersion,
  run: ResearchReportRun,
  evidence: readonly ResearchEvidence[],
): string[] {
  const coveredStepIds = getCitableStepIds(run, evidence);
  return plan.steps
    .filter((step) => coveredStepIds.has(step.id))
    .map((step) => step.id);
}
