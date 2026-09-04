import {
  DEFAULT_REPORT_SECTION_LABELS,
  reportSectionKey,
  type ReportSectionLabels,
} from "../reportSections";
import {
  DEFAULT_REPORT_FALLBACK_TEXT,
  type ReportFallbackText,
} from "../reportFallbackText";
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
  sectionLabels = DEFAULT_REPORT_SECTION_LABELS,
  text = DEFAULT_REPORT_FALLBACK_TEXT,
}: {
  task: ResearchTask;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  reason: string;
  sectionLabels?: ReportSectionLabels;
  text?: ReportFallbackText;
}): string {
  const citableClaims = getCitableResearchClaims(run, evidence);
  const findings = citableClaims.map((citable) => {
    const source = citable.supportingEvidence[0];
    const conflict =
      citable.confidence === "contested" ? ` (${text.unresolvedConflict})` : "";
    return `- [${citable.claim.id}] ${citable.claim.text}${conflict} [${source.sourceId}](${source.locator})`;
  });
  const citableIds = new Set(citableClaims.map((item) => item.claim.id));
  const unverified = run.claims
    .filter((claim) => !citableIds.has(claim.id))
    .map((claim) => `- ${text.unverifiedPrefix}: ${claim.text}`);
  const coveredStepIds = new Set(
    getCoveredResearchStepIds(plan, run, evidence),
  );
  const coverage = plan.steps.map((step) => {
    const answered = coveredStepIds.has(step.id);
    return `- ${step.id}: ${answered ? "answered" : "partial"} - ${answered ? text.citedFindingAvailable : text.noCitedFinding}`;
  });
  const requiredSections = plan.deliverable.requiredSections
    .filter(
      (section) =>
        !REQUIRED_REPORT_SECTIONS.some(
          (required) =>
            normalizeAuditLabel(required) === normalizeAuditLabel(section),
        ),
    )
    .map((section) => {
      const key = reportSectionKey(section);
      return `## ${key ? sectionLabels[key] : section}\n\n${text.unverifiedArea}`;
    });
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
        `- [${item.sourceId}] [${item.title || item.locator}](${item.locator}) — ${text.retrieved} ${new Date(item.retrievedAt).toISOString()}`,
    );
  const degradedStepIds = getDegradedResearchStepIds(run, evidence);
  const evidenceGaps = [
    reason,
    ...degradedStepIds.map((stepId) => `- ${stepId}: ${text.archiveMissing}`),
  ].join("\n");
  return [
    `# ${plan.title || task.goal}`,
    `## ${sectionLabels.executiveSummary}`,
    text.partialSummary,
    `## ${sectionLabels.keyFindings}`,
    findings.length > 0 ? findings.join("\n") : text.noFindings,
    ...(unverified.length
      ? [`## ${sectionLabels.unverifiedMaterial}`, unverified.join("\n")]
      : []),
    ...requiredSections,
    `## ${sectionLabels.questionsToVerify}`,
    plan.steps
      .filter((step) => !coveredStepIds.has(step.id))
      .map((step) => `- ${step.title}: ${step.objective}`)
      .join("\n") || text.noQuestions,
    `## ${sectionLabels.planCoverage}`,
    coverage.join("\n"),
    `## ${sectionLabels.evidenceGaps}`,
    evidenceGaps,
    `## ${sectionLabels.sources}`,
    sources.length > 0 ? sources.join("\n") : text.noEvidence,
  ].join("\n\n");
}
