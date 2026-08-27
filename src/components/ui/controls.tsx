"use client";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useId,
  useMemo,
} from "react";
import { ChevronDown, Check, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import AnchoredPortal from "@/components/ui/AnchoredPortal";
import { Button } from "@/components/ui/primitives";

// --- Custom Select Component ---
export interface SelectOption {
  value: string;
  label: string;
}

export interface GroupedSelectOption {
  label: string;
  options: SelectOption[];
}

export interface CustomSelectProps {
  id?: string;
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[] | GroupedSelectOption[];
  icon?: any;
  className?: string;
  selectButtonClassName?: string;
  ariaLabel?: string;
  disabled?: boolean;
  emptyLabel?: string;
  name?: string;
  required?: boolean;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
  renderOption?: (option: SelectOption) => React.ReactNode;
  renderValue?: (
    option: SelectOption | undefined,
    label: string,
  ) => React.ReactNode;
}

export const CustomSelect = React.forwardRef<
  HTMLButtonElement,
  CustomSelectProps
>(function CustomSelect(
  {
    id,
    value,
    onChange,
    options,
    icon: Icon,
    className = "",
    selectButtonClassName,
    ariaLabel,
    disabled = false,
    emptyLabel,
    name,
    required = false,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedBy,
    renderOption,
    renderValue,
  },
  ref,
) {
  const t = useTranslations("Common");
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();
  const hasOptions = options.length > 0;
  const flatOptions = useMemo(() => {
    if (!hasOptions) return [] as SelectOption[];
    if ("options" in options[0]) {
      return (options as GroupedSelectOption[]).flatMap(
        (group) => group.options,
      );
    }
    return options as SelectOption[];
  }, [hasOptions, options]);
  const [highlightedValue, setHighlightedValue] = useState(value);

  const getOptionId = useCallback(
    (optionValue: string) =>
      `${listboxId}-option-${optionValue.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    [listboxId],
  );

  const clearCloseTimer = useCallback(() => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    clearCloseTimer();
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setIsOpen(false);
      setIsClosing(false);
    }, 200);
  }, [clearCloseTimer]);

  const handleToggle = () => {
    if (!hasOptions) return;

    if (isOpen) {
      handleClose();
    } else {
      clearCloseTimer();
      setIsClosing(false);
      setIsOpen(true);
    }
  };

  const commitOption = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      handleClose();
      triggerRef.current?.focus({ preventScroll: true });
    },
    [handleClose, onChange],
  );

  const setTriggerRef = useCallback(
    (element: HTMLButtonElement | null) => {
      triggerRef.current = element;
      if (typeof ref === "function") {
        ref(element);
      } else if (ref) {
        ref.current = element;
      }
    },
    [ref],
  );

  const handleListboxKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!hasOptions || flatOptions.length === 0) return;

    const currentIndex = Math.max(
      0,
      flatOptions.findIndex((option) => option.value === highlightedValue),
    );
    const lastIndex = flatOptions.length - 1;

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      handleClose();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && !isOpen) {
      event.preventDefault();
      clearCloseTimer();
      setIsClosing(false);
      setIsOpen(true);
      setHighlightedValue(value || flatOptions[0].value);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      clearCloseTimer();
      setIsClosing(false);
      setIsOpen(true);
      setHighlightedValue(
        flatOptions[Math.min(currentIndex + 1, lastIndex)].value,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      clearCloseTimer();
      setIsClosing(false);
      setIsOpen(true);
      setHighlightedValue(flatOptions[Math.max(currentIndex - 1, 0)].value);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      clearCloseTimer();
      setIsClosing(false);
      setIsOpen(true);
      setHighlightedValue(flatOptions[0].value);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      clearCloseTimer();
      setIsClosing(false);
      setIsOpen(true);
      setHighlightedValue(flatOptions[lastIndex].value);
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isOpen) {
      event.preventDefault();
      commitOption(highlightedValue || value);
    }
  };

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  useEffect(() => {
    setHighlightedValue(value);
  }, [value]);

  // Helper to find label across flat or grouped options
  const getSelectedLabel = () => {
    if (!hasOptions) return emptyLabel || value || t("noOptions");
    // Check if grouped
    if ("options" in options[0]) {
      for (const group of options as GroupedSelectOption[]) {
        const found = group.options.find((o) => o.value === value);
        if (found) return found.label;
      }
    } else {
      const found = (options as SelectOption[]).find((o) => o.value === value);
      if (found) return found.label;
    }
    return value;
  };

  const selectedLabel = getSelectedLabel();
  const selectedOption = flatOptions.find((option) => option.value === value);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required}
          disabled={disabled || !hasOptions}
        />
      ) : null}
      <Button
        ref={setTriggerRef}
        variant="bare"
        type="button"
        id={id}
        disabled={disabled || !hasOptions}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          isOpen && highlightedValue ? getOptionId(highlightedValue) : undefined
        }
        onClick={handleToggle}
        onKeyDown={handleListboxKeyDown}
        className={
          selectButtonClassName ||
          "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-[border-color,background-color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-foreground flex items-center justify-between"
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-gray-700 dark:text-foreground">
          {Icon && (
            <Icon size={16} className="text-gray-500" aria-hidden="true" />
          )}
          {renderValue ? (
            renderValue(selectedOption, selectedLabel || t("select"))
          ) : (
            <span className="truncate">{selectedLabel || t("select")}</span>
          )}
        </div>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </Button>

      <AnchoredPortal
        anchorRef={containerRef}
        open={isOpen && hasOptions}
        onClose={handleClose}
        id={listboxId}
        role="listbox"
        ariaLabel={ariaLabel}
        placement="bottom-start"
        matchAnchorWidth
        maxHeight={240}
        className={`z-50 overflow-hidden overflow-y-auto rounded-md border border-input bg-popover text-popover-foreground shadow-md custom-scrollbar transform transition-[opacity,transform] duration-200 origin-top ${
          isClosing
            ? "opacity-0 scale-95"
            : "opacity-100 scale-100 animate-in fade-in zoom-in-95"
        }`}
      >
        <div className="p-1">
          {hasOptions && "options" in options[0]
            ? // Render Grouped Options
              (options as GroupedSelectOption[]).map((group, idx) => (
                <div key={idx} role="group" aria-label={group.label}>
                  <div className="mx-1 mb-1 rounded-sm bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                  {group.options.map((opt) => (
                    <div
                      role="option"
                      tabIndex={-1}
                      id={getOptionId(opt.value)}
                      aria-selected={value === opt.value}
                      key={opt.value}
                      onClick={() => {
                        commitOption(opt.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          commitOption(opt.value);
                        }
                      }}
                      onMouseEnter={() => setHighlightedValue(opt.value)}
                      className={`mb-0.5 flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        value === opt.value || highlightedValue === opt.value
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      {renderOption ? (
                        renderOption(opt)
                      ) : (
                        <span className="truncate">{opt.label}</span>
                      )}
                      {value === opt.value && (
                        <Check size={14} aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
              ))
            : // Render Flat Options
              (options as SelectOption[]).map((opt) => (
                <div
                  role="option"
                  tabIndex={-1}
                  id={getOptionId(opt.value)}
                  aria-selected={value === opt.value}
                  key={opt.value}
                  onClick={() => {
                    commitOption(opt.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      commitOption(opt.value);
                    }
                  }}
                  onMouseEnter={() => setHighlightedValue(opt.value)}
                  className={`mb-0.5 flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    value === opt.value || highlightedValue === opt.value
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {renderOption ? (
                    renderOption(opt)
                  ) : (
                    <span className="truncate">{opt.label}</span>
                  )}
                  {value === opt.value && (
                    <Check size={14} aria-hidden="true" />
                  )}
                </div>
              ))}
        </div>
      </AnchoredPortal>
    </div>
  );
});

// --- Segmented Control ---
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: any }[];
  value: T;
  onChange: (val: T) => void;
  ariaLabel?: string;
}) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className="flex rounded-md bg-muted p-1 text-muted-foreground"
  >
    {options.map((opt) => (
      <Button
        variant="bare"
        type="button"
        key={opt.value}
        aria-pressed={value === opt.value}
        onClick={() => onChange(opt.value)}
        className={`flex-1 flex items-center justify-center gap-2 rounded-sm px-2 py-2 text-sm font-medium transition-[color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value === opt.value
            ? "bg-background text-foreground shadow-sm"
            : "hover:text-foreground"
        }`}
      >
        {opt.icon && <opt.icon size={16} aria-hidden="true" />}
        <span>{opt.label}</span>
      </Button>
    ))}
  </div>
);

// --- Simple Switch ---
export const SimpleSwitch = ({
  checked,
  onChange,
  ariaLabel,
  id,
  name,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
  id?: string;
  name?: string;
}) => (
  <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center">
    <input
      id={id}
      name={name}
      type="checkbox"
      aria-label={ariaLabel}
      className="sr-only peer"
      checked={checked}
      onChange={onChange}
    />
    <div
      data-state={checked ? "checked" : "unchecked"}
      className="h-5 w-9 rounded-full bg-input transition-[background-color,box-shadow] data-[state=checked]:bg-blue-500 data-[state=checked]:shadow-[0_0_0_3px_rgba(59,130,246,0.18)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-input after:bg-background after:shadow-sm after:transition-transform after:content-[''] data-[state=checked]:after:translate-x-full data-[state=checked]:after:border-background dark:data-[state=checked]:bg-blue-400"
    ></div>
  </label>
);

// --- Secret Input ---
export const SecretInput = ({
  id,
  name,
  placeholder,
  maxLength,
  hasSecret,
  onSave,
  onClear,
  inputClassName = "",
}: {
  id: string;
  name: string;
  placeholder: string;
  maxLength?: number;
  hasSecret: boolean;
  onSave: (value: string) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
  inputClassName?: string;
}) => {
  const t = useTranslations("Common");
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const trimmed = value.trim();

  const handleSave = async () => {
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    try {
      await onSave(trimmed);
      setValue("");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!onClear || isSaving) return;

    setIsSaving(true);
    try {
      await onClear();
      setValue("");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          id={id}
          name={name}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          placeholder={hasSecret ? t("replaceSecretPlaceholder") : placeholder}
          className={
            inputClassName ||
            "min-w-0 flex-1 px-3 py-2 bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-[background-color,border-color,box-shadow,color] font-mono text-gray-800 dark:text-foreground"
          }
        />
        <Button
          variant="bare"
          type="button"
          aria-label={t("saveSecret")}
          disabled={!trimmed || isSaving}
          onClick={handleSave}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition-colors hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size={15} aria-hidden="true" />
        </Button>
        {hasSecret && onClear ? (
          <Button
            variant="bare"
            type="button"
            aria-label={t("clearSecret")}
            disabled={isSaving}
            onClick={handleClear}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-red-300"
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-muted-foreground">
        {hasSecret ? t("secretSaved") : t("secretNotSaved")}
      </p>
    </div>
  );
};
