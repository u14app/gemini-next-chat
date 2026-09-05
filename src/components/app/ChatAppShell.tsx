"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCircleDashed,
  MessageCircleDashedCheck,
} from "lucide-react";

import Sidebar from "@/components/layout/Sidebar";
import {
  SessionActionsMenu,
  SessionActionsProvider,
} from "@/components/chat/SessionActions";
import { isTemporarySession } from "@/lib/chat/sessionRetention";
import MessageInput, {
  type ComposerForcedInvocations,
  type MessageInputRef,
} from "@/components/chat/MessageInput";
import type { ComposerSkillParameterValues } from "@/components/skill/SkillParameterDialog";
import VirtualizedMessageTimeline, {
  type VirtualizedMessageTimelineRef,
} from "@/components/chat/VirtualizedMessageTimeline";
import Tooltip from "@/components/ui/Tooltip";
import { Logo } from "@/components/ui/Icons";
import {
  ShortcutTooltipContent,
  useShortcutPresentation,
} from "@/components/shortcuts/ShortcutHint";
import type { ModelInfo } from "@/services/api/chatService";
import type { ChatPanel, SettingsTabId } from "@/lib/chat/panelUrlState";
import type {
  Attachment,
  LobeAgent,
  Message,
  MessageReplyReference,
  Session,
  SessionMessageTree,
  ToolCall,
  ToolConfirmationDecision,
  ToolConfirmationRequest,
} from "@/types";
import { getActiveMessagePath } from "@/lib/chat/messageTree";
import { getSessionDisplayTitle } from "@/lib/chat/sessionTitle";
import { getReplyExcerpt } from "@/lib/chat/streamResilience";
import type { GlobalSearchNavigationTarget } from "@/lib/global-search";
import { useChatStore } from "@/store/core/chatStore";
import { useUIStore } from "@/store/core/uiStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import {
  dispatchShortcutEvent,
  type ShortcutActionHandlers,
} from "@/lib/shortcutDispatcher";
import {
  KNOWLEDGE_SOURCE_NAVIGATE_EVENT,
  type KnowledgeSourceNavigationDetail,
} from "@/lib/knowledge/navigation";
import { Button } from "@/components/ui/primitives";
import { ConnectedResearchGlobalBar } from "@/components/research/ConnectedResearchGlobalBar";
import {
  RESEARCH_TASK_NAVIGATE_EVENT,
  type ResearchTaskNavigationDetail,
} from "@/lib/research/navigation";

const ConnectedResearchTaskList = dynamic(
  () =>
    import("@/components/research/ConnectedResearchViews").then(
      (module) => module.ConnectedResearchTaskList,
    ),
  { ssr: false },
);
const ConnectedResearchWorkbench = dynamic(
  () =>
    import("@/components/research/ConnectedResearchViews").then(
      (module) => module.ConnectedResearchWorkbench,
    ),
  { ssr: false },
);

const ImagePreview = dynamic(() => import("@/components/media/ImagePreview"), {
  ssr: false,
});
const PluginMarket = dynamic(() => import("@/components/plugin/PluginMarket"), {
  ssr: false,
});
const SkillMarket = dynamic(() => import("@/components/skill/SkillMarket"), {
  ssr: false,
});
const AssistantHub = dynamic(
  () => import("@/components/assistant/AssistantHub"),
  {
    ssr: false,
  },
);
const KnowledgeBase = dynamic(
  () => import("@/components/knowledge/KnowledgeBase"),
  {
    ssr: false,
  },
);
const SettingsPage = dynamic(
  () => import("@/components/settings/SettingsPage"),
  {
    ssr: false,
  },
);
const GlobalSearchCenter = dynamic(
  () => import("@/components/search/GlobalSearchCenter"),
  { ssr: false },
);

type WelcomeState = "visible" | "exiting" | "hidden";
type MessageInputVariant = "default" | "hero";

