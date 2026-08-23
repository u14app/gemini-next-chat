import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROMPT_CONTEXT_LIMITS } from "../config/limits";
import type { AppliedSkillInvocation, TextSkill } from "../types";
import type { BuiltinToolContext } from "../services/api/chat/builtinTools";

const mocks = vi.hoisted(() => ({
  settingsState: {
    installedSkills: [] as TextSkill[],
  },
}));

vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
  },
}));

import { createLoadSkillBinding } from "../services/api/chat/builtinTools/loadSkill";

type SkillInvocationEmitter = (invocation: AppliedSkillInvocation) => void;

const baseSkill: TextSkill = {
  id: "brief-writer",
  name: "brief-writer",
  title: "Brief writer",
  description: "Writes a focused brief.",
  category: "writing",
  tags: ["brief"],
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
    embeddingText: "brief writer",
    useWhen: ["Write a brief"],
    avoidWhen: [],
    exampleQueries: [],
  },
  content: "Write for {{audience}} in a {{tone}} tone.",
  parameters: [
    {
      key: "audience",
      label: "Audience",
      input: "text",
      required: true,
      maxLength: 80,
    },
    {
      key: "tone",
      label: "Tone",
      input: "select",
      defaultValue: "concise",
      options: [
        { value: "concise", label: "Concise" },
        { value: "warm", label: "Warm" },
      ],
      maxLength: 20,
    },
  ],
};

function createContext({
  signal = new AbortController().signal,
  skillInvocation = vi.fn<SkillInvocationEmitter>(),
  skillToolRestriction,
}: {
  signal?: AbortSignal;
  skillInvocation?: SkillInvocationEmitter;
  skillToolRestriction?: (allowedTools: readonly string[]) => void;
} = {}): BuiltinToolContext {
  return {
    signal,
    sessionId: "session-1",
    emit: { skillInvocation, skillToolRestriction },
  };
}

describe("load_skill binding", () => {
  beforeEach(() => {
    mocks.settingsState = { installedSkills: [baseSkill] };
  });

  it("offers exact installed IDs and emits a reproducible auto invocation", async () => {
    const binding = createLoadSkillBinding([baseSkill]);
    const definition = binding.definition.function.parameters as {
      properties: { skill_id: { enum: string[] } };
    };
    expect(definition.properties.skill_id.enum).toEqual(["brief-writer"]);
    expect(binding).toMatchObject({
      risk: "read",
      displayKey: "loadSkill",
      agentOnly: true,
    });

    const skillInvocation = vi.fn<SkillInvocationEmitter>();
    const result = await binding.execute(
      {
        skill_id: "brief-writer",
        parameters: { audience: "R&D <team>" },
      },
      createContext({ skillInvocation }),
    );

    expect(result).toEqual({
      skill_id: "brief-writer",
      title: "Brief writer",
      content: "Write for R&amp;D &lt;team&gt; in a concise tone.",
      truncated: false,
    });
    expect(skillInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "brief-writer",
        mode: "auto",
        schemaVersion: 2,
        definitionHash: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
        parameters: {
          audience: "R&D <team>",
          tone: "concise",
        },
      }),
    );
  });

  it("rechecks the live settings store for removal and definition changes", async () => {
    const binding = createLoadSkillBinding([baseSkill]);
    const skillInvocation = vi.fn<SkillInvocationEmitter>();

    mocks.settingsState = { installedSkills: [] };
    await expect(
      binding.execute(
        { skill_id: "brief-writer" },
        createContext({ skillInvocation }),
      ),
    ).resolves.toMatchObject({
      error: { code: "LOAD_SKILL_NOT_INSTALLED" },
    });

    mocks.settingsState = {
      installedSkills: [{ ...baseSkill, content: "Changed instructions." }],
    };
    await expect(
      binding.execute(
        { skill_id: "brief-writer" },
        createContext({ skillInvocation }),
      ),
    ).resolves.toMatchObject({
      error: { code: "LOAD_SKILL_CHANGED" },
    });
    expect(skillInvocation).not.toHaveBeenCalled();
  });

  it("returns structured errors for missing or invalid parameters", async () => {
    const binding = createLoadSkillBinding([baseSkill]);

    await expect(
      binding.execute({ skill_id: "brief-writer" }, createContext()),
    ).resolves.toMatchObject({
      error: {
        code: "LOAD_SKILL_MISSING_PARAMETER",
        parameter_key: "audience",
      },
    });
    await expect(
      binding.execute(
        {
          skill_id: "brief-writer",
          parameters: { audience: 42 },
        },
        createContext(),
      ),
    ).resolves.toMatchObject({
      error: { code: "LOAD_SKILL_INVALID_PARAMETERS" },
    });
    await expect(
      binding.execute(
        {
          skill_id: "brief-writer",
          parameters: { audience: "operators", unknown: "value" },
        },
        createContext(),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "LOAD_SKILL_INVALID_PARAMETERS",
        parameter_key: "unknown",
      },
    });
  });

  it("caps rendered content at the prompt single-file limit", async () => {
    const longSkill: TextSkill = {
      ...baseSkill,
      id: "long-skill",
      name: "long-skill",
      content: "x".repeat(
        PROMPT_CONTEXT_LIMITS.maxSingleFileContentChars + 100,
      ),
      parameters: [],
    };
    mocks.settingsState = { installedSkills: [longSkill] };
    const binding = createLoadSkillBinding([longSkill]);

    const result = (await binding.execute(
      { skill_id: "long-skill" },
      createContext(),
    )) as { content: string; truncated: boolean };

    expect(result.content).toHaveLength(
      PROMPT_CONTEXT_LIMITS.maxSingleFileContentChars,
    );
    expect(result.truncated).toBe(true);
  });

  it("applies an explicit empty Tool restriction", async () => {
    const noToolSkill: TextSkill = {
      ...baseSkill,
      allowedTools: [],
    };
    mocks.settingsState = { installedSkills: [noToolSkill] };
    const skillToolRestriction =
      vi.fn<(allowedTools: readonly string[]) => void>();

    await expect(
      createLoadSkillBinding([noToolSkill]).execute(
        {
          skill_id: "brief-writer",
          parameters: { audience: "operators" },
        },
        createContext({ skillToolRestriction }),
      ),
    ).resolves.toMatchObject({ allowedTools: [] });
    expect(skillToolRestriction).toHaveBeenCalledWith([]);
  });

  it("fails closed when execution starts aborted", async () => {
    const binding = createLoadSkillBinding([baseSkill]);
    const controller = new AbortController();
    const skillInvocation = vi.fn<SkillInvocationEmitter>();
    controller.abort();

    await expect(
      binding.execute(
        {
          skill_id: "brief-writer",
          parameters: { audience: "operators" },
        },
        createContext({
          signal: controller.signal,
          skillInvocation,
        }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(skillInvocation).not.toHaveBeenCalled();
  });
});
