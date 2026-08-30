"use client";

import { useCallback, useEffect, useState } from "react";

type ComposerMenu = "attach" | "skill" | "plugin" | "reasoning" | "model";

export function useComposerMenuState() {
  const [openMenu, setOpenMenu] = useState<ComposerMenu | null>(null);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenus();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [closeMenus]);

  const setShowAttachMenu = useCallback((open: boolean) => {
    setOpenMenu(open ? "attach" : null);
  }, []);

  const setShowSkillSelect = useCallback((open: boolean) => {
    setOpenMenu(open ? "skill" : null);
  }, []);

  const setShowPluginSelect = useCallback((open: boolean) => {
    setOpenMenu(open ? "plugin" : null);
  }, []);

  const setShowReasoningSelect = useCallback((open: boolean) => {
    setOpenMenu(open ? "reasoning" : null);
  }, []);

  const setShowModelSelect = useCallback((open: boolean) => {
    setOpenMenu(open ? "model" : null);
  }, []);

  return {
    showAttachMenu: openMenu === "attach",
    showSkillSelect: openMenu === "skill",
    showPluginSelect: openMenu === "plugin",
    showReasoningSelect: openMenu === "reasoning",
    showModelSelect: openMenu === "model",
    setShowAttachMenu,
    setShowSkillSelect,
    setShowPluginSelect,
    setShowReasoningSelect,
    setShowModelSelect,
    closeMenus,
  };
}
