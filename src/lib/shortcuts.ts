export const SHORTCUT_ACTION_IDS = [
  "globalSearch",
  "newChat",
  "focusComposer",
  "cycleChatMode",
  "toggleSidebar",
  "openShortcutSettings",
  "stopGeneration",
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

export interface ShortcutBinding {
  code: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
}

export type ShortcutBindings = Record<ShortcutActionId, ShortcutBinding | null>;

export type ShortcutPlatform = "mac" | "other";

type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey"
> &
  Partial<Pick<KeyboardEvent, "keyCode">>;

export type ShortcutBindingValidation =
  { valid: true } | { valid: false; reason: "invalid" | "reserved" };

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
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
};

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "CapsLock",
  "ControlLeft",
  "ControlRight",
  "Fn",
  "FnLock",
  "MetaLeft",
  "MetaRight",
  "NumLock",
  "OSLeft",
  "OSRight",
  "ScrollLock",
  "ShiftLeft",
  "ShiftRight",
]);

const NAVIGATION_CODES = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Space",
]);

const PUNCTUATION_CODES = new Set([
  "Backquote",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "Comma",
  "Equal",
  "IntlBackslash",
  "IntlRo",
  "IntlYen",
  "Minus",
  "Period",
  "Quote",
  "Semicolon",
  "Slash",
]);

const NUMPAD_CODES = new Set([
  "NumpadAdd",
  "NumpadComma",
  "NumpadDecimal",
  "NumpadDivide",
  "NumpadEnter",
  "NumpadEqual",
  "NumpadMultiply",
  "NumpadParenLeft",
  "NumpadParenRight",
  "NumpadSubtract",
]);

const CODE_LABELS: Record<string, string> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Equal: "=",
  Home: "Home",
  Insert: "Insert",
  IntlBackslash: "\\",
  IntlRo: "Ro",
  IntlYen: "¥",
  Minus: "-",
  NumpadAdd: "Num +",
  NumpadComma: "Num ,",
  NumpadDecimal: "Num .",
  NumpadDivide: "Num /",
  NumpadEnter: "Num Enter",
  NumpadEqual: "Num =",
  NumpadMultiply: "Num *",
  NumpadParenLeft: "Num (",
  NumpadParenRight: "Num )",
  NumpadSubtract: "Num -",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
};

const ARIA_CODE_LABELS: Record<string, string> = {
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Equal: "=",
  Home: "Home",
  Insert: "Insert",
  Minus: "-",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
};

// These combinations are handled by browsers or the operating system before a
// page can use them reliably. App defaults are deliberately not in this list.
const RESERVED_MOD_CODES = new Set([
  "Comma",
  "KeyL",
  "KeyN",
  "KeyO",
  "KeyP",
  "KeyQ",
  "KeyR",
  "KeyT",
  "KeyW",
]);

const RESERVED_MOD_SHIFT_CODES = new Set([
  "Delete",
  "KeyB",
  "KeyN",
  "KeyO",
  "KeyP",
  "KeyT",
  "KeyW",
]);

const RESERVED_PLAIN_CODES = new Set(["F5", "F6", "F11", "F12"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isKnownShortcutCode(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    /^Numpad[0-9]$/.test(code) ||
    /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code) ||
    NAVIGATION_CODES.has(code) ||
    PUNCTUATION_CODES.has(code) ||
    NUMPAD_CODES.has(code)
  );
}

function parseShortcutBinding(value: unknown): ShortcutBinding | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.code !== "string" ||
    typeof value.mod !== "boolean" ||
    typeof value.alt !== "boolean" ||
    typeof value.shift !== "boolean" ||
    !isKnownShortcutCode(value.code)
  ) {
    return null;
  }

  return {
    code: value.code,
    mod: value.mod,
    alt: value.alt,
    shift: value.shift,
  };
}

function cloneBinding(binding: ShortcutBinding | null): ShortcutBinding | null {
  return binding ? { ...binding } : null;
}

function bindingsEqual(
  left: ShortcutBinding | null,
  right: ShortcutBinding | null,
): boolean {
  return Boolean(
    left &&
    right &&
    left.code === right.code &&
    left.mod === right.mod &&
    left.alt === right.alt &&
    left.shift === right.shift,
  );
}

function bindingKey(binding: ShortcutBinding): string {
  return [binding.code, binding.mod, binding.alt, binding.shift].join(":");
}

function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const platform =
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform || navigator.platform;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "mac" : "other";
}

function formatCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return CODE_LABELS[code] || code;
}

function formatAriaCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return ARIA_CODE_LABELS[code] || CODE_LABELS[code] || code;
}

export function cloneShortcutBindings(
  bindings: ShortcutBindings = DEFAULT_SHORTCUT_BINDINGS,
): ShortcutBindings {
  return SHORTCUT_ACTION_IDS.reduce<ShortcutBindings>((result, actionId) => {
    result[actionId] = cloneBinding(bindings[actionId]);
    return result;
  }, {} as ShortcutBindings);
}

