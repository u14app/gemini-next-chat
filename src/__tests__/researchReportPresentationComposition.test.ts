import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Research report presentation composition", () => {
  it("keeps supplements out of the report body while exporting one complete version", () => {
    const workbenchDir = resolve(
      process.cwd(),
      "src/components/research/workbench",
    );
    const workbench = readFileSync(
      resolve(workbenchDir, "ResearchWorkbench.tsx"),
      "utf8",
    );
    const reportPanel = readFileSync(
      resolve(workbenchDir, "ReportPanel.tsx"),
      "utf8",
    );
    const connected = readFileSync(
      resolve(
        process.cwd(),
        "src/components/research/ConnectedResearchViews.tsx",
      ),
      "utf8",
    );

    expect(workbench).toContain('tab === "supplements"');
    expect(workbench).toContain("SupplementPanel");
    expect(workbench).toContain("createReportPresentation");
    expect(workbench).not.toContain("<ResearchRunRail run={task.run} />");
    expect(reportPanel).toContain("ReportTrustSummary");
    expect(reportPanel).toContain('t("report.gapsTitle")');
    expect(reportPanel).toContain('t("report.changeSummary")');
    expect(reportPanel).toContain("report.diff");
    expect(reportPanel).toContain("report.audit");
    expect(reportPanel).toContain("DropdownMenu");
    expect(reportPanel).toContain('t("actions.downloadReport")');
    expect(reportPanel).toContain("imageSources={imageSources}");
    expect(reportPanel).not.toContain("ResearchImageGallery");
    expect(connected).toContain("createReportPresentation");
    expect(connected).toContain("report.markdown");
    expect(connected).toContain("imageSources={printReport.imageSources}");
    expect(connected).not.toContain("appendResearchImageMaterialsMarkdown");
    expect(connected).not.toContain('t("export.metadata")');
    expect(connected).not.toContain('t("export.taskId")');
    expect(connected).not.toContain('t("export.evidenceCount")');
  });
});
