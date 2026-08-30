import { getCitableResearchClaims } from "../orchestration";
import type {
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchTask,
} from "../types";
import { normalizeAuditLabel, REQUIRED_REPORT_SECTIONS } from "./normalize";
import {
  getCoveredResearchStepIds,
  getDegradedResearchStepIds,
} from "./stepCoverage";

export function buildDeterministicSalvageReport({
  task,
  plan,
  run,
  evidence,
  reason,
}: {
  task: ResearchTask;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  reason: string;
}): string {
  const findings = getCitableResearchClaims(run, evidence).map((citable) => {
    const source = citable.supportingEvidence[0];
    const conflict =
      citable.confidence === "contested"
        ? " (contradicting evidence remains unresolved)"
        : "";
    return `- [${citable.claim.id}] ${citable.claim.text}${conflict} [${source.sourceId}](${source.locator})`;
  });
  const coveredStepIds = new Set(
    getCoveredResearchStepIds(plan, run, evidence),
  );
  const coverage = plan.steps.map((step) => {
    const answered = coveredStepIds.has(step.id);
    return `- ${step.id}: ${answered ? "answered" : "partial"} - ${answered ? "cited finding available" : "no cited finding was produced"}`;
  });
  const requiredSections = plan.deliverable.requiredSections
    .filter(
      (section) =>
        !REQUIRED_REPORT_SECTIONS.some(
          (required) =>
            normalizeAuditLabel(required) === normalizeAuditLabel(section),
        ),
    )
    .map((section) => `## ${section}\n\nNot completed in this partial report.`);
  const relevantEvidenceIds = new Set([
    ...run.nodes.flatMap((node) => node.evidenceIds),
    ...run.claims.flatMap((claim) => [
      ...claim.supportingEvidenceIds,
      ...claim.contradictingEvidenceIds,
    ]),
  ]);
  const sources = evidence
    .filter((item) => relevantEvidenceIds.has(item.id))
    .slice(0, 200)
    .map(
      (item) =>
        `- [${item.sourceId}] [${item.title || item.locator}](${item.locator}) — retrieved ${new Date(item.retrievedAt).toISOString()}`,
    );
  const degradedStepIds = getDegradedResearchStepIds(run, evidence);
  const evidenceGaps = [
    reason,
    ...degradedStepIds.map(
      (stepId) =>
        `- ${stepId}: the wave archive did not produce a validated learning packet.`,
    ),
  ].join("\n");
  return [
    `# ${plan.title || task.goal}`,
    "## Executive summary",
    "This partial report includes only findings supported by the available cited evidence. Some requested areas could not be completed.",
    "## Key findings",
    findings.length > 0
      ? findings.join("\n")
      : "No finding could be reconstructed from the collected evidence.",
    ...requiredSections,
    "## Research plan coverage",
    coverage.join("\n"),
    "## Evidence gaps",
    evidenceGaps,
    "## Sources",
    sources.length > 0 ? sources.join("\n") : "No formal evidence committed.",
  ].join("\n\n");
}
