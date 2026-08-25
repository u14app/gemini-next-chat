// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTION_IDS,
  cloneShortcutBindings,
  type ShortcutActionId,
  type ShortcutBindings,
} from "@/lib/shortcuts";
import {
  dispatchShortcutEvent,
  type ShortcutActionHandlers,
} from "@/lib/shortcutDispatcher";

function createHandlers(executed = true): ShortcutActionHandlers {
  return Object.fromEntries(
    SHORTCUT_ACTION_IDS.map((actionId) => [actionId, vi.fn(() => executed)]),
  ) as unknown as ShortcutActionHandlers;
}

function dispatchFrom(
  target: HTMLElement,
  init: KeyboardEventInit,
  bindings: ShortcutBindings,
  handlers: ShortcutActionHandlers,
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  let actionId: ShortcutActionId | null = null;
  target.addEventListener(
    "keydown",
    (keyboardEvent) => {
      actionId = dispatchShortcutEvent(keyboardEvent, bindings, handlers);
    },
    { once: true },
  );
  target.dispatchEvent(event);
  return { actionId, event };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("shortcut dispatcher", () => {
  it.each([
    ["globalSearch", { code: "KeyK", ctrlKey: true }],
    ["newChat", { code: "KeyN", ctrlKey: true, altKey: true }],
    ["focusComposer", { code: "Slash", ctrlKey: true }],
    ["cycleChatMode", { code: "KeyM", ctrlKey: true }],
    ["toggleSidebar", { code: "Backslash", ctrlKey: true }],
    ["openShortcutSettings", { code: "KeyS", ctrlKey: true, altKey: true }],
    ["stopGeneration", { code: "Period", ctrlKey: true, altKey: true }],
  ] as const)("dispatches the default %s action", (expected, init) => {
    const target = document.body.appendChild(document.createElement("div"));
    const handlers = createHandlers();

    const result = dispatchFrom(
      target,
      init,
      DEFAULT_SHORTCUT_BINDINGS,
      handlers,
    );

    expect(result.actionId).toBe(expected);
    expect(handlers[expected]).toHaveBeenCalledOnce();
    expect(result.event.defaultPrevented).toBe(true);
  });

  it("allows Meta or Control for Mod while requiring exact Alt and Shift state", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const handlers = createHandlers();

    expect(
      dispatchFrom(
        target,
        { code: "KeyK", metaKey: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBe("globalSearch");
    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true, shiftKey: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();
    expect(
      dispatchFrom(
        target,
        { code: "KeyN", ctrlKey: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();
  });

  it("ignores consumed, repeated, composing, and IME process events", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const handlers = createHandlers();
    const consumed = new KeyboardEvent("keydown", {
      code: "KeyK",
      ctrlKey: true,
      cancelable: true,
    });
    consumed.preventDefault();

    expect(
      dispatchShortcutEvent(consumed, DEFAULT_SHORTCUT_BINDINGS, handlers),
    ).toBeNull();
    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true, repeat: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();
    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true, isComposing: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();
    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true, key: "Process" },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();
    expect(handlers.globalSearch).not.toHaveBeenCalled();
  });

  it("gives active dialogs and menus priority over app shortcuts", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const handlers = createHandlers();
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");

    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();

    dialog.remove();
    const menu = document.body.appendChild(document.createElement("div"));
    menu.setAttribute("role", "menu");
    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBeNull();

    menu.setAttribute("data-state", "closed");
    expect(
      dispatchFrom(
        target,
        { code: "KeyK", ctrlKey: true },
        DEFAULT_SHORTCUT_BINDINGS,
        handlers,
      ).actionId,
    ).toBe("globalSearch");
  });

  it("limits unmodified and Shift-only bindings to non-editable targets", () => {
    const input = document.body.appendChild(document.createElement("input"));
    const target = document.body.appendChild(document.createElement("div"));
    const handlers = createHandlers();
    const bindings = cloneShortcutBindings();
    bindings.newChat = {
      code: "KeyJ",
      mod: false,
      alt: false,
      shift: false,
    };

    expect(
      dispatchFrom(input, { code: "KeyJ" }, bindings, handlers).actionId,
    ).toBeNull();
    expect(
      dispatchFrom(target, { code: "KeyJ" }, bindings, handlers).actionId,
    ).toBe("newChat");

    bindings.newChat = {
      code: "KeyJ",
      mod: false,
      alt: true,
      shift: false,
    };
    expect(
      dispatchFrom(input, { code: "KeyJ", altKey: true }, bindings, handlers)
        .actionId,
    ).toBe("newChat");
  });

  it("prevents browser behavior only when the matched action executes", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const handlers = createHandlers();
    handlers.stopGeneration = vi.fn(() => false);

    const result = dispatchFrom(
      target,
      { code: "Period", ctrlKey: true, altKey: true },
      DEFAULT_SHORTCUT_BINDINGS,
      handlers,
    );

    expect(handlers.stopGeneration).toHaveBeenCalledOnce();
    expect(result.actionId).toBeNull();
    expect(result.event.defaultPrevented).toBe(false);
  });
});
