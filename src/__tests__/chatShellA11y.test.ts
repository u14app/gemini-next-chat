import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chat shell accessibility", () => {
  it("accounts for mobile safe areas in fixed app chrome", () => {
    const chatShell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/layout/Sidebar.tsx"),
      "utf8",
    );

    expect(chatShell).toContain("env(safe-area-inset-bottom)");
    expect(sidebar).toContain("env(safe-area-inset-top)");
    expect(sidebar).toContain("env(safe-area-inset-bottom)");
  });

  it("isolates the main chat region while the non-desktop sidebar drawer is open", () => {
    const chatShell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );
    const panelNavigation = readFileSync(
      resolve(
        process.cwd(),
        "src/features/chat/hooks/useChatPanelNavigation.ts",
      ),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/layout/Sidebar.tsx"),
      "utf8",
    );

    expect(panelNavigation).toContain("isNonDesktopViewport");
    expect(panelNavigation).toContain(
      "window.innerWidth < DESKTOP_SIDEBAR_BREAKPOINT",
    );
    expect(panelNavigation).toContain(
      "window.innerWidth >= EXPANDED_SIDEBAR_BREAKPOINT",
    );
    expect(panelNavigation).toContain("setIsSidebarOpen(shouldExpandSidebar)");
    expect(panelNavigation).toContain(
      "const isSidebarDrawerOpen = isSidebarOpen && isNonDesktopViewport",
    );
    expect(chatShell).not.toContain("md:pl-16");
    expect(chatShell).toContain('className="lg:hidden"');
    expect(chatShell).not.toContain("backdrop-blur-[1px]");
    expect(panelNavigation).toContain("mainInertProps");
    expect(panelNavigation).toContain("inert");
    expect(panelNavigation).toContain("aria-hidden");
    expect(sidebar).toContain('role={isModal ? "dialog" : undefined}');
    expect(sidebar).toContain("aria-modal={isModal || undefined}");
    expect(sidebar).toContain("handleSidebarKeyDown");
    expect(sidebar).toContain("restoreFocusRef");
    expect(sidebar).toContain("inert={isHidden || undefined}");
    expect(sidebar).toContain("aria-hidden={isHidden || undefined}");
  });

  it("keeps mobile header icon buttons keyboard-focus visible", () => {
    const chatShell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );

    expect(chatShell).toContain(
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    );
    expect(chatShell).toContain(
      '<MessageSquarePlus size={16} aria-hidden="true" />',
    );
    expect(chatShell).toContain('className="md:hidden"');
  });

  it("contains workspace settings scrolling on small viewports", () => {
    const modal = readFileSync(
      resolve(
        process.cwd(),
        "src/components/layout/WorkspaceSettingsModal.tsx",
      ),
      "utf8",
    );

    expect(modal).toContain("document.body.style.overflow");
    expect(modal).toContain("100dvh");
    expect(modal).toContain("overscroll-contain");
    expect(modal).toContain("env(safe-area-inset-bottom)");
    expect(modal).toContain("min-w-0 truncate");
    expect(modal).toContain("title={plugin.title}");
    expect(modal).toContain("title={col.name}");
  });

  it("uses shared modal containment for image preview", () => {
    const imagePreview = readFileSync(
      resolve(process.cwd(), "src/components/media/ImagePreview.tsx"),
      "utf8",
    );

    expect(imagePreview).toContain("useModalLifecycle");
    expect(imagePreview).toContain("trapModalFocus");
    expect(imagePreview).toContain("overscroll-contain");
    expect(imagePreview).toContain("env(safe-area-inset-bottom)");
    expect(imagePreview).toContain('e.key === "ArrowRight"');
    expect(imagePreview).toContain('e.key === "ArrowLeft"');
  });

  it("does not hide composer mode changes behind mouse-only gestures", () => {
    const messageInput = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageInput.tsx"),
      "utf8",
    );
    const voiceButtonSection = messageInput.slice(
      messageInput.indexOf("stopRecordingAria"),
      messageInput.indexOf(
        "</Tooltip>",
        messageInput.indexOf("stopRecordingAria"),
      ),
    );

    expect(voiceButtonSection).not.toContain("onContextMenu");
    expect(voiceButtonSection).not.toContain(
      "autoTranscribe: !voice.autoTranscribe",
    );
  });

  it("keeps searchable unavailable reasons reachable to assistive tech", () => {
    const messageInput = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageInput.tsx"),
      "utf8",
    );
    const searchButtonSection = messageInput.slice(
      messageInput.indexOf("{/* Search Button */}"),
      messageInput.indexOf("{/* Agent Mode Button */}"),
    );

    expect(searchButtonSection).not.toContain("aria-disabled");
    expect(searchButtonSection).toContain("aria-label={searchToggleAriaLabel}");
    expect(messageInput).toContain("const searchToggleAriaLabel");
    expect(messageInput).toContain("getSearchUnavailableMessage");
  });

  // Editing an old message is covered behaviourally in componentA11y.test.tsx:
  // it renders UserMessageEditor and asserts focus/preventScroll per viewport.

  it("uses the configured medium font before hydration", () => {
    const globals = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const themeInit = readFileSync(
      resolve(process.cwd(), "src/lib/themeInitScript.ts"),
      "utf8",
    );
    const themeEffects = readFileSync(
      resolve(process.cwd(), "src/features/chat/hooks/useChatThemeEffects.ts"),
      "utf8",
    );

    expect(globals).toContain("--neo-font-size-base: 14px");
    expect(globals).toContain('html[data-font-size="small"]');
    expect(themeInit).toContain('localStorage.getItem("neo-chat-font-size")');
    expect(themeInit).toContain("document.documentElement.dataset.fontSize");
    expect(themeEffects).toContain(
      'localStorage.setItem("neo-chat-font-size", fontSize)',
    );
  });

  it("scales app chrome from the font size setting, not just message content", () => {
    const globals = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const htmlRule = globals.slice(
      globals.indexOf("\nhtml {"),
      globals.indexOf("}", globals.indexOf("\nhtml {")),
    );

    // rem-based Tailwind sizes resolve against html, so the scale has to be
    // declared there; on body it only ever reached opted-in content.
    expect(htmlRule).toContain("font-size: var(--neo-font-scale)");
    expect(globals).toContain("--neo-font-scale: 100%");
    expect(globals).toMatch(
      /html\[data-font-size="small"\]\s*\{[^}]*--neo-font-scale:\s*87\.5%/,
    );
    expect(globals).toMatch(
      /html\[data-font-size="large"\]\s*\{[^}]*--neo-font-scale:\s*112\.5%/,
    );
  });

  it("holds touch form controls at 16px so restored zoom does not trigger iOS focus zoom", () => {
    const globals = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(globals).toMatch(
      /@media \(pointer: coarse\)\s*\{[\s\S]*?font-size: max\(16px, var\(--neo-font-size-base\)\)/,
    );
  });

  it("keeps Enter as a newline on narrow or coarse-pointer devices", () => {
    const messageInput = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageInput.tsx"),
      "utf8",
    );

    expect(messageInput).toContain('"(pointer: coarse), (max-width: 1023px)"');
    expect(messageInput).toContain("requiresExplicitSend");
    expect(messageInput).toContain(
      '"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"',
    );
  });

  it("finds the last user message once before rendering the list", () => {
    const timeline = readFileSync(
      resolve(
        process.cwd(),
        "src/components/chat/VirtualizedMessageTimeline.tsx",
      ),
      "utf8",
    );

    expect(timeline).toContain("const lastUserMessageIndex = React.useMemo");
    expect(timeline).toContain("row.messageIndex !== lastUserMessageIndex");
    expect(timeline).not.toContain("messages.slice(row.messageIndex + 1)");
  });
});
