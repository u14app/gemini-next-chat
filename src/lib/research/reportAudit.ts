import { canonicalizeResearchLocator } from "./evidence";
import { summarizeResearchReport } from "./prompts";
import type {
  ResearchEvidence,
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchTask,
} from "./types";

export interface ResearchReportAudit {
  issues: string[];
  unknownCitationCount: number;
  unsupportedFindingCount: number;
  missingSectionCount: number;
}

const REQUIRED_REPORT_SECTIONS = [
  "Executive summary",
  "Key findings",
  "Research plan coverage",
  "Evidence gaps",
  "Sources",
] as const;

function normalizeAuditLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function extractCitedUrls(markdown: string): string[] {
  return Array.from(markdown.matchAll(/https?:\/\/[^\s)\]>]+/gi), (match) =>
    canonicalizeResearchLocator(match[0].replace(/[.,;:!?]+$/, "")),
  );
}

export function getCoveredResearchStepIds(
  plan: ResearchPlanVersion,
  run: ResearchReportRun,
): string[] {
  return plan.steps
    .filter((step) =>
      run.claims.some(
        (claim) =>
          claim.stepId === step.id &&
          claim.importance === "major" &&
          claim.verificationStatus === "verified",
      ),
    )
    .map((step) => step.id);
}

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
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const findings = run.claims
    .filter((claim) => claim.verificationStatus === "verified")
    .map((claim) => {
      const source = claim.supportingEvidenceIds
        .map((id) => evidenceById.get(id))
        .find(
          (item) =>
            item &&
            item.availability !== "unavailable" &&
            item.freshness !== "stale",
        );
      return source
        ? `- [${claim.id}] ${claim.text} [${source.sourceId}](${source.locator})`
        : `- [${claim.id}] ${claim.text}`;
    });
  const coveredStepIds = new Set(getCoveredResearchStepIds(plan, run));
  const coverage = plan.steps.map((step) => {
    const answered = coveredStepIds.has(step.id);
    return `- ${step.id}: ${answered ? "answered" : "partial"} - ${answered ? "verified claim available" : "evidence threshold not met"}`;
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
  return [
    `# ${plan.title || task.goal}`,
    "## Executive summary",
    `This is an automatically salvaged partial report. ${reason}`,
    "## Key findings",
    findings.length > 0
      ? findings.join("\n")
      : "No major claim met the approved verification threshold.",
    ...requiredSections,
    "## Research plan coverage",
    coverage.join("\n"),
    "## Evidence gaps",
    reason,
    "## Sources",
    sources.length > 0 ? sources.join("\n") : "No formal evidence committed.",
  ].join("\n\n");
}

export function auditResearchReport({
  markdown,
  plan,
  run,
  evidence,
}: {
  markdown: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
}): ResearchReportAudit {
  const issues: string[] = [];
  const headings = new Set(
    Array.from(markdown.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) =>
      normalizeAuditLabel(match[1].replace(/[*_`]/g, "")),
    ),
  );
  const requiredSections = Array.from(
    new Set([
      ...REQUIRED_REPORT_SECTIONS,
      ...plan.deliverable.requiredSections,
    ]),
  );
  const missingSections = requiredSections.filter(
    (section) => !headings.has(normalizeAuditLabel(section)),
  );
  if (missingSections.length > 0) {
    issues.push(`Missing required sections: ${missingSections.join(", ")}.`);
  }

  const knownLocators = new Set(
    evidence.flatMap((item) =>
      [item.locator, ...(item.aliasLocators || [])].map(
        canonicalizeResearchLocator,
      ),
    ),
  );
  const citedUrls = extractCitedUrls(markdown);
  const knownSourceIds = new Set(
    evidence.flatMap((item) => [item.sourceId, ...(item.aliasSourceIds || [])]),
  );
  const citedSourceIds = Array.from(
    markdown.matchAll(/\[(source-[A-Za-z0-9:_-]+)\]/g),
    (match) => match[1],
  );
  const unknownCitationCount =
    citedUrls.filter((url) => !knownLocators.has(url)).length +
    citedSourceIds.filter((sourceId) => !knownSourceIds.has(sourceId)).length;
  if (unknownCitationCount > 0) {
    issues.push(
      `${unknownCitationCount} report citations do not match committed evidence.`,
    );
  }

  const metadata = summarizeResearchReport(markdown);
  const verifiedClaims = run.claims.filter(
    (claim) => claim.verificationStatus === "verified",
  );
  let unsupportedFindingCount = 0;
  for (const finding of metadata.keyFindings) {
    const claim = verifiedClaims.find((candidate) =>
      finding.toLowerCase().includes(`[${candidate.id}]`.toLowerCase()),
    );
    if (!claim) {
      unsupportedFindingCount += 1;
      continue;
    }
    const findingUrls = new Set(extractCitedUrls(finding));
    const supportingEvidence = evidence.filter(
      (item) =>
        claim.supportingEvidenceIds.includes(item.id) &&
        item.availability !== "unavailable" &&
        item.freshness !== "stale",
    );
    const hasCitation = supportingEvidence.some(
      (item) =>
        [item.locator, ...(item.aliasLocators || [])].some((locator) =>
          findingUrls.has(canonicalizeResearchLocator(locator)),
        ) ||
        [item.sourceId, ...(item.aliasSourceIds || [])].some((sourceId) =>
          finding.toLowerCase().includes(`[${sourceId}]`.toLowerCase()),
        ),
    );
    if (!hasCitation) unsupportedFindingCount += 1;
  }
  if (unsupportedFindingCount > 0) {
    issues.push(
      `${unsupportedFindingCount} key findings lack a verified claim and committed citation on the same item.`,
    );
  }
  if (metadata.keyFindings.length === 0) {
    issues.push("The report has no auditable key findings.");
  }
  return {
    issues,
    unknownCitationCount,
    unsupportedFindingCount,
    missingSectionCount: missingSections.length,
  };
}
