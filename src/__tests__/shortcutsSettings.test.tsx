// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import ShortcutsSettings from "../components/settings/ShortcutsSettings";
import enMessages from "../i18n/locales/en/Shortcuts.json";
import jaMessages from "../i18n/locales/ja/Shortcuts.json";
import zhMessages from "../i18n/locales/zh/Shortcuts.json";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  cloneShortcutBindings,
} from "../lib/shortcuts";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";

vi.mock("@/store/core/coreSettingsStore", async () => {
  const { create } = await import("zustand");
  const { cloneShortcutBindings, DEFAULT_SHORTCUT_BINDINGS } =
    await import("@/lib/shortcuts");
  const useCoreSettingsStore = create<{
    shortcutBindings: ReturnType<typeof cloneShortcutBindings>;
    setShortcutBinding: (
      actionId: keyof ReturnType<typeof cloneShortcutBindings>,
      binding: ReturnType<typeof cloneShortcutBindings>[keyof ReturnType<
        typeof cloneShortcutBindings
      >],
    ) => void;
    resetShortcutBinding: (
      actionId: keyof ReturnType<typeof cloneShortcutBindings>,
    ) => void;
    resetShortcutBindings: () => void;
  }>()((set) => ({
    shortcutBindings: cloneShortcutBindings(),
    setShortcutBinding: (actionId, binding) =>
      set((state) => ({
        shortcutBindings: {
          ...state.shortcutBindings,
          [actionId]: binding,
        },
      })),
    resetShortcutBinding: (actionId) =>
      set((state) => ({
        shortcutBindings: {
          ...state.shortcutBindings,
          [actionId]: DEFAULT_SHORTCUT_BINDINGS[actionId],
        },
      })),
    resetShortcutBindings: () =>
      set({ shortcutBindings: cloneShortcutBindings() }),
  }));

  return { useCoreSettingsStore };
});

const renderSettings = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ Shortcuts: enMessages }}>
      <ShortcutsSettings />
    </NextIntlClientProvider>,
  );

describe("shortcut settings", () => {
  beforeEach(() => {
    cleanup();
    useCoreSettingsStore.setState({
      shortcutBindings: cloneShortcutBindings(),
    });
  });

  it("records, clears, restores, and resets bindings", async () => {
    const user = userEvent.setup();
    renderSettings();

    const recordSearch = screen.getByRole("button", {
      name: "Record a shortcut for Global search",
    });
    await user.click(recordSearch);
    fireEvent.keyDown(recordSearch, {
      key: "p",
      code: "KeyP",
      ctrlKey: true,
      altKey: true,
    });

    expect(
      useCoreSettingsStore.getState().shortcutBindings.globalSearch,
    ).toEqual({
      code: "KeyP",
      mod: true,
      alt: true,
      shift: false,
    });

    await user.click(
      screen.getByRole("button", {
        name: "Clear the shortcut for Global search",
      }),
    );
    expect(
      useCoreSettingsStore.getState().shortcutBindings.globalSearch,
    ).toBeNull();
    expect(screen.getByText("Not assigned")).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: "Restore the default shortcut for Global search",
      }),
    );
    expect(
      useCoreSettingsStore.getState().shortcutBindings.globalSearch,
    ).toEqual(DEFAULT_SHORTCUT_BINDINGS.globalSearch);

    await user.click(
      screen.getByRole("button", {
        name: "Record a shortcut for New chat",
      }),
    );
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Recording a shortcut for New chat",
      }),
      { key: "g", code: "KeyG", ctrlKey: true, altKey: true },
    );
    await user.click(
      screen.getByRole("button", {
        name: "Restore all keyboard shortcuts to their defaults",
      }),
    );
    expect(useCoreSettingsStore.getState().shortcutBindings).toEqual(
      DEFAULT_SHORTCUT_BINDINGS,
    );
  });

  it("keeps recording across Tab navigation and cancels with Escape", async () => {
    const user = userEvent.setup();
    renderSettings();

    const record = screen.getByRole("button", {
      name: "Record a shortcut for Focus message input",
    });
    await user.click(record);

    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    record.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(
      screen.getByRole("button", {
        name: "Recording a shortcut for Focus message input",
      }),
    ).toBeTruthy();

    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Restore all keyboard shortcuts to their defaults",
      }),
      {
        key: "f",
        code: "KeyF",
        ctrlKey: true,
        altKey: true,
      },
    );
    expect(
      useCoreSettingsStore.getState().shortcutBindings.focusComposer,
    ).toEqual({
      code: "KeyF",
      mod: true,
      alt: true,
      shift: false,
    });

    await user.click(
      screen.getByRole("button", {
        name: "Record a shortcut for Focus message input",
      }),
    );
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(
      screen.getByRole("button", {
        name: "Record a shortcut for Focus message input",
      }),
    ).toBeTruthy();
    expect(
      useCoreSettingsStore.getState().shortcutBindings.focusComposer,
    ).toEqual({
      code: "KeyF",
      mod: true,
      alt: true,
      shift: false,
    });
  });

  it("announces invalid, reserved, and conflicting bindings without replacing the original", async () => {
    const user = userEvent.setup();
    renderSettings();

    const startRecording = async () => {
      await user.click(
        screen.getByRole("button", {
          name: "Record a shortcut for Focus message input",
        }),
      );
      return screen.getByRole("button", {
        name: "Recording a shortcut for Focus message input",
      });
    };

    let record = await startRecording();
    fireEvent.keyDown(record, {
      key: "Shift",
      code: "ShiftLeft",
      shiftKey: true,
    });
    expect(screen.getByRole("alert").textContent).toContain("non-modifier key");

    record = screen.getByRole("button", {
      name: "Recording a shortcut for Focus message input",
    });
    fireEvent.keyDown(record, {
      key: "n",
      code: "KeyN",
      ctrlKey: true,
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "reserved by the browser",
    );

    fireEvent.keyDown(record, {
      key: "n",
      code: "KeyN",
      ctrlKey: true,
      altKey: true,
    });
    expect(screen.getByRole("alert").textContent).toContain("New chat");
    expect(
      useCoreSettingsStore.getState().shortcutBindings.focusComposer,
    ).toEqual(DEFAULT_SHORTCUT_BINDINGS.focusComposer);
  });

  it("ships complete English, Chinese, and Japanese action copy", () => {
    for (const messages of [enMessages, zhMessages, jaMessages]) {
      expect(messages.title).toBeTruthy();
      expect(messages.recordingHelp).toBeTruthy();
      expect(messages.conflictingShortcut).toContain("{action}");
      expect(messages.action_globalSearch).toBeTruthy();
      expect(messages.action_newChat).toBeTruthy();
      expect(messages.action_focusComposer).toBeTruthy();
      expect(messages.action_cycleChatMode).toBeTruthy();
      expect(messages.action_toggleSidebar).toBeTruthy();
      expect(messages.action_openShortcutSettings).toBeTruthy();
      expect(messages.action_stopGeneration).toBeTruthy();
    }
  });
});
