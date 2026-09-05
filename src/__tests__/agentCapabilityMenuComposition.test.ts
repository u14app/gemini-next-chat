import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import enMessages from "../i18n/locales/en/MessageInput.json";
import jaMessages from "../i18n/locales/ja/MessageInput.json";
import zhMessages from "../i18n/locales/zh/MessageInput.json";

describe("AgentCapabilityMenu composition", () => {
  it("keeps the mode picker focused on mode selection", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/agent/AgentCapabilityMenu.tsx"),
      "utf8",
    );

    expect(source).toContain('role="group"');
    expect(source).toContain("aria-pressed={selected}");
    expect(source).toContain("disabled={!option.supported}");
    expect(source).toContain("onModeChange(option.value);");
    expect(source).toContain('case "auto"');
    expect(source).toContain("<Route");
    expect(source).not.toContain("<Sparkles");
    expect(source).toContain('case "chat"');
    expect(source).toContain('case "research"');
    expect(source).toContain('case "agent"');
    expect(source).not.toContain("AgentCapabilitySummary");
    expect(source).not.toContain("agentCapabilitiesTools");
  });

  it("uses a neutral trigger and limits settings to Agent or Research", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/agent/AgentCapabilityMenu.tsx"),
      "utf8",
    );

    const triggerStart = source.indexOf("const trigger = (");
    const triggerEnd = source.indexOf("\n  );", triggerStart);
    const trigger = source.slice(triggerStart, triggerEnd);
    expect(trigger).toContain("<ModeIcon mode={mode} />");
    expect(trigger).not.toContain("bg-blue");
    expect(trigger).toContain(
      "aria-keyshortcuts={modeShortcut.ariaKeyShortcuts}",
    );
    expect(source).toContain('useShortcutPresentation("cycleChatMode")');
    expect(source).toContain("<ShortcutTooltipContent");
    expect(source).toContain("function SettingsButton");
    expect(source.match(/<SettingsButton/g)).toHaveLength(2);
    expect(source).toContain('content={label} position="left" portal');
    expect(source).not.toContain('title={t("agentSettingsOpen")}');
    expect(source).toContain('mode === "agent" || mode === "research"');
    expect(source).toContain('t("researchSettingsOpen")');
    expect(trigger).toContain("buttonClassName");
    expect(trigger).toContain('mode === "research"');
    expect(trigger).not.toContain("h-11");
    expect(trigger).not.toContain("w-11");
    expect(source).toContain("<Settings2");
    expect(source).toContain("close();");
    expect(source).toContain("onOpenSettings(settingsMode);");
    expect(source).toContain(
      "onOpenSettings(settingsMode, desktopTriggerRef.current)",
    );
    expect(source).toContain("onOpenSettings(mode, mobileTriggerRef.current)");
    expect(source).toContain("desktopTriggerRef.current");
    expect(source).toContain("mobileTriggerRef.current");
    expect(source).toContain("headerAction=");
    expect(source).toContain('label={t("chatModeClose")}');
    expect(source).toContain("<X");
    expect(source).toContain("closeOnBackdropClick");
    expect(source).toContain("showHeader={false}");
    expect(source).toContain('className="w-80 overflow-hidden p-0"');
    expect(source).toContain('align="end"');
    expect(source).toContain('placement="responsive-sheet"');
    expect(source).toContain('className="border-b border-border px-2 py-1"');
    expect(source).toContain("bg-background/80 text-current ring-1");
    expect(source).not.toContain("text-current shadow-sm ring-1");
    expect(source).not.toContain(
      'className="border-b border-border px-3 py-2.5"',
    );
  });

  it("keeps the concise Research description in every locale", () => {
    expect(enMessages.chatModeResearchDescription).toBe(
      "Uses evidence from multiple sources.",
    );
    expect(zhMessages.chatModeResearchDescription).toBe(
      "基于多来源证据开展深入研究。",
    );
    expect(jaMessages.chatModeResearchDescription).toBe(
      "複数の情報源を根拠に詳しく調査します。",
    );
  });
});