interface ChatAppShellProps {
  actionError: string | null;
  actionNotice: string | null;
  sessions: Session[];
  currentSessionId: string | null;
  currentSession?: Session;
  messages: Message[];
  activeMessageTree: SessionMessageTree;
  isGenerating: boolean;
  isActiveSessionLoading: boolean;
  availableModels: ModelInfo[];
  isModelBootstrapReady: boolean;
  selectedModel: string;
  isSearchEnabled: boolean;
  viewMode: ChatPanel;
  settingsTab: SettingsTabId;
  researchTaskId: string | null;
  isSidebarOpen: boolean;
  isNonDesktopViewport: boolean;
  isSidebarDrawerOpen: boolean;
  mainInertProps: React.HTMLAttributes<HTMLElement> & { inert?: boolean };
  shouldShowChatTitleBar: boolean;
  welcomeState: WelcomeState;
  messageInputVariant: MessageInputVariant;
  messagesScrollRef: React.RefObject<HTMLDivElement | null>;
  messageInputRef: React.RefObject<MessageInputRef | null>;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  navigateToPanel: (
    panel: ChatPanel,
    nextSettingsTab?: SettingsTabId | null,
    historyMode?: "push" | "replace",
    options?: { keepSidebarOpen?: boolean; researchTaskId?: string | null },
  ) => void;
  handleSettingsTabChange: (tab: SettingsTabId) => void;
  stopActiveGenerationWithFeedback: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  handleNewChat: () => void;
  handleStartTemporaryChat: () => void;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (id: string, title: string) => void;
  toggleSessionPin: (id: string) => void;
  handleDuplicateSession: (sessionId: string) => Promise<void>;
  handleSmartRename: (sessionId: string) => Promise<void>;
  handleAssistantSelect: (agent: LobeAgent) => Promise<void>;
  updateSessionInstruction: (id: string, instruction: string) => void;
  handleEditMessage: (msgId: string, newContent: string) => void;
  handleDeleteMessage: (msgId: string) => Promise<void>;
  handleSubmitUserMessageEdit: (
    msgId: string,
    newContent: string,
  ) => Promise<void>;
  handleRetractMessage: (msg: Message) => Promise<void>;
  handleRegenerate: (messageId: string, model?: string) => Promise<void>;
  handleContinueGeneration: (messageId: string) => Promise<void>;
  handleVersionChange: (msgId: string, direction: "prev" | "next") => void;
  handleVersionSelect: (msgId: string, targetId: string) => void;
  handleSendMessage: (
    text: string,
    attachments: Attachment[],
    replyTo?: MessageReplyReference,
    skillParameters?: ComposerSkillParameterValues,
    forced?: ComposerForcedInvocations,
  ) => Promise<void>;
  prepareComposerSkillParameters: (
    forced?: ComposerForcedInvocations,
  ) => Promise<ComposerSkillParameterValues | null>;
  handleCompressContext: () => void | Promise<void>;
  handleSuggestionClick: (question: string) => void;
  handleStopGeneration: () => void;
  setModel: (model: string) => void;
  onToggleSearch: () => void;
  pendingToolConfirmations: ToolConfirmationRequest[];
  onToolConfirmationDecision: (
    toolCallId: string,
    decision: ToolConfirmationDecision,
  ) => boolean;
  onRevokeToolSessionApproval: (toolCall: ToolCall) => void;
}

