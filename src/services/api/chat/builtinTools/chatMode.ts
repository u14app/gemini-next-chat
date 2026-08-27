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
          "Route the current Auto-mode request into a first-class workflow before answering, searching, or using any other tool. Choose research for an explicit Deep Research request or evidence-driven work across multiple, fresh, or cross-checked sources with traceable citations or a formal report. Choose agent for an explicit Agent request or multi-step tool execution, workspace or file operations, or actions with external effects. Do not call this for ordinary chat or a one-step lookup. If both workflows are materially required, ask the user which outcome to prioritize instead of switching.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: {
              type: "string",
              enum: ["agent", "research"],
              description:
                "Use agent for multi-step tool execution, workspace or file operations, and external actions. Use research for evidence-driven work across multiple sources with freshness, cross-checking, citations, or a formal report.",
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
