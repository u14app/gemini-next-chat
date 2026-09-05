import { readReportSections, readReportCitations } from "../reportSections";
import { canonicalizeResearchLocator } from "../evidence";
import { getCitableResearchClaims } from "../orchestration";
import { summarizeResearchReport } from "../prompts";
import type {
  ResearchEvidence,
  ResearchImageSource,
  ResearchPlanVersion,
  ResearchReportRun,
} from "../types";
import {
  containsExactToken,
  extractAuditSection,
  normalizeAuditLabel,
  REQUIRED_REPORT_SECTIONS,
} from "./normalize";
import { getDegradedResearchStepIds } from "./stepCoverage";

export interface ResearchReportAudit {
  /** Legacy severity field, retained for saved reports; never gates delivery. */
  blocking: string[];
  /** Recorded for diagnostics; never blocks or rewrites the report. */
  advisory: string[];
  unknownCitationCount: number;
  unsupportedFindingCount: number;
  missingSectionCount: number;
}

export function auditResearchReport({
  markdown,
  plan,
  run,
  evidence,
  imageSources,
  requiredEvidenceGapStepIds,
}: {
  markdown: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  imageSources?: readonly ResearchImageSource[];
  requiredEvidenceGapStepIds?: readonly string[];
}): ResearchReportAudit {
  const blocking: string[] = [];
  const advisory: string[] = [];
  const headings = new Set(
    readReportSections(markdown).map((section) =>
      normalizeAuditLabel(section.title),
    ),
  );
  const hasHeading = (section: string) =>
    headings.has(normalizeAuditLabel(section));
  const missingCoreSections = REQUIRED_REPORT_SECTIONS.filter(
    (section) => !hasHeading(section),
  );
  const missingContractSections = Array.from(
    new Set(plan.deliverable.requiredSections),
  ).filter(
    (section) =>
      !hasHeading(section) &&
      !REQUIRED_REPORT_SECTIONS.some(
        (required) =>
          normalizeAuditLabel(required) === normalizeAuditLabel(section),
      ),
  );
  if (missingCoreSections.length > 0) {
    blocking.push(
      `Missing required sections: ${missingCoreSections.join(", ")}.`,
    );
  }
  if (missingContractSections.length > 0) {
    blocking.push(
      `Missing deliverable sections: ${missingContractSections.join(", ")}.`,
    );
  }

  const requiredGapStepIds = new Set([
    ...getDegradedResearchStepIds(run, evidence),
    ...(requiredEvidenceGapStepIds || []),
  ]);
  const orderedRequiredGapStepIds = plan.steps
    .map((step) => step.id)
    .filter((stepId) => requiredGapStepIds.has(stepId));
  const evidenceGaps = extractAuditSection(markdown, "Evidence gaps");
  const missingEvidenceGapStepIds = orderedRequiredGapStepIds.filter(
    (stepId) => !containsExactToken(evidenceGaps, stepId),
  );
  if (missingEvidenceGapStepIds.length > 0) {
    advisory.push(
      `Evidence gaps must identify these degraded research steps: ${missingEvidenceGapStepIds.join(", ")}.`,
    );
  }

  const knownLocators = new Set(
    evidence.flatMap((item) =>
      [item.locator, ...(item.aliasLocators || [])].map(
        canonicalizeResearchLocator,
      ),
    ),
  );
  const citations = readReportCitations(markdown);
  // Image source pages are provenance for illustrations, not formal evidence
  // citations. Exclude the allow-listed catalog URLs from the audit while
  // retaining every other report link for evidence validation.
  const imageMaterialUrls = new Set(
    (imageSources ?? run.imageSources ?? []).flatMap((image) =>
      [image.url, image.sourceUrl]
        .filter((url): url is string => Boolean(url))
        .map(canonicalizeResearchLocator),
    ),
  );
  // Navigation/contact links are not claims about external web evidence.
  const citedUrls = citations.urls
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => !imageMaterialUrls.has(canonicalizeResearchLocator(url)))
    .map(canonicalizeResearchLocator);
  const knownSourceIds = new Set(
    evidence.flatMap((item) => [item.sourceId, ...(item.aliasSourceIds || [])]),
  );
  const citedSourceIds = citations.sourceIds;
  const unknownCitationCount =
    citedUrls.filter((url) => !knownLocators.has(url)).length +
    citedSourceIds.filter((sourceId) => !knownSourceIds.has(sourceId)).length;
  if (unknownCitationCount > 0) {
    blocking.push(
      `${unknownCitationCount} report citations do not match committed evidence.`,
    );
  }

  const metadata = summarizeResearchReport(markdown);
  const citableClaims = getCitableResearchClaims(run, evidence);
  let unsupportedFindingCount = 0;
  for (const finding of metadata.keyFindings) {
    const citable = citableClaims.find((candidate) =>
      finding.toLowerCase().includes(`[${candidate.claim.id}]`.toLowerCase()),
    );
    if (!citable) {
      unsupportedFindingCount += 1;
      continue;
    }
    const findingCitations = readReportCitations(finding, markdown);
    const findingUrls = new Set(
      findingCitations.urls.map(canonicalizeResearchLocator),
    );
    const findingSourceIds = new Set(findingCitations.sourceIds);
    const hasCitation = citable.supportingEvidence.some(
      (item) =>
        [item.locator, ...(item.aliasLocators || [])].some((locator) =>
          findingUrls.has(canonicalizeResearchLocator(locator)),
        ) ||
        [item.sourceId, ...(item.aliasSourceIds || [])].some((sourceId) =>
          findingSourceIds.has(sourceId),
        ),
    );
    if (!hasCitation) unsupportedFindingCount += 1;
  }
  if (unsupportedFindingCount > 0) {
    advisory.push(
      `${unsupportedFindingCount} key findings lack a cited claim and committed citation on the same item.`,
    );
  }
  if (metadata.keyFindings.length === 0) {
    blocking.push("The report has no auditable key findings.");
  }
  return {
    blocking,
    advisory,
    unknownCitationCount,
    unsupportedFindingCount,
    missingSectionCount:
      missingCoreSections.length + missingContractSections.length,
  };
}
