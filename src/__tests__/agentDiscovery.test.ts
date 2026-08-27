import { describe, expect, it, vi } from "vitest";

import type { TextSkill } from "../types";
import { createSkillDiscoveryBindings } from "../services/api/chat/builtinTools/skillDiscovery";
import {
  createToolDiscoveryBindings,
  type DiscoverableToolEntry,
} from "../services/api/chat/builtinTools/toolDiscovery";

const context = {
  sessionId: "session-1",
  model: "openai:test-model",
  signal: new AbortController().signal,
  emit: {},
};

function tool(name: string, providerId: string): DiscoverableToolEntry {
  return {
    name,
    originalName: name,
    providerId,
    providerTitle: providerId,
    description: `${name} deployment records`,
    definition: {
      type: "function",
      function: {
        name,
        description: `${name} deployment records`,
        parameters: { type: "object", additionalProperties: false },
      },
    },
  };
}

function skill(overrides: Partial<TextSkill> = {}): TextSkill {
  return {
    id: "requirements-interview",
    name: "requirements-interview",
    title: "Requirements Interview",
    description: "Clarify consequential product requirements.",
    category: "productivity",
    tags: ["requirements", "interview"],
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
      embeddingText: "requirements interview",
      useWhen: ["Requirements are ambiguous."],
      avoidWhen: [],
      exampleQueries: ["Interview me"],
    },
    content: "Ask only consequential questions.",
    version: "2.0.0",
    publisher: "Neo Chat",
    source: "builtin",
    locales: ["en"],
    runtime: {
      kind: "declarative_text",
      supportsScripts: false,
      acceptsPlaintextSecrets: false,
    },
    requiredCapabilities: ["structured_user_input"],
    allowedTools: ["request_user_input"],
    outputContract: { format: "markdown" },
    evalCases: [{ id: "ambiguous", input: "Build sharing." }],
    ...overrides,
  };
}

describe("Agent dynamic discovery", () => {
  it("searches metadata and makes capacity failures visible", async () => {
    const loaded = new Set<string>(["get_deployment"]);
    const load = vi.fn((names: string[]) => ({
      loaded: names.filter((name) => name === "delete_deployment"),
      alreadyLoaded: names.filter((name) => loaded.has(name)),
      unavailable: names.filter(
        (name) => name !== "delete_deployment" && !loaded.has(name),
      ),
      capacityRemaining: 0,
    }));
    const bindings = createToolDiscoveryBindings({
      entries: [
        tool("get_deployment", "cloud"),
        tool("delete_deployment", "cloud"),
      ],
      isLoaded: (name) => loaded.has(name),
      load,
    });

    await expect(
      bindings[0].execute({ query: "deployment", limit: 1 }, context),
    ).resolves.toMatchObject({
      tools: [{ name: "get_deployment", loaded: true }],
      totalAvailable: 2,
    });
    await expect(
      bindings[1].execute({ names: ["delete_deployment", "missing"] }, context),
    ).resolves.toEqual({
      loaded: ["delete_deployment"],
      alreadyLoaded: [],
      unavailable: ["missing"],
      capacityRemaining: 0,
    });
  });

  it("only exposes allowed Skill metadata before instructions are loaded", async () => {
    const [search, inspect] = createSkillDiscoveryBindings([skill()]);

    const searchResult = await search.execute(
      {
        query: "requirements",
        language: "en",
        capability: "structured_user_input",
      },
      context,
    );
    expect(searchResult).toMatchObject({
      totalAllowed: 1,
      skills: [{ id: "requirements-interview", version: "2.0.0" }],
    });
    expect(JSON.stringify(searchResult)).not.toContain(
      "Ask only consequential questions",
    );

    await expect(
      inspect.execute({ skill_id: "requirements-interview" }, context),
    ).resolves.toMatchObject({
      allowedTools: ["request_user_input"],
      runtime: {
        kind: "declarative_text",
        supportsScripts: false,
        acceptsPlaintextSecrets: false,
      },
      outputContract: { format: "markdown" },
    });
    await expect(
      inspect.execute({ skill_id: "not-allowed" }, context),
    ).resolves.toMatchObject({ error: { code: "SKILL_NOT_ALLOWED" } });
  });
});
