"use client";

import { useEffect } from "react";

const LIGHT_THEME_COLOR = "#ffffff";
const DARK_THEME_COLOR = "#09090b";

export function useChatThemeEffects(
  theme: "light" | "dark" | "system",
  fontSize: "small" | "medium" | "large" = "medium",
) {
  useEffect(() => {
    const root = window.document.documentElement;
    const applyTheme = (nextTheme: string) => {
      const isDark = nextTheme === "dark";
      root.classList.toggle("dark", isDark);
      const themeColorMeta = window.document.querySelector(
        'meta[name="theme-color"]',
      );
      themeColorMeta?.setAttribute(
        "content",
        isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
      );
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches ? "dark" : "light");

      const listener = (event: MediaQueryListEvent) => {
        applyTheme(event.matches ? "dark" : "light");
      };
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }

    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    window.document.documentElement.dataset.fontSize = fontSize;
    window.localStorage.setItem("neo-chat-font-size", fontSize);
  }, [fontSize]);
}
