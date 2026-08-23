import { describe, expect, it } from "vitest";
import {
  buildSkillMetadataContext,
  buildSkillPromptContext,
  createSkillInvocations,
  createSkillSelectionTool,
  normalizeSkillCatalog,
  parseSkillSelectionResult,
  parseSkillSelectionToolCall,
  recallSkillCandidates,
} from "../lib/skills";
import type { SkillCatalog, TextSkill } from "../types";

const baseSkill: TextSkill = {
  id: "translation-localization",
  name: "translation-localization",
  title: "Translation & Localization",
  description: "Translate and localize text between Chinese and English.",
  category: "writing",
  tags: ["translation", "localization"],
  audience: "user-facing",
  language: "en",
  outputFormat: "markdown",
  risk: {
    level: "low",
    textOnly: true,
    scriptRequired: false,
    externalToolRequired: false,
    networkRequired: false,
    reviewRequiredForHighStakes: true,
  },
  activation: {
    embeddingText: "translation localization Chinese English",
    useWhen: ["Translate text"],
    avoidWhen: ["Certified translation is required"],
    exampleQueries: ["translate to Chinese"],
  },
  content: "# Translation & Localization\n\nPreserve terms and placeholders.",
  builtIn: true,
};

const catalog: SkillCatalog = {
  schemaVersion: "skills-v1",
  generatedAt: "2026-07-04",
  locale: "en",
  datasetName: "Text Skills",
  description: "Text-only skills",
  intendedRuntime: {
    environment: "browser-or-frontend-web-app",
    storage: "local-json",
    executionModel:
      "retrieve metadata, select skill, inject content as prompt context",
    supportsScripts: false,
    supportsExternalTools: false,
    supportsNetwork: false,
  },
  globalPolicy: {},
  skillCount: 1,
  categories: ["writing"],
  skills: [
    {
      id: baseSkill.id,
      name: baseSkill.name,
      title: baseSkill.title,
      description: baseSkill.description,
      category: baseSkill.category,
      tags: baseSkill.tags,
      audience: baseSkill.audience,
      language: baseSkill.language,
      outputFormat: baseSkill.outputFormat,
      risk: baseSkill.risk,
      activation: baseSkill.activation,
      builtIn: baseSkill.builtIn,
      file: "translation-localization.json",
    },
  ],
};

