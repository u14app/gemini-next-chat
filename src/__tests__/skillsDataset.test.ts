import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSkillCatalog, normalizeTextSkill } from "../lib/skills";

const skillsDir = resolve(process.cwd(), "public/data/skills");
const V2_BUILTIN_IDS = new Set([
  "requirements-interview",
  "deep-research",
  "citation-evidence-audit",
  "workspace-document-builder",
  "tabular-analysis",
  "execution-verifier",
]);

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("public skills dataset", () => {
  it("ships modular localized text-only skills data under public/data/skills", () => {
    const schema = readJson(
      resolve(process.cwd(), "public/data/skills.schema.json"),
    );
    const englishCatalog = normalizeSkillCatalog(
      readJson(resolve(skillsDir, "skills.metadata.json")),
    );
    const zhCatalog = normalizeSkillCatalog(
      readJson(resolve(skillsDir, "skills.metadata.zh-CN.json")),
    );
    const jaCatalog = normalizeSkillCatalog(
      readJson(resolve(skillsDir, "skills.metadata.ja.json")),
    );
    const ids = new Set(englishCatalog.skills.map((skill) => skill.id));

    expect(schema.$id).toBe("skills.schema.json");
    expect(schema.title).toBe("Skills Dataset");
    expect(englishCatalog.schemaVersion).toBe("skills-v2");
    expect(zhCatalog.schemaVersion).toBe("skills-v2");
    expect(jaCatalog.schemaVersion).toBe("skills-v2");
    expect(englishCatalog.skills).toHaveLength(63);
    expect(zhCatalog.skills).toHaveLength(63);
    expect(jaCatalog.skills).toHaveLength(63);
    expect(ids.size).toBe(63);
    expect(englishCatalog.skillCount).toBe(63);
    expect(jaCatalog.skillCount).toBe(63);
    expect(jaCatalog.locale).toBe("ja");
    expect(englishCatalog.categories).toContain("writing");
    expect(jaCatalog.categories).toEqual(englishCatalog.categories);
    expect(englishCatalog.skills.every((skill) => !("content" in skill))).toBe(
      true,
    );
    expect(
      englishCatalog.skills.every(
        (skill) =>
          skill.title &&
          skill.description &&
          skill.file &&
          !skill.file.includes("..") &&
          existsSync(resolve(skillsDir, skill.file)),
      ),
    ).toBe(true);
    expect(
      zhCatalog.skills.every((skill) => {
        const file = skill.file;
        return (
          Boolean(file) &&
          (V2_BUILTIN_IDS.has(skill.id)
            ? file ===
              englishCatalog.skills.find((entry) => entry.id === skill.id)?.file
            : file!.endsWith(".zh-CN.json")) &&
          existsSync(resolve(skillsDir, file!))
        );
      }),
    ).toBe(true);
    expect(
      jaCatalog.skills.every((skill) => {
        const enEntry = englishCatalog.skills.find(
          (englishSkill) => englishSkill.id === skill.id,
        );
        return Boolean(
          enEntry &&
          skill.file === enEntry.file &&
          skill.language === "ja" &&
          skill.title &&
          skill.description &&
          existsSync(resolve(skillsDir, skill.file!)),
        );
      }),
    ).toBe(true);
    expect(
      jaCatalog.skills.find((skill) => skill.id === "translation-localization"),
    ).toMatchObject({
      title: "翻訳とローカライズ",
      file: "translation-localization.json",
    });

    for (const entry of englishCatalog.skills) {
      expect(entry.file).toBeTruthy();
      const entryFile = entry.file!;
      const enDefinition = normalizeTextSkill(
        readJson(resolve(skillsDir, entryFile)),
      );
      const zhEntry = zhCatalog.skills.find((skill) => skill.id === entry.id);
      expect(zhEntry).toBeTruthy();
      expect(zhEntry?.file).toBeTruthy();
      const zhEntryFile = zhEntry!.file!;
      const zhDefinition = normalizeTextSkill(
        readJson(resolve(skillsDir, zhEntryFile)),
      );

      expect(enDefinition?.content).toBeTruthy();
      expect(zhDefinition?.content).toBeTruthy();
      if (enDefinition?.version === "2.0.0") {
        expect(enDefinition).toMatchObject({
          version: "2.0.0",
          publisher: "Neo Chat",
          source: "builtin",
          runtime: {
            kind: "declarative_text",
            supportsScripts: false,
            acceptsPlaintextSecrets: false,
          },
          outputContract: expect.any(Object),
          evalCases: expect.any(Array),
        });
        expect(enDefinition!.content.length).toBeGreaterThan(600);
        expect(Array.isArray(enDefinition?.allowedTools)).toBe(true);
      } else {
        expect(enDefinition!.content.length).toBeGreaterThan(1_000);
        expect(zhDefinition!.content.length).toBeGreaterThan(900);
        expect(enDefinition!.content).toContain("## Output Contract");
        expect(zhDefinition!.content).toContain("## 输出要求");
        expect(enDefinition?.risk.externalToolRequired).toBe(false);
        expect(zhDefinition?.risk.externalToolRequired).toBe(false);
        expect(enDefinition?.risk.networkRequired).toBe(false);
        expect(zhDefinition?.risk.networkRequired).toBe(false);
      }
      expect(enDefinition?.risk.textOnly).toBe(true);
      expect(zhDefinition?.risk.textOnly).toBe(true);
      expect(enDefinition?.risk.scriptRequired).toBe(false);
      expect(zhDefinition?.risk.scriptRequired).toBe(false);
    }
  });

  it("does not keep legacy dataset names or runtime files", () => {
    const legacyRuntimeFile = ["skills", "v1", "json"].join(".");
    const legacyPrefix = ["frontend", "text"].join("-");
    const legacyLabel = ["Frontend", "Text-Only"].join(" ");
    const schemaSource = readFileSync(
      resolve(process.cwd(), "public/data/skills.schema.json"),
      "utf8",
    );
    const skillsSource = readFileSync(
      resolve(process.cwd(), "src/lib/skills/index.ts"),
      "utf8",
    );
    const skillServiceSource = readFileSync(
      resolve(process.cwd(), "src/services/api/skillService.ts"),
      "utf8",
    );

    expect(
      existsSync(resolve(process.cwd(), "public/data", legacyRuntimeFile)),
    ).toBe(false);
    expect(schemaSource).not.toContain(legacyPrefix);
    expect(schemaSource).not.toContain(legacyLabel);
    expect(skillsSource).not.toContain(legacyPrefix);
    expect(skillServiceSource).not.toContain(legacyRuntimeFile);
  });
});
