// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChatPanelNavigation } from "@/hooks/useChatPanelNavigation";

describe("chat panel navigation", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("closes the mobile sidebar for normal panel navigation", async () => {
    const { result } = renderHook(() => useChatPanelNavigation());

    await waitFor(() => {
      expect(result.current.isNonDesktopViewport).toBe(true);
    });
    act(() => result.current.setIsSidebarOpen(true));
    act(() => result.current.navigateToPanel("knowledge"));

    expect(result.current.isSidebarOpen).toBe(false);
    expect(window.location.search).toBe("?panel=knowledge");
  });

  it("keeps the mobile sidebar open when navigation requests it", async () => {
    window.history.replaceState(null, "", "/?panel=search");
    const { result } = renderHook(() => useChatPanelNavigation());

    await waitFor(() => {
      expect(result.current.isNonDesktopViewport).toBe(true);
      expect(result.current.viewMode).toBe("search");
    });
    act(() => result.current.setIsSidebarOpen(true));
    act(() =>
      result.current.navigateToPanel("chat", null, "push", {
        keepSidebarOpen: true,
      }),
    );

    expect(result.current.isSidebarOpen).toBe(true);
    expect(window.location.search).toBe("");
  });
});
