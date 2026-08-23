import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MessageInput composition", () => {
  it("omits the model capability preview while retaining capability gates", () => {
    const messageInput = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageInput.tsx"),
      "utf8",
    );
    const localeCatalogs = ["en", "zh", "ja"]
      .map((locale) =>
        readFileSync(
          resolve(
            process.cwd(),
            `src/i18n/locales/${locale}/MessageInput.json`,
          ),
          "utf8",
        ),
      )
      .join("\n");
    const removedKeys = [
      "selectModelWithCapabilitiesAria",
      "modelCapabilityPreflight",
      "capabilityAttachments",
      "capabilityImages",
      "capabilityTools",
      "capabilityReasoning",
      "capabilitySupported",
      "capabilityUnavailable",
    ];

    expect(messageInput).toContain('t("selectModelAria"');
    expect(messageInput).toContain("modelCapabilities");
    removedKeys.forEach((key) => {
      expect(messageInput).not.toContain(key);
      expect(localeCatalogs).not.toContain(`"${key}"`);
    });
  });

  it("keeps attachment tray presentation outside the composer container", () => {
    // The composer's attachment logic lives in the extracted hook; read both
    // halves so this stays an assertion about the surface, not about layout.
    const messageInput = [
      "src/components/chat/MessageInput.tsx",
      "src/features/chat/hooks/useComposerAttachments.ts",
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");
    const attachmentTray = readFileSync(
      resolve(
        process.cwd(),
        "src/components/chat/MessageInputAttachmentTray.tsx",
      ),
      "utf8",
    );

    expect(messageInput).toContain("MessageInputAttachmentTray");
    expect(messageInput).toContain("isKnowledgeAttachment");
    expect(messageInput).toContain("aria-pressed={hasKnowledgeAttachments}");
    expect(messageInput).not.toContain("LayoutDashboard");
    expect(messageInput).not.toContain("system.enableHtmlVisualPrompt");
    expect(messageInput).not.toContain("updateSystemSettings");
    expect(messageInput).not.toContain("htmlVisualPromptEnabled");
    expect(messageInput).not.toContain("HTML Visual Prompt Button");
    expect(messageInput).toContain("PencilSparkles");
    expect(messageInput).not.toContain("PencilSparklesIcon");
    expect(messageInput).not.toContain("showMobileTools");
    expect(messageInput).not.toContain("mobileActiveToolCount");
    expect(messageInput).not.toContain("mobileToolsAriaLabel");
    expect(messageInput).not.toContain("MoreHorizontal");
    expect(messageInput).not.toContain("Mobile Tools Menu");
    expect(messageInput).not.toContain("handleAttachClick");
    expect(messageInput).toContain("glass-shell relative flex w-full flex-col");
    expect(messageInput).toContain("variant?: MessageInputVariant");
    expect(messageInput).toContain('variant = "default"');
    expect(messageInput).toContain("isHeroVariant");
    expect(messageInput).toContain('"min-h-[5em]"');
    expect(messageInput).toContain('"min-h-[2em]"');
    expect(messageInput).toContain('isHeroVariant ? "mb-0 md:mb-18" : ""');
    expect(messageInput).not.toContain('"min-h-[6em]"');
    expect(messageInput).not.toContain("min-h-[4em]");
    expect(messageInput).not.toContain("min-h-[3em]");
    expect(messageInput).not.toContain("min-h-28");
    expect(messageInput).not.toContain("md:min-h-32");
    expect(messageInput).not.toContain("min-h-12");
    expect(messageInput).toContain("installedSkills");
    expect(messageInput).toContain("updateSessionConfig");
    expect(messageInput).toContain("normalizeSkillIdRefs");
    expect(messageInput).toContain("pluginSourceGroups");
    expect(messageInput).toContain('plugin.source === "mcp"');
    expect(messageInput).toContain('t("mcpServers")');
    expect(messageInput).not.toContain("toggleSkillActive");
    expect(messageInput).not.toContain("formatSkillCategory");
    expect(messageInput).not.toContain("autoSelectSkills");
    expect(messageInput).not.toContain("manageSkills");
    expect(messageInput).not.toContain("setSkillAutoSelect");
    expect(messageInput).not.toContain("border border-green-500 bg-green-500");
    expect(messageInput).toContain("border border-cyan-500 bg-cyan-500");
    expect(messageInput).not.toContain("border border-blue-500 bg-blue-500");
    expect(messageInput).not.toContain("text-green-500 dark:text-green-400");
    expect(messageInput).toContain("text-blue-500 dark:text-blue-400");
    expect(messageInput).toContain(
      "text-cyan-500 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20",
    );
    expect(messageInput).toContain(
      "text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
    );
    expect(messageInput).toContain("handlePolishInput");
    expect(messageInput).toContain("reasoningOptions");
    expect(messageInput).toContain("reasoningMode");
    expect(messageInput).toContain("Bot");
    expect(messageInput).toContain("agentModeEnabled");
    expect(messageInput).toContain("handleAgentModeToggle");
    expect(messageInput).toContain("!modelCapabilities.toolCall");
    expect(messageInput).toContain("setChatConfig({ useAgentMode });");
    expect(messageInput).toContain(
      "updateSessionConfig(currentSessionId, { useAgentMode });",
    );
    expect(messageInput).toContain('t("agentModeUnavailable")');
    expect(messageInput).toContain("agentSearchRequiresExternalProvider");
    expect(messageInput).toContain('searchCompatibility.mode !== "external"');
    expect(messageInput).toContain("searchToggleTooltip");
    expect(messageInput).toContain("searchToggleAriaLabel");
    expect(messageInput).toContain('t("agentSearchRequiresExternalProvider")');
    expect(messageInput).toContain("DropdownMenuRadioGroup");
    expect(messageInput).toContain('t("reasoningModeAuto")');
    expect(messageInput).toContain('t("reasoningModeHigh")');
    expect(messageInput).toContain("w-40 p-1.5 md:w-72");
    expect(messageInput).toContain(
      "h-auto min-h-8 rounded-md px-2 py-1.5 pr-8",
    );
    expect(messageInput).toContain("hover:bg-accent");
    expect(messageInput).toContain("data-[state=checked]:bg-accent");
    expect(messageInput).not.toContain(
      "data-[state=checked]:border-violet-300",
    );
    expect(messageInput).toContain("hidden text-[11px]");
    expect(messageInput).toContain("md:block");
    expect(messageInput).not.toContain(
      "setChatConfig({ useReasoning: !chatConfig.useReasoning })",
    );
    expect(messageInput).toContain("createChatDocumentAttachment");
    expect(messageInput).toContain("isParsingAttachments");
    expect(messageInput).toContain("isDragUploadActive");
    expect(messageInput).toContain("handleComposerDrop");
    expect(messageInput).toContain("handleComposerPaste");
    expect(messageInput).toContain("extractChatAttachmentFilesFromDrop");
    expect(messageInput).toContain("extractChatAttachmentFilesFromClipboard");
    expect(messageInput).toContain('t("dropFilesTitle")');
    expect(messageInput).toContain("failedToParseDocument");
    expect(messageInput).toContain(".pdf");
    expect(messageInput).not.toContain("reader.readAsText");
    expect(messageInput).not.toContain(
      "text-amber-500 hover:bg-amber-50 hover:text-amber-600",
    );
    expect(messageInput).not.toContain(
      "dark:text-amber-300 dark:hover:bg-amber-900/20",
    );
    expect(messageInput).toContain("<Library");
    expect(messageInput).toContain("text-purple-500 dark:text-purple-400");
    expect(messageInput).toContain('<span>{t("knowledgeBase")}</span>');
    expect(messageInput).toContain("open={showAttachMenu}");
    expect(messageInput).not.toContain("showAttachMenu && hasAttachmentMenu");
    expect(messageInput).toContain("textFallbackInputRef.current?.click()");
    expect(messageInput).not.toContain("const AttachmentPreviewCard");
    expect(messageInput.indexOf("{/* Reasoning Button")).toBeLessThan(
      messageInput.indexOf("{/* Search Button */}"),
    );
    expect(messageInput.indexOf("{/* Search Button */}")).toBeLessThan(
      messageInput.indexOf("{/* Agent Mode Button */}"),
    );
    expect(messageInput.indexOf("{/* Agent Mode Button */}")).toBeLessThan(
      messageInput.indexOf("{/* Model Selector */}"),
    );
    expect(messageInput.indexOf("{/* Model Selector */}")).toBeLessThan(
      messageInput.indexOf("{/* Text Polish Button */}"),
    );
    expect(messageInput.indexOf("{/* Text Polish Button */}")).toBeLessThan(
      messageInput.indexOf("{/* Actions */}"),
    );
    expect(attachmentTray).toContain("AttachmentPreviewCard");
    expect(attachmentTray).toContain("resolveObjectUrlWithLifecycle");
    expect(attachmentTray).toContain("markdown-file-card");
    expect(attachmentTray).toContain("markdown-file-card-icon");
    expect(attachmentTray).toContain("markdown-file-card-action");
    expect(attachmentTray).not.toContain("h-16 w-16");
  });

  it("wires the slash and at-sign composer commands", () => {
    // The command menu logic lives in the extracted hook; read the composer
    // first so the keydown-ordering assertions below still hold.
    const messageInput = [
      "src/components/chat/MessageInput.tsx",
      "src/features/chat/hooks/useComposerCommandMenu.ts",
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");
    const commandMenu = readFileSync(
      resolve(process.cwd(), "src/components/chat/ComposerCommandMenu.tsx"),
      "utf8",
    );
    const referenceChips = readFileSync(
      resolve(process.cwd(), "src/components/chat/ComposerReferenceChips.tsx"),
      "utf8",
    );

    // Parsing lives in the pure helper module, not in the component.
    expect(messageInput).toContain("detectComposerTrigger");
    expect(messageInput).toContain("consumeComposerTrigger");
    expect(messageInput).toContain("filterComposerItems");
    expect(messageInput).not.toContain("text.slice(match.start");

    // The menu commits before the send check so Enter selects, not sends.
    expect(
      messageInput.indexOf("if (handleCommandMenuKeyDown(e)) return;"),
    ).toBeLessThan(messageInput.indexOf("shouldSubmitOnEnter({"));
    expect(messageInput).toContain("e.nativeEvent.isComposing) return false");
    expect(messageInput).toContain("getNextMenuItemIndex");

    // Combobox semantics on the textarea, listbox semantics on the popup.
    expect(messageInput).toContain('role={isCommandMenuOpen ? "combobox"');
    expect(messageInput).toContain("aria-activedescendant");
    expect(messageInput).toContain("aria-controls={isCommandMenuOpen");
    expect(commandMenu).toContain('role="listbox"');
    expect(commandMenu).toContain('role="option"');
    expect(commandMenu).toContain('role="group"');
    expect(commandMenu).not.toContain('role="menu"');
    expect(commandMenu).toContain("AnchoredPortal");
    expect(commandMenu).toContain('placement="top-start"');

    // Forced references are per-message state surfaced as dismissible chips.
    expect(messageInput).toContain("forcedSkillIds");
    expect(messageInput).toContain("forcedPluginIds");
    expect(messageInput).toContain("ComposerReferenceChips");
    expect(messageInput).toContain("setForcedSkillIds([]);");
    expect(messageInput).toContain("setForcedPluginIds([]);");
    expect(messageInput).toContain('t("forcedPluginNeedsToolSupport")');
    expect(referenceChips).toContain("removeSkillLabel");
    expect(referenceChips).toContain("removePluginLabel");
    // Referenced conversations become real attachments, never chips.
    expect(referenceChips).not.toContain("conversations:");
    expect(referenceChips).not.toContain("onRemoveConversation");

    // Action commands reuse the handlers the toolbar already dispatches to.
    expect(messageInput).toContain("imageInputRef.current?.click()");
    expect(messageInput).toContain("setShowKBModal(true)");
    expect(messageInput).toContain("setShowRemoteModal(true)");
    expect(messageInput).toContain("newChat: onNewChat");
    expect(messageInput).toContain("compressContext: onCompressContext");
    expect(messageInput).toContain("newChat?.()");
    expect(messageInput).toContain("void compressContext?.()");

    // Referenced conversations flow through the shared attachment budget.
    expect(messageInput).toContain("buildVisibleConversationSource");
    expect(messageInput).not.toContain("buildCompressionSource");
    expect(messageInput).toContain("buildConversationTranscript");
    expect(messageInput).toContain("CONVERSATION_REFERENCE_MAX_CHARS");
    expect(messageInput).toContain("appendAttachments([");
    expect(messageInput).toContain('mimeType: "text/markdown"');
  });
});
