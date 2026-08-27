"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileUp,
  ImageUp,
  LibraryBig,
  Link,
  MessageSquarePlus,
  Shrink,
} from "lucide-react";
import type {
  ComposerCommandItem,
  ComposerCommandSection,
} from "@/components/chat/ComposerCommandMenu";
import {
  consumeComposerTrigger,
  filterComposerItems,
  type ComposerTriggerMatch,
} from "@/lib/utils/composerCommands";
import { getNextMenuItemIndex } from "@/components/ui/primitives";
import type { useComposerCapabilityState } from "./useComposerCapabilityState";

type ModelCapabilities = ReturnType<
  typeof useComposerCapabilityState
>["modelCapabilities"];

/** Structural shape of the skills/plugins the `/` and `@` menus list. */
interface CommandMenuEntry {
  id: string;
  title: string;
  description?: string;
}

interface CommandMenuConversation {
  id: string;
  title: string;
}

/**
 * Imperative side of a command selection. An omitted `newChat` /
 * `compressContext` hides that row, matching the composer's optional props.
 */
interface ComposerCommandActions {
  attachFile: () => void;
  attachImage: () => void;
  openKnowledgeBase: () => void;
  openRemoteFile: () => void;
  newChat?: () => void;
  compressContext?: () => void | Promise<void>;
  forceSkill: (skillId: string) => void;
  forcePlugin: (pluginId: string) => void;
  attachConversation: (sessionId: string, title: string) => void;
}

interface UseComposerCommandMenuOptions {
  t: ReturnType<typeof useTranslations<"MessageInput">>;
  modelCapabilities: ModelCapabilities;
  ragEnabled: boolean;
  isInputBusy: boolean;
  commandListboxId: string;
  skillsForMenu: readonly CommandMenuEntry[];
  pluginSourceGroups: {
    plugins: readonly CommandMenuEntry[];
    mcp: readonly CommandMenuEntry[];
  };
  conversationsForMenu: readonly CommandMenuConversation[];
  /** Live composer value; read at select time so the trigger token is current. */
  inputValueRef: React.RefObject<string>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setInput: (value: string) => void;
  setErrorMsg: (message: string | null) => void;
  actions: ComposerCommandActions;
}

