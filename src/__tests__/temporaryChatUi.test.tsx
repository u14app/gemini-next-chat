// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatAppShell from "@/components/app/ChatAppShell";
import Sidebar from "@/components/layout/Sidebar";
import ChatAppMessages from "@/i18n/locales/en/ChatApp.json";
import CommonMessages from "@/i18n/locales/en/Common.json";
import SidebarMessages from "@/i18n/locales/en/Sidebar.json";
import type { Message, Session, Workspace } from "@/types";

const mocks = vi.hoisted(() => {
  const chatState = {
    activeMessages: [],
    activeMessageTree: {},
    currentSessionId: null as string | null,
    workspaces: [] as Workspace[],
    createSession: vi.fn(() => "created-session"),
    discardTemporarySession: vi.fn(),
  };
  const coreSettingsState = {
    shortcutBindings: {},
    theme: "system" as const,
    language: "en" as const,
    setTheme: vi.fn(),
    setLanguage: vi.fn(),
  };
  const settingsState = {
    serverConfig: { sharing: { available: true } },
  };
  const uiState = { imagePreview: { isOpen: false } };
  const useChatStore = Object.assign(
    (selector?: (state: typeof chatState) => unknown) =>
      selector ? selector(chatState) : chatState,
    { getState: () => chatState },
  );
  const useCoreSettingsStore = (
    selector?: (state: typeof coreSettingsState) => unknown,
  ) => (selector ? selector(coreSettingsState) : coreSettingsState);
  const useSettingsStore = (
    selector?: (state: typeof settingsState) => unknown,
  ) => (selector ? selector(settingsState) : settingsState);
  const useUIStore = Object.assign(
    (selector: (state: typeof uiState) => unknown) => selector(uiState),
    { getState: () => uiState },
  );

  return {
    chatState,
    coreSettingsState,
    settingsState,
    useChatStore,
    useCoreSettingsStore,
    useSettingsStore,
    useUIStore,
    setLocale: vi.fn(),
  };
});

vi.mock("@/store/core/chatStore", () => ({
  useChatStore: mocks.useChatStore,
}));
vi.mock("@/store/core/coreSettingsStore", () => ({
  useCoreSettingsStore: mocks.useCoreSettingsStore,
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: mocks.useSettingsStore,
}));
vi.mock("@/store/core/uiStore", () => ({
  useUIStore: mocks.useUIStore,
}));
vi.mock("@/i18n/useSetLocale", () => ({
  useSetLocale: () => mocks.setLocale,
}));
vi.mock("@/components/shortcuts/ShortcutHint", () => ({
  ShortcutTooltipContent: ({ label }: { label: React.ReactNode }) => (
    <span>{label}</span>
  ),
  useShortcutPresentation: () => ({
    display: null,
    ariaKeyShortcuts: undefined,
  }),
}));
vi.mock("@/components/research/ConnectedResearchGlobalBar", () => ({
  ConnectedResearchGlobalBar: () => null,
}));
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("@/components/chat/MessageInput", () => {
  const MessageInputMock = React.forwardRef<
    HTMLElement,
    { footerNote?: React.ReactNode; variant?: string }
  >(({ footerNote, variant }, ref) => (
    <div data-testid="message-input-shell">
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        aria-describedby={footerNote ? "message-input-footer-note" : undefined}
        aria-label="Chat input"
        data-variant={variant}
      />
      {footerNote ? <p id="message-input-footer-note">{footerNote}</p> : null}
    </div>
  ));
  MessageInputMock.displayName = "MessageInputMock";
  return { default: MessageInputMock };
});
vi.mock("@/components/chat/VirtualizedMessageTimeline", () => {
  const TimelineMock = React.forwardRef<HTMLElement>(() => null);
  TimelineMock.displayName = "TimelineMock";
  return { default: TimelineMock };
});

const localeMessages = {
  ChatApp: ChatAppMessages,
  Common: CommonMessages,
  Sidebar: SidebarMessages,
};

const now = Date.now();

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    messageCount: 0,
    updatedAt: now,
    model: "model",
    ...overrides,
  };
}

const temporarySession = makeSession("Temporary chat", {
  retention: "temporary",
});

