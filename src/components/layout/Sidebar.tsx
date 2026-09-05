"use client";
import React, { useState, useRef, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { AppSettings, Session, Workspace } from "@/types";
import { Logo } from "../ui/Icons";
import { PRODUCT_NAME } from "@/lib/product";
import { useChatStore } from "@/store/core/chatStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useSetLocale } from "@/i18n/useSetLocale";
import Tooltip from "../ui/Tooltip";
import {
  ShortcutTooltipContent,
  useShortcutPresentation,
} from "@/components/shortcuts/ShortcutHint";
import WorkspaceSettingsModal from "./WorkspaceSettingsModal";
import SidebarSearch from "./SidebarSearch";
import {
  calculateSidebarPaneHeights,
  type SidebarPaneHeights,
} from "./sidebarLayout";
import {
  MessageSquarePlus,
  MoreVertical,
  Pin,
  FolderOpen,
  Settings,
  Cable,
  BotMessageSquare,
  ChevronDown,
  LibraryBig,
  FolderPlus,
  EllipsisVertical,
  FolderCog,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Laptop,
  Languages,
  ScrollText,
} from "lucide-react";
import { getSessionDisplayTitle } from "@/lib/chat/sessionTitle";
import { isTemporarySession } from "@/lib/chat/sessionRetention";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/primitives";
import { SessionActionsMenu } from "@/components/chat/SessionActions";

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  isHidden?: boolean;
  toggleSidebar: () => void;
  isModal?: boolean;
  onRequestClose?: () => void;
  onOpenPluginMarket: () => void;
  isPluginMarketOpen: boolean;
  onOpenSkillMarket: () => void;
  isSkillMarketOpen: boolean;
  onOpenAssistantHub: () => void;
  isAssistantHubOpen: boolean;
  onOpenKnowledgeBase: () => void;
  isKnowledgeBaseOpen: boolean;
  onOpenSettings: () => void;
  isSettingsOpen: boolean;
  onOpenGlobalSearch: () => void;
  isGlobalSearchOpen: boolean;
  focusedWorkspaceId?: string;
  onLogoClick: () => void;
}

const WORKSPACE_COLOR_MAP: Record<string, string> = {
  blue: "text-blue-500",
  purple: "text-purple-500",
  green: "text-green-500",
  orange: "text-orange-500",
  red: "text-red-500",
  pink: "text-pink-500",
  cyan: "text-cyan-500",
  gray: "text-gray-500",
};

const WORKSPACE_SESSION_PREVIEW_LIMIT = 5;
const ROOT_SESSION_PREVIEW_LIMIT = 5;
const SIDEBAR_PANE_GAP = 8;

type RootSessionListKey = "pinned" | "recent" | "archived";

const DEFAULT_ROOT_SESSION_LISTS: Record<RootSessionListKey, boolean> = {
  pinned: false,
  recent: false,
  archived: false,
};

const getNow = () => Date.now();

