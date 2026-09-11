import { describe, expect, it } from "vitest";
import {
  getSessionPluginPresetSyncKey,
  shouldCreateInitialChatSession,
  shouldEnableReasoningByDefault,
  shouldDisableSearchToggle,
  shouldApplySessionPluginPreset,
  shouldResolveSelectedModelAfterBootstrap,
  shouldRunSettingsStartupEffects,
  shouldSyncSessionPlugins,
} from "../lib/app/startupEffects";
import { getSearchCompatibility } from "../lib/settings/searchRag";

describe("app startup effects", () => {
  it("enables reasoning by default for a capable initialized model", () => {
    expect(
      shouldEnableReasoningByDefault({
        selectedModel: "SERVER_DEFAULT:thinking-model",
        modelSupportsReasoning: true,
        chatConfig: { useReasoning: false, reasoningMode: "off" },
      }),
    ).toBe(true);

    expect(
      shouldEnableReasoningByDefault({
        selectedModel: "SERVER_DEFAULT:plain-model",
        modelSupportsReasoning: false,
        chatConfig: { useReasoning: false, reasoningMode: "off" },
      }),
    ).toBe(false);
  });

  it("does not override an explicit reasoning choice", () => {
    expect(
      shouldEnableReasoningByDefault({
        selectedModel: "SERVER_DEFAULT:thinking-model",
        modelSupportsReasoning: true,
        chatConfig: { useReasoning: false, reasoningMode: "off" },
        sessionConfig: { useReasoning: false, reasoningMode: "off" },
      }),
    ).toBe(false);

    expect(
      shouldEnableReasoningByDefault({
        selectedModel: "SERVER_DEFAULT:thinking-model",
        modelSupportsReasoning: true,
        chatConfig: { useReasoning: true, reasoningMode: "auto" },
      }),
    ).toBe(false);
  });

  it("creates a session only for an empty hydrated chat store", () => {
    expect(
      shouldCreateInitialChatSession({ chatHydrated: false, sessionCount: 0 }),
    ).toBe(false);
    expect(
      shouldCreateInitialChatSession({ chatHydrated: true, sessionCount: 1 }),
    ).toBe(false);
    expect(
      shouldCreateInitialChatSession({ chatHydrated: true, sessionCount: 0 }),
    ).toBe(true);
  });

  it("waits for settings hydration before running settings writes", () => {
    expect(shouldRunSettingsStartupEffects(false)).toBe(false);
    expect(shouldRunSettingsStartupEffects(true)).toBe(true);
  });

  it("waits for chat and settings hydration before syncing session plugins", () => {
    expect(shouldSyncSessionPlugins(false, false)).toBe(false);
    expect(shouldSyncSessionPlugins(true, false)).toBe(false);
    expect(shouldSyncSessionPlugins(false, true)).toBe(false);
    expect(shouldSyncSessionPlugins(true, true)).toBe(true);
  });

  it("applies session plugin presets when an explicit preset exists", () => {
    expect(shouldApplySessionPluginPreset(false, true, ["weather-gpt"])).toBe(
      false,
    );
    expect(shouldApplySessionPluginPreset(true, true, undefined)).toBe(false);
    expect(shouldApplySessionPluginPreset(true, true, [])).toBe(true);
    expect(shouldApplySessionPluginPreset(true, true, ["weather-gpt"])).toBe(
      true,
    );
    expect(getSessionPluginPresetSyncKey("session-1", [])).toBe("session-1:[]");
  });

  it("does not reapply a session plugin preset already synced for the current session", () => {
    const syncKey = getSessionPluginPresetSyncKey("session-1", [
      "reader",
      "weather",
    ]);

    expect(syncKey).toBe('session-1:["reader","weather"]');
    expect(
      shouldApplySessionPluginPreset(
        true,
        true,
        ["weather", "reader"],
        syncKey,
        syncKey,
      ),
    ).toBe(false);
    expect(
      shouldApplySessionPluginPreset(
        true,
        true,
        ["weather", "reader"],
        syncKey,
        getSessionPluginPresetSyncKey("session-2", ["reader", "weather"]),
      ),
    ).toBe(true);
  });

  it("waits for server model bootstrap before auto-selecting a model", () => {
    expect(
      shouldResolveSelectedModelAfterBootstrap({
        chatHydrated: true,
        settingsHydrated: true,
        coreHydrated: true,
        serverModelBootstrapReady: false,
      }),
    ).toBe(false);
  });

  it("allows auto-selection after server model bootstrap succeeds or fails", () => {
    expect(
      shouldResolveSelectedModelAfterBootstrap({
        chatHydrated: true,
        settingsHydrated: true,
        coreHydrated: true,
        serverModelBootstrapReady: true,
      }),
    ).toBe(true);
  });

  it("does not clear restored search during transient model startup", () => {
    const configuredFirecrawl = getSearchCompatibility({
      searchProvider: "firecrawl",
      searchConfig: { apiKey: "firecrawl-key" },
      modelProviderType: "OpenAI",
    });

    expect(
      shouldDisableSearchToggle({
        chatHydrated: true,
        settingsHydrated: true,
        coreHydrated: true,
        serverModelBootstrapReady: true,
        useSearch: true,
        searchCompatibility: configuredFirecrawl,
      }),
    ).toBe(false);

    expect(
      shouldDisableSearchToggle({
        chatHydrated: true,
        settingsHydrated: true,
        coreHydrated: true,
        serverModelBootstrapReady: true,
        useSearch: true,
        searchCompatibility: {
          enabled: false,
          reason: "missing_model_provider",
        },
      }),
    ).toBe(false);

    expect(
      shouldDisableSearchToggle({
        chatHydrated: true,
        settingsHydrated: true,
        coreHydrated: true,
        serverModelBootstrapReady: true,
        useSearch: true,
        searchCompatibility: {
          enabled: false,
          reason: "missing_search_api_key",
        },
      }),
    ).toBe(true);
  });
});