function renderShell(
  overrides: Partial<React.ComponentProps<typeof ChatAppShell>> = {},
) {
  const props: React.ComponentProps<typeof ChatAppShell> = {
    actionError: null,
    actionNotice: null,
    sessions: [],
    currentSessionId: null,
    currentSession: undefined,
    messages: [],
    activeMessageTree: {} as React.ComponentProps<
      typeof ChatAppShell
    >["activeMessageTree"],
    isGenerating: false,
    isActiveSessionLoading: false,
    availableModels: [],
    isModelBootstrapReady: false,
    selectedModel: "model",
    isSearchEnabled: false,
    viewMode: "chat",
    settingsTab: "providers",
    researchTaskId: null,
    isSidebarOpen: true,
    isNonDesktopViewport: false,
    isSidebarDrawerOpen: false,
    mainInertProps: {},
    shouldShowChatTitleBar: false,
    welcomeState: "visible",
    messageInputVariant: "hero",
    messagesScrollRef: { current: null },
    messageInputRef: { current: null },
    setIsSidebarOpen: vi.fn(),
    navigateToPanel: vi.fn(),
    handleSettingsTabChange: vi.fn(),
    stopActiveGenerationWithFeedback: vi.fn(async () => undefined),
    selectSession: vi.fn(async () => undefined),
    handleNewChat: vi.fn(),
    handleStartTemporaryChat: vi.fn(),
    handleDeleteSession: vi.fn(async () => undefined),
    updateSessionTitle: vi.fn(),
    toggleSessionPin: vi.fn(),
    handleDuplicateSession: vi.fn(async () => undefined),
    handleSmartRename: vi.fn(async () => undefined),
    handleAssistantSelect: vi.fn(async () => undefined),
    updateSessionInstruction: vi.fn(),
    handleEditMessage: vi.fn(),
    handleDeleteMessage: vi.fn(async () => undefined),
    handleSubmitUserMessageEdit: vi.fn(async () => undefined),
    handleRetractMessage: vi.fn(async () => undefined),
    handleRegenerate: vi.fn(async () => undefined),
    handleContinueGeneration: vi.fn(async () => undefined),
    handleVersionChange: vi.fn(),
    handleVersionSelect: vi.fn(),
    handleSendMessage: vi.fn(async () => undefined),
    prepareComposerSkillParameters: vi.fn(async () => null),
    handleCompressContext: vi.fn(),
    handleSuggestionClick: vi.fn(),
    handleStopGeneration: vi.fn(),
    setModel: vi.fn(),
    onToggleSearch: vi.fn(),
    pendingToolConfirmations: [],
    onToolConfirmationDecision: vi.fn(() => true),
    onRevokeToolSessionApproval: vi.fn(),
    ...overrides,
  };

  const view = render(
    <NextIntlClientProvider locale="en" messages={localeMessages}>
      <ChatAppShell {...props} />
    </NextIntlClientProvider>,
  );

  return { ...view, props };
}

