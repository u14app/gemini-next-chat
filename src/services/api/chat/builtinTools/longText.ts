import {
  LONG_TEXT_TOOL_NAME,
  LONG_TEXT_TITLE_MAX_LENGTH,
  parseLongTextOutputRequest,
} from "@/lib/chat/longText";

import type { BuiltinToolBinding } from "./types";

export function createLongTextOutputBinding(): BuiltinToolBinding {
  let hasStarted = false;

  return {
    definition: {
      type: "function",
      function: {
        name: LONG_TEXT_TOOL_NAME,
        description:
          "Start a document-style long text response when the user's request genuinely benefits from a substantial standalone document. Do not use it for ordinary conversational answers. First call this tool with only the title and format; after it succeeds, your next response must contain only the complete document body as ordinary text, with no preamble and no further tool calls.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: {
              type: "string",
              minLength: 1,
              maxLength: LONG_TEXT_TITLE_MAX_LENGTH,
            },
            format: {
              type: "string",
              enum: ["markdown", "plain_text"],
              default: "markdown",
            },
          },
          required: ["title"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_write"],
      idempotency: "non_idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "longTextOutput",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const parsed = parseLongTextOutputRequest(args);
      if (!parsed.ok) {
        return {
          ok: false,
          error: { ...parsed.error, recoverable: true },
        };
      }
      if (hasStarted) {
        return {
          ok: false,
          error: {
            code: "LONG_TEXT_OUTPUT_ALREADY_STARTED",
            message: "Only one long text document can be created per response.",
            recoverable: true,
          },
        };
      }

      if (!context.emit.longText) {
        return {
          ok: false,
          error: {
            code: "LONG_TEXT_OUTPUT_UNAVAILABLE",
            message:
              "Long text output capture is unavailable for this request.",
            recoverable: true,
          },
        };
      }
      const capture = context.emit.longText(parsed.value);
      if (!capture.ok) {
        return {
          ok: false,
          error: { ...capture.error, recoverable: true },
        };
      }
      hasStarted = true;
      context.signal?.throwIfAborted();
      return { ok: true, capture: "next_model_text" };
    },
  };
}
