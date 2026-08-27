import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Research model routing composition", () => {
  it("persists the request model before the first planning round", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/research/ResearchRuntimeProvider.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("requestModel?: string");
    expect(source).toMatch(
      /resolveTaskContext\(\s*initial,\s*requestModel,?\s*\)/u,
    );
    expect(source).toMatch(
      /createSourceSnapshot\(\s*initial,\s*requestModel,?\s*\)/u,
    );
    expect(source).toContain("sourceSnapshot: provisionalSnapshot");
    expect(source).toContain(
      "void preparePlan(withRun.id, undefined, context.model)",
    );
  });

  it("repairs one invalid wave without tools and preserves a protocol stop reason", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/research/ResearchRuntimeProvider.tsx",
      ),
      "utf8",
    );

    expect(source.match(/buildResearchWaveRepairPrompt\(\{/gu)).toHaveLength(1);
    expect(source).toContain(".filter(isCommittedCheckpointToolCall)");
    expect(source).toMatch(
      /buildResearchWaveRepairPrompt\([\s\S]{0,4000}chatMode: "chat",[\s\S]{0,2000}disableTools: true/u,
    );
    expect(source).toContain('code: "invalid_model_output"');
    expect(source).toContain(
      'researchRun.stopReason?.code !== "invalid_model_output"',
    );
    expect(
      source.match(
        /chatMode: "chat",\s+useAgentMode: false,\s+useDeepResearch: false/gu,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("uses the shared localized Tool-name resolver in Research activity", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/research/ConnectedResearchViews.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('useTranslations("Content")');
    expect(source).toContain("getBuiltinToolLabelKey(tool)");
    expect(source).toContain("contentT(labelKey)");
    expect(source).toContain("formatToolDisplayName(tool)");
  });
});
