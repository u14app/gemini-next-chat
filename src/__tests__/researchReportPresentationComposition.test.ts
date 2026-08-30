import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Research report presentation composition", () => {
  it("keeps audit metadata outside the report panel and exports", () => {
    const workbenchDir = resolve(
      process.cwd(),
      "src/components/research/workbench",
    );
    const workbench = readdirSync(workbenchDir)
      .map((file) => readFileSync(resolve(workbenchDir, file), "utf8"))
      .join("\n");
    const connected = readFileSync(
      resolve(
        process.cwd(),
        "src/components/research/ConnectedResearchViews.tsx",
      ),
      "utf8",
    );

    expect(workbench).not.toContain('t("card.knownGaps")');
    expect(workbench).not.toContain("report.changeSummary");
    expect(workbench).not.toContain("report.diff");
    expect(connected).not.toContain('t("export.metadata")');
    expect(connected).not.toContain('t("export.taskId")');
    expect(connected).not.toContain('t("export.evidenceCount")');
  });
});
