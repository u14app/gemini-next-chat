import { describe, expect, it } from "vitest";
import { CHAT_CONFIG_LIMITS, SYSTEM_SETTINGS_LIMITS } from "../config/limits";
import {
  DEFAULT_CHAT_CONFIG,
  DEFAULT_SYSTEM_SETTINGS,
} from "../config/defaults";
import {
  normalizeChatConfig,
  normalizeSystemSettings,
} from "../lib/settings/appConfig";

describe("app config normalization", () => {
  it("normalizes chat config booleans and clamps temperature", () => {
    expect(
      normalizeChatConfig({
        useSearch: "yes",
        useReasoning: true,
        useAgentMode: "yes",
        useDeepResearch: "yes",
        reasoningMode: "medium",
        useRAG: true,
        temperature: 99,
      }),
    ).toEqual({
      chatMode: "auto",
      useSearch: false,
      useReasoning: true,
      useAgentMode: false,
      useDeepResearch: false,
      reasoningMode: "medium",
      useRAG: true,
      temperature: CHAT_CONFIG_LIMITS.maxTemperature,
    });

    expect(normalizeChatConfig({ temperature: Number.NaN }).temperature).toBe(
      DEFAULT_CHAT_CONFIG.temperature,
    );
    expect(normalizeChatConfig({ useAgentMode: true }).useAgentMode).toBe(true);
    expect(normalizeChatConfig({ useAgentMode: true }).chatMode).toBe("agent");
    expect(normalizeChatConfig({ useDeepResearch: true })).toMatchObject({
      chatMode: "research",
      useAgentMode: false,
      useDeepResearch: true,
    });
    expect(
      normalizeChatConfig({
        chatMode: "auto",
        useAgentMode: true,
        useDeepResearch: true,
      }),
    ).toMatchObject({
      chatMode: "auto",
      useAgentMode: false,
      useDeepResearch: false,
    });
  });

  it("uses shared defaults for missing app config fields", () => {
    expect(normalizeChatConfig({})).toEqual(DEFAULT_CHAT_CONFIG);
    expect(normalizeSystemSettings({})).toEqual(DEFAULT_SYSTEM_SETTINGS);
    expect(DEFAULT_SYSTEM_SETTINGS.enableHtmlVisualPrompt).toBe(true);
    expect(DEFAULT_SYSTEM_SETTINGS.enableDestructiveToolConfirmation).toBe(
      true,
    );
    expect(DEFAULT_SYSTEM_SETTINGS.enableAutoScroll).toBe(false);
    expect(DEFAULT_SYSTEM_SETTINGS.personality).toBe("default");
    expect(DEFAULT_SYSTEM_SETTINGS.enableAutoImageCompression).toBe(true);
    expect(DEFAULT_SYSTEM_SETTINGS.imageCompressionMaxSizeMB).toBe(1);
    expect(DEFAULT_SYSTEM_SETTINGS.imageCompressionMaxWidthOrHeight).toBe(1024);
  });

  it("migrates legacy reasoning booleans to reasoning modes", () => {
    expect(normalizeChatConfig({ useReasoning: true }).reasoningMode).toBe(
      "high",
    );
    expect(normalizeChatConfig({ useReasoning: false }).reasoningMode).toBe(
      "off",
    );
    expect(
      normalizeChatConfig({
        useReasoning: false,
        reasoningMode: "auto",
      }),
    ).toMatchObject({
      useReasoning: true,
      reasoningMode: "auto",
    });
    expect(normalizeChatConfig({ reasoningMode: "xhigh" })).toMatchObject({
      useReasoning: false,
      reasoningMode: "off",
    });
  });

  it("normalizes system settings text and numeric ranges", () => {
    const system = normalizeSystemSettings({
      systemPrompt: "x".repeat(SYSTEM_SETTINGS_LIMITS.maxSystemPromptChars + 1),
      enableAutoTitle: "yes",
      enableRelatedQuestions: false,
      enableAutoCompression: false,
      compressionThreshold: 999,
      historyKeepCount: 0,
      enableAutoImageCompression: false,
      imageCompressionMaxSizeMB: 99,
      imageCompressionMaxWidthOrHeight: 0,
      enableCodeCollapse: true,
      enableHtmlVisualPrompt: true,
      enableDestructiveToolConfirmation: true,
      enableAutoScroll: true,
    });

    expect(system.systemPrompt).toHaveLength(
      SYSTEM_SETTINGS_LIMITS.maxSystemPromptChars,
    );
    expect(system.enableAutoTitle).toBe(true);
    expect(system.enableRelatedQuestions).toBe(false);
    expect(system.enableAutoCompression).toBe(false);
    expect(system.compressionThreshold).toBe(
      SYSTEM_SETTINGS_LIMITS.maxCompressionThreshold,
    );
    expect(system.historyKeepCount).toBe(
      SYSTEM_SETTINGS_LIMITS.minHistoryKeepCount,
    );
    expect(system.enableAutoImageCompression).toBe(false);
    expect(system.imageCompressionMaxSizeMB).toBe(
      SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxSizeMB,
    );
    expect(system.imageCompressionMaxWidthOrHeight).toBe(
      SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxWidthOrHeight,
    );
    expect(system.enableCodeCollapse).toBe(true);
    expect(system.enableHtmlVisualPrompt).toBe(true);
    expect(system.enableDestructiveToolConfirmation).toBe(true);
    expect(system.enableAutoScroll).toBe(true);
    expect(
      normalizeSystemSettings({ enableDestructiveToolConfirmation: "yes" }),
    ).toMatchObject({ enableDestructiveToolConfirmation: true });
    expect(
      normalizeSystemSettings({ enableDestructiveToolConfirmation: false }),
    ).toMatchObject({ enableDestructiveToolConfirmation: false });
    expect(normalizeSystemSettings({ enableAutoScroll: "yes" })).toMatchObject({
      enableAutoScroll: false,
    });
    expect(normalizeSystemSettings({ enableAutoScroll: true })).toMatchObject({
      enableAutoScroll: true,
    });
    expect(
      normalizeSystemSettings({
        enableAutoImageCompression: "yes",
        imageCompressionMaxSizeMB: Number.NaN,
        imageCompressionMaxWidthOrHeight: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({
      enableAutoImageCompression: true,
      imageCompressionMaxSizeMB:
        DEFAULT_SYSTEM_SETTINGS.imageCompressionMaxSizeMB,
      imageCompressionMaxWidthOrHeight:
        DEFAULT_SYSTEM_SETTINGS.imageCompressionMaxWidthOrHeight,
    });
  });

  it("normalizes system font size", () => {
    expect(normalizeSystemSettings({ fontSize: "large" }).fontSize).toBe(
      "large",
    );
    expect(normalizeSystemSettings({ fontSize: "huge" }).fontSize).toBe(
      DEFAULT_SYSTEM_SETTINGS.fontSize,
    );
  });

  it("normalizes system personality without legacy reply style fields", () => {
    expect(normalizeSystemSettings({ personality: "efficient" })).toMatchObject(
      {
        personality: "efficient",
      },
    );
    expect(normalizeSystemSettings({ personality: "verbose" })).toMatchObject({
      personality: DEFAULT_SYSTEM_SETTINGS.personality,
    });
    expect(
      normalizeSystemSettings({ replyStyle: "concise" }),
    ).not.toHaveProperty("replyStyle");
    expect(normalizeSystemSettings({ replyTone: "direct" })).not.toHaveProperty(
      "replyTone",
    );
  });
});
