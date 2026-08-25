import { TASK_PLAN_LIMITS } from "@/config/limits";
import { parseTaskPlan } from "@/lib/agent/taskPlan";

import type { BuiltinToolBinding } from "./types";

export function createTaskPlanBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "update_task_plan",
        description:
          "Create or update the live task checklist for a genuinely multi-step request. Whenever a step changes status, immediately send the full current plan again. Before the final answer, leave no step pending or in progress.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            steps: {
              type: "array",
              minItems: 1,
              maxItems: TASK_PLAN_LIMITS.maxSteps,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: {
                    type: "string",
                    minLength: 1,
                    maxLength: TASK_PLAN_LIMITS.maxTitleChars,
                  },
                  status: {
                    type: "string",
                    enum: ["pending", "in_progress", "completed"],
                  },
                },
                required: ["title", "status"],
              },
            },
            note: {
              type: "string",
              maxLength: TASK_PLAN_LIMITS.maxNoteChars,
            },
          },
          required: ["steps"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_write"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "taskPlan",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const parsed = parseTaskPlan(args);
      if (!parsed.ok) {
        return {
          ok: false,
          error: {
            ...parsed.error,
            recoverable: true,
          },
        };
      }

      context.emit.taskPlan?.(parsed.plan);
      context.signal?.throwIfAborted();
      return { ok: true };
    },
  };
}