const ChatAppShell = ({
  actionError,
  actionNotice,
  sessions,
  currentSessionId,
  currentSession,
  messages,
  activeMessageTree,
  isGenerating,
  isActiveSessionLoading,
  availableModels,
  isModelBootstrapReady,
  selectedModel,
  isSearchEnabled,
  viewMode,
  settingsTab,
  researchTaskId,
  isSidebarOpen,
  isNonDesktopViewport,
  isSidebarDrawerOpen,
  mainInertProps,
  shouldShowChatTitleBar,
  welcomeState,
  messageInputVariant,
  messagesScrollRef,
  messageInputRef,
  setIsSidebarOpen,
  navigateToPanel,
  handleSettingsTabChange,
  stopActiveGenerationWithFeedback,
  selectSession,
  handleNewChat,
  handleStartTemporaryChat,
  handleDeleteSession,
  updateSessionTitle,
  toggleSessionPin,
  handleDuplicateSession,
  handleSmartRename,
  handleAssistantSelect,
  updateSessionInstruction,
  handleEditMessage,
  handleDeleteMessage,
  handleSubmitUserMessageEdit,
  handleRetractMessage,
  handleRegenerate,
  handleContinueGeneration,
  handleVersionChange,
  handleVersionSelect,
  handleSendMessage,
  prepareComposerSkillParameters,
  handleCompressContext,
  handleSuggestionClick,
  handleStopGeneration,
  setModel,
  onToggleSearch,
  pendingToolConfirmations,
  onToolConfirmationDecision,
  onRevokeToolSessionApproval,
}: ChatAppShellProps) => {
  const t = useTranslations("ChatApp");
  const imagePreviewOpen = useUIStore((state) => state.imagePreview.isOpen);
  React.useEffect(() => {
    if (viewMode !== "chat" && viewMode !== "settings")
      useChatStore.getState().discardTemporarySession();
  }, [viewMode]);
  const newChatShortcut = useShortcutPresentation("newChat");
  const toggleSidebarShortcut = useShortcutPresentation("toggleSidebar");
  const shortcutBindings = useCoreSettingsStore(
    (state) => state.shortcutBindings,
  );
  const [focusedMessageId, setFocusedMessageId] = React.useState<string>();
  const searchReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const researchReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const previousViewModeRef = React.useRef(viewMode);
  const shouldFocusComposerRef = React.useRef(false);
  const [replyTarget, setReplyTarget] = React.useState<MessageReplyReference>();
  const timelineRef = React.useRef<VirtualizedMessageTimelineRef>(null);
  const [messagesScrollElement, setMessagesScrollElement] =
    React.useState<HTMLDivElement | null>(null);
  const attachMessagesScrollElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      messagesScrollRef.current = element;
      setMessagesScrollElement(element);
    },
    [messagesScrollRef],
  );
  const [focusedWorkspaceId, setFocusedWorkspaceId] = React.useState<string>();
  const [focusedKnowledgeTarget, setFocusedKnowledgeTarget] = React.useState<{
    collectionId: string;
    fileId?: string;
    chunkIndex?: number;
    excerpt?: string;
  }>();
  const [focusedMemoryId, setFocusedMemoryId] = React.useState<string>();
  const [isOnline, setIsOnline] = React.useState(true);
  const [streamClock, setStreamClock] = React.useState(() => Date.now());
  const localDeviceId = React.useMemo(() => getSyncDeviceId(), []);
  const hasForeignActiveGeneration = React.useMemo(
    () =>
      messages.some(
        (message) =>
          message.generation?.status === "streaming" &&
          message.generation.ownerDeviceId !== localDeviceId &&
          streamClock - message.generation.checkpointAt <= 2 * 60 * 1000,
      ),
    [localDeviceId, messages, streamClock],
  );
  const pendingToolConfirmation = pendingToolConfirmations[0];
  const pendingToolMessageId = React.useMemo(
    () =>
      pendingToolConfirmation
        ? messages.find((message) =>
            message.toolCalls?.some(
              (toolCall) => toolCall.id === pendingToolConfirmation.toolCallId,
            ),
          )?.id
        : undefined,
    [messages, pendingToolConfirmation],
  );
  const [pendingToolVisibility, setPendingToolVisibility] = React.useState<{
    messageId: string;
    visible: boolean;
  }>();
  const handlePendingToolVisibilityChange = React.useCallback(
    (visible: boolean) => {
      if (!pendingToolMessageId) return;
      setPendingToolVisibility({ messageId: pendingToolMessageId, visible });
    },
    [pendingToolMessageId],
  );
  const shouldShowPendingToolBanner = Boolean(
    pendingToolConfirmation &&
    (viewMode !== "chat" ||
      (pendingToolConfirmation.sessionId &&
        pendingToolConfirmation.sessionId !== currentSessionId) ||
      !pendingToolMessageId ||
      (pendingToolVisibility?.messageId === pendingToolMessageId &&
        !pendingToolVisibility.visible)),
  );

  const returnToPendingToolSession = React.useCallback(async () => {
    if (
      pendingToolConfirmation?.sessionId &&
      pendingToolConfirmation.sessionId !== currentSessionId
    ) {
      await selectSession(pendingToolConfirmation.sessionId);
    }
    navigateToPanel("chat");
    const activePendingMessage = useChatStore
      .getState()
      .activeMessages.find((message) =>
        message.toolCalls?.some(
          (toolCall) => toolCall.id === pendingToolConfirmation?.toolCallId,
        ),
      );
    if (activePendingMessage) {
      setFocusedMessageId(activePendingMessage.id);
    }
  }, [
    currentSessionId,
    navigateToPanel,
    pendingToolConfirmation,
    selectSession,
  ]);

  const openGlobalSearch = React.useCallback(() => {
    searchReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    navigateToPanel("search");
  }, [navigateToPanel]);

  const focusComposer = React.useCallback(() => {
    if (viewMode !== "chat") {
      shouldFocusComposerRef.current = true;
      navigateToPanel("chat");
      return true;
    }

    window.requestAnimationFrame(() => messageInputRef.current?.focus());
    return true;
  }, [messageInputRef, navigateToPanel, viewMode]);

  React.useEffect(() => {
    if (viewMode !== "chat" || !shouldFocusComposerRef.current) return;
    shouldFocusComposerRef.current = false;
    const frameId = window.requestAnimationFrame(() =>
      messageInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frameId);
  }, [messageInputRef, viewMode]);

  const shortcutActionHandlers = React.useMemo<ShortcutActionHandlers>(
    () => ({
      globalSearch: () => {
        openGlobalSearch();
        return true;
      },
      newChat: () => {
        handleNewChat();
        return true;
      },
      focusComposer,
      cycleChatMode: () => messageInputRef.current?.cycleChatMode() ?? false,
      toggleSidebar: () => {
        setIsSidebarOpen((open) => !open);
        return true;
      },
      openShortcutSettings: () => {
        navigateToPanel("settings", "shortcuts");
        return true;
      },
      stopGeneration: () => {
        if (!isGenerating) return false;
        handleStopGeneration();
        return true;
      },
    }),
    [
      focusComposer,
      handleNewChat,
      handleStopGeneration,
      isGenerating,
      messageInputRef,
      navigateToPanel,
      openGlobalSearch,
      setIsSidebarOpen,
    ],
  );

  React.useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  React.useEffect(() => {
    const deadlines = messages
      .filter(
        (message) =>
          message.generation?.status === "streaming" &&
          message.generation.ownerDeviceId !== localDeviceId,
      )
      .map(
        (message) =>
          message.generation!.checkpointAt + 2 * 60 * 1000 - Date.now(),
      )
      .filter((delay) => delay > 0);
    if (deadlines.length === 0) return;
    const timer = window.setTimeout(
      () => setStreamClock(Date.now()),
      Math.max(50, Math.min(...deadlines)),
    );
    return () => window.clearTimeout(timer);
  }, [localDeviceId, messages, streamClock]);

  React.useEffect(() => {
    const handleKnowledgeSourceNavigate = (event: Event) => {
      const detail = (event as CustomEvent<KnowledgeSourceNavigationDetail>)
        .detail;
      if (!detail?.collectionId) return;
      setFocusedKnowledgeTarget(detail);
      navigateToPanel("knowledge");
    };
    window.addEventListener(
      KNOWLEDGE_SOURCE_NAVIGATE_EVENT,
      handleKnowledgeSourceNavigate,
    );
    return () =>
      window.removeEventListener(
        KNOWLEDGE_SOURCE_NAVIGATE_EVENT,
        handleKnowledgeSourceNavigate,
      );
  }, [navigateToPanel]);

  React.useEffect(() => {
    const handleResearchNavigate = (event: Event) => {
      const taskId = (event as CustomEvent<ResearchTaskNavigationDetail>).detail
        ?.taskId;
      if (!taskId) return;
      if (viewMode !== "research") {
        researchReturnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      navigateToPanel("research", null, "push", { researchTaskId: taskId });
    };
    window.addEventListener(
      RESEARCH_TASK_NAVIGATE_EVENT,
      handleResearchNavigate,
    );
    return () =>
      window.removeEventListener(
        RESEARCH_TASK_NAVIGATE_EVENT,
        handleResearchNavigate,
      );
  }, [navigateToPanel, viewMode]);

  React.useEffect(() => {
    const previousViewMode = previousViewModeRef.current;
    previousViewModeRef.current = viewMode;
    if (previousViewMode !== "research" || viewMode === "research") return;
    const frameId = window.requestAnimationFrame(() => {
      const target = researchReturnFocusRef.current;
      researchReturnFocusRef.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else messageInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [messageInputRef, viewMode]);

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      dispatchShortcutEvent(event, shortcutBindings, shortcutActionHandlers);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [shortcutActionHandlers, shortcutBindings]);

  React.useEffect(() => {
    if (viewMode !== "chat" || !focusedMessageId) return;
    timelineRef.current?.scrollToMessage(focusedMessageId);
    const focusTimerId = window.setTimeout(() => {
      document.getElementById(`message-${focusedMessageId}`)?.focus({
        preventScroll: true,
      });
    }, 180);
    const timerId = window.setTimeout(
      () => setFocusedMessageId(undefined),
      2400,
    );
    return () => {
      window.clearTimeout(focusTimerId);
      window.clearTimeout(timerId);
    };
  }, [focusedMessageId, messages.length, viewMode]);

  React.useEffect(() => setReplyTarget(undefined), [currentSessionId]);

  const focusMessage = React.useCallback((messageId: string) => {
    setFocusedMessageId(messageId);
  }, []);

  const selectReplyTarget = React.useCallback(
    (message: Message) => {
      setReplyTarget({
        messageId: message.id,
        role: message.role,
        excerpt: getReplyExcerpt(message),
      });
      requestAnimationFrame(() => messageInputRef.current?.focus());
    },
    [messageInputRef],
  );

  const handleTimelineVersionChange = React.useCallback(
    (messageId: string, direction: "prev" | "next") => {
      const messageIndex = messages.findIndex(
        (message) => message.id === messageId,
      );
      handleVersionChange(messageId, direction);
      requestAnimationFrame(() => {
        const nextMessage =
          useChatStore.getState().activeMessages[messageIndex];
        if (nextMessage) setFocusedMessageId(nextMessage.id);
      });
    },
    [handleVersionChange, messages],
  );

  const handleTimelineVersionSelect = React.useCallback(
    (messageId: string, targetId: string) => {
      const messageIndex = messages.findIndex(
        (message) => message.id === messageId,
      );
      handleVersionSelect(messageId, targetId);
      requestAnimationFrame(() => {
        const nextMessage =
          useChatStore.getState().activeMessages[messageIndex];
        if (nextMessage) setFocusedMessageId(nextMessage.id);
      });
    },
    [handleVersionSelect, messages],
  );

  const handleGlobalSearchNavigate = React.useCallback(
    async (target: GlobalSearchNavigationTarget) => {
      if (target.type === "session" || target.type === "message") {
        if (isGenerating) await stopActiveGenerationWithFeedback();
        await selectSession(target.sessionId);
        if (target.type === "message") {
          const activeIds = new Set(
            getActiveMessagePath(useChatStore.getState().activeMessageTree).map(
              (message) => message.id,
            ),
          );
          if (!activeIds.has(target.messageId)) return false;
          setFocusedMessageId(target.messageId);
        }
        navigateToPanel("chat");
        return true;
      }
      if (target.type === "knowledge") {
        setFocusedKnowledgeTarget({
          collectionId: target.collectionId,
          fileId: target.fileId,
        });
        navigateToPanel("knowledge");
        return true;
      }
      if (target.type === "workspace") {
        setFocusedWorkspaceId(target.workspaceId);
        setIsSidebarOpen(true);
        navigateToPanel("chat", null, "push", { keepSidebarOpen: true });
        window.setTimeout(() => setFocusedWorkspaceId(undefined), 2400);
        return true;
      }
      setFocusedMemoryId(target.memoryId);
      navigateToPanel("settings", "memory");
      return true;
    },
    [
      isGenerating,
      navigateToPanel,
      selectSession,
      setIsSidebarOpen,
      stopActiveGenerationWithFeedback,
    ],
  );
  return (
    <SessionActionsProvider
      onDelete={handleDeleteSession}
      onRename={updateSessionTitle}
      onTogglePin={toggleSessionPin}
      onDuplicate={handleDuplicateSession}
      onSmartRename={handleSmartRename}
      duplicateDisabled={isGenerating || isActiveSessionLoading}
    >
      <div
        data-chat-app-shell
        inert={viewMode === "search" ? true : undefined}
        aria-hidden={viewMode === "search" ? true : undefined}
        className="relative flex h-dvh w-full overflow-hidden bg-background font-sans text-foreground transition-colors duration-300"
      >
        {imagePreviewOpen && <ImagePreview />}

        {isSidebarDrawerOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/10 transition-opacity duration-200 dark:bg-black/50 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={(id) => {
            if (isGenerating) {
              void stopActiveGenerationWithFeedback();
            }
            void selectSession(id);
            navigateToPanel("chat");
          }}
          onNewChat={handleNewChat}
          isOpen={isSidebarOpen}
          isHidden={isNonDesktopViewport && !isSidebarOpen}
          toggleSidebar={() => setIsSidebarOpen((open) => !open)}
          isModal={isSidebarDrawerOpen}
          onRequestClose={() => setIsSidebarOpen(false)}
          onOpenPluginMarket={() => navigateToPanel("plugins")}
          isPluginMarketOpen={viewMode === "plugins"}
          onOpenSkillMarket={() => navigateToPanel("skills")}
          isSkillMarketOpen={viewMode === "skills"}
          onOpenAssistantHub={() => navigateToPanel("assistants")}
          isAssistantHubOpen={viewMode === "assistants"}
          onOpenKnowledgeBase={() => navigateToPanel("knowledge")}
          isKnowledgeBaseOpen={viewMode === "knowledge"}
          onOpenSettings={() => navigateToPanel("settings", "system")}
          isSettingsOpen={viewMode === "settings"}
          onOpenGlobalSearch={openGlobalSearch}
          isGlobalSearchOpen={viewMode === "search"}
          focusedWorkspaceId={focusedWorkspaceId}
          onLogoClick={handleNewChat}
        />

        <main
          {...mainInertProps}
          className="flex-1 flex flex-col h-full relative z-0 min-w-0 overflow-hidden"
        >
          {viewMode !== "research" ? (
            <div className="shrink-0">
              <ConnectedResearchGlobalBar />
            </div>
          ) : null}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {actionError && (
              <div
                role="alert"
                className="absolute top-16 left-4 right-4 z-30 pointer-events-none"
              >
                <div className="mx-auto max-w-3xl rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow-sm dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-100">
                  {actionError}
                </div>
              </div>
            )}
            {actionNotice && !actionError && (
              <div
                role="status"
                aria-live="polite"
                className="absolute top-16 left-4 right-4 z-30 pointer-events-none"
              >
                <div className="mx-auto max-w-3xl rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
                  {actionNotice}
                </div>
              </div>
            )}
            {shouldShowPendingToolBanner && pendingToolConfirmation ? (
              <div className="absolute inset-x-4 top-3 z-40 mx-auto flex max-w-3xl items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t("pendingToolAction")}</p>
                  <p className="truncate text-xs opacity-80">
                    {pendingToolConfirmation.pluginTitle} ·{" "}
                    {pendingToolConfirmation.functionName}
                  </p>
                </div>
                <Button
                  variant="bare"
                  type="button"
                  onClick={() => void returnToPendingToolSession()}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  {t("reviewToolAction")}
                </Button>
              </div>
            ) : null}
            {viewMode === "research" ? (
              researchTaskId ? (
                <ConnectedResearchWorkbench
                  taskId={researchTaskId}
                  onClose={() => navigateToPanel("chat")}
                />
              ) : (
                <ConnectedResearchTaskList
                  onClose={() => navigateToPanel("chat")}
                />
              )
            ) : viewMode === "plugins" ? (
              <PluginMarket onClose={() => navigateToPanel("chat")} />
            ) : viewMode === "skills" ? (
              <SkillMarket onClose={() => navigateToPanel("chat")} />
            ) : viewMode === "assistants" ? (
              <AssistantHub
                onClose={() => navigateToPanel("chat")}
                onSelect={handleAssistantSelect}
              />
            ) : viewMode === "knowledge" ? (
              <KnowledgeBase
                onClose={() => navigateToPanel("chat")}
                initialCollectionId={focusedKnowledgeTarget?.collectionId}
                initialFileId={focusedKnowledgeTarget?.fileId}
                initialChunkIndex={focusedKnowledgeTarget?.chunkIndex}
                initialExcerpt={focusedKnowledgeTarget?.excerpt}
              />
            ) : viewMode === "settings" ? (
              <SettingsPage
                activeTab={settingsTab}
                onTabChange={handleSettingsTabChange}
                onClose={() => navigateToPanel("chat")}
                focusMemoryId={focusedMemoryId}
              />
            ) : (
              <>
                <header className="relative z-10 flex h-14 items-center justify-between px-4">
                  <div className="flex min-w-10 items-center">
                    <Tooltip
                      content={
                        <ShortcutTooltipContent
                          label={
                            isSidebarOpen ? t("closeSidebar") : t("openSidebar")
                          }
                          shortcut={toggleSidebarShortcut.display}
                        />
                      }
                      position="right"
                      className="lg:hidden"
                    >
                      <Button
                        variant="bare"
                        type="button"
                        aria-label={
                          isSidebarOpen
                            ? t("closeSidebarAria")
                            : t("openSidebarAria")
                        }
                        aria-keyshortcuts={
                          toggleSidebarShortcut.ariaKeyShortcuts
                        }
                        onClick={() => setIsSidebarOpen((open) => !open)}
                        className="p-2 -ml-2 rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {isSidebarOpen ? (
                          <PanelLeftClose size={16} aria-hidden="true" />
                        ) : (
                          <PanelLeftOpen size={16} aria-hidden="true" />
                        )}
                      </Button>
                    </Tooltip>
                  </div>

                  {shouldShowChatTitleBar && (
                    <div
                      suppressHydrationWarning
                      className="min-w-0 flex-1 truncate px-2 text-center font-bold text-foreground"
                    >
                      {currentSession
                        ? getSessionDisplayTitle(
                            currentSession.title,
                            t("newChat"),
                          )
                        : t("newChat")}
                    </div>
                  )}

                  <div className="ml-auto flex min-w-10 shrink-0 items-center justify-end gap-1">
                    {isTemporarySession(currentSession) ? (
                      <Tooltip content={t("endTemporaryChat")} position="left">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0"
                          onClick={handleNewChat}
                          aria-label={t("endTemporaryChat")}
                        >
                          <MessageCircleDashedCheck
                            size={16}
                            aria-hidden="true"
                          />
                        </Button>
                      </Tooltip>
                    ) : welcomeState === "visible" ? (
                      <Tooltip
                        content={t("temporaryChatDescription")}
                        position="left"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0"
                          onClick={handleStartTemporaryChat}
                          aria-label={t("temporaryChat")}
                        >
                          <MessageCircleDashed size={16} aria-hidden="true" />
                        </Button>
                      </Tooltip>
                    ) : null}

                    {!isSidebarOpen && (
                      <Tooltip
                        content={
                          <ShortcutTooltipContent
                            label={t("newChat")}
                            shortcut={newChatShortcut.display}
                          />
                        }
                        position="left"
                        className="md:hidden"
                      >
                        <Button
                          variant="bare"
                          type="button"
                          aria-label={t("newChatAria")}
                          aria-keyshortcuts={newChatShortcut.ariaKeyShortcuts}
                          onClick={handleNewChat}
                          className="p-2 -mr-2 rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          <MessageSquarePlus size={16} aria-hidden="true" />
                        </Button>
                      </Tooltip>
                    )}
                    {currentSession &&
                      messages.length > 0 &&
                      (shouldShowChatTitleBar ||
                        isTemporarySession(currentSession)) && (
                        <SessionActionsMenu session={currentSession} />
                      )}
                  </div>
                </header>

                <div
                  ref={attachMessagesScrollElement}
                  data-chat-scroll-container
                  className="relative flex-1 overflow-y-auto px-3 md:px-6"
                >
                  <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
                    {(welcomeState === "visible" ||
                      welcomeState === "exiting") && (
                      <div
                        className={`emptyChatSurface flex-1 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:transform origin-center ${
                          welcomeState === "exiting"
                            ? "opacity-0 scale-95 pointer-events-none"
                            : "opacity-100 scale-100"
                        }`}
                      />
                    )}

                    {welcomeState === "hidden" && (
                      <VirtualizedMessageTimeline
                        key={currentSession?.id}
                        ref={timelineRef}
                        scrollElement={messagesScrollElement}
                        currentSession={currentSession}
                        messages={messages}
                        activeMessageTree={activeMessageTree}
                        focusedMessageId={focusedMessageId}
                        isGenerating={isGenerating}
                        actionsDisabled={isActiveSessionLoading}
                        mutationsDisabled={
                          isGenerating ||
                          isActiveSessionLoading ||
                          !isOnline ||
                          hasForeignActiveGeneration
                        }
                        toolActionsDisabled={
                          isActiveSessionLoading ||
                          !isOnline ||
                          hasForeignActiveGeneration
                        }
                        availableModels={availableModels}
                        onUpdateInstruction={(instruction) => {
                          if (currentSession) {
                            updateSessionInstruction(
                              currentSession.id,
                              instruction,
                            );
                          }
                        }}
                        onEdit={handleEditMessage}
                        onDelete={handleDeleteMessage}
                        onSubmitUserEdit={handleSubmitUserMessageEdit}
                        onRetract={(message) =>
                          void handleRetractMessage(message)
                        }
                        onRegenerate={(messageId, model) =>
                          void handleRegenerate(messageId, model)
                        }
                        onContinue={(messageId) =>
                          void handleContinueGeneration(messageId)
                        }
                        onStopGeneration={handleStopGeneration}
                        onReply={selectReplyTarget}
                        onNavigateToMessage={focusMessage}
                        onVersionChange={handleTimelineVersionChange}
                        onVersionSelect={handleTimelineVersionSelect}
                        onSuggestionClick={handleSuggestionClick}
                        onToolConfirmationDecision={onToolConfirmationDecision}
                        onRevokeToolSessionApproval={
                          onRevokeToolSessionApproval
                        }
                        pendingToolMessageId={pendingToolMessageId}
                        onPendingToolVisibilityChange={
                          handlePendingToolVisibilityChange
                        }
                      />
                    )}
                  </div>
                </div>

                <div className="w-full h-4 md:h-6"></div>

                <div
                  className={`absolute left-0 right-0 z-20 px-4 pointer-events-none md:px-8 motion-safe:transition-[bottom,padding-bottom] motion-safe:duration-300 ${
                    welcomeState === "visible"
                      ? "bottom-[40vh] pb-0 md:bottom-[32vh] md:pb-0"
                      : "bottom-0 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-6"
                  }`}
                >
                  <div
                    className={`flex w-full mx-auto pointer-events-auto flex-col items-center motion-safe:transition-[max-width] motion-safe:duration-300 ${
                      welcomeState === "visible" ? "max-w-2xl" : "max-w-3xl"
                    }`}
                  >
                    {hasForeignActiveGeneration || !isOnline ? (
                      <div
                        role="status"
                        className="mb-2 w-full rounded-lg border border-blue-200 bg-blue-50/95 px-3 py-2 text-xs text-blue-800 shadow-sm backdrop-blur dark:border-blue-900/60 dark:bg-blue-950/90 dark:text-blue-100"
                      >
                        {hasForeignActiveGeneration
                          ? t("foreignGenerationActive")
                          : t("offlineReadOnly")}
                      </div>
                    ) : null}
                    {(welcomeState === "visible" ||
                      welcomeState === "exiting") && (
                      <div
                        className={`mb-8 md:mb-8 flex items-center gap-3 text-center motion-safe:transition-[opacity,transform] motion-safe:duration-300 ${
                          welcomeState === "exiting"
                            ? "pointer-events-none opacity-0 scale-95"
                            : "opacity-100 scale-100"
                        }`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center md:h-11 md:w-11">
                          <Logo className="h-10 w-10 md:h-11 md:w-11" />
                        </div>
                        <h1 className="neoChatWordmark bg-clip-text text-[1.75rem] font-bold leading-none tracking-[0.01em] text-transparent bg-[linear-gradient(to_right,#00DEB9,#03B2DE,#1D88E1)]">
                          {t("productName")}
                        </h1>
                      </div>
                    )}
                    {isModelBootstrapReady && availableModels.length === 0 && (
                      <div
                        role="status"
                        className="mb-2 flex w-full flex-col gap-2 rounded-xl border border-border bg-card/95 px-3 py-2.5 text-left shadow-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {t("noModelsTitle")}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {t("noModelsDescription")}
                          </p>
                        </div>
                        <Button
                          variant="bare"
                          type="button"
                          onClick={() =>
                            navigateToPanel("settings", "providers")
                          }
                          className="shrink-0 self-start rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:self-auto"
                        >
                          {t("configureProviders")}
                        </Button>
                      </div>
                    )}
                    <MessageInput
                      ref={messageInputRef}
                      variant={messageInputVariant}
                      onSend={(
                        text,
                        attachments,
                        replyTo,
                        skillParameters,
                        forced,
                      ) => {
                        void handleSendMessage(
                          text,
                          attachments,
                          replyTo,
                          skillParameters,
                          forced,
                        );
                        setReplyTarget(undefined);
                      }}
                      onPrepareSend={prepareComposerSkillParameters}
                      onStop={isGenerating ? handleStopGeneration : undefined}
                      disabled={
                        isGenerating ||
                        isActiveSessionLoading ||
                        hasForeignActiveGeneration ||
                        availableModels.length === 0
                      }
                      offline={!isOnline}
                      availableModels={availableModels}
                      selectedModel={selectedModel}
                      onSelectModel={setModel}
                      isSearchEnabled={isSearchEnabled}
                      onToggleSearch={onToggleSearch}
                      replyTo={replyTarget}
                      onCancelReply={() => setReplyTarget(undefined)}
                      onNavigateReply={focusMessage}
                      onNewChat={handleNewChat}
                      onCompressContext={handleCompressContext}
                      footerNote={
                        isTemporarySession(currentSession) &&
                        welcomeState === "visible"
                          ? t("temporaryChatHistoryNotice")
                          : undefined
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
        {viewMode === "search" && (
          <GlobalSearchCenter
            onClose={() => navigateToPanel("chat")}
            returnFocusRef={searchReturnFocusRef}
            onNavigate={handleGlobalSearchNavigate}
          />
        )}
      </div>
    </SessionActionsProvider>
  );
};

export default ChatAppShell;
