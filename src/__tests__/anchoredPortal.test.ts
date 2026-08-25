// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeAnchoredPortalStyle,
  computeHiddenAnchoredPortalStyle,
  default as AnchoredPortal,
} from "../components/ui/AnchoredPortal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("anchored portal positioning", () => {
  it("positions long top-end menus using the bounded max height", () => {
    const style = computeAnchoredPortalStyle({
      anchorRect: {
        left: 520,
        right: 720,
        top: 620,
        bottom: 652,
        width: 200,
      },
      viewportWidth: 800,
      viewportHeight: 700,
      naturalWidth: 224,
      naturalHeight: 900,
      placement: "top-end",
      offset: 8,
      maxHeight: 256,
      matchAnchorWidth: false,
    });

    expect(style.top).toBe(356);
    expect(style.left).toBe(496);
    expect(style.maxHeight).toBe(256);
  });

  it("clamps end alignment to the viewport margin", () => {
    const style = computeAnchoredPortalStyle({
      anchorRect: {
        left: 20,
        right: 70,
        top: 420,
        bottom: 452,
        width: 50,
      },
      viewportWidth: 300,
      viewportHeight: 600,
      naturalWidth: 120,
      naturalHeight: 100,
      placement: "top-end",
      offset: 8,
      matchAnchorWidth: false,
    });

    expect(style.left).toBe(8);
    expect(style.top).toBe(312);
  });

  it("flips bottom placement above the anchor when there is no room below", () => {
    const style = computeAnchoredPortalStyle({
      anchorRect: {
        left: 120,
        right: 220,
        top: 500,
        bottom: 532,
        width: 100,
      },
      viewportWidth: 640,
      viewportHeight: 600,
      naturalWidth: 180,
      naturalHeight: 140,
      placement: "bottom-start",
      offset: 8,
      matchAnchorWidth: false,
    });

    expect(style.top).toBe(352);
    expect(style.left).toBe(120);
  });

  it("measures before making portal content visible", () => {
    const measurementStyle = computeHiddenAnchoredPortalStyle({
      anchorRect: {
        left: 120,
        right: 440,
        top: 500,
        bottom: 540,
        width: 320,
      },
      viewportHeight: 700,
      matchAnchorWidth: true,
      maxHeight: 296,
    });
    const source = readFileSync(
      resolve(process.cwd(), "src/components/ui/AnchoredPortal.tsx"),
      "utf8",
    );

    expect(measurementStyle).toMatchObject({
      left: 120,
      width: 320,
      maxHeight: 296,
      visibility: "hidden",
      pointerEvents: "none",
    });
    expect(source).toContain("useIsomorphicLayoutEffect");
    expect(source).toContain('setPositionPhase("measuring")');
    expect(source).toContain('positionPhase !== "measuring"');
    expect(source).toContain("new ResizeObserver(scheduleUpdate)");
  });

  it("keeps the command menu free of transform or position animations", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/chat/ComposerCommandMenu.tsx"),
      "utf8",
    );

    expect(source).not.toContain("zoom-in");
    expect(source).not.toContain("slide-in");
    expect(source).not.toContain("animate-in");
    expect(source).not.toContain("transition-transform");
  });

  it("reveals portal content only with the anchor's final width applied", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        disconnect() {}
      },
    );
    const anchor = document.createElement("div");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 40,
      right: 360,
      top: 500,
      bottom: 540,
      width: 320,
      height: 40,
      x: 40,
      y: 500,
      toJSON: () => ({}),
    });

    render(
      React.createElement(
        AnchoredPortal,
        {
          anchorRef: { current: anchor },
          open: true,
          onClose: () => undefined,
          role: "listbox",
          matchAnchorWidth: true,
          placement: "top-start",
          maxHeight: 296,
        },
        React.createElement("div", null, "Commands"),
      ),
    );

    const menu = screen.getByRole("listbox");
    expect(menu.style.width).toBe("320px");
    expect(menu.style.visibility).toBe("visible");
    expect(menu.getAttribute("aria-hidden")).toBeNull();
    anchor.remove();
  });
});