const SIDEBAR_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const getSidebarFocusableElements = (container: HTMLElement | null) => {
  if (!container) return [];

  return Array.from(
    container.querySelectorAll<HTMLElement>(SIDEBAR_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest('[inert], [aria-hidden="true"]') &&
      !element.getAttribute("aria-hidden"),
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  isOpen,
  isHidden = false,
  toggleSidebar,
  isModal = false,
  onRequestClose,
  onOpenPluginMarket,
  isPluginMarketOpen,
  onOpenSkillMarket,
  isSkillMarketOpen,
  onOpenAssistantHub,
  isAssistantHubOpen,
  onOpenKnowledgeBase,
  isKnowledgeBaseOpen,
  onOpenSettings,
  isSettingsOpen,
  onOpenGlobalSearch,
  isGlobalSearchOpen,
  focusedWorkspaceId,
  onLogoClick,
}) => {
  const t = useTranslations("Sidebar");
  const chatT = useTranslations("ChatApp");
  const newChatShortcut = useShortcutPresentation("newChat");
  const toggleSidebarShortcut = useShortcutPresentation("toggleSidebar");
  const { workspaces, createSession } = useChatStore();
  const { theme, setTheme, language } = useCoreSettingsStore();
  const setLocale = useSetLocale();
  const themeDisplayLabel = {
    light: t("themeLight"),
    dark: t("themeDark"),
    system: t("themeSystem"),
  }[theme];
  const languageDisplayLabel = {
    en: t("langEnglish"),
    zh: t("langChinese"),
    ja: t("langJapanese"),
    auto: t("langSystem"),
  }[language];

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
    trigger?: HTMLElement;
  } | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<{
    x: number;
    y: number;
    workspaceId: string;
  } | null>(null);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [expandedWorkspaceSessionLists, setExpandedWorkspaceSessionLists] =
    useState<Record<string, boolean>>({});
  const [expandedRootSessionLists, setExpandedRootSessionLists] = useState(
    DEFAULT_ROOT_SESSION_LISTS,
  );
  const [sidebarPaneHeights, setSidebarPaneHeights] =
    useState<SidebarPaneHeights>({ workspace: 0, chat: 0 });

  // Section Expansion State
  const [expandedSections, setExpandedSections] = useState<{
    [key: string]: boolean;
  }>({
    pinned: true,
    recent: true,
    archived: false,
    // Workspaces are expanded by default? Or store their state?
    // Let's use ID for workspace keys
  });

  const [editingWorkspace, setEditingWorkspace] = useState<
    Workspace | undefined
  >(undefined);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const sidebarListRegionRef = useRef<HTMLDivElement>(null);
  const workspacePaneHeaderRef = useRef<HTMLDivElement>(null);
  const chatPaneHeaderRef = useRef<HTMLDivElement>(null);
  const workspacePaneContentRef = useRef<HTMLDivElement>(null);
  const chatPaneContentRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const sidebarId = useId();

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusedWorkspaceId || !isOpen) return;
    let focusFrameId: number | null = null;
    const frameId = requestAnimationFrame(() => {
      const target = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "[data-workspace-id]",
        ) ?? [],
      ).find((element) => element.dataset.workspaceId === focusedWorkspaceId);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      focusFrameId = requestAnimationFrame(() => {
        target?.querySelector<HTMLElement>("button")?.focus();
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
      if (focusFrameId !== null) cancelAnimationFrame(focusFrameId);
    };
  }, [focusedWorkspaceId, isOpen]);

  useEffect(() => {
    if (!isModal || !isOpen) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const frameId = requestAnimationFrame(() => {
      const firstFocusable = getSidebarFocusableElements(sidebarRef.current)[0];
      (firstFocusable ?? sidebarRef.current)?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frameId);
      if (restoreFocusRef.current?.isConnected) {
        restoreFocusRef.current.focus({ preventScroll: true });
      }
      restoreFocusRef.current = null;
    };
  }, [isModal, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let frameId: number | null = null;
    const scheduleMeasure = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;

        const availableHeight =
          (sidebarListRegionRef.current?.clientHeight ?? 0) -
          (workspacePaneHeaderRef.current?.offsetHeight ?? 0) -
          (chatPaneHeaderRef.current?.offsetHeight ?? 0);
        const nextHeights = calculateSidebarPaneHeights({
          availableHeight,
          workspaceContentHeight:
            workspacePaneContentRef.current?.scrollHeight ?? 0,
          chatContentHeight: chatPaneContentRef.current?.scrollHeight ?? 0,
          gap: SIDEBAR_PANE_GAP,
        });

        setSidebarPaneHeights((current) =>
          Math.abs(current.workspace - nextHeights.workspace) < 0.5 &&
          Math.abs(current.chat - nextHeights.chat) < 0.5
            ? current
            : nextHeights,
        );
      });
    };

    const observedElements = [
      sidebarListRegionRef.current,
      workspacePaneHeaderRef.current,
      chatPaneHeaderRef.current,
      workspacePaneContentRef.current,
      chatPaneContentRef.current,
    ].filter(Boolean) as Element[];

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (frameId !== null) cancelAnimationFrame(frameId);
        window.removeEventListener("resize", scheduleMeasure);
      };
    }

    const observer = new ResizeObserver(scheduleMeasure);
    observedElements.forEach((element) => observer.observe(element));

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [isOpen]);

  // Set default expanded state for workspaces
  useEffect(() => {
    const newExpanded = { ...expandedSections };
    let changed = false;
    workspaces.forEach((w) => {
      if (newExpanded[w.id] === undefined) {
        newExpanded[w.id] = false;
        changed = true;
      }
    });
    if (changed) {
      // Use queueMicrotask to defer state update
      queueMicrotask(() => {
        if (!isMountedRef.current) return;
        setExpandedSections(newExpanded);
      });
    }
  }, [workspaces, expandedSections]);

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = Math.min(e.clientY, window.innerHeight - 350);
    const trigger =
      e.currentTarget instanceof HTMLButtonElement
        ? e.currentTarget
        : (e.currentTarget.querySelector<HTMLButtonElement>("button") ??
          undefined);
    setContextMenu({ x, y, sessionId, trigger });
  };

  const handleWorkspaceContextMenu = (
    e: React.MouseEvent,
    workspaceId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setWorkspaceMenu({ x, y, workspaceId });
  };

  const handleSidebarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isModal) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose?.();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = getSidebarFocusableElements(sidebarRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      sidebarRef.current?.focus({ preventScroll: true });
      return;
    }

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (
        activeElement === firstFocusable ||
        !sidebarRef.current?.contains(activeElement)
      ) {
        event.preventDefault();
        lastFocusable?.focus({ preventScroll: true });
      }
      return;
    }

    if (activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable?.focus({ preventScroll: true });
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleNewChatInWorkspace = async (workspace: Workspace) => {
    const sessionId = createSession(
      workspace.systemPrompt,
      "New Chat",
      workspace.id,
      workspace.files,
      {
        useSearch: workspace.enableSearch,
        useReasoning: workspace.enableReasoning,
        activePlugins: workspace.activePlugins,
        activeSkills: workspace.activeSkills,
      },
    );

    onSelectSession(sessionId);
  };

  const now = getNow();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // Split sessions into Workspace-bound and Unbound (Root)
  const historySessions = sessions.filter((s) => !isTemporarySession(s));
  const rootSessions = historySessions.filter((s) => !s.workspaceId);
  const workspaceSessionsMap = new Map<string, Session[]>();

  workspaces.forEach((w) => {
    workspaceSessionsMap.set(
      w.id,
      historySessions.filter((s) => s.workspaceId === w.id),
    );
  });

  const pinnedSessions = rootSessions
    .filter((s) => s.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const unpinnedSessions = rootSessions
    .filter((s) => !s.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const recentSessions = unpinnedSessions.filter(
    (s) => now - s.updatedAt <= SEVEN_DAYS_MS,
  );
  const archivedSessions = unpinnedSessions.filter(
    (s) => now - s.updatedAt > SEVEN_DAYS_MS,
  );
  const getVisibleRootSessions = (
    sectionKey: RootSessionListKey,
    items: Session[],
  ) => {
    if (expandedRootSessionLists[sectionKey]) {
      return items;
    }
    return items.slice(0, ROOT_SESSION_PREVIEW_LIMIT);
  };
  const visiblePinnedSessions = getVisibleRootSessions(
    "pinned",
    pinnedSessions,
  );
  const visibleRecentSessions = getVisibleRootSessions(
    "recent",
    recentSessions,
  );
  const visibleArchivedSessions = getVisibleRootSessions(
    "archived",
    archivedSessions,
  );

  const getVisibleWorkspaceSessions = (
    workspaceId: string,
    items: Session[],
  ) => {
    if (expandedWorkspaceSessionLists[workspaceId]) {
      return items;
    }
    return items.slice(0, WORKSPACE_SESSION_PREVIEW_LIMIT);
  };

  const hasMeasuredSidebarPanes =
    sidebarPaneHeights.workspace > 0 || sidebarPaneHeights.chat > 0;
  const workspacePaneStyle = hasMeasuredSidebarPanes
    ? { height: sidebarPaneHeights.workspace }
    : undefined;
  const chatPaneStyle = hasMeasuredSidebarPanes
    ? { height: sidebarPaneHeights.chat }
    : undefined;

  const renderSessionItem = (session: Session) => {
    const displayTitle = getSessionDisplayTitle(session.title, t("newChat"));
    const isActive =
      currentSessionId === session.id &&
      !isPluginMarketOpen &&
      !isAssistantHubOpen &&
      !isSkillMarketOpen &&
      !isKnowledgeBaseOpen &&
      !isGlobalSearchOpen &&
      !isSettingsOpen;

    return (
      <div
        key={session.id}
        className={`
          group relative flex items-center rounded-lg py-2 pl-3 pr-2 text-sm transition-[color,background-color] duration-200
          ${
            isActive
              ? "bg-gray-100/80 font-medium text-gray-800 dark:bg-accent/60 dark:text-foreground"
              : "text-gray-600 hover:bg-gray-100/80 dark:text-muted-foreground dark:hover:bg-muted/60"
          }
        `}
        onContextMenu={(e) => handleContextMenu(e, session.id)}
      >
        <>
          <Button
            variant="bare"
            type="button"
            aria-current={isActive ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md pr-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            onClick={() => {
              onSelectSession(session.id);
            }}
          >
            {session.pinned && (
              <Pin
                size={12}
                className="shrink-0 fill-current text-red-500"
                aria-hidden="true"
              />
            )}
            <span className="truncate">{displayTitle}</span>
          </Button>

          <Button
            variant="bare"
            type="button"
            aria-label={t("moreActionsAria", { title: displayTitle })}
            className={`absolute right-2 rounded-lg p-1 opacity-100 transition-[opacity,background-color] hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-accent ${contextMenu?.sessionId === session.id ? "opacity-100" : ""}`}
            onClick={(e) => handleContextMenu(e, session.id)}
          >
            <MoreVertical size={14} aria-hidden="true" />
          </Button>
        </>
      </div>
    );
  };

  const renderShowAllButton = ({
    controlId,
    expanded,
    hiddenCount,
    onToggle,
  }: {
    controlId: string;
    expanded: boolean;
    hiddenCount: number;
    onToggle: () => void;
  }) => {
    if (hiddenCount <= 0) return null;

    return (
      <Button
        variant="bare"
        type="button"
        aria-expanded={expanded}
        aria-controls={controlId}
        onClick={onToggle}
        className="mt-1 flex w-full items-center rounded-md px-3 py-1 text-left text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100/70 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-muted-foreground/70 dark:hover:bg-muted/60 dark:hover:text-foreground/85"
      >
        {expanded ? t("showLess") : t("showAll", { count: hiddenCount })}
      </Button>
    );
  };

  const renderSection = (
    title: string,
    sectionKey: string,
    items: Session[],
    listExpansion?: {
      expanded: boolean;
      hiddenCount: number;
      onToggle: () => void;
    },
  ) => {
    if (items.length === 0) return null;
    const isExpanded = expandedSections[sectionKey] === true;

    const contentId = `${sidebarId}-section-${sectionKey}`;

    return (
      <div className="mb-2">
        <Button
          variant="bare"
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="group flex w-full items-center justify-between gap-1 rounded-md px-3 py-1.5 text-left text-xs font-semibold text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-muted-foreground/70 dark:hover:text-foreground/85"
          onClick={() => toggleSection(sectionKey)}
        >
          <span>{title}</span>
          <ChevronDown
            size={12}
            className={`transition-transform duration-200 ${isExpanded ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        </Button>
        <div
          id={contentId}
          inert={isExpanded ? undefined : true}
          aria-hidden={!isExpanded}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        >
          <div className="overflow-hidden">
            {items.map(renderSessionItem)}
            {listExpansion
              ? renderShowAllButton({
                  controlId: contentId,
                  expanded: listExpansion.expanded,
                  hiddenCount: listExpansion.hiddenCount,
                  onToggle: listExpansion.onToggle,
                })
              : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={sidebarRef}
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal || undefined}
      inert={isHidden || undefined}
      aria-hidden={isHidden || undefined}
      aria-label={isModal ? PRODUCT_NAME : undefined}
      tabIndex={isModal ? -1 : undefined}
      onKeyDown={handleSidebarKeyDown}
      className={`
      glass-shell border-r border-gray-200 dark:border-sidebar-border flex flex-col shrink-0 h-full w-72 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out will-change-transform md:pb-0 md:pt-0 lg:transition-[width,transform] lg:duration-300
      fixed inset-y-0 left-0 z-40
      ${isOpen ? "translate-x-0" : "-translate-x-full"}
      lg:translate-x-0 lg:relative
      ${isOpen ? "lg:w-72" : "lg:w-16"}
    `}
    >
      {showWorkspaceModal && (
        <WorkspaceSettingsModal
          onClose={() => {
            setShowWorkspaceModal(false);
            setEditingWorkspace(undefined);
          }}
          workspace={editingWorkspace}
        />
      )}

      <div className="flex h-full w-full flex-col">
        <div
          className={`px-3 py-3 flex shrink-0 transition-[height,padding] duration-300 ${
            isOpen ? "h-14 items-center gap-2" : "items-center justify-center"
          }`}
        >
          {isOpen ? (
            <>
              <Button
                variant="bare"
                type="button"
                aria-label={t("goHomeAria")}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-lg font-bold text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-foreground"
                onClick={onLogoClick}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <Logo className="w-7 h-7" />
                </div>
                <span className="truncate bg-clip-text text-transparent bg-[linear-gradient(to_right,#00DEB9,#03B2DE,#1D88E1)] animate-in fade-in duration-300 whitespace-nowrap">
                  {PRODUCT_NAME}
                </span>
              </Button>
              <Tooltip
                content={
                  <ShortcutTooltipContent
                    label={chatT("closeSidebar")}
                    shortcut={toggleSidebarShortcut.display}
                  />
                }
                position="left"
              >
                <Button
                  variant="bare"
                  type="button"
                  aria-label={chatT("closeSidebarAria")}
                  aria-keyshortcuts={toggleSidebarShortcut.ariaKeyShortcuts}
                  onClick={toggleSidebar}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-[background-color,color,box-shadow] hover:bg-gray-200/70 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-muted-foreground dark:hover:bg-muted/80 dark:hover:text-foreground"
                >
                  <PanelLeftClose size={18} aria-hidden="true" />
                </Button>
              </Tooltip>
            </>
          ) : (
            <Tooltip
              content={
                <ShortcutTooltipContent
                  label={chatT("openSidebar")}
                  shortcut={toggleSidebarShortcut.display}
                />
              }
              position="right"
            >
              <Button
                variant="bare"
                type="button"
                aria-label={chatT("openSidebarAria")}
                aria-keyshortcuts={toggleSidebarShortcut.ariaKeyShortcuts}
                className="group relative flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 transition-[background-color,color,box-shadow] hover:bg-gray-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-foreground dark:hover:bg-muted/60"
                onClick={toggleSidebar}
              >
                <div className="absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 group-hover:scale-90 group-hover:opacity-0 group-focus-visible:scale-90 group-focus-visible:opacity-0">
                  <Logo className="w-7 h-7" />
                </div>
                <PanelLeftOpen
                  size={18}
                  aria-hidden="true"
                  className="scale-75 opacity-0 transition-[opacity,transform] duration-200 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                />
              </Button>
            </Tooltip>
          )}
        </div>

        <div className="px-3 pb-2 space-y-1 shrink-0">
          <Tooltip
            content={t("assistantHub")}
            disabled={isOpen}
            position="right"
            className={isOpen ? "w-full" : "w-full justify-center"}
          >
            <Button
              variant="bare"
              type="button"
              aria-label={t("openAssistantHub")}
              aria-current={isAssistantHubOpen ? "page" : undefined}
              onClick={onOpenAssistantHub}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${
                isAssistantHubOpen
                  ? "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                  : "text-gray-600 dark:text-muted-foreground hover:bg-gray-100/80 dark:hover:bg-muted/60"
              } ${isOpen ? "w-full" : "w-10 justify-center px-0"}`}
            >
              <BotMessageSquare
                size={18}
                className={`shrink-0 ${isAssistantHubOpen ? "text-rose-500" : "text-gray-500"}`}
                aria-hidden="true"
              />
              {isOpen && <span className="truncate">{t("assistantHub")}</span>}
            </Button>
          </Tooltip>

          <Tooltip
            content={t("skillMarket")}
            disabled={isOpen}
            position="right"
            className={isOpen ? "w-full" : "w-full justify-center"}
          >
            <Button
              variant="bare"
              type="button"
              aria-label={t("openSkillMarket")}
              aria-current={isSkillMarketOpen ? "page" : undefined}
              onClick={onOpenSkillMarket}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                isSkillMarketOpen
                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "text-gray-600 dark:text-muted-foreground hover:bg-gray-100/80 dark:hover:bg-muted/60"
              } ${isOpen ? "w-full" : "w-10 justify-center px-0"}`}
            >
              <ScrollText
                size={18}
                className={`shrink-0 ${isSkillMarketOpen ? "text-emerald-500" : "text-gray-500"}`}
                aria-hidden="true"
              />
              {isOpen && <span className="truncate">{t("skillMarket")}</span>}
            </Button>
          </Tooltip>

          <Tooltip
            content={t("pluginMarket")}
            disabled={isOpen}
            position="right"
            className={isOpen ? "w-full" : "w-full justify-center"}
          >
            <Button
              variant="bare"
              type="button"
              aria-label={t("openPluginMarket")}
              aria-current={isPluginMarketOpen ? "page" : undefined}
              onClick={onOpenPluginMarket}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                isPluginMarketOpen
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-gray-600 dark:text-muted-foreground hover:bg-gray-100/80 dark:hover:bg-muted/60"
              } ${isOpen ? "w-full" : "w-10 justify-center px-0"}`}
            >
              <Cable
                size={18}
                className={`shrink-0 ${isPluginMarketOpen ? "text-blue-500" : "text-gray-500"}`}
                aria-hidden="true"
              />
              {isOpen && <span className="truncate">{t("pluginMarket")}</span>}
            </Button>
          </Tooltip>

          <Tooltip
            content={t("knowledgeBase")}
            disabled={isOpen}
            position="right"
            className={isOpen ? "w-full" : "w-full justify-center"}
          >
            <Button
              variant="bare"
              type="button"
              aria-label={t("openKnowledgeBase")}
              aria-current={isKnowledgeBaseOpen ? "page" : undefined}
              onClick={onOpenKnowledgeBase}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 ${
                isKnowledgeBaseOpen
                  ? "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
                  : "text-gray-600 dark:text-muted-foreground hover:bg-gray-100/80 dark:hover:bg-muted/60"
              } ${isOpen ? "w-full" : "w-10 justify-center px-0"}`}
            >
              <LibraryBig
                size={18}
                className={`shrink-0 ${isKnowledgeBaseOpen ? "text-purple-500" : "text-gray-500"}`}
                aria-hidden="true"
              />
              {isOpen && <span className="truncate">{t("knowledgeBase")}</span>}
            </Button>
          </Tooltip>
        </div>

        <div className="shrink-0">
          <SidebarSearch
            isOpen={isOpen}
            onOpenGlobalSearch={onOpenGlobalSearch}
            isGlobalSearchOpen={isGlobalSearchOpen}
          />
        </div>

        <div className="min-h-0 flex-1 px-3 pb-2 animate-in fade-in duration-300">
          {isOpen ? (
            <div
              ref={sidebarListRegionRef}
              className="flex h-full min-h-0 flex-col gap-2"
            >
              {/* Workspaces Section */}
              <section className="flex min-h-0 shrink-0 flex-col">
                <div
                  ref={workspacePaneHeaderRef}
                  className="flex shrink-0 items-center justify-between pt-1 pl-3 pr-1 group"
                >
                  <span className="text-sm font-medium text-gray-600 dark:text-muted-foreground whitespace-nowrap">
                    {t("workspaces")}
                  </span>
                  <Tooltip content={t("newWorkspace")} position="left">
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("createWorkspaceAria")}
                      onClick={() => {
                        setEditingWorkspace(undefined);
                        setShowWorkspaceModal(true);
                      }}
                      className="p-1.5 text-gray-500 dark:text-muted-foreground hover:bg-gray-200 dark:hover:bg-accent/80 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      <FolderPlus size={16} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </div>

                <div
                  className="min-h-0 overflow-y-auto overscroll-contain pr-0.5 custom-scrollbar"
                  style={workspacePaneStyle}
                >
                  <div ref={workspacePaneContentRef} className="space-y-1 pb-1">
                    {workspaces.map((ws) => {
                      const wsSessions = workspaceSessionsMap.get(ws.id) || [];
                      const visibleWorkspaceSessions =
                        getVisibleWorkspaceSessions(ws.id, wsSessions);
                      const workspaceListExpanded =
                        !!expandedWorkspaceSessionLists[ws.id];
                      const hiddenWorkspaceSessionCount = Math.max(
                        wsSessions.length - WORKSPACE_SESSION_PREVIEW_LIMIT,
                        0,
                      );
                      const isExpanded = expandedSections[ws.id] === true;
                      const folderColorClass = ws.color
                        ? WORKSPACE_COLOR_MAP[ws.color]
                        : "text-blue-500";
                      const workspaceContentId = `${sidebarId}-workspace-${ws.id}`;

                      return (
                        <div
                          key={ws.id}
                          data-workspace-id={ws.id}
                          className={
                            focusedWorkspaceId === ws.id
                              ? "rounded-lg ring-2 ring-blue-500/60"
                              : undefined
                          }
                        >
                          <div
                            className="group relative flex items-center justify-between rounded-lg py-1.5 pl-3 pr-2 transition-colors hover:bg-gray-100/50 dark:hover:bg-muted/30"
                            onContextMenu={(e) =>
                              handleWorkspaceContextMenu(e, ws.id)
                            }
                          >
                            <Button
                              variant="bare"
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={workspaceContentId}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                              onClick={() => toggleSection(ws.id)}
                            >
                              {isExpanded ? (
                                <FolderOpen
                                  size={14}
                                  className={`${folderColorClass} shrink-0`}
                                  aria-hidden="true"
                                />
                              ) : (
                                <Folder
                                  size={14}
                                  className={`${folderColorClass} shrink-0`}
                                  aria-hidden="true"
                                />
                              )}
                              <span className="text-sm text-gray-700 dark:text-foreground/85 truncate font-medium">
                                {ws.name}
                              </span>
                            </Button>

                            <Button
                              variant="bare"
                              type="button"
                              aria-label={t("workspaceMoreActionsAria", {
                                name: ws.name,
                              })}
                              onClick={(e) =>
                                handleWorkspaceContextMenu(e, ws.id)
                              }
                              className={`p-1 text-gray-400 hover:text-gray-600 dark:hover:text-foreground/85 hover:bg-gray-200 dark:hover:bg-accent rounded transition-[opacity,color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${workspaceMenu?.workspaceId === ws.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                            >
                              <EllipsisVertical size={14} aria-hidden="true" />
                            </Button>
                          </div>

                          {isExpanded && (
                            <div
                              id={workspaceContentId}
                              className="border-gray-200 dark:border-border space-y-0.5"
                            >
                              {wsSessions.length > 0 ? (
                                <>
                                  {visibleWorkspaceSessions.map(
                                    renderSessionItem,
                                  )}
                                  {renderShowAllButton({
                                    controlId: workspaceContentId,
                                    expanded: workspaceListExpanded,
                                    hiddenCount: hiddenWorkspaceSessionCount,
                                    onToggle: () =>
                                      setExpandedWorkspaceSessionLists(
                                        (prev) => ({
                                          ...prev,
                                          [ws.id]: !prev[ws.id],
                                        }),
                                      ),
                                  })}
                                </>
                              ) : (
                                <div className="pl-3 pr-2 py-1.5 text-xs text-gray-400 italic">
                                  {t("noChats")}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Chat List Section */}
              <section className="flex min-h-0 shrink-0 flex-col">
                <div
                  ref={chatPaneHeaderRef}
                  className="flex shrink-0 items-center justify-between pt-1 pl-3 pr-1 group"
                >
                  <span className="text-sm font-medium text-gray-600 dark:text-muted-foreground whitespace-nowrap">
                    {t("chatList")}
                  </span>
                  <Tooltip
                    content={
                      <ShortcutTooltipContent
                        label={t("newChat")}
                        shortcut={newChatShortcut.display}
                      />
                    }
                    position="left"
                  >
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("createChatAria")}
                      aria-keyshortcuts={newChatShortcut.ariaKeyShortcuts}
                      onClick={onNewChat}
                      className="p-1.5 text-gray-500 dark:text-muted-foreground hover:bg-gray-200 dark:hover:bg-accent/80 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      <MessageSquarePlus size={16} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </div>

                <div
                  id={`${sidebarId}-root-sessions`}
                  className="min-h-0 overflow-y-auto overscroll-contain pr-0.5 custom-scrollbar"
                  style={chatPaneStyle}
                >
                  <div ref={chatPaneContentRef} className="pb-1">
                    {renderSection(
                      t("pinned"),
                      "pinned",
                      visiblePinnedSessions,
                      {
                        expanded: expandedRootSessionLists.pinned,
                        hiddenCount: Math.max(
                          pinnedSessions.length - ROOT_SESSION_PREVIEW_LIMIT,
                          0,
                        ),
                        onToggle: () =>
                          setExpandedRootSessionLists((prev) => ({
                            ...prev,
                            pinned: !prev.pinned,
                          })),
                      },
                    )}
                    {renderSection(
                      t("recent"),
                      "recent",
                      visibleRecentSessions,
                      {
                        expanded: expandedRootSessionLists.recent,
                        hiddenCount: Math.max(
                          recentSessions.length - ROOT_SESSION_PREVIEW_LIMIT,
                          0,
                        ),
                        onToggle: () =>
                          setExpandedRootSessionLists((prev) => ({
                            ...prev,
                            recent: !prev.recent,
                          })),
                      },
                    )}

                    {visibleArchivedSessions.length > 0 &&
                      renderSection(
                        t("archived"),
                        "archived",
                        visibleArchivedSessions,
                        {
                          expanded: expandedRootSessionLists.archived,
                          hiddenCount: Math.max(
                            archivedSessions.length -
                              ROOT_SESSION_PREVIEW_LIMIT,
                            0,
                          ),
                          onToggle: () =>
                            setExpandedRootSessionLists((prev) => ({
                              ...prev,
                              archived: !prev.archived,
                            })),
                        },
                      )}

                    {rootSessions.length === 0 && (
                      <div className="text-center text-gray-400 text-xs mt-4">
                        {t("noChatsInList")}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex flex-col gap-1 items-center">
              {/* Collapsed New Workspace Button */}
              <Tooltip
                content={t("newWorkspace")}
                position="right"
                className="justify-center"
              >
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("createWorkspaceAria")}
                  onClick={() => {
                    setEditingWorkspace(undefined);
                    setShowWorkspaceModal(true);
                  }}
                  className="p-2 text-gray-500 hover:bg-gray-100/80 dark:hover:bg-muted/60 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  <FolderPlus size={18} aria-hidden="true" />
                </Button>
              </Tooltip>

              <Tooltip
                content={
                  <ShortcutTooltipContent
                    label={t("newChat")}
                    shortcut={newChatShortcut.display}
                  />
                }
                position="right"
                className="justify-center"
              >
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("createChatAria")}
                  aria-keyshortcuts={newChatShortcut.ariaKeyShortcuts}
                  onClick={onNewChat}
                  className="p-2 text-gray-500 hover:bg-gray-100/80 dark:hover:bg-muted/60 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  <MessageSquarePlus size={18} aria-hidden="true" />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200/50 p-3 dark:border-border">
          <DropdownMenu
            open={isSettingsMenuOpen}
            onOpenChange={setIsSettingsMenuOpen}
          >
            <Tooltip
              content={t("settings")}
              position="right"
              className={isOpen ? "w-full" : "w-full justify-center"}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("openSettingsMenu")}
                  aria-current={isSettingsOpen ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                    isSettingsOpen
                      ? "bg-sidebar-accent/70 text-slate-700 dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                      : "text-gray-600 hover:bg-sidebar-accent dark:text-muted-foreground"
                  } ${isOpen ? "w-full" : "w-10 justify-center px-0"}`}
                >
                  <Settings
                    size={18}
                    className={`shrink-0 ${isSettingsOpen ? "text-blue-500" : "text-gray-500"}`}
                    aria-hidden="true"
                  />
                  {isOpen && <span className="truncate">{t("settings")}</span>}
                  {isOpen && (
                    <ChevronDown
                      size={14}
                      className={`ml-auto text-muted-foreground transition-transform duration-200 ease-out ${
                        isSettingsMenuOpen ? "rotate-180" : "rotate-0"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent
              side={isOpen ? "top" : "right"}
              align={isOpen ? "start" : "end"}
              className="w-52 overflow-visible"
            >
              <DropdownMenuItem onSelect={() => onOpenSettings()}>
                <Settings size={14} aria-hidden="true" />
                {t("settings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-auto min-h-8">
                  <Sun size={14} aria-hidden="true" />
                  <span>{t("appearance")}</span>
                  <span className="ml-auto max-w-20 truncate text-xs text-muted-foreground">
                    {themeDisplayLabel}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) =>
                      setTheme(value as AppSettings["theme"])
                    }
                  >
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="light"
                      className={
                        theme === "light" ? "font-medium text-brand" : undefined
                      }
                    >
                      <Sun size={14} aria-hidden="true" />
                      {t("themeLight")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="dark"
                      className={
                        theme === "dark" ? "font-medium text-brand" : undefined
                      }
                    >
                      <Moon size={14} aria-hidden="true" />
                      {t("themeDark")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="system"
                      className={
                        theme === "system"
                          ? "font-medium text-brand"
                          : undefined
                      }
                    >
                      <Laptop size={14} aria-hidden="true" />
                      {t("themeSystem")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-auto min-h-8">
                  <Languages size={14} aria-hidden="true" />
                  <span>{t("language")}</span>
                  <span className="ml-auto max-w-20 truncate text-xs text-muted-foreground">
                    {languageDisplayLabel}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  <DropdownMenuRadioGroup
                    value={language}
                    onValueChange={(value) =>
                      setLocale(value as AppSettings["language"])
                    }
                  >
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="en"
                      className={
                        language === "en" ? "font-medium text-brand" : undefined
                      }
                    >
                      {t("langEnglish")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="zh"
                      className={
                        language === "zh" ? "font-medium text-brand" : undefined
                      }
                    >
                      {t("langChinese")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="ja"
                      className={
                        language === "ja" ? "font-medium text-brand" : undefined
                      }
                    >
                      {t("langJapanese")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      indicatorPosition="right"
                      value="auto"
                      className={
                        language === "auto"
                          ? "font-medium text-brand"
                          : undefined
                      }
                    >
                      {t("langSystem")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {contextMenu &&
          sessions.find((session) => session.id === contextMenu.sessionId) && (
            <SessionActionsMenu
              session={sessions.find(
                (session) => session.id === contextMenu.sessionId,
              )!}
              anchor={contextMenu}
              returnFocus={contextMenu.trigger}
              onClose={() => setContextMenu(null)}
            />
          )}

        {/* Workspace Context Menu */}
        {workspaceMenu && (
          <DropdownMenu
            open
            onOpenChange={(open) => {
              if (!open) setWorkspaceMenu(null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="bare"
                type="button"
                aria-label={t("workspaceActions")}
                className="fixed z-50 h-px w-px opacity-0"
                style={{ top: workspaceMenu.y, left: workspaceMenu.x }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="start"
              sideOffset={0}
              className="w-48"
            >
              <DropdownMenuItem
                onSelect={() => {
                  const ws = workspaces.find(
                    (w) => w.id === workspaceMenu.workspaceId,
                  );
                  if (ws) handleNewChatInWorkspace(ws);
                  setWorkspaceMenu(null);
                }}
              >
                <MessageSquarePlus size={14} aria-hidden="true" />
                {t("newChat")}
              </DropdownMenuItem>

              <DropdownMenuItem
                onSelect={() => {
                  const ws = workspaces.find(
                    (w) => w.id === workspaceMenu.workspaceId,
                  );
                  setEditingWorkspace(ws);
                  setShowWorkspaceModal(true);
                  setWorkspaceMenu(null);
                }}
              >
                <FolderCog size={14} aria-hidden="true" />
                {t("editWorkspace")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
