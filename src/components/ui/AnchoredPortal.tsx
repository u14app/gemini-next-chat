"use client";

import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type Placement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

interface AnchoredPortalRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

interface ComputeAnchoredPortalStyleOptions {
  anchorRect: AnchoredPortalRect;
  viewportWidth: number;
  viewportHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  placement?: Placement;
  offset?: number;
  matchAnchorWidth?: boolean;
  maxHeight?: number;
}

interface AnchoredPortalProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  className?: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  "aria-activedescendant"?: string;
  placement?: Placement;
  offset?: number;
  matchAnchorWidth?: boolean;
  maxHeight?: number;
}

const VIEWPORT_MARGIN = 8;
const HIDDEN_PORTAL_STYLE: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  visibility: "hidden",
  pointerEvents: "none",
};

type PortalPositionPhase = "hidden" | "measuring" | "positioned";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getPlacementSide = (placement: Placement) =>
  placement.startsWith("top") ? "top" : "bottom";

const getPlacementAlign = (placement: Placement) =>
  placement.endsWith("end") ? "end" : "start";

export const computeHiddenAnchoredPortalStyle = ({
  anchorRect,
  viewportHeight,
  matchAnchorWidth,
  maxHeight,
}: Pick<
  ComputeAnchoredPortalStyleOptions,
  "anchorRect" | "viewportHeight" | "matchAnchorWidth" | "maxHeight"
>): CSSProperties => ({
  ...HIDDEN_PORTAL_STYLE,
  left: Math.round(anchorRect.left),
  width: matchAnchorWidth ? Math.round(anchorRect.width) : undefined,
  maxHeight: Math.max(
    96,
    Math.min(
      maxHeight ?? viewportHeight - VIEWPORT_MARGIN * 2,
      viewportHeight - VIEWPORT_MARGIN * 2,
    ),
  ),
});

export const computeAnchoredPortalStyle = ({
  anchorRect,
  viewportWidth,
  viewportHeight,
  naturalWidth: requestedNaturalWidth,
  naturalHeight,
  placement = "bottom-start",
  offset = 8,
  matchAnchorWidth = false,
  maxHeight,
}: ComputeAnchoredPortalStyleOptions): CSSProperties => {
  const naturalWidth = matchAnchorWidth
    ? anchorRect.width
    : requestedNaturalWidth || anchorRect.width;
  const side = getPlacementSide(placement);
  const align = getPlacementAlign(placement);
  const maxAllowedHeight = maxHeight ?? viewportHeight - VIEWPORT_MARGIN * 2;
  const boundedMaxHeight = Math.max(
    96,
    Math.min(maxAllowedHeight, viewportHeight - VIEWPORT_MARGIN * 2),
  );
  const measuredHeight = Math.min(naturalHeight, boundedMaxHeight);

  let left =
    align === "end" ? anchorRect.right - naturalWidth : anchorRect.left;
  left = clamp(
    left,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportWidth - naturalWidth - VIEWPORT_MARGIN),
  );

  const topAbove = anchorRect.top - offset - measuredHeight;
  const topBelow = anchorRect.bottom + offset;
  let top = side === "top" ? topAbove : topBelow;

  if (
    side === "top" &&
    top < VIEWPORT_MARGIN &&
    topBelow + measuredHeight <= viewportHeight - VIEWPORT_MARGIN
  ) {
    top = topBelow;
  }

  if (
    side === "bottom" &&
    top + measuredHeight > viewportHeight - VIEWPORT_MARGIN &&
    topAbove >= VIEWPORT_MARGIN
  ) {
    top = topAbove;
  }

  top = clamp(
    top,
    VIEWPORT_MARGIN,
    Math.max(
      VIEWPORT_MARGIN,
      viewportHeight - measuredHeight - VIEWPORT_MARGIN,
    ),
  );

  const availableHeight = Math.max(
    96,
    Math.min(boundedMaxHeight, viewportHeight - top - VIEWPORT_MARGIN),
  );

  return {
    position: "fixed",
    left: Math.round(left),
    top: Math.round(top),
    width: matchAnchorWidth ? Math.round(anchorRect.width) : undefined,
    maxHeight: availableHeight,
    visibility: "visible",
  };
};

export default function AnchoredPortal({
  anchorRef,
  open,
  onClose,
  children,
  className = "",
  id,
  role,
  ariaLabel,
  ariaLabelledBy,
  "aria-activedescendant": ariaActiveDescendant,
  placement = "bottom-start",
  offset = 8,
  matchAnchorWidth = false,
  maxHeight,
}: AnchoredPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_PORTAL_STYLE);
  const [positionPhase, setPositionPhase] =
    useState<PortalPositionPhase>("hidden");

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    setStyle(
      computeAnchoredPortalStyle({
        anchorRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        naturalWidth: menu.offsetWidth,
        naturalHeight: menu.scrollHeight || menu.offsetHeight,
        placement,
        offset,
        matchAnchorWidth,
        maxHeight,
      }),
    );
    setPositionPhase("positioned");
  }, [anchorRef, matchAnchorWidth, maxHeight, offset, placement]);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPositionPhase("hidden");
      setStyle(HIDDEN_PORTAL_STYLE);
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) return;
    setPositionPhase("measuring");
    setStyle(
      computeHiddenAnchoredPortalStyle({
        anchorRect: anchor.getBoundingClientRect(),
        viewportHeight: window.innerHeight,
        matchAnchorWidth,
        maxHeight,
      }),
    );
  }, [anchorRef, matchAnchorWidth, maxHeight, open, updatePosition]);

  useIsomorphicLayoutEffect(() => {
    if (!open || positionPhase !== "measuring") return;
    updatePosition();
  }, [open, positionPhase, updatePosition]);

  useEffect(() => {
    if (!open || positionPhase !== "positioned") return;

    let frameId = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updatePosition);
    };

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    if (anchorRef.current) resizeObserver?.observe(anchorRef.current);
    if (menuRef.current) resizeObserver?.observe(menuRef.current);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [anchorRef, open, positionPhase, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-activedescendant={ariaActiveDescendant}
      aria-hidden={positionPhase === "positioned" ? undefined : true}
      style={style}
      className={className}
    >
      {children}
    </div>,
    document.body,
  );
}