export function validateShortcutBinding(
  binding: ShortcutBinding,
): ShortcutBindingValidation {
  const parsed = parseShortcutBinding(binding);
  if (!parsed) return { valid: false, reason: "invalid" };

  const isReserved =
    (!parsed.mod &&
      !parsed.alt &&
      !parsed.shift &&
      RESERVED_PLAIN_CODES.has(parsed.code)) ||
    (parsed.mod &&
      !parsed.alt &&
      !parsed.shift &&
      RESERVED_MOD_CODES.has(parsed.code)) ||
    (parsed.mod &&
      !parsed.alt &&
      parsed.shift &&
      RESERVED_MOD_SHIFT_CODES.has(parsed.code)) ||
    (!parsed.mod &&
      parsed.alt &&
      !parsed.shift &&
      (parsed.code === "ArrowLeft" || parsed.code === "ArrowRight"));

  return isReserved ? { valid: false, reason: "reserved" } : { valid: true };
}

export function shortcutBindingFromEvent(
  event: ShortcutKeyboardEvent,
): ShortcutBinding | null {
  if (
    event.isComposing ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.keyCode === 229 ||
    event.code === "Escape" ||
    event.code === "Tab" ||
    MODIFIER_CODES.has(event.code) ||
    !isKnownShortcutCode(event.code) ||
    (event.ctrlKey && event.metaKey)
  ) {
    return null;
  }

  return {
    code: event.code,
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

export function shortcutBindingMatchesEvent(
  binding: ShortcutBinding | null,
  event: ShortcutKeyboardEvent,
): boolean {
  if (
    !binding ||
    event.isComposing ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.keyCode === 229 ||
    (event.ctrlKey && event.metaKey)
  ) {
    return false;
  }

  return (
    binding.code === event.code &&
    binding.mod === (event.metaKey || event.ctrlKey) &&
    binding.alt === event.altKey &&
    binding.shift === event.shiftKey
  );
}

export function findShortcutConflict(
  bindings: ShortcutBindings,
  binding: ShortcutBinding,
  exceptAction?: ShortcutActionId,
): ShortcutActionId | null {
  for (const actionId of SHORTCUT_ACTION_IDS) {
    if (
      actionId !== exceptAction &&
      bindingsEqual(bindings[actionId], binding)
    ) {
      return actionId;
    }
  }
  return null;
}

export function normalizeShortcutBindings(value: unknown): ShortcutBindings {
  const source = isRecord(value) ? value : {};
  const usedBindings = new Set<string>();
  const result = {} as ShortcutBindings;

  for (const actionId of SHORTCUT_ACTION_IDS) {
    const rawBinding = source[actionId];
    let binding: ShortcutBinding | null;

    if (rawBinding === null) {
      binding = null;
    } else {
      const parsed = parseShortcutBinding(rawBinding);
      binding =
        parsed && validateShortcutBinding(parsed).valid
          ? parsed
          : cloneBinding(DEFAULT_SHORTCUT_BINDINGS[actionId]);
    }

    if (binding && usedBindings.has(bindingKey(binding))) {
      const defaultBinding = cloneBinding(DEFAULT_SHORTCUT_BINDINGS[actionId]);
      binding =
        defaultBinding && !usedBindings.has(bindingKey(defaultBinding))
          ? defaultBinding
          : null;
    }

    result[actionId] = binding;
    if (binding) usedBindings.add(bindingKey(binding));
  }

  return result;
}

export function formatShortcutBinding(
  binding: ShortcutBinding | null,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string {
  if (!binding) return "—";

  const modifiers: string[] = [];
  if (binding.mod) modifiers.push(platform === "mac" ? "⌘" : "Ctrl");
  if (binding.alt) modifiers.push(platform === "mac" ? "⌥" : "Alt");
  if (binding.shift) modifiers.push(platform === "mac" ? "⇧" : "Shift");

  const parts = [...modifiers, formatCode(binding.code)];
  return platform === "mac" ? parts.join("") : parts.join("+");
}

export function shortcutBindingToAriaKeyShortcuts(
  binding: ShortcutBinding | null,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string | undefined {
  if (!binding) return undefined;

  const parts: string[] = [];
  if (binding.mod) parts.push(platform === "mac" ? "Meta" : "Control");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(formatAriaCode(binding.code));
  return parts.join("+");
}

export function canShortcutRunInEditable(
  binding: ShortcutBinding | null,
): boolean {
  return Boolean(binding && (binding.mod || binding.alt));
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  if (target.closest('input, textarea, select, [role="textbox"]')) {
    return true;
  }
  const editableHost = target.closest("[contenteditable]");
  return Boolean(
    editableHost && editableHost.getAttribute("contenteditable") !== "false",
  );
}
