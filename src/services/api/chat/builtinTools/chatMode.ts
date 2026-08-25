import type { ChatMode } from "@/types";
import { CHAT_MODE_SWITCH_TOOL_NAME } from "@/lib/chat/mode";

import type { BuiltinToolBinding } from "./types";

type AutomaticChatModeTarget = Extract<ChatMode, "agent" | "research">;

const parseMode = (args: unknown): AutomaticChatModeTarget | null => {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const mode = (args as Record<string, unknown>).mode;
  return mode === "agent" || mode === "research" ? mode : null;
};

export function createChatModeSwitchBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: CHAT_MODE_SWITCH_TOOL_NAME,
        description:
          "Available only while the conversation is in Auto mode. Call this before answering and before any other tool only when the request clearly requires Agent actions or a multi-source Deep Research workflow. Do not call it for ordinary questions, explanations, writing, translation, summarization, or brainstorming.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: {
              type: "string",
              enum: ["agent", "research"],
              description:
                "Use agent for multi-step tool or workspace actions. Use research for evidence synthesis across multiple sources.",
            },
          },
          required: ["mode"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_write"],
      idempotency: "idempotent",
      sensitivity: "none",
      origin: "builtin",
    },
    displayKey: "chatModeSwitch",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const mode = parseMode(args);
      if (!mode) {
        return {
          ok: false,
          error: {
            code: "INVALID_CHAT_MODE",
            message: "The requested chat mode is invalid.",
            recoverable: true,
          },
        };
      }
      context.emit.chatMode?.(mode);
      return { ok: true, mode };
    },
  };
}
