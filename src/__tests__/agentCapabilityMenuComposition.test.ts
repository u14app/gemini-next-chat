import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AgentCapabilityMenu composition", () => {
  it("keeps every capability in a compact two-column summary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/agent/AgentCapabilityMenu.tsx"),
      "utf8",
    );

    expect(source).toContain("grid grid-cols-2 gap-px");
    expect(source.match(/min-h-11/g)).toHaveLength(2);
    expect(source.match(/md:min-h-9/g)).toHaveLength(2);
    expect(source).toContain("<dl");
    expect(source).toContain("<dt");
    expect(source).toContain("<dd");
    [
      "agentCapabilitiesTools",
      "agentCapabilitiesPlugins",
      "agentCapabilitiesSkills",
      "agentCapabilitiesMemory",
      "agentCapabilitiesKnowledge",
      "agentCapabilitiesSearch",
    ].forEach((translationKey) => {
      expect(source).toContain(`t("${translationKey}")`);
    });
  });

  it("retains toggle semantics and the Artifact entry point", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/agent/AgentCapabilityMenu.tsx"),
      "utf8",
    );

    expect(source).toContain("aria-pressed={enabled}");
    expect(source).toContain("disabled={!supported}");
    expect(source).toContain("onOpenArtifacts();");
    expect(source).toContain("disabled={!summary.workspaceAvailable}");
    expect(source).toContain('className="w-80 overflow-hidden p-0"');
    expect(source).toContain('placement="responsive-sheet"');
  });
});
