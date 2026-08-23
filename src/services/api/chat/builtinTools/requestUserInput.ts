import type {
  AgentUserInputQuestion,
  AgentUserInputQuestionKind,
} from "@/types";

import type { BuiltinToolBinding } from "./types";

const QUESTION_KINDS = new Set<AgentUserInputQuestionKind>([
  "single_choice",
  "multiple_choice",
  "confirmation",
  "short_text",
]);

function parseQuestions(value: unknown): AgentUserInputQuestion[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return null;
  }
  const seen = new Set<string>();
  const questions: AgentUserInputQuestion[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 80) : "";
    const question =
      typeof raw.question === "string" ? raw.question.trim().slice(0, 500) : "";
    const kind = raw.kind as AgentUserInputQuestionKind;
    if (!id || seen.has(id) || !question || !QUESTION_KINDS.has(kind)) {
      return null;
    }

    const options = Array.isArray(raw.options)
      ? raw.options
          .slice(0, 8)
          .map((option) => {
            if (!option || typeof option !== "object") return null;
            const candidate = option as Record<string, unknown>;
            const value =
              typeof candidate.value === "string"
                ? candidate.value.trim().slice(0, 160)
                : "";
            const label =
              typeof candidate.label === "string"
                ? candidate.label.trim().slice(0, 160)
                : "";
            if (!value || !label) return null;
            return {
              value,
              label,
              ...(typeof candidate.description === "string" &&
              candidate.description.trim()
                ? {
                    description: candidate.description.trim().slice(0, 300),
                  }
                : {}),
            };
          })
          .filter((option) => option !== null)
      : [];
    if (
      (kind === "single_choice" || kind === "multiple_choice") &&
      options.length < 2
    ) {
      return null;
    }

    questions.push({
      id,
      question,
      kind,
      required: raw.required !== false,
      ...(typeof raw.header === "string" && raw.header.trim()
        ? { header: raw.header.trim().slice(0, 80) }
        : {}),
      ...(options.length ? { options } : {}),
      ...(kind === "multiple_choice"
        ? {
            maxSelections: Math.max(
              1,
              Math.min(
                options.length,
                Number.isInteger(raw.maxSelections)
                  ? Number(raw.maxSelections)
                  : options.length,
              ),
            ),
          }
        : {}),
      ...(kind === "short_text"
        ? {
            maxLength: Math.max(
              1,
              Math.min(
                2_000,
                Number.isInteger(raw.maxLength) ? Number(raw.maxLength) : 500,
              ),
            ),
          }
        : {}),
    });
    seen.add(id);
  }

  return questions;
}

export function createRequestUserInputBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "request_user_input",
        description:
          "Pause the Agent run and ask the user 1-3 concise structured questions only when their answer is required to continue safely or correctly.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            questions: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 80 },
                  header: { type: "string", maxLength: 80 },
                  question: { type: "string", minLength: 1, maxLength: 500 },
                  kind: {
                    type: "string",
                    enum: [
                      "single_choice",
                      "multiple_choice",
                      "confirmation",
                      "short_text",
                    ],
                  },
                  required: { type: "boolean" },
                  maxSelections: {
                    type: "integer",
                    minimum: 1,
                    maximum: 8,
                  },
                  maxLength: {
                    type: "integer",
                    minimum: 1,
                    maximum: 2000,
                  },
                  options: {
                    type: "array",
                    minItems: 2,
                    maxItems: 8,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        value: { type: "string", minLength: 1, maxLength: 160 },
                        label: { type: "string", minLength: 1, maxLength: 160 },
                        description: { type: "string", maxLength: 300 },
                      },
                      required: ["value", "label"],
                    },
                  },
                },
                required: ["id", "question", "kind"],
              },
            },
          },
          required: ["questions"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_read"],
      idempotency: "unknown",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "requestUserInput",
    agentOnly: true,
    executionGroup: "interaction",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const questions = parseQuestions(
        args && typeof args === "object"
          ? (args as Record<string, unknown>).questions
          : undefined,
      );
      if (!questions) {
        return {
          ok: false,
          error: {
            code: "INVALID_USER_INPUT_REQUEST",
            message: "Provide between one and three valid questions.",
            recoverable: true,
          },
        };
      }
      if (!context.userInputController || !context.toolCallId) {
        return {
          ok: false,
          error: {
            code: "USER_INPUT_UNAVAILABLE",
            message: "Structured user input is unavailable in this client.",
            recoverable: true,
          },
        };
      }

      return context.userInputController.requestInput(
        {
          requestId: context.toolCallId,
          toolCallId: context.toolCallId,
          sessionId: context.sessionId,
          questions,
        },
        context.signal,
      );
    },
  };
}
