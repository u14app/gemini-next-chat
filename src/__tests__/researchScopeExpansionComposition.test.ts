import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeSource = readFileSync(
  resolve(process.cwd(), "src/features/research/ResearchRuntimeProvider.tsx"),
  "utf8",
);

describe("Deep Research scope expansion composition", () => {
  it("refreshes authorized conversation sources and continues the same run", () => {
    expect(runtimeSource).toContain("refreshExpansionSources(wavePackets)");
    expect(runtimeSource).toContain(
      "allowedSourceTypes: expansionSources.allowedSourceTypes",
    );
    expect(runtimeSource).toContain("scopeExpansionEvents");
    expect(runtimeSource).not.toContain(
      "buildResearchScopeExpansionAdjustment",
    );
    expect(runtimeSource).not.toContain("pendingScopeAdjustment");
  });

  it("resumes legacy scope pauses from stored packets without replanning", () => {
    const legacyBranch = runtimeSource
      .split('if (task.error?.code === "RESEARCH_SCOPE_APPROVAL_REQUIRED")')[1]
      ?.split("const resumeStatus")[0];

    expect(legacyBranch).toBeTruthy();
    expect(legacyBranch).toContain("activeRun.learningPackets");
    expect(legacyBranch).toContain("recordPacket: false");
    expect(legacyBranch).toContain(
      'transitionResearchTask(withRun, "researching"',
    );
    expect(legacyBranch).toContain("launchResearch(taskId)");
    expect(legacyBranch).not.toContain("preparePlan");
  });
});