export function useComposerCommandMenu({
  t,
  modelCapabilities,
  ragEnabled,
  isInputBusy,
  commandListboxId,
  skillsForMenu,
  pluginSourceGroups,
  conversationsForMenu,
  inputValueRef,
  textareaRef,
  setInput,
  setErrorMsg,
  actions,
}: UseComposerCommandMenuOptions) {
  const [commandMatch, setCommandMatch] = useState<ComposerTriggerMatch | null>(
    null,
  );
  const [highlightedCommandId, setHighlightedCommandId] = useState<
    string | null
  >(null);

  const { newChat, compressContext } = actions;

  const actionCommands = useMemo<ComposerCommandItem[]>(() => {
    const items: ComposerCommandItem[] = [
      {
        id: "action:attach",
        token: "attach",
        kind: "action",
        label: t("commandAttachFile"),
        hint: t("commandAttachFileHint"),
        icon: FileUp,
      },
    ];

    if (modelCapabilities.vision) {
      items.push({
        id: "action:image",
        token: "image",
        kind: "action",
        label: t("commandAttachImage"),
        hint: t("commandAttachImageHint"),
        icon: ImageUp,
      });
    }

    if (ragEnabled) {
      items.push({
        id: "action:knowledge",
        token: "knowledge",
        kind: "action",
        label: t("commandKnowledgeBase"),
        hint: t("commandKnowledgeBaseHint"),
        icon: LibraryBig,
      });
    }

    items.push({
      id: "action:remote-file",
      token: "remote-file",
      kind: "action",
      label: t("commandRemoteFile"),
      hint: t("commandRemoteFileHint"),
      icon: Link,
    });

    if (newChat) {
      items.push({
        id: "action:new",
        token: "new",
        kind: "action",
        label: t("commandNewChat"),
        hint: t("commandNewChatHint"),
        icon: MessageSquarePlus,
      });
    }

    if (compressContext) {
      items.push({
        id: "action:compress",
        token: "compress",
        kind: "action",
        label: t("commandCompress"),
        hint: t("commandCompressHint"),
        icon: Shrink,
      });
    }

    return items;
  }, [modelCapabilities.vision, compressContext, newChat, ragEnabled, t]);

  const commandSections = useMemo<ComposerCommandSection[]>(() => {
    if (!commandMatch) return [];
    const { trigger, query } = commandMatch;

    if (trigger === "/") {
      return [
        {
          id: "actions",
          label: t("commandSectionActions"),
          items: filterComposerItems(actionCommands, query),
        },
        {
          id: "skills",
          label: t("commandSectionSkills"),
          items: filterComposerItems(
            skillsForMenu.map<ComposerCommandItem>((skill) => ({
              id: `skill:${skill.id}`,
              token: skill.id,
              kind: "skill",
              label: skill.title,
              hint: skill.description,
            })),
            query,
          ),
        },
      ];
    }

    const toPluginItems = (plugins: readonly CommandMenuEntry[]) =>
      filterComposerItems(
        plugins.map<ComposerCommandItem>((plugin) => ({
          id: `plugin:${plugin.id}`,
          token: plugin.id,
          kind: "plugin",
          label: plugin.title,
          hint: plugin.description,
        })),
        query,
      );

    return [
      {
        id: "conversations",
        label: t("commandSectionConversations"),
        items: filterComposerItems(
          conversationsForMenu.map<ComposerCommandItem>((session) => ({
            id: `conversation:${session.id}`,
            token: session.title,
            kind: "conversation",
            label: session.title,
          })),
          query,
        ).slice(0, 8),
      },
      {
        id: "plugins",
        label: t("installedPlugins"),
        items: toPluginItems(pluginSourceGroups.plugins),
      },
      {
        id: "mcp",
        label: t("mcpServers"),
        items: toPluginItems(pluginSourceGroups.mcp),
      },
    ];
  }, [
    actionCommands,
    commandMatch,
    conversationsForMenu,
    pluginSourceGroups.mcp,
    pluginSourceGroups.plugins,
    skillsForMenu,
    t,
  ]);

  const flatCommandItems = useMemo(
    () => commandSections.flatMap((section) => section.items),
    [commandSections],
  );

  // Keep the highlight on a still-visible row as the query narrows results.
  useEffect(() => {
    if (flatCommandItems.length === 0) {
      if (highlightedCommandId !== null) setHighlightedCommandId(null);
      return;
    }
    if (
      highlightedCommandId &&
      flatCommandItems.some((item) => item.id === highlightedCommandId)
    ) {
      return;
    }
    setHighlightedCommandId(flatCommandItems[0].id);
  }, [flatCommandItems, highlightedCommandId]);

  const isCommandMenuOpen = Boolean(commandMatch) && !isInputBusy;
  const getCommandOptionId = (itemId: string) =>
    `${commandListboxId}-${itemId.replace(/[^\w-]/g, "_")}`;

  const closeCommandMenu = () => {
    setCommandMatch(null);
    setHighlightedCommandId(null);
  };

  /** Rewrites the composer value and restores the caret after React paints. */
  const applyComposerText = (text: string, caret: number) => {
    setInput(text);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  };

  const handleSelectCommand = (item: ComposerCommandItem) => {
    if (!commandMatch) return;
    const consumed = consumeComposerTrigger(
      inputValueRef.current,
      commandMatch,
    );
    closeCommandMenu();
    applyComposerText(consumed.text, consumed.caret);

    // Ids are namespaced (`skill:<id>`); the tail is the real target id.
    const value = item.id.slice(item.id.indexOf(":") + 1);

    switch (item.kind) {
      case "action":
        switch (value) {
          case "attach":
            actions.attachFile();
            break;
          case "image":
            actions.attachImage();
            break;
          case "knowledge":
            actions.openKnowledgeBase();
            break;
          case "remote-file":
            actions.openRemoteFile();
            break;
          case "new":
            newChat?.();
            break;
          case "compress":
            void compressContext?.();
            break;
        }
        break;
      case "skill":
        actions.forceSkill(value);
        break;
      case "plugin":
        if (!modelCapabilities.toolCall) {
          setErrorMsg(t("forcedPluginNeedsToolSupport"));
          break;
        }
        actions.forcePlugin(value);
        break;
      case "conversation":
        actions.attachConversation(value, item.label);
        break;
    }
  };

  const moveCommandHighlight = (key: string) => {
    if (flatCommandItems.length === 0) return;
    const next = getNextMenuItemIndex(
      flatCommandItems.findIndex((item) => item.id === highlightedCommandId),
      flatCommandItems.length,
      key,
    );
    if (next < 0) return;
    setHighlightedCommandId(flatCommandItems[next].id);
  };

  /** Runs before the send check so Enter picks an option instead of sending. */
  const handleCommandMenuKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!isCommandMenuOpen || e.nativeEvent.isComposing) return false;

    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End":
        if (flatCommandItems.length === 0) return false;
        e.preventDefault();
        moveCommandHighlight(e.key);
        return true;
      case "Enter":
      case "Tab": {
        const highlighted = flatCommandItems.find(
          (item) => item.id === highlightedCommandId,
        );
        if (!highlighted) return false;
        e.preventDefault();
        handleSelectCommand(highlighted);
        return true;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeCommandMenu();
        return true;
      default:
        return false;
    }
  };

  return {
    commandMatch,
    setCommandMatch,
    highlightedCommandId,
    setHighlightedCommandId,
    commandSections,
    isCommandMenuOpen,
    getCommandOptionId,
    closeCommandMenu,
    handleSelectCommand,
    handleCommandMenuKeyDown,
  };
}