function renderSidebar(sessions: Session[], workspaces: Workspace[] = []) {
  mocks.chatState.workspaces = workspaces;

  return render(
    <NextIntlClientProvider locale="en" messages={localeMessages}>
      <Sidebar
        sessions={sessions}
        currentSessionId={null}
        onSelectSession={vi.fn()}
        onNewChat={vi.fn()}
        isOpen
        toggleSidebar={vi.fn()}
        onOpenPluginMarket={vi.fn()}
        isPluginMarketOpen={false}
        onOpenSkillMarket={vi.fn()}
        isSkillMarketOpen={false}
        onOpenAssistantHub={vi.fn()}
        isAssistantHubOpen={false}
        onOpenKnowledgeBase={vi.fn()}
        isKnowledgeBaseOpen={false}
        onOpenSettings={vi.fn()}
        isSettingsOpen={false}
        onOpenGlobalSearch={vi.fn()}
        isGlobalSearchOpen={false}
        onLogoClick={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatState.workspaces = [];
  mocks.coreSettingsState.shortcutBindings = {};
});

describe("temporary chat shell controls", () => {
  it("shows the temporary entry icon, accessible name, and tooltip in the ordinary hero", async () => {
    const user = userEvent.setup();
    const handleStartTemporaryChat = vi.fn();
    const emptyOrdinarySession = makeSession("Empty ordinary chat");
    renderShell({
      currentSessionId: emptyOrdinarySession.id,
      currentSession: emptyOrdinarySession,
      handleStartTemporaryChat,
      shouldShowChatTitleBar: true,
    });

    const entry = screen.getByRole("button", { name: "Temporary chat" });
    expect(
      entry.querySelector("svg.lucide-message-circle-dashed"),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Exit temporary chat" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "More actions for Empty ordinary chat",
      }),
    ).toBeNull();
    const tooltipId = entry.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId!)?.textContent).toContain(
      "Chat and search without saving conversation history",
    );

    await user.hover(entry);
    await waitFor(() => {
      const tooltip = document.getElementById(tooltipId!);
      expect(tooltip?.className).toContain("opacity-100");
    });

    await user.click(entry);
    expect(handleStartTemporaryChat).toHaveBeenCalledOnce();
  });

  it("switches the temporary hero to the exit icon and hides its notice after entering the message view", async () => {
    const user = userEvent.setup();
    const handleNewChat = vi.fn();
    const view = renderShell({
      currentSessionId: temporarySession.id,
      currentSession: temporarySession,
      handleNewChat,
    });

    const exit = screen.getByRole("button", { name: "Exit temporary chat" });
    expect(
      exit.querySelector("svg.lucide-message-circle-dashed-check"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Temporary chat" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "More actions for Temporary chat",
      }),
    ).toBeNull();
    expect(
      screen
        .getByRole("textbox", { name: "Chat input" })
        .getAttribute("aria-describedby"),
    ).toBe("message-input-footer-note");
    expect(
      screen.getByText("This conversation will not appear in your history."),
    ).toBeTruthy();

    view.rerender(
      <NextIntlClientProvider locale="en" messages={localeMessages}>
        <ChatAppShell {...view.props} welcomeState="hidden" />
      </NextIntlClientProvider>,
    );
    // The message view keeps the exit affordance while removing hero-only copy.
    expect(
      screen.getByRole("button", { name: "Exit temporary chat" }),
    ).toBeTruthy();
    expect(
      screen.queryByText("This conversation will not appear in your history."),
    ).toBeNull();
    expect(
      screen
        .getByRole("textbox", { name: "Chat input" })
        .getAttribute("aria-describedby"),
    ).not.toBe("message-input-footer-note");

    await user.click(
      screen.getByRole("button", { name: "Exit temporary chat" }),
    );
    expect(handleNewChat).toHaveBeenCalledOnce();
  });

  it("keeps session actions available for a temporary conversation with messages", () => {
    const sessionWithMessages = makeSession("Temporary with messages", {
      retention: "temporary",
      messageCount: 1,
    });
    renderShell({
      currentSessionId: sessionWithMessages.id,
      currentSession: sessionWithMessages,
      messages: [
        {
          id: "temporary-message",
          role: "user",
          content: "Hello",
          timestamp: now,
        } satisfies Message,
      ],
      welcomeState: "hidden",
      shouldShowChatTitleBar: true,
    });

    expect(
      screen.getByRole("button", {
        name: "More actions for Temporary with messages",
      }),
    ).toBeTruthy();
  });
});

describe("temporary chat sidebar retention", () => {
  it("keeps temporary empty and populated sessions out of groups, previews, and counts", async () => {
    const ordinaryRecent = Array.from({ length: 6 }, (_, index) =>
      makeSession(`Regular recent ${index + 1}`, { messageCount: 1 }),
    );
    const ordinaryArchived = makeSession("Regular archived", {
      messageCount: 1,
      updatedAt: now - 8 * 24 * 60 * 60 * 1000,
    });
    const workspace: Workspace = {
      id: "workspace-1",
      name: "A workspace",
      knowledgeCollectionIds: [],
      files: [],
      createdAt: now,
    };
    const ordinaryWorkspace = makeSession("Regular workspace", {
      messageCount: 1,
      workspaceId: workspace.id,
    });
    const temporaryEmpty = makeSession("Temporary empty", {
      retention: "temporary",
    });
    const temporaryWithMessages = makeSession("Temporary with messages", {
      retention: "temporary",
      messageCount: 3,
    });
    const temporaryArchived = makeSession("Temporary archived", {
      retention: "temporary",
      messageCount: 1,
      updatedAt: now - 8 * 24 * 60 * 60 * 1000,
    });
    const temporaryWorkspace = makeSession("Temporary workspace", {
      retention: "temporary",
      messageCount: 2,
      workspaceId: workspace.id,
    });

    renderSidebar(
      [
        ...ordinaryRecent,
        ordinaryArchived,
        ordinaryWorkspace,
        temporaryEmpty,
        temporaryWithMessages,
        temporaryArchived,
        temporaryWorkspace,
      ],
      [workspace],
    );

    ordinaryRecent.slice(0, 5).forEach((session) => {
      expect(screen.getByRole("button", { name: session.title })).toBeTruthy();
    });
    expect(screen.queryByText("Temporary empty")).toBeNull();
    expect(screen.queryByText("Temporary with messages")).toBeNull();
    expect(screen.queryByText("Temporary archived")).toBeNull();
    expect(screen.queryByText("Temporary workspace")).toBeNull();
    expect(screen.getByRole("button", { name: "Show all (1)" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "A workspace" }));
    expect(
      within(
        screen.getByText("A workspace").parentElement!.parentElement!
          .parentElement!,
      ).getByRole("button", { name: "Regular workspace" }),
    ).toBeTruthy();
    expect(screen.queryByText("Temporary workspace")).toBeNull();
  });
});
