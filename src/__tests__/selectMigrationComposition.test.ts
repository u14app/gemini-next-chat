import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migratedSelectSurfaces = [
  "src/components/settings/SearchSettings.tsx",
  "src/components/knowledge/KnowledgeBase.tsx",
  "src/components/knowledge/AddToKnowledgeModal.tsx",
  "src/components/search/GlobalSearchCenter.tsx",
  "src/components/assistant/AssistantHub.tsx",
  "src/components/skill/SkillParameterEditor.tsx",
  "src/components/skill/SkillBundleEditor.tsx",
  "src/components/skill/SkillParameterDialog.tsx",
];

describe("native select migration", () => {
  it.each(migratedSelectSurfaces)("uses CustomSelect in %s", (path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");

    expect(source).toContain("CustomSelect");
    expect(source).not.toContain("<select");
    expect(source).not.toContain("<option");
  });
});
