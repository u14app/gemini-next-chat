import { describe, expect, it } from "vitest";
import {
  parseChatPanelUrlState,
  setChatPanelUrlState,
} from "../lib/chat/panelUrlState";

describe("chat panel URL state", () => {
  it("parses valid panel and settings tab query params", () => {
    const state = parseChatPanelUrlState(
      new URLSearchParams("panel=settings&settingsTab=about&keep=1"),
    );

    expect(state.panel).toBe("settings");
    expect(state.settingsTab).toBe("about");
    expect(state.needsReplace).toBe(false);
  });

  it("normalizes invalid panel and tab params away", () => {
    const state = parseChatPanelUrlState(
      new URLSearchParams("panel=missing&settingsTab=wrong&keep=1"),
    );

    expect(state.panel).toBe("chat");
    expect(state.settingsTab).toBeNull();
    expect(state.needsReplace).toBe(true);
    expect(state.normalizedSearchParams.get("keep")).toBe("1");
    expect(state.normalizedSearchParams.has("panel")).toBe(false);
    expect(state.normalizedSearchParams.has("settingsTab")).toBe(false);
  });

  it("serializes panel state while preserving unrelated query params", () => {
    const params = setChatPanelUrlState(new URLSearchParams("keep=1"), {
      panel: "settings",
      settingsTab: "rag",
    });

    expect(params.get("keep")).toBe("1");
    expect(params.get("panel")).toBe("settings");
    expect(params.get("settingsTab")).toBe("rag");
  });

  it("round-trips the encrypted sync settings tab", () => {
    const params = setChatPanelUrlState(new URLSearchParams("keep=1"), {
      panel: "settings",
      settingsTab: "sync",
    });
    const state = parseChatPanelUrlState(params);

    expect(state.settingsTab).toBe("sync");
    expect(state.needsReplace).toBe(false);
  });

  it("round-trips the keyboard shortcut settings tab", () => {
    const params = setChatPanelUrlState(new URLSearchParams("keep=1"), {
      panel: "settings",
      settingsTab: "shortcuts",
    });
    const state = parseChatPanelUrlState(params);

    expect(params.toString()).toContain("panel=settings&settingsTab=shortcuts");
    expect(state.settingsTab).toBe("shortcuts");
    expect(state.needsReplace).toBe(false);
  });

  it("round-trips the skills panel without settings params", () => {
    const params = setChatPanelUrlState(new URLSearchParams("keep=1"), {
      panel: "skills",
    });
    const state = parseChatPanelUrlState(params);

    expect(params.get("panel")).toBe("skills");
    expect(params.has("settingsTab")).toBe(false);
    expect(state.panel).toBe("skills");
    expect(state.settingsTab).toBeNull();
    expect(state.needsReplace).toBe(false);
  });

  it("round-trips the global search panel without serializing query text", () => {
    const params = setChatPanelUrlState(new URLSearchParams("keep=1"), {
      panel: "search",
    });
    const state = parseChatPanelUrlState(params);

    expect(params.get("panel")).toBe("search");
    expect(params.has("settingsTab")).toBe(false);
    expect(params.has("query")).toBe(false);
    expect(state.panel).toBe("search");
    expect(state.needsReplace).toBe(false);
  });

  it("round-trips a research workbench task with the stable task param", () => {
    const params = setChatPanelUrlState(new URLSearchParams("keep=1"), {
      panel: "research",
      researchTaskId: "research-task_1",
    });
    const state = parseChatPanelUrlState(params);

    expect(params.get("panel")).toBe("research");
    expect(params.get("task")).toBe("research-task_1");
    expect(state.researchTaskId).toBe("research-task_1");
    expect(state.needsReplace).toBe(false);
  });

  it("opens the research task list when no task is provided", () => {
    const state = parseChatPanelUrlState(
      new URLSearchParams("panel=research&keep=1"),
    );

    expect(state.panel).toBe("research");
    expect(state.researchTaskId).toBeNull();
    expect(state.needsReplace).toBe(false);
  });

  it("removes an invalid research task param and opens the task list", () => {
    const state = parseChatPanelUrlState(
      new URLSearchParams("panel=research&task=../../unsafe&keep=1"),
    );

    expect(state.panel).toBe("research");
    expect(state.researchTaskId).toBeNull();
    expect(state.normalizedSearchParams.get("keep")).toBe("1");
    expect(state.normalizedSearchParams.has("task")).toBe(false);
  });

  it("removes panel params when returning to chat", () => {
    const params = setChatPanelUrlState(
      new URLSearchParams("panel=settings&settingsTab=voice&keep=1"),
      { panel: "chat" },
    );

    expect(params.get("keep")).toBe("1");
    expect(params.has("panel")).toBe(false);
    expect(params.has("settingsTab")).toBe(false);
  });
});
