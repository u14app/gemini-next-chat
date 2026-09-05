"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn as cx } from "@/lib/utils/cn";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const disabledState = "disabled:cursor-not-allowed disabled:opacity-50";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * `bare` contributes no colour, geometry, or typography — only the shared
   * focus ring and disabled affordance. It exists so an existing call site can
   * adopt the primitive without its own look changing.
   */
  variant?: "primary" | "secondary" | "danger" | "ghost" | "bare";
  size?: "sm" | "md";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      disabled,
      size = "md",
      type = "button",
      variant = "secondary",
      ...props
    },
    ref,
  ) => {
    const styled = variant !== "bare";

    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled}
        className={cx(
          styled &&
            "inline-flex min-w-0 items-center justify-center gap-2 rounded-md font-medium transition-[background-color,color,border-color,box-shadow]",
          styled && size === "sm" && "h-8 px-2.5 text-sm",
          styled && size === "md" && "h-9 px-3 text-sm",
          variant === "primary" &&
            "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:text-white dark:hover:bg-red-400",
          variant === "secondary" &&
            "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted",
          variant === "danger" &&
            "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-900/40",
          variant === "ghost" &&
            "text-gray-700 hover:bg-gray-100 dark:text-foreground/85 dark:hover:bg-muted",
          disabledState,
          focusRing,
          className,
        )}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export type IconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  label: string;
  icon: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tooltip?: string;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { label, icon, size = "md", className, tooltip, type = "button", ...props },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      title={tooltip || label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md text-gray-600 transition-[background-color,color,box-shadow] hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-foreground/85 dark:hover:bg-muted dark:hover:text-foreground",
        size === "sm" && "h-8 w-8",
        size === "md" && "h-9 w-9",
        size === "lg" && "h-10 w-10",
        focusRing,
        className,
      )}
    >
      {icon}
    </button>
  ),
);
IconButton.displayName = "IconButton";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      aria-invalid={invalid || props["aria-invalid"] ? true : undefined}
      className={cx(
        "h-9 w-full min-w-0 rounded-md border bg-white px-3 text-sm text-gray-900 outline-none transition-[border-color,box-shadow] placeholder:text-gray-400 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground",
        invalid
          ? "border-red-300 focus-visible:ring-red-500/40 dark:border-red-800"
          : "border-gray-200 dark:border-border",
        focusRing,
        className,
      )}
    />
  ),
);
Input.displayName = "Input";

export function InlineStatus({
  children,
  tone = "neutral",
  live = false,
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  live?: boolean;
  className?: string;
}) {
  return (
    <p
      aria-live={live ? "polite" : undefined}
      className={cx(
        "min-w-0 break-words rounded-md border px-3 py-2 text-sm",
        tone === "neutral" &&
          "border-gray-200 bg-gray-50 text-gray-700 dark:border-border dark:bg-card dark:text-foreground/85",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        tone === "danger" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  children,
  description,
  error,
  htmlFor,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  const fallbackId = useId();
  const fieldId = htmlFor || fallbackId;

  return (
    <div className={cx("min-w-0 space-y-1.5", className)}>
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-800 dark:text-foreground"
      >
        {label}
      </label>
      {description ? (
        <p className="break-words text-xs text-gray-500 dark:text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
      {error ? (
        <InlineStatus tone="danger" live>
          {error}
        </InlineStatus>
      ) : null}
    </div>
  );
}

export function DangerAction({
  children,
  confirmLabel,
  onConfirm,
  className,
  disabled,
}: {
  children: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async () => {
    if (disabled) return;
    if (confirming) {
      setConfirming(false);
      await onConfirm();
      return;
    }
    setConfirming(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setConfirming(false), 3500);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-red-700 transition-[background-color,color,box-shadow] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40",
        focusRing,
        className,
      )}
    >
      {confirming ? confirmLabel : children}
    </button>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  headerAction,
  children,
  className,
  placement = "center",
  closeOnBackdropClick = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  placement?: "center" | "responsive-sheet";
  closeOnBackdropClick?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((item) => item.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return createPortal(
    <div
      className={cx(
        "fixed inset-0 z-9999 flex justify-center bg-black/40 backdrop-blur-sm",
        placement === "responsive-sheet"
          ? "items-end p-0 sm:items-center sm:p-4"
          : "items-center p-4",
      )}
      onMouseDown={(event) => {
        if (closeOnBackdropClick && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cx(
          "max-h-[min(720px,90vh)] w-full max-w-xl overflow-hidden overscroll-contain rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-border dark:bg-background",
          placement === "responsive-sheet" &&
            "max-h-[92dvh] rounded-b-none border-b-0 sm:max-h-[min(760px,90dvh)] sm:rounded-lg sm:border-b",
          focusRing,
          className,
        )}
      >
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-border">
          <h2
            id={titleId}
            className="text-base font-semibold text-gray-900 dark:text-foreground"
          >
            {title}
          </h2>
          {headerAction}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Menu({
  children,
  labelledBy,
  className,
}: {
  children: React.ReactNode;
  labelledBy?: string;
  className?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (labelledBy) {
        document.getElementById(labelledBy)?.focus({ preventScroll: true });
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)',
      ),
    );
    const currentIndex = items.findIndex(
      (item) => item === document.activeElement,
    );
    const nextIndex = getNextMenuItemIndex(
      currentIndex,
      items.length,
      event.key,
    );
    if (nextIndex < 0) return;

    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-labelledby={labelledBy}
      onKeyDown={handleKeyDown}
      className={cx(
        "min-w-48 overflow-hidden rounded-md border border-gray-200 bg-white p-1 shadow-xl dark:border-border dark:bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type MenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  destructive?: boolean;
};

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
  (
    { children, className, destructive, disabled, type = "button", ...props },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cx(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        destructive
          ? "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
          : "text-gray-700 hover:bg-gray-100 dark:text-foreground/85 dark:hover:bg-muted",
        focusRing,
        className,
      )}
    >
      {children}
    </button>
  ),
);
MenuItem.displayName = "MenuItem";

export function getNextMenuItemIndex(
  currentIndex: number,
  itemCount: number,
  key: string,
): number {
  if (itemCount <= 0) return -1;
  if (key === "ArrowDown") return (currentIndex + 1) % itemCount;
  if (key === "ArrowUp") return (currentIndex - 1 + itemCount) % itemCount;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  return currentIndex;
}

export function VirtualList<T>({
  items,
  estimateSize,
  threshold = 80,
  height,
  renderItem,
  className,
}: {
  items: T[];
  estimateSize: number;
  threshold?: number;
  height: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  if (items.length <= threshold) {
    return <div className={className}>{items.map(renderItem)}</div>;
  }

  const overscan = 6;
  const visibleCount = Math.ceil(height / estimateSize);
  const start = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan);
  const end = Math.min(items.length, start + visibleCount + overscan * 2);
  const visibleItems = items.slice(start, end);

  return (
    <div
      className={cx("overflow-y-auto overscroll-contain", className)}
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        style={{ height: items.length * estimateSize, position: "relative" }}
      >
        <div
          style={{
            transform: `translateY(${start * estimateSize}px)`,
          }}
        >
          {visibleItems.map((item, offset) => renderItem(item, start + offset))}
        </div>
      </div>
    </div>
  );
}

export function Toast({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={cx(
        "rounded-md border px-3 py-2 text-sm shadow-lg",
        tone === "neutral" &&
          "border-gray-200 bg-white text-gray-800 dark:border-border dark:bg-card dark:text-foreground",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        tone === "danger" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
        className,
      )}
    >
      {children}
    </div>
  );
}
