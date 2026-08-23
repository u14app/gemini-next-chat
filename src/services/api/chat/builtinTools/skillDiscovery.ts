import { createSkillDefinitionHash, normalizeTextSkill } from "@/lib/skills";
import type { TextSkill } from "@/types";

import type { BuiltinToolBinding } from "./types";

function offeredSkills(skills: readonly TextSkill[]): TextSkill[] {
  const seen = new Set<string>();
  return skills.flatMap((value) => {
    const skill = normalizeTextSkill(value);
    if (!skill || seen.has(skill.id)) return [];
    seen.add(skill.id);
    return [skill];
  });
}

function tokens(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(Boolean)
        .slice(0, 20)
    : [];
}

export function createSkillDiscoveryBindings(
  skills: readonly TextSkill[],
): BuiltinToolBinding[] {
  const offered = offeredSkills(skills);
  const commonDescriptor: NonNullable<BuiltinToolBinding["descriptor"]> = {
    version: 2,
    effects: ["local_read"],
    idempotency: "idempotent",
    sensitivity: "user_data",
    origin: "builtin",
  };

  return [
    {
      definition: {
        type: "function",
        function: {
          name: "search_skills",
          description:
            "Search the Skills allowed by the current Agent Profile and session. This returns metadata only; use inspect_skill or load_skill for one selection.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", minLength: 1, maxLength: 300 },
              language: { type: "string", maxLength: 40 },
              tags: {
                type: "array",
                maxItems: 8,
                items: { type: "string", minLength: 1, maxLength: 80 },
              },
              capability: { type: "string", maxLength: 80 },
              limit: { type: "integer", minimum: 1, maximum: 12 },
            },
            required: ["query"],
          },
        },
      },
      risk: "read",
      descriptor: commonDescriptor,
      displayKey: "searchSkills",
      agentOnly: true,
      async execute(args) {
        const input =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const queryTokens = tokens(input.query);
        if (queryTokens.length === 0) {
          return {
            ok: false,
            error: {
              code: "INVALID_SKILL_SEARCH",
              message: "A non-empty skill search query is required.",
              recoverable: true,
            },
          };
        }
        const requestedTags = Array.isArray(input.tags)
          ? input.tags.flatMap(tokens)
          : [];
        const language =
          typeof input.language === "string"
            ? input.language.trim().toLocaleLowerCase()
            : "";
        const capability =
          typeof input.capability === "string"
            ? input.capability.trim().toLocaleLowerCase()
            : "";
        const limit = Number.isInteger(input.limit)
          ? Math.min(12, Math.max(1, Number(input.limit)))
          : 8;

        const results = offered
          .map((skill, index) => {
            const requiredCapabilities = skill.requiredCapabilities || [];
            const haystack = [
              skill.id,
              skill.title,
              skill.description,
              skill.category,
              ...skill.tags,
              ...requiredCapabilities,
            ]
              .join(" ")
              .toLocaleLowerCase();
            const score = queryTokens.reduce(
              (sum, token) => sum + (haystack.includes(token) ? 1 : 0),
              0,
            );
            return { skill, index, score, haystack, requiredCapabilities };
          })
          .filter(
            ({ skill, score, haystack }) =>
              score > 0 &&
              (!language || skill.language.toLocaleLowerCase() === language) &&
              requestedTags.every((tag) => haystack.includes(tag)) &&
              (!capability || haystack.includes(capability)),
          )
          .sort(
            (left, right) =>
              right.score - left.score || left.index - right.index,
          )
          .slice(0, limit)
          .map(({ skill }) => ({
            id: skill.id,
            title: skill.title,
            description: skill.description,
            category: skill.category,
            tags: skill.tags,
            language: skill.language,
            version: skill.version || "1",
            requiredCapabilities: skill.requiredCapabilities || [],
          }));
        return { skills: results, totalAllowed: offered.length };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "inspect_skill",
          description:
            "Inspect one allowed Skill's metadata, parameters, capability requirements, tool restrictions, and output contract without loading its instructions.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              skill_id: {
                type: "string",
                enum: offered.map((skill) => skill.id),
              },
            },
            required: ["skill_id"],
          },
        },
      },
      risk: "read",
      descriptor: commonDescriptor,
      displayKey: "inspectSkill",
      agentOnly: true,
      async execute(args) {
        const skillId =
          args &&
          typeof args === "object" &&
          typeof (args as Record<string, unknown>).skill_id === "string"
            ? String((args as Record<string, unknown>).skill_id)
            : "";
        const skill = offered.find((candidate) => candidate.id === skillId);
        if (!skill) {
          return {
            ok: false,
            error: {
              code: "SKILL_NOT_ALLOWED",
              message: "The selected Skill is not allowed in this session.",
              recoverable: true,
            },
          };
        }
        return {
          id: skill.id,
          title: skill.title,
          description: skill.description,
          version: skill.version || "1",
          publisher: skill.publisher,
          source: skill.source,
          contentHash: skill.contentHash || createSkillDefinitionHash(skill),
          locales: skill.locales || [skill.language],
          runtime: skill.runtime,
          requiredCapabilities: skill.requiredCapabilities || [],
          allowedTools: skill.allowedTools || [],
          parameters: skill.parameters || [],
          outputContract: skill.outputContract,
          evalCases: skill.evalCases || [],
        };
      },
    },
  ];
}
