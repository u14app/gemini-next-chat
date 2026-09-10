import type { SearchCompatibilityResult } from "../settings/searchRag";

export function shouldRunSettingsStartupEffects(
  settingsHydrated: boolean,
): boolean {
  return settingsHydrated;
}

export function shouldCreateInitialChatSession({
  chatHydrated,
  sessionCount,
}: {
  chatHydrated: boolean;
  sessionCount: number;
}): boolean {
  return chatHydrated && sessionCount === 0;
}

export function shouldSyncSessionPlugins(
  settingsHydrated: boolean,
  chatHydrated: boolean,
): boolean {
  return settingsHydrated && chatHydrated;
}

export function shouldApplySessionPluginPreset(
  settingsHydrated: boolean,
  chatHydrated: boolean,
  pluginIds: unknown,
  appliedPresetSyncKey?: string | null,
  nextPresetSyncKey?: string | null,
): boolean {
  return (
    shouldSyncSessionPlugins(settingsHydrated, chatHydrated) &&
    Array.isArray(pluginIds) &&
    (!nextPresetSyncKey || appliedPresetSyncKey !== nextPresetSyncKey)
  );
}

export function getSessionPluginPresetSyncKey(
  sessionId: string | null | undefined,
  pluginIds: unknown,
): string | null {
  if (!sessionId || !Array.isArray(pluginIds)) {
    return null;
  }

  return `${sessionId}:${JSON.stringify([...pluginIds].sort())}`;
}

export function shouldResolveSelectedModelAfterBootstrap({
  chatHydrated,
  settingsHydrated,
  coreHydrated,
  serverModelBootstrapReady,
}: {
  chatHydrated: boolean;
  settingsHydrated: boolean;
  coreHydrated: boolean;
  serverModelBootstrapReady: boolean;
}): boolean {
  return (
    chatHydrated &&
    settingsHydrated &&
    coreHydrated &&
    serverModelBootstrapReady
  );
}

export function shouldDisableSearchToggle({
  chatHydrated,
  settingsHydrated,
  coreHydrated,
  serverModelBootstrapReady,
  useSearch,
  searchCompatibility,
}: {
  chatHydrated: boolean;
  settingsHydrated: boolean;
  coreHydrated: boolean;
  serverModelBootstrapReady: boolean;
  useSearch: boolean;
  searchCompatibility: Pick<SearchCompatibilityResult, "enabled" | "reason">;
}): boolean {
  return (
    shouldResolveSelectedModelAfterBootstrap({
      chatHydrated,
      settingsHydrated,
      coreHydrated,
      serverModelBootstrapReady,
    }) &&
    useSearch &&
    !searchCompatibility.enabled &&
    searchCompatibility.reason !== "missing_model_provider"
  );
}
