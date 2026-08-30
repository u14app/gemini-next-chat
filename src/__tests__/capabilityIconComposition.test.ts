import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("Capability icon composition", () => {
  it("uses ScrollText for generic Skill surfaces", () => {
    const sidebar = readSource("src/components/layout/Sidebar.tsx");
    const workspaceSettings = readSource(
      "src/components/layout/WorkspaceSettingsModal.tsx",
    );
    const commandMenu = readSource(
      "src/components/chat/ComposerCommandMenu.tsx",
    );
    const referenceChips = readSource(
      "src/components/chat/ComposerReferenceChips.tsx",
    );
    const messageItem = readSource("src/components/chat/MessageItem.tsx");
    const skillMarket = readSource("src/components/skill/SkillMarket.tsx");
    const toolCalls = readSource("src/components/content/ToolCallBlock.tsx");

    expect(sidebar).toContain("<ScrollText");
    expect(workspaceSettings).toContain("<ScrollText");
    expect(commandMenu).toContain("skill: ScrollText");
    expect(referenceChips).toContain("icon={ScrollText}");
    expect(messageItem).toContain(
      '<ScrollText size={11} aria-hidden="true" />',
    );
    expect(skillMarket).toContain("<ScrollText");
    expect(skillMarket).not.toContain("<Sparkles");
    expect(toolCalls).toContain("load_skill: ScrollText");
  });

  it("uses Cable for generic Plugin surfaces while preserving brand logos", () => {
    const sidebar = readSource("src/components/layout/Sidebar.tsx");
    const workspaceSettings = readSource(
      "src/components/layout/WorkspaceSettingsModal.tsx",
    );
    const messageInput = readSource("src/components/chat/MessageInput.tsx");
    const commandMenu = readSource(
      "src/components/chat/ComposerCommandMenu.tsx",
    );
    const referenceChips = readSource(
      "src/components/chat/ComposerReferenceChips.tsx",
    );
    const pluginMarket = readSource("src/components/plugin/PluginMarket.tsx");
    const toolCalls = readSource("src/components/content/ToolCallBlock.tsx");

    expect(sidebar).toContain("<Cable");
    expect(workspaceSettings).toContain("<Cable");
    expect(messageInput).toContain("<Cable");
    expect(commandMenu).toContain("plugin: Cable");
    expect(referenceChips).toContain("icon={Cable}");
    expect(pluginMarket).toContain("src={plugin.logoUrl}");
    expect(pluginMarket).toContain("<Cable");
    expect(pluginMarket).not.toContain("<Blocks");
    expect(toolCalls).toMatch(/toolCall\.pluginId\s*\? Cable/u);
  });

  it("uses LibraryBig for Knowledge Base surfaces", () => {
    for (const path of [
      "src/components/layout/Sidebar.tsx",
      "src/components/chat/MessageInput.tsx",
      "src/hooks/useComposerCommandMenu.ts",
      "src/components/knowledge/KnowledgeSelectionModal.tsx",
      "src/components/knowledge/KnowledgeBase.tsx",
      "src/components/knowledge/RAGBlock.tsx",
      "src/components/knowledge/AddToKnowledgeModal.tsx",
      "src/components/chat/MessageInputAttachmentTray.tsx",
      "src/components/chat/MessageAttachmentView.tsx",
      "src/components/chat/MessageItem.tsx",
      "src/components/layout/WorkspaceSettingsModal.tsx",
      "src/components/search/GlobalSearchCenter.tsx",
    ]) {
      const source = readSource(path);
      expect(source).toContain("LibraryBig");
      expect(source).not.toMatch(/\bLibrary\b/u);
    }
  });
});
