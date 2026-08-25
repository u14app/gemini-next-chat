export const CHAT_PANEL_VALUES = [
  "chat",
  "assistants",
  "plugins",
  "skills",
  "knowledge",
  "research",
  "search",
  "settings",
] as const;

export type ChatPanel = (typeof CHAT_PANEL_VALUES)[number];

export const SETTINGS_TAB_VALUES = [
  "providers",
  "defaults",
  "search",
  "rag",
  "voice",
  "memory",
  "sync",
  "health",
  "system",
  "shortcuts",
  "about",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_VALUES)[number];

export interface ChatPanelUrlState {
  panel: ChatPanel;
  settingsTab: SettingsTabId | null;
  researchTaskId: string | null;
  needsReplace: boolean;
  normalizedSearchParams: URLSearchParams;
}

const QUERY_PANEL_VALUES: readonly ChatPanel[] = [
  "assistants",
  "plugins",
  "skills",
  "knowledge",
  "research",
  "search",
  "settings",
];

const isChatPanel = (value: string | null): value is ChatPanel =>
  value !== null && CHAT_PANEL_VALUES.includes(value as ChatPanel);

const isQueryPanel = (value: string | null): value is ChatPanel =>
  value !== null && QUERY_PANEL_VALUES.includes(value as ChatPanel);

const isSettingsTab = (value: string | null): value is SettingsTabId =>
  value !== null && SETTINGS_TAB_VALUES.includes(value as SettingsTabId);

const cloneSearchParams = (input: URLSearchParams | string) =>
  new URLSearchParams(input);

export const parseChatPanelUrlState = (
  input: URLSearchParams | string,
): ChatPanelUrlState => {
  const originalParams = cloneSearchParams(input);
  const normalizedSearchParams = cloneSearchParams(input);
  const rawPanel = originalParams.get("panel");
  const rawSettingsTab = originalParams.get("settingsTab");
  const rawResearchTaskId = originalParams.get("task");
  let panel: ChatPanel = "chat";
  let settingsTab: SettingsTabId | null = null;
  let researchTaskId: string | null = null;
  let needsReplace = false;

  if (isQueryPanel(rawPanel)) {
    panel = rawPanel;
  } else if (isChatPanel(rawPanel)) {
    normalizedSearchParams.delete("panel");
    needsReplace = true;
  } else if (rawPanel !== null) {
    normalizedSearchParams.delete("panel");
    needsReplace = true;
  }

  if (panel === "settings") {
    if (isSettingsTab(rawSettingsTab)) {
      settingsTab = rawSettingsTab;
    } else if (rawSettingsTab !== null) {
      normalizedSearchParams.delete("settingsTab");
      needsReplace = true;
    }
  } else if (rawSettingsTab !== null) {
    normalizedSearchParams.delete("settingsTab");
    needsReplace = true;
  }

  if (panel === "research") {
    const normalizedTaskId = rawResearchTaskId?.trim() || "";
    if (!normalizedTaskId) {
      if (rawResearchTaskId !== null) {
        normalizedSearchParams.delete("task");
        needsReplace = true;
      }
    } else if (/^[a-zA-Z0-9._:-]{1,240}$/.test(normalizedTaskId)) {
      researchTaskId = normalizedTaskId;
    } else {
      normalizedSearchParams.delete("task");
      needsReplace = true;
    }
  } else if (rawResearchTaskId !== null) {
    normalizedSearchParams.delete("task");
    needsReplace = true;
  }

  return {
    panel,
    settingsTab,
    researchTaskId,
    needsReplace,
    normalizedSearchParams,
  };
};

export const setChatPanelUrlState = (
  input: URLSearchParams | string,
  state: {
    panel: ChatPanel;
    settingsTab?: SettingsTabId | null;
    researchTaskId?: string | null;
  },
): URLSearchParams => {
  const params = cloneSearchParams(input);

  params.delete("panel");
  params.delete("settingsTab");
  params.delete("task");

  if (state.panel === "chat") {
    return params;
  }

  params.set("panel", state.panel);

  if (state.panel === "settings") {
    params.set("settingsTab", state.settingsTab ?? "providers");
  } else if (state.panel === "research" && state.researchTaskId) {
    params.set("task", state.researchTaskId);
  }

  return params;
};
