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

const REPORT_SECTION_ALIASES = new Map<string, string>([
  ["executive summary", "Executive summary"],
  ["执行摘要", "Executive summary"],
  ["摘要", "Executive summary"],
  ["エグゼクティブサマリー", "Executive summary"],
  ["要約", "Executive summary"],
  ["key findings", "Key findings"],
  ["关键发现", "Key findings"],
  ["主要发现", "Key findings"],
  ["核心发现", "Key findings"],
  ["主な調査結果", "Key findings"],
  ["主要な調査結果", "Key findings"],
  ["research plan coverage", "Research plan coverage"],
  ["研究计划覆盖", "Research plan coverage"],
  ["研究计划覆盖情况", "Research plan coverage"],
  ["研究计划完成情况", "Research plan coverage"],
  ["調査計画のカバレッジ", "Research plan coverage"],
  ["調査計画の網羅状況", "Research plan coverage"],
  ["evidence gaps", "Evidence gaps"],
  ["证据缺口", "Evidence gaps"],
  ["证据不足", "Evidence gaps"],
  ["エビデンスギャップ", "Evidence gaps"],
  ["証拠の不足", "Evidence gaps"],
  ["sources", "Sources"],
  ["来源", "Sources"],
  ["资料来源", "Sources"],
  ["参考来源", "Sources"],
  ["情報源", "Sources"],
  ["出典", "Sources"],
]);

function normalizeAuditLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function unwrapOuterMarkdownFence(value: string): string {
  const lines = value.trim().replace(/\r\n/g, "\n").split("\n");
  const openingIndex = lines.findIndex((line) =>
    /^(```|~~~)(?:markdown|md)\s*$/i.test(line.trim()),
  );
  if (openingIndex < 0) return lines.join("\n").trim();
  if (
    lines
      .slice(0, openingIndex)
      .some((line) => /^#{1,6}\s+\S/.test(line.trim()))
  ) {
    return lines.join("\n").trim();
  }
  const opening = /^(```|~~~)/.exec(lines[openingIndex].trim())?.[1];
  let closingIndex = lines.length - 1;
  while (closingIndex > openingIndex && !lines[closingIndex].trim()) {
    closingIndex -= 1;
  }
  if (
    !opening ||
    lines[closingIndex].trim() !== opening ||
    !lines
      .slice(openingIndex + 1, closingIndex)
      .some((line) => /^#\s+\S/.test(line))
  ) {
    return lines.join("\n").trim();
  }
  return lines
    .slice(openingIndex + 1, closingIndex)
    .join("\n")
    .trim();
}

function removeTrailingOrphanFence(value: string): string {
  const lines = value.split("\n");
  let openFence: "```" | "~~~" | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(```|~~~)(.*)$/.exec(lines[index]);
    if (!match) continue;
    const fence = match[1] as "```" | "~~~";
    if (!openFence) {
      openFence = fence;
      continue;
    }
    if (openFence === fence && !match[2].trim()) openFence = undefined;
  }
  if (!openFence || lines.at(-1)?.trim() !== openFence) return value.trim();
  return lines.slice(0, -1).join("\n").trim();
}

export function normalizeResearchReportMarkdown(value: string): string {
  let normalized = unwrapOuterMarkdownFence(value);
  const titleIndex = normalized.search(/^#\s+\S/m);
  if (titleIndex > 0) normalized = normalized.slice(titleIndex);
  normalized = removeTrailingOrphanFence(normalized);
  return normalized
    .split("\n")
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!heading || heading[1].length === 1) return line;
      const canonical = REPORT_SECTION_ALIASES.get(
        normalizeAuditLabel(heading[2].replace(/[*_`]/g, "")),
      );
      return canonical ? `## ${canonical}` : line;
    })
    .join("\n")
    .trim();
}

function extractCitedUrls(markdown: string): string[] {
  return Array.from(markdown.matchAll(/https?:\/\/[^\s)\]>]+/gi), (match) =>
    canonicalizeResearchLocator(match[0].replace(/[.,;:!?]+$/, "")),
  );
}

function extractAuditSection(markdown: string, heading: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedHeading = normalizeAuditLabel(heading);
  let collecting = false;
  const section: string[] = [];
  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (collecting) break;
      collecting =
        normalizeAuditLabel(headingMatch[1].replace(/[*_`]/g, "")) ===
        normalizedHeading;
      continue;
    }
    if (collecting) section.push(line);
  }
  return section.join("\n").trim();
}

function containsExactStepId(section: string, stepId: string): boolean {
  const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`,
    "m",
  ).test(section);
}

export function getDegradedResearchStepIds(run: ResearchReportRun): string[] {
  const degradedNodeIds = new Set(
    run.waves.flatMap((wave) => wave.degradedNodeIds || []),
  );
  const stepIds = new Set<string>();
  const coveredStepIds = new Set(
    run.claims
      .filter(
        (claim) =>
          claim.importance === "major" &&
          claim.verificationStatus === "verified",
      )
      .map((claim) => claim.stepId),
  );
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
  const degradedStepIds = getDegradedResearchStepIds(run);
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
    `This is an automatically salvaged partial report. ${reason}`,
    "## Key findings",
    findings.length > 0
      ? findings.join("\n")
      : "No major claim met the approved verification threshold.",
    ...requiredSections,
    "## Research plan coverage",
    coverage.join("\n"),
    "## Evidence gaps",
    evidenceGaps,
    "## Sources",
    sources.length > 0 ? sources.join("\n") : "No formal evidence committed.",
  ].join("\n\n");
}

export function buildDeterministicRepairReport({
  task,
  plan,
  run,
  evidence,
}: {
  task: ResearchTask;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
}): string {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const findings = run.claims.flatMap((claim) => {
    if (claim.verificationStatus !== "verified") return [];
    const source = claim.supportingEvidenceIds
      .map((id) => evidenceById.get(id))
      .find(
        (item) =>
          item &&
          item.availability !== "unavailable" &&
          item.freshness !== "stale",
      );
    return source
      ? [
          `- [${claim.id}] ${claim.text} [${source.sourceId}](${source.locator})`,
        ]
      : [];
  });
  const coveredStepIds = new Set(getCoveredResearchStepIds(plan, run));
  const uncoveredSteps = plan.steps.filter(
    (step) => !coveredStepIds.has(step.id),
  );
  const degradedStepIds = getDegradedResearchStepIds(run);
  const unresolvedMajorClaims = run.claims.filter(
    (claim) =>
      claim.importance === "major" && claim.verificationStatus !== "verified",
  );
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
    .map((section) => [
      `## ${section}`,
      findings.length > 0
        ? [
            "Verified evidence for this requested section:",
            findings.join("\n"),
          ].join("\n\n")
        : "No verified finding is available for this requested section.",
    ]);
  const relevantEvidenceIds = new Set(
    run.claims.flatMap((claim) => [
      ...claim.supportingEvidenceIds,
      ...claim.contradictingEvidenceIds,
    ]),
  );
  const sources = evidence
    .filter(
      (item) =>
        relevantEvidenceIds.has(item.id) && item.availability !== "unavailable",
    )
    .slice(0, 200)
    .map(
      (item) =>
        `- [${item.sourceId}] [${item.title || item.locator}](${item.locator}) — retrieved ${new Date(item.retrievedAt).toISOString()}`,
    );
  const evidenceGaps = [
    ...uncoveredSteps.map(
      (step) =>
        `- ${step.id}: no verified major claim covers this approved step.`,
    ),
    ...degradedStepIds
      .filter((stepId) => !uncoveredSteps.some((step) => step.id === stepId))
      .map(
        (stepId) =>
          `- ${stepId}: the degraded wave archive was not covered by another verified claim.`,
      ),
    ...(unresolvedMajorClaims.length > 0
      ? [
          `- ${unresolvedMajorClaims.length} major claim(s) remain unsupported or unresolved.`,
        ]
      : []),
    ...(findings.length === 0
      ? ["- No auditable verified finding could be reconstructed."]
      : []),
  ];

  return [
    `# ${plan.title || task.goal}`,
    "## Executive summary",
    findings.length > 0
      ? `This report was reconstructed deterministically from the verified claim ledger and committed evidence after the model-authored report failed publication audit. It preserves ${findings.length} auditable finding(s) and covers ${coveredStepIds.size} of ${plan.steps.length} approved step(s).`
      : "No conclusion met the approved verification and citation requirements.",
    "## Key findings",
    findings.length > 0 ? findings.join("\n") : "",
    ...requiredSections.flat(),
    "## Research plan coverage",
    coverage.join("\n"),
    "## Evidence gaps",
    evidenceGaps.length > 0
      ? evidenceGaps.join("\n")
      : "No material evidence gaps.",
    "## Sources",
    sources.length > 0 ? sources.join("\n") : "No formal evidence committed.",
  ].join("\n\n");
}

export function auditResearchReport({
  markdown,
  plan,
  run,
  evidence,
  requiredEvidenceGapStepIds,
}: {
  markdown: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  requiredEvidenceGapStepIds?: readonly string[];
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

  const requiredGapStepIds = new Set([
    ...getDegradedResearchStepIds(run),
    ...(requiredEvidenceGapStepIds || []),
  ]);
  const orderedRequiredGapStepIds = plan.steps
    .map((step) => step.id)
    .filter((stepId) => requiredGapStepIds.has(stepId));
  const evidenceGaps = extractAuditSection(markdown, "Evidence gaps");
  const missingEvidenceGapStepIds = orderedRequiredGapStepIds.filter(
    (stepId) => !containsExactStepId(evidenceGaps, stepId),
  );
  if (missingEvidenceGapStepIds.length > 0) {
    issues.push(
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
