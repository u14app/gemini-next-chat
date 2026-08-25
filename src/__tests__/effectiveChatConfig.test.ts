import { describe, expect, it } from "vitest";
import { resolveEffectiveChatRequestConfig } from "../lib/chat/effectiveChatConfig";

describe("effective chat request config", () => {
  it("enables Agent mode only for models with tool-call support", () => {
    const chatConfig = {
      useSearch: false,
      useReasoning: false,
      useAgentMode: true,
      reasoningMode: "off" as const,
      temperature: 0.7,
    };

    const supported = resolveEffectiveChatRequestConfig({
      chatConfig,
      selectedModel: "openai:gpt-tools",
      modelMetadata: {
        "gpt-tools": {
          id: "gpt-tools",
          name: "GPT Tools",
          tool_call: true,
        },
      },
      customModelMetadata: {},
    });
    const unsupported = resolveEffectiveChatRequestConfig({
      chatConfig,
      selectedModel: "openai:gpt-basic",
      modelMetadata: {
        "gpt-basic": {
          id: "gpt-basic",
          name: "GPT Basic",
          tool_call: false,
        },
      },
      customModelMetadata: {},
    });

    expect(supported.useAgentMode).toBe(true);
    expect(unsupported.useAgentMode).toBe(false);
  });

  it("treats missing tool-call metadata as unsupported", () => {
    const config = resolveEffectiveChatRequestConfig({
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        useAgentMode: true,
        reasoningMode: "off",
        temperature: 0.7,
      },
      selectedModel: "openai:unknown",
      modelMetadata: {},
      customModelMetadata: {},
    });

    expect(config.useAgentMode).toBe(false);
  });

  it("derives Research independently from Agent mode", () => {
    const config = resolveEffectiveChatRequestConfig({
      chatConfig: {
        chatMode: "research",
        useSearch: true,
        useReasoning: false,
        useAgentMode: true,
        useDeepResearch: true,
        reasoningMode: "off",
        temperature: 0.7,
      },
      selectedModel: "openai:gpt-tools",
      modelMetadata: {
        "gpt-tools": {
          id: "gpt-tools",
          name: "GPT Tools",
          tool_call: true,
        },
      },
      customModelMetadata: {},
    });

    expect(config).toMatchObject({
      chatMode: "research",
      useAgentMode: false,
      useDeepResearch: true,
    });
  });
});
