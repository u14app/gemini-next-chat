"use client";

import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapModalFocus(
  event: ReactKeyboardEvent<HTMLElement> | KeyboardEvent,
  dialog: HTMLElement | null,
) {
  if (event.key !== "Tab" || !dialog) return;

  const focusableElements = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.getClientRects().length > 0);

  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    firstElement.focus({ preventScroll: true });
  } else if (
    event.shiftKey &&
    (document.activeElement === firstElement ||
      document.activeElement === dialog)
  ) {
    event.preventDefault();
    lastElement.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus({ preventScroll: true });
  }
}

export function useModalLifecycle({
  open,
  dialogRef,
  initialFocusRef,
  returnFocusRef,
}: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!open) return;

    const previousFocus =
      returnFocusRef?.current ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";

    const frame = requestAnimationFrame(() => {
      const target = initialFocusRef?.current || dialogRef.current;
      target?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [dialogRef, initialFocusRef, open, returnFocusRef]);
}
