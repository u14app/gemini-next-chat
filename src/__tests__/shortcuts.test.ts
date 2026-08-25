// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTION_IDS,
  canShortcutRunInEditable,
  findShortcutConflict,
  formatShortcutBinding,
  isEditableShortcutTarget,
  normalizeShortcutBindings,
  shortcutBindingFromEvent,
  shortcutBindingMatchesEvent,
  shortcutBindingToAriaKeyShortcuts,
  validateShortcutBinding,
  type ShortcutBinding,
  type ShortcutBindings,
} from "@/lib/shortcuts";

vi.mock("server-only", () => ({}));

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    code: "KeyK",
    ctrlKey: false,
    isComposing: false,
    key: "k",
    keyCode: 75,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("shortcut bindings", () => {
  it("defines the seven actions and their defaults in a stable order", () => {
    expect(SHORTCUT_ACTION_IDS).toEqual([
      "globalSearch",
      "newChat",
      "focusComposer",
      "cycleChatMode",
      "toggleSidebar",
      "openShortcutSettings",
      "stopGeneration",
    ]);
    expect(DEFAULT_SHORTCUT_BINDINGS).toEqual({
      globalSearch: {
        code: "KeyK",
        mod: true,
        alt: false,
        shift: false,
      },
      newChat: {
        code: "KeyN",
        mod: true,
        alt: true,
        shift: false,
      },
      focusComposer: {
        code: "Slash",
        mod: true,
        alt: false,
        shift: false,
      },
      cycleChatMode: {
        code: "KeyM",
        mod: true,
        alt: false,
        shift: false,
      },
      toggleSidebar: {
        code: "Backslash",
        mod: true,
        alt: false,
        shift: false,
      },
      openShortcutSettings: {
        code: "KeyS",
        mod: true,
        alt: true,
        shift: false,
      },
      stopGeneration: {
        code: "Period",
        mod: true,
        alt: true,
        shift: false,
      },
    });
  });

  it("matches Mod with Meta or Control and requires exact modifiers", () => {
    const binding = DEFAULT_SHORTCUT_BINDINGS.globalSearch;
    expect(
      shortcutBindingMatchesEvent(binding, keyboardEvent({ metaKey: true })),
    ).toBe(true);
    expect(
      shortcutBindingMatchesEvent(binding, keyboardEvent({ ctrlKey: true })),
    ).toBe(true);
    expect(
      shortcutBindingMatchesEvent(
        binding,
        keyboardEvent({ ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      shortcutBindingMatchesEvent(
        binding,
        keyboardEvent({ ctrlKey: true, code: "KeyJ" }),
      ),
    ).toBe(false);
    expect(
      shortcutBindingMatchesEvent(
        binding,
        keyboardEvent({ ctrlKey: true, metaKey: true }),
      ),
    ).toBe(false);
  });

  it("rejects composing, dead, process, modifier-only and navigation events during capture", () => {
    expect(
      shortcutBindingFromEvent(
        keyboardEvent({ isComposing: true, ctrlKey: true }),
      ),
    ).toBeNull();
    expect(
      shortcutBindingFromEvent(keyboardEvent({ key: "Dead", ctrlKey: true })),
    ).toBeNull();
    expect(
      shortcutBindingFromEvent(
        keyboardEvent({ key: "Process", ctrlKey: true }),
      ),
    ).toBeNull();
    expect(
      shortcutBindingFromEvent(
        keyboardEvent({ code: "ControlLeft", key: "Control" }),
      ),
    ).toBeNull();
    expect(
      shortcutBindingFromEvent(
        keyboardEvent({ code: "Escape", key: "Escape" }),
      ),
    ).toBeNull();
    expect(
      shortcutBindingFromEvent(keyboardEvent({ code: "Tab", key: "Tab" })),
    ).toBeNull();
  });

  it("captures event.code instead of the localized key value", () => {
    expect(
      shortcutBindingFromEvent(
        keyboardEvent({
          altKey: true,
          code: "Slash",
          ctrlKey: true,
          key: "§",
          keyCode: 191,
        }),
      ),
    ).toEqual({
      code: "Slash",
      mod: true,
      alt: true,
      shift: false,
    });
  });

  it("rejects known browser-reserved and invalid bindings", () => {
    expect(
      validateShortcutBinding({
        code: "KeyN",
        mod: true,
        alt: false,
        shift: false,
      }),
    ).toEqual({ valid: false, reason: "reserved" });
    expect(
      validateShortcutBinding({
        code: "F5",
        mod: false,
        alt: false,
        shift: false,
      }),
    ).toEqual({ valid: false, reason: "reserved" });
    expect(
      validateShortcutBinding({
        code: "UnknownKey",
        mod: false,
        alt: false,
        shift: false,
      }),
    ).toEqual({ valid: false, reason: "invalid" });
    for (const binding of Object.values(DEFAULT_SHORTCUT_BINDINGS)) {
      expect(binding && validateShortcutBinding(binding)).toEqual({
        valid: true,
      });
    }
  });

  it("normalizes malformed, missing, unknown and duplicate persisted data", () => {
    const duplicate: ShortcutBinding = {
      code: "KeyN",
      mod: true,
      alt: true,
      shift: false,
    };
    const normalized = normalizeShortcutBindings({
      globalSearch: duplicate,
      newChat: duplicate,
      focusComposer: { code: "Mystery", mod: true },
      toggleSidebar: null,
      unknownAction: DEFAULT_SHORTCUT_BINDINGS.stopGeneration,
    });

    expect(normalized.globalSearch).toEqual(duplicate);
    expect(normalized.newChat).toBeNull();
    expect(normalized.focusComposer).toEqual(
      DEFAULT_SHORTCUT_BINDINGS.focusComposer,
    );
    expect(normalized.toggleSidebar).toBeNull();
    expect(normalized.openShortcutSettings).toEqual(
      DEFAULT_SHORTCUT_BINDINGS.openShortcutSettings,
    );
    expect(Object.keys(normalized)).toEqual([...SHORTCUT_ACTION_IDS]);
  });

  it("finds conflicts while allowing the edited action to be excluded", () => {
    expect(
      findShortcutConflict(
        DEFAULT_SHORTCUT_BINDINGS,
        DEFAULT_SHORTCUT_BINDINGS.newChat!,
      ),
    ).toBe("newChat");
    expect(
      findShortcutConflict(
        DEFAULT_SHORTCUT_BINDINGS,
        DEFAULT_SHORTCUT_BINDINGS.newChat!,
        "newChat",
      ),
    ).toBeNull();
  });

  it("formats platform labels and aria-keyshortcuts values", () => {
    expect(
      formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.newChat, "mac"),
    ).toBe("⌘⌥N");
    expect(
      formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.newChat, "other"),
    ).toBe("Ctrl+Alt+N");
    expect(
      formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.cycleChatMode, "mac"),
    ).toBe("⌘M");
    expect(
      shortcutBindingToAriaKeyShortcuts(
        DEFAULT_SHORTCUT_BINDINGS.focusComposer,
        "mac",
      ),
    ).toBe("Meta+/");
    expect(
      shortcutBindingToAriaKeyShortcuts(
        DEFAULT_SHORTCUT_BINDINGS.cycleChatMode,
        "other",
      ),
    ).toBe("Control+M");
    expect(shortcutBindingToAriaKeyShortcuts(null, "other")).toBeUndefined();
  });

  it("allows unmodified shortcuts only outside editable controls", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.appendChild(child);

    expect(isEditableShortcutTarget(input)).toBe(true);
    expect(isEditableShortcutTarget(child)).toBe(true);
    expect(isEditableShortcutTarget(document.body)).toBe(false);
    expect(
      canShortcutRunInEditable({
        code: "KeyG",
        mod: false,
        alt: false,
        shift: true,
      }),
    ).toBe(false);
    expect(
      canShortcutRunInEditable(DEFAULT_SHORTCUT_BINDINGS.globalSearch),
    ).toBe(true);
  });
});

