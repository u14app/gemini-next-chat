import { PROMPT_CONTEXT_LIMITS } from "@/config/limits";
import {
  createSkillDefinitionHash,
  createSkillInvocations,
  normalizeTextSkill,
  renderSkillTemplate,
  resolveSkillParameterValues,
  SkillParameterValidationError,
} from "@/lib/skills";
import type { TextSkill } from "@/types";
import { useSettingsStore } from "@/store/core/settingsStore";

import type { BuiltinToolBinding } from "./types";

const LOAD_SKILL_TOOL_NAME = "load_skill";
const MAX_PARAMETER_COUNT = 20;

function errorResult(
  code: string,
  message: string,
  details?: Record<string, string>,
) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      recoverable: true,
      ...details,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeOfferedSkills(
  installedSkills: readonly TextSkill[],
): TextSkill[] {
  const normalized: TextSkill[] = [];
  const seen = new Set<string>();
  for (const value of installedSkills) {
    const skill = normalizeTextSkill(value);
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    normalized.push(skill);
  }
  return normalized;
}

export function createLoadSkillBinding(
  installedSkills: readonly TextSkill[],
): BuiltinToolBinding {
  const offeredSkills = normalizeOfferedSkills(installedSkills);
  const offeredHashes = new Map(
    offeredSkills.map((skill) => [skill.id, createSkillDefinitionHash(skill)]),
  );

  return {
    definition: {
      type: "function",
      function: {
        name: LOAD_SKILL_TOOL_NAME,
        description:
          "Load the bounded text instructions for one currently installed skill. Supply string parameters required by that skill's metadata.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            skill_id: {
              type: "string",
              enum: offeredSkills.map((skill) => skill.id),
              description: "Exact ID of an installed skill.",
            },
            parameters: {
              type: "object",
              maxProperties: MAX_PARAMETER_COUNT,
              additionalProperties: { type: "string" },
              description:
                "Optional string values keyed by the selected skill's parameter metadata.",
            },
          },
          required: ["skill_id"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "loadSkill",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      if (!isPlainObject(args)) {
        return errorResult(
          "LOAD_SKILL_INVALID_ARGUMENTS",
          "load_skill requires an object argument.",
        );
      }

      const skillId = typeof args.skill_id === "string" ? args.skill_id : "";
      if (!skillId || !offeredHashes.has(skillId)) {
        return errorResult(
          "LOAD_SKILL_INVALID_SKILL_ID",
          "load_skill requires an exact skill_id from the offered enum.",
        );
      }

      const rawParameters = args.parameters;
      if (
        rawParameters !== undefined &&
        (!isPlainObject(rawParameters) ||
          Object.keys(rawParameters).length > MAX_PARAMETER_COUNT)
      ) {
        return errorResult(
          "LOAD_SKILL_INVALID_PARAMETERS",
          "Skill parameters must be a bounded plain object of string values.",
        );
      }
      if (
        rawParameters &&
        Object.values(rawParameters).some((value) => typeof value !== "string")
      ) {
        return errorResult(
          "LOAD_SKILL_INVALID_PARAMETERS",
          "Every skill parameter value must be a string.",
        );
      }

      const liveValue = useSettingsStore
        .getState()
        .installedSkills.find((skill) => skill.id === skillId);
      if (!liveValue) {
        return errorResult(
          "LOAD_SKILL_NOT_INSTALLED",
          "The selected skill is no longer installed.",
        );
      }
      const skill = normalizeTextSkill(liveValue);
      if (!skill) {
        return errorResult(
          "LOAD_SKILL_INVALID_DEFINITION",
          "The selected installed skill is no longer a valid text skill.",
        );
      }
      if (createSkillDefinitionHash(skill) !== offeredHashes.get(skillId)) {
        return errorResult(
          "LOAD_SKILL_CHANGED",
          "The selected skill changed after this tool was offered.",
        );
      }

      const allowedParameterKeys = new Set(
        (skill.parameters || []).map((parameter) => parameter.key),
      );
      const parameterValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawParameters || {})) {
        if (!allowedParameterKeys.has(key)) {
          return errorResult(
            "LOAD_SKILL_INVALID_PARAMETERS",
            "Unknown skill parameter.",
            { parameter_key: key.slice(0, 40) },
          );
        }
        parameterValues[key] = value as string;
      }

      try {
        const resolvedParameters = resolveSkillParameterValues(
          skill,
          parameterValues,
        );
        const rendered = renderSkillTemplate(skill, resolvedParameters);
        const content = rendered.slice(
          0,
          PROMPT_CONTEXT_LIMITS.maxSingleFileContentChars,
        );
        const invocation = createSkillInvocations([
          {
            skill,
            mode: "auto",
            parameters: resolvedParameters,
          },
        ])[0];

        context.signal?.throwIfAborted();
        context.emit.skillInvocation?.(invocation);
        if (skill.allowedTools) {
          context.emit.skillToolRestriction?.(skill.allowedTools);
        }
        return {
          skill_id: skill.id,
          title: skill.title,
          content,
          truncated: content.length < rendered.length,
          ...(skill.allowedTools ? { allowedTools: skill.allowedTools } : {}),
        };
      } catch (error) {
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        if (error instanceof SkillParameterValidationError) {
          const missing = error.message.startsWith(
            "Missing required skill parameter:",
          );
          return errorResult(
            missing
              ? "LOAD_SKILL_MISSING_PARAMETER"
              : "LOAD_SKILL_INVALID_PARAMETERS",
            error.message,
            error.parameterKey
              ? { parameter_key: error.parameterKey }
              : undefined,
          );
        }
        return errorResult(
          "LOAD_SKILL_FAILED",
          "The selected skill could not be rendered.",
        );
      }
    },
  };
}
