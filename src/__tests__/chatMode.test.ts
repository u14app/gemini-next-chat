import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CHAT_CONFIG } from "@/config/defaults";
import {
  AUTO_MODE_SYSTEM_INSTRUCTION,
  applyChatMode,
  getNextSupportedChatMode,
  normalizeChatMode,
} from "@/lib/chat/mode";
import { createChatModeSwitchBinding } from "@/services/api/chat/builtinTools/chatMode";

describe("chat mode", () => {
  it("defaults Auto to ordinary chat and migrates legacy enabled modes", () => {
    expect(DEFAULT_CHAT_CONFIG).toMatchObject({
      chatMode: "auto",
      useAgentMode: false,
      useDeepResearch: false,
    });
    expect(normalizeChatMode(undefined, false, false)).toBe("auto");
    expect(normalizeChatMode(undefined, true, false)).toBe("agent");
    expect(normalizeChatMode(undefined, true, true)).toBe("research");
    expect(applyChatMode(DEFAULT_CHAT_CONFIG, "chat")).toMatchObject({
      chatMode: "chat",
      useAgentMode: false,
      useDeepResearch: false,
    });
    expect(applyChatMode(DEFAULT_CHAT_CONFIG, "research")).toMatchObject({
      chatMode: "research",
      useAgentMode: false,
      useDeepResearch: true,
    });
  });

  it("cycles through the displayed order while skipping unsupported modes", () => {
    const supported = ["auto", "chat", "agent"] as const;

    expect(getNextSupportedChatMode("auto", supported)).toBe("chat");
    expect(getNextSupportedChatMode("chat", supported)).toBe("agent");
    expect(getNextSupportedChatMode("agent", supported)).toBe("auto");
    expect(getNextSupportedChatMode("chat", ["chat"])).toBe("chat");
  });

  it("exposes a bounded Auto-mode switch tool", async () => {
    const emitMode = vi.fn();
    const binding = createChatModeSwitchBinding();

    expect(binding.definition.function.name).toBe("switch_chat_mode");
    expect(binding.definition.function.parameters).toMatchObject({
      properties: {
        mode: {
          enum: ["agent", "research"],
          description: expect.stringContaining("multi-step tool execution"),
        },
      },
      required: ["mode"],
    });
    expect(binding.definition.function.description).toContain(
      "before answering, searching, or using any other tool",
    );
    await expect(
      binding.execute(
        { mode: "research" },
        {
          sessionId: "session-1",
          model: "openai:test-model",
          emit: { chatMode: emitMode },
        },
      ),
    ).resolves.toEqual({ ok: true, mode: "research" });
    expect(emitMode).toHaveBeenCalledWith("research");

    emitMode.mockClear();
    await expect(
      binding.execute(
        { mode: "chat" },
        {
          sessionId: "session-1",
          model: "openai:test-model",
          emit: { chatMode: emitMode },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CHAT_MODE" },
    });
    expect(emitMode).not.toHaveBeenCalled();
  });

  it("defines a complete Auto-mode routing contract", () => {
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toMatch(/^<auto-mode>/);
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toMatch(/<\/auto-mode>$/);
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toContain(
      "Call switch_chat_mode with research",
    );
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toContain(
      "Call switch_chat_mode with agent",
    );
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toContain(
      "ask the user which outcome to prioritize",
    );
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toContain(
      "use it at most once for a routine lookup",
    );
    expect(AUTO_MODE_SYSTEM_INSTRUCTION).toContain(
      "Do not imitate Deep Research or Agent inside Auto mode",
    );
  });
});
