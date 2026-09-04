import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILTIN_RESEARCH_TEMPLATES,
  applyResearchTemplateDefaults,
  createResearchTemplateFromPlan,
  localizeResearchTemplate,
  resolveResearchTemplate,
  type ResearchTemplate,
} from "@/lib/research/templates";
import {
  createResearchTemplate,
  deleteResearchTemplate,
  duplicateResearchTemplate,
  freezeResearchTaskTemplate,
  getFrozenResearchTaskTemplate,
  getResearchTemplate,
  listResearchTemplates,
  updateResearchTemplate,
} from "@/services/research/templates";
import { RESEARCH_STRATEGY_PRESETS } from "@/lib/research/orchestration";
import {
  createMemoryResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
} from "@/services/research/extensionRepository";
import {
  DEFAULT_AGENT_PROFILE,
  normalizeAgentProfile,
  resolveAgentProfile,
} from "@/lib/assistant/profile";

const customInput = {
  name: "Internal review",
  description: "A focused review for an internal decision.",
  deliverableKind: "decision_memo" as const,
  requiredSections: ["Decision", "Risks"],
  sourcePriorities: [
    { sourceType: "workspace" as const, priority: "high" as const },
  ],
};

describe("Research templates", () => {
  beforeEach(() => {
    setResearchExtensionRepositoryForTests(
      createMemoryResearchExtensionRepository(),
    );
  });

  afterEach(() => {
    setResearchExtensionRepositoryForTests(undefined);
  });

  it("ships four standard, permission-free built-in templates", () => {
    expect(BUILTIN_RESEARCH_TEMPLATES).toHaveLength(4);
    expect(BUILTIN_RESEARCH_TEMPLATES.map((template) => template.id)).toEqual([
      "competitive-analysis",
      "literature-review",
      "due-diligence",
      "technical-evaluation",
    ]);
    for (const template of BUILTIN_RESEARCH_TEMPLATES) {
      expect(template.strategy).toEqual(RESEARCH_STRATEGY_PRESETS.standard);
      expect(template.requiredSections.length).toBeGreaterThan(0);
      expect(template.sourcePriorities.length).toBeGreaterThan(0);
      expect(template).not.toHaveProperty("pluginIds");
      expect(template).not.toHaveProperty("budget");
    }
  });

  it("persists custom templates, increments revisions, and copies built-ins", async () => {
    const created = await createResearchTemplate({
      ...customInput,
      id: "internal-review",
      now: 100,
    });
    expect(await getResearchTemplate(created.id)).toMatchObject({
      id: "internal-review",
      revision: 1,
      createdAt: 100,
    });

    const updated = await updateResearchTemplate(created.id, {
      requiredSections: ["Decision", "Risks", "Next steps"],
    });
    expect(updated.revision).toBe(2);
    expect(updated.requiredSections).toEqual([
      "Decision",
      "Risks",
      "Next steps",
    ]);

    const copied = await duplicateResearchTemplate("due-diligence", {
      id: "my-diligence",
      name: "My diligence",
    });
    expect(copied.builtIn).toBeUndefined();
    expect(copied.requiredSections).toEqual(
      BUILTIN_RESEARCH_TEMPLATES.find(
        (template) => template.id === "due-diligence",
      )?.requiredSections,
    );
    expect(
      (await listResearchTemplates()).map((template) => template.id),
    ).toContain("my-diligence");

    await deleteResearchTemplate(created.id);
    expect(await getResearchTemplate(created.id)).toBeNull();
    await expect(deleteResearchTemplate("due-diligence")).rejects.toThrow(
      "cannot be deleted",
    );
  });

  it("updates revisions atomically without allowing identity fields to drift", async () => {
    const created = await createResearchTemplate({
      ...customInput,
      id: "atomic-template",
      now: 200,
    });
    const [first, second] = await Promise.all([
      updateResearchTemplate(created.id, {
        name: "First revision",
      }),
      updateResearchTemplate(created.id, {
        name: "Second revision",
        ...({
          id: "wrong-id",
          schemaVersion: 999,
          builtIn: true,
          createdAt: 1,
        } as unknown as Record<string, never>),
      }),
    ]);
    expect(new Set([first.revision, second.revision])).toEqual(new Set([2, 3]));
    const latest = await getResearchTemplate(created.id);
    expect(latest).toMatchObject({
      id: created.id,
      revision: 3,
      createdAt: 200,
    });
    expect(latest?.builtIn).toBeUndefined();
  });

  it("freezes the first task template and preserves an explicit disable", async () => {
    const selected = await createResearchTemplate({
      ...customInput,
      id: "selected",
    });
    const first = await freezeResearchTaskTemplate("task-1", selected, 10);
    expect(first.template?.id).toBe("selected");

    const changed = await duplicateResearchTemplate("selected", {
      id: "selected-copy",
    });
    const second = await freezeResearchTaskTemplate("task-1", changed, 20);
    expect(second.template?.id).toBe("selected");
    expect((await getFrozenResearchTaskTemplate("task-1"))?.capturedAt).toBe(
      10,
    );

    const disabled = await freezeResearchTaskTemplate("task-2", null, 30);
    expect(disabled).toEqual({ template: null, capturedAt: 30 });
    expect(await getFrozenResearchTaskTemplate("task-2")).toEqual(disabled);
  });

  it("freezes built-in contract text in the task locale and leaves custom text unchanged", async () => {
    const builtIn = BUILTIN_RESEARCH_TEMPLATES.find(
      (template) => template.id === "due-diligence",
    );
    if (!builtIn) throw new Error("Expected the due diligence template.");

    const zh = await freezeResearchTaskTemplate(
      "task-zh",
      builtIn,
      40,
      "zh-CN",
    );
    expect(zh.template?.name).toBe("尽职调查");
    expect(zh.template?.requiredSections).toEqual([
      "主体与范围",
      "关键事实",
      "风险与证据缺口",
      "待核实事项",
      "建议",
    ]);

    const ja = localizeResearchTemplate(builtIn, "ja-JP");
    expect(ja.requiredSections).toContain("確認事項");

    const custom = await createResearchTemplate({
      ...customInput,
      id: "localized-custom",
      requiredSections: ["Keep this heading"],
    });
    const customSnapshot = await freezeResearchTaskTemplate(
      "task-custom",
      custom,
      41,
      "zh-CN",
    );
    expect(customSnapshot.template?.requiredSections).toEqual([
      "Keep this heading",
    ]);
  });

  it("keeps the initial template contract when a model emits other defaults", () => {
    const template = BUILTIN_RESEARCH_TEMPLATES.find(
      (item) => item.id === "competitive-analysis",
    );
    if (!template) throw new Error("Expected the competitive template.");
    const plan = {
      title: "Comparison",
      summary: "Compare the options.",
      objective: "Compare the options.",
      scope: {
        audience: "Decision makers",
        includes: ["Options"],
        excludes: [],
        allowedSourceTypes: ["web" as const],
      },
      assumptions: [],
      deliverable: {
        kind: "research_report" as const,
        description: "Model default",
        requiredSections: ["Model section"],
      },
      strategy: { ...RESEARCH_STRATEGY_PRESETS.standard },
      steps: [
        {
          id: "step-1",
          title: "Compare",
          objective: "Compare.",
          questions: ["Which is stronger?"],
          queryTopics: ["comparison"],
          sourcePriorities: [
            { sourceType: "web" as const, priority: "low" as const },
          ],
          evidenceCriteria: ["Direct source"],
          priority: "high" as const,
        },
      ],
      completionCriteria: ["Complete"],
    };
    const initial = applyResearchTemplateDefaults(plan, template, true);
    expect(initial.deliverable.kind).toBe("comparison");
    expect(initial.deliverable.requiredSections).toEqual([
      ...template.requiredSections,
      "Model section",
    ]);
    expect(initial.steps[0].sourcePriorities[0]).toMatchObject({
      sourceType: "web",
      priority: "high",
    });
  });

  it("keeps template layers ordered and carries plan defaults into a template", async () => {
    const workspace = BUILTIN_RESEARCH_TEMPLATES[0];
    const profile = BUILTIN_RESEARCH_TEMPLATES[1];
    expect(resolveResearchTemplate(workspace, profile)?.id).toBe(
      "literature-review",
    );
    expect(resolveResearchTemplate(workspace, profile, null)).toBeNull();
    expect(resolveResearchTemplate(workspace, undefined)?.id).toBe(
      "competitive-analysis",
    );

    const input = createResearchTemplateFromPlan(
      {
        deliverable: {
          kind: "comparison",
          description: "Compare two options.",
          requiredSections: ["Matrix"],
        },
        strategy: { ...RESEARCH_STRATEGY_PRESETS.standard },
        steps: [
          {
            id: "step-1",
            title: "Compare",
            objective: "Compare options.",
            questions: ["Which is stronger?"],
            queryTopics: ["official comparison"],
            sourcePriorities: [
              { sourceType: "web", priority: "high" },
              { sourceType: "plugin", priority: "medium" },
            ],
            evidenceCriteria: ["Direct source"],
            priority: "high",
          },
        ],
      },
      { name: "Saved plan", description: "Saved from a plan." },
    );
    expect(input).toMatchObject({
      deliverableKind: "comparison",
      requiredSections: ["Matrix"],
      sourcePriorities: [
        { sourceType: "web", priority: "high" },
        { sourceType: "plugin", priority: "medium" },
      ],
    });
  });

  it("normalizes portable profile snapshots and preserves null disable", () => {
    const profileTemplate: ResearchTemplate = {
      ...BUILTIN_RESEARCH_TEMPLATES[2],
      requiredSections: [...BUILTIN_RESEARCH_TEMPLATES[2].requiredSections],
    };
    const profile = normalizeAgentProfile({
      ...DEFAULT_AGENT_PROFILE,
      researchTemplate: profileTemplate,
    });
    expect(profile?.researchTemplate?.id).toBe("due-diligence");
    expect(
      resolveAgentProfile({ researchTemplate: profileTemplate })
        .researchTemplate?.id,
    ).toBe("due-diligence");
    expect(
      normalizeAgentProfile({
        ...DEFAULT_AGENT_PROFILE,
        researchTemplate: null,
      })?.researchTemplate,
    ).toBeNull();
  });
});
