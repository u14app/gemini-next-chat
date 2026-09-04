import { createReportPresentation } from "@/components/research/workbench/workbenchUtils";
import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/Research.json";
import zh from "@/i18n/locales/zh/Research.json";
import ja from "@/i18n/locales/ja/Research.json";
import {
  projectResearchReport,
  extractReportSection,
  omitReportSections,
} from "@/lib/research/reportSections";
import { normalizeResearchReportMarkdown } from "@/lib/research/reportAudit/normalize";
import {
  summarizeResearchReport,
  parseResearchStepCoverage,
} from "@/lib/research/prompts/reportSummary";

const report = `# Research

> Quality limitation.

## Executive summary
Summary with [a reference][ref] and a note[^note].

## Key findings
- An established finding.

## Custom analysis
Keep this section.

\`\`\`markdown
## Sources
This is code, not an appendix.
\`\`\`

## Knowledge supplement
Unverified background.

## Evidence gaps
- Needs verification.

## Sources
[ref]: https://example.com/source
[^note]: A note used by the body.
`;

describe("Research report sections", () => {
  it.each([en, zh, ja])(
    "localizes and partitions without losing references or custom content",
    (messages) => {
      const view = projectResearchReport(report, messages.report.sections);
      expect(view.bodyMarkdown).toContain(
        `## ${messages.report.sections.executiveSummary}`,
      );
      expect(view.bodyMarkdown).toContain("Quality limitation.");
      expect(view.bodyMarkdown).toContain("## Custom analysis");
      expect(view.bodyMarkdown).toContain(
        "```markdown\n## Sources\nThis is code",
      );
      expect(view.bodyMarkdown).not.toContain("Unverified background.");
      expect(view.supplementsMarkdown).toContain("Unverified background.");
      expect(view.supplementsMarkdown).toContain("Needs verification.");
      expect(view.bodyMarkdown).toContain("[ref]: https://example.com/source");
      expect(view.bodyMarkdown).toContain("[^note]: A note used by the body.");
      expect(view.markdown).toContain("Unverified background.");
      expect(
        extractReportSection(view.markdown, "Executive summary"),
      ).toContain("Summary with");
      expect(summarizeResearchReport(view.markdown).keyFindings).toEqual([
        "An established finding.",
      ]);
    },
  );

  it("preserves localized headings and code through normalization and coverage parsing", () => {
    const input =
      "# 报告\n\n## 执行摘要\n摘要。\n\n## 研究计划覆盖情况\n- step-1: answered - 完成\n\n```markdown\n## Sources\n```";
    expect(normalizeResearchReportMarkdown(input)).toBe(input);
    expect(parseResearchStepCoverage(input, ["step-1"])).toEqual(["step-1"]);
  });

  it("keeps UI citation anchors out of downloads and code examples", () => {
    const markdown =
      "# Report\n\n## Key findings\nA fact [Source 1].\n\n```markdown\n[Source 1]\n```\n\n## Sources\n[Source 1] Local source";
    const view = createReportPresentation(
      markdown,
      [
        {
          id: "e1",
          title: "Local source",
          sourceType: "knowledge",
          retrievedAt: 1,
          linkedClaims: [],
        },
      ],
      en.report.sections,
    );
    expect(view.markdown).toBe(markdown);
    expect(view.bodyMarkdown).toContain("A fact [Source 1](#citation-0).");
    expect(view.bodyMarkdown).toContain("```markdown\n[Source 1]\n```");
  });

  it("keeps shared definitions when replacing a gaps section", () => {
    const input =
      "# Report\n\n## Key findings\nA finding [a][ref].\n\n## Evidence gaps\nUnknown.\n\n[ref]: https://example.com\n[^n]: note";
    const output = omitReportSections(input, ["evidenceGaps"]);
    expect(output).not.toContain("Unknown.");
    expect(output).toContain("[ref]: https://example.com");
    expect(output).toContain("[^n]: note");
  });

  it("preserves links inside headings", () => {
    const input =
      "# Report\n\n## [Sources](https://example.com)\nA linked chapter.";
    expect(projectResearchReport(input, zh.report.sections).markdown).toBe(
      input,
    );
  });

  it("does not manufacture an appendix for body-only documents", () => {
    const input =
      "# Report\n\n## Analysis\nBody [x][r].\n\n[r]: https://example.com";
    expect(projectResearchReport(input, en.report.sections)).toEqual({
      markdown: input,
      bodyMarkdown: input,
      supplementsMarkdown: "",
    });
  });
});
