import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hooksRoot = resolve(process.cwd(), "src/hooks/research");
const runtimeRoot = resolve(process.cwd(), "src/lib/research/runtime");

function readDirectorySource(directory: string): string {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => readFileSync(join(directory, entry), "utf8"))
    .join("\n");
}

const waveSource = readDirectorySource(join(runtimeRoot, "wave"));
const featureSource = [
  readFileSync(
    resolve(
      process.cwd(),
      "src/components/research/ResearchRuntimeProvider.tsx",
    ),
    "utf8",
  ),
  readDirectorySource(hooksRoot),
  readDirectorySource(runtimeRoot),
  waveSource,
  readDirectorySource(join(runtimeRoot, "stages")),
].join("\n");

const taskActionsSource = readFileSync(
  join(hooksRoot, "useResearchTaskActions.ts"),
  "utf8",
);

describe("Deep Research scope expansion composition", () => {
  it("refreshes authorized conversation sources and continues the same run", () => {
    expect(waveSource).toContain("refreshExpansionSources(ctx, wavePackets)");
    expect(waveSource).toContain(
      "allowedSourceTypes: expansionSources.allowedSourceTypes",
    );
    expect(waveSource).toContain("scopeExpansionEvents");
    expect(featureSource).not.toContain(
      "buildResearchScopeExpansionAdjustment",
    );
    expect(featureSource).not.toContain("pendingScopeAdjustment");
  });

  it("resumes legacy scope pauses from stored packets without replanning", () => {
    const dispatch = taskActionsSource
      .split('if (task.error?.code === "RESEARCH_SCOPE_APPROVAL_REQUIRED")')[1]
      ?.split("const resumeStatus")[0];
    const legacyBranch = readFileSync(
      join(runtimeRoot, "resumeLegacyScope.ts"),
      "utf8",
    );

    expect(dispatch).toBeTruthy();
    expect(dispatch).toContain("resumeLegacyScopeApproval({");
    expect(dispatch).not.toContain("preparePlan");
    expect(legacyBranch).toContain("activeRun.learningPackets");
    expect(legacyBranch).toContain("recordPacket: false");
    expect(legacyBranch).toContain(
      'transitionResearchTask(withRun, "researching"',
    );
    expect(legacyBranch).toContain("launchResearch(taskId)");
    expect(legacyBranch).not.toContain("preparePlan");
  });
});