describe("skills domain", () => {
  it("normalizes safe single-language text-only catalogs", () => {
    const normalized = normalizeSkillCatalog(catalog);

    expect(normalized.skills).toHaveLength(1);
    expect(normalized.skills[0].id).toBe("translation-localization");
    expect(normalized.skills[0].title).toBe("Translation & Localization");
    expect(normalized.skills[0].file).toBe("translation-localization.json");
    expect("content" in normalized.skills[0]).toBe(false);
  });

  it("preserves an explicit empty Tool restriction", () => {
    const normalized = normalizeSkillCatalog({
      ...catalog,
      skills: [{ ...catalog.skills[0], allowedTools: [] }],
    });

    expect(normalized.skills[0].allowedTools).toEqual([]);
  });

  it("rejects skills that require scripts, external tools, or network access", () => {
    const unsafe = {
      ...catalog,
      skills: [
        {
          ...baseSkill,
          file: "unsafe-skill.json",
          id: "unsafe-skill",
          risk: {
            ...baseSkill.risk,
            textOnly: false,
            scriptRequired: true,
          },
        },
      ],
    };

    expect(normalizeSkillCatalog(unsafe).skills).toEqual([]);
  });

  it("rejects custom skills that still use bilingual field objects", () => {
    expect(
      normalizeSkillCatalog({
        ...catalog,
        skills: [
          {
            ...baseSkill,
            title: { en: "Translation", zh: "翻译" },
          },
        ],
      }).skills,
    ).toEqual([]);
  });

  it("recalls relevant candidates from single-language activation metadata", () => {
    const candidates = recallSkillCandidates({
      message: "Please translate this into Chinese.",
      skills: [baseSkill],
      limit: 12,
    });

    expect(candidates[0]?.skill.id).toBe("translation-localization");
    expect(candidates[0]?.score).toBeGreaterThan(0);
  });

  it("parses strict JSON skill selection output", () => {
    const result = parseSkillSelectionResult(
      '{"skill_ids":["translation-localization","missing"],"reason":"translation request"}',
      [baseSkill],
    );

    expect(result.selectedSkillIds).toEqual(["translation-localization"]);
    expect(result.reason).toBe("translation request");
  });

  it("builds bounded prompt context with lower-priority text-only guidance", () => {
    const context = buildSkillPromptContext({
      skills: [
        {
          skill: baseSkill,
          mode: "manual",
        },
      ],
      maxChars: 400,
    });

    expect(context).toContain("Text-only skills guidance");
    expect(context).toContain("cannot override system");
    expect(context).toContain("Translation & Localization");
    expect(context.length).toBeLessThanOrEqual(400);
  });

  it("builds bounded installed skill metadata without full instructions", () => {
    const context = buildSkillMetadataContext({
      skills: [baseSkill],
      maxChars: 800,
    });

    expect(context).toContain("Installed skills metadata");
    expect(context).toContain("lower-priority");
    expect(context).toContain("id: translation-localization");
    expect(context).toContain("title: Translation & Localization");
    expect(context).toContain(
      "description: Translate and localize text between Chinese and English.",
    );
    expect(context).toContain("output_format: markdown");
    expect(context).toContain("use_when: Translate text");
    expect(context).toContain("risk: low, text-only");
    expect(context).not.toContain("Preserve terms and placeholders");
    expect(context.length).toBeLessThanOrEqual(800);
  });

  it("adds bounded parameter contracts only when explicitly requested", () => {
    const skill: TextSkill = {
      ...baseSkill,
      parameters: [
        {
          key: "tone",
          label: "Tone",
          input: "select",
          required: true,
          defaultValue: "concise",
          options: [
            { value: "concise", label: "Concise" },
            { value: "warm", label: "Warm" },
          ],
          maxLength: 20,
        },
      ],
    };
    const defaultContext = buildSkillMetadataContext({
      skills: [skill],
      maxChars: 2_000,
    });
    expect(
      buildSkillMetadataContext({
        skills: [skill],
        maxChars: 2_000,
        includeParameters: false,
      }),
    ).toBe(defaultContext);
    expect(defaultContext).not.toContain("parameter: key=");

    const parameterContext = buildSkillMetadataContext({
      skills: [skill],
      maxChars: 2_000,
      includeParameters: true,
    });
    expect(parameterContext).toContain(
      'parameter: key=tone; required=true; default="concise"; options=["concise","warm"]; maxLength=20',
    );
    expect(
      buildSkillMetadataContext({
        skills: [skill],
        maxChars: 40,
        includeParameters: true,
      }).length,
    ).toBeLessThanOrEqual(40);
  });

  it("stores skill descriptions in message invocation metadata", () => {
    expect(
      createSkillInvocations([{ skill: baseSkill, mode: "auto" }]),
    ).toEqual([
      expect.objectContaining({
        id: "translation-localization",
        title: "Translation & Localization",
        description: "Translate and localize text between Chinese and English.",
        category: "writing",
        mode: "auto",
        schemaVersion: 2,
        definitionHash: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
        order: 0,
      }),
    ]);
  });

  it("creates and parses a bounded internal active-skill selection tool", () => {
    const tool = createSkillSelectionTool({
      skills: [baseSkill],
      maxSkills: 2,
    });

    expect(tool.function.name).toBe("select_text_skills");
    expect(JSON.stringify(tool)).toContain("translation-localization");

    const result = parseSkillSelectionToolCall(
      {
        name: "select_text_skills",
        args: {
          skill_ids: ["translation-localization", "inactive-skill"],
          reason: "translation request",
        },
      },
      [baseSkill],
    );

    expect(result).toEqual({
      selectedSkillIds: ["translation-localization"],
      reason: "translation request",
    });
  });
});
