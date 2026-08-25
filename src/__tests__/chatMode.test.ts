import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CHAT_CONFIG } from "@/config/defaults";
import {
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
      properties: { mode: { enum: ["agent", "research"] } },
      required: ["mode"],
    });
    await expect(
      binding.execute(
        { mode: "research" },
        { sessionId: "session-1", emit: { chatMode: emitMode } },
      ),
    ).resolves.toEqual({ ok: true, mode: "research" });
    expect(emitMode).toHaveBeenCalledWith("research");

    emitMode.mockClear();
    await expect(
      binding.execute(
        { mode: "chat" },
        { sessionId: "session-1", emit: { chatMode: emitMode } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CHAT_MODE" },
    });
    expect(emitMode).not.toHaveBeenCalled();
  });
});