describe("core shortcut settings persistence", () => {
  beforeEach(async () => {
    const { useCoreSettingsStore } =
      await import("@/store/core/coreSettingsStore");
    // Persist hydration lazily imports the browser sync recovery module. Wait
    // for that import before jsdom teardown so full-suite worker contention
    // cannot leave an OPFS module load attached to a disposed environment.
    await vi.dynamicImportSettled();
    useCoreSettingsStore.setState(useCoreSettingsStore.getInitialState(), true);
  });

  it("persists shortcut bindings without changing the shared storage version", async () => {
    const { useCoreSettingsStore } =
      await import("@/store/core/coreSettingsStore");
    const options = useCoreSettingsStore.persist.getOptions();
    const partialize = options.partialize!;
    const persisted = partialize(useCoreSettingsStore.getState()) as Record<
      string,
      unknown
    >;

    expect(options.version).toBe(6);
    expect(persisted.shortcutBindings).toEqual(DEFAULT_SHORTCUT_BINDINGS);
  });

  it("normalizes old or damaged same-version state during merge", async () => {
    const { useCoreSettingsStore } =
      await import("@/store/core/coreSettingsStore");
    const merge = useCoreSettingsStore.persist.getOptions().merge!;
    const merged = merge(
      {
        theme: "dark",
        shortcutBindings: {
          globalSearch: null,
          newChat: { code: "Broken" },
        },
      },
      useCoreSettingsStore.getInitialState(),
    );

    expect(merged.theme).toBe("dark");
    expect(merged.shortcutBindings.globalSearch).toBeNull();
    expect(merged.shortcutBindings.newChat).toEqual(
      DEFAULT_SHORTCUT_BINDINGS.newChat,
    );
    expect(typeof merged.setShortcutBinding).toBe("function");
  });

  it("normalizes shortcut bindings when older core settings are migrated", async () => {
    const { useCoreSettingsStore } =
      await import("@/store/core/coreSettingsStore");
    const migrate = useCoreSettingsStore.persist.getOptions().migrate!;
    const migrated = (await migrate(
      {
        providers: [],
        defaultModels: {},
        shortcutBindings: {
          globalSearch: { code: "Unknown" },
          newChat: null,
        },
      },
      5,
    )) as { shortcutBindings: ShortcutBindings };

    expect(migrated.shortcutBindings.globalSearch).toEqual(
      DEFAULT_SHORTCUT_BINDINGS.globalSearch,
    );
    expect(migrated.shortcutBindings.newChat).toBeNull();
    expect(migrated.shortcutBindings.focusComposer).toEqual(
      DEFAULT_SHORTCUT_BINDINGS.focusComposer,
    );
  });

  it("protects uniqueness and supports clear and default resets", async () => {
    const { useCoreSettingsStore } =
      await import("@/store/core/coreSettingsStore");

    useCoreSettingsStore
      .getState()
      .setShortcutBinding("globalSearch", DEFAULT_SHORTCUT_BINDINGS.newChat);
    expect(
      useCoreSettingsStore.getState().shortcutBindings.globalSearch,
    ).toEqual(DEFAULT_SHORTCUT_BINDINGS.globalSearch);

    useCoreSettingsStore.getState().setShortcutBinding("newChat", null);
    useCoreSettingsStore
      .getState()
      .setShortcutBinding("globalSearch", DEFAULT_SHORTCUT_BINDINGS.newChat);
    expect(
      useCoreSettingsStore.getState().shortcutBindings.globalSearch,
    ).toEqual(DEFAULT_SHORTCUT_BINDINGS.newChat);

    useCoreSettingsStore.getState().resetShortcutBinding("newChat");
    expect(useCoreSettingsStore.getState().shortcutBindings.newChat).toEqual(
      DEFAULT_SHORTCUT_BINDINGS.newChat,
    );
    expect(
      useCoreSettingsStore.getState().shortcutBindings.globalSearch,
    ).toBeNull();

    useCoreSettingsStore.getState().resetShortcutBindings();
    expect(useCoreSettingsStore.getState().shortcutBindings).toEqual(
      DEFAULT_SHORTCUT_BINDINGS,
    );
  });
});
