import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import ja from "../i18n/locales/ja";
import zh from "../i18n/locales/zh";

describe("plugin confirmation UI wiring", () => {
  it("wires runtime tool confirmation into ChatApp streaming calls", () => {
    // The streaming calls moved into ChatApp's extracted flow hooks.
    const chatApp = [
      "src/components/app/ChatApp.tsx",
      "src/hooks/useSendMessageFlow.ts",
      "src/hooks/useResponseBranchFlow.ts",
      "src/hooks/useMessageEditFlow.ts",
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");

    expect(chatApp).toContain("useToolConfirmationController");
    expect(chatApp).toContain("pendingToolConfirmations");
    expect(chatApp).toContain("decideToolConfirmation");
    expect(chatApp).toContain("toolConfirmationController");
    expect(chatApp).toContain("streamChatResponse(");
  });

  it("exposes an accessible opt-in setting for destructive tool calls", () => {
    const systemSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/SystemSettings.tsx"),
      "utf8",
    );

    expect(
      systemSettings.indexOf('title={t("systemAutomationTitle")}'),
    ).toBeLessThan(
      systemSettings.indexOf('name="enableDestructiveToolConfirmation"'),
    );
    expect(systemSettings).toMatch(
      /<ToggleRow[\s\S]*?name="enableDestructiveToolConfirmation"/,
    );
    expect(systemSettings).toContain(
      'name="enableDestructiveToolConfirmation"',
    );
    expect(systemSettings).toContain(
      "checked={system.enableDestructiveToolConfirmation}",
    );
    expect(systemSettings).toContain(
      'ariaLabel={t("destructiveToolConfirmationAria")}',
    );
    expect(en.System.destructiveToolConfirmation).toBeTruthy();
    expect(en.System.destructiveToolConfirmationDesc).toBeTruthy();
    expect(en.System.destructiveToolConfirmationAria).toBeTruthy();
    expect(zh.System.destructiveToolConfirmation).toBeTruthy();
    expect(zh.System.destructiveToolConfirmationDesc).toBeTruthy();
    expect(zh.System.destructiveToolConfirmationAria).toBeTruthy();
    expect(ja.System.destructiveToolConfirmation).toBeTruthy();
    expect(ja.System.destructiveToolConfirmationDesc).toBeTruthy();
    expect(ja.System.destructiveToolConfirmationAria).toBeTruthy();
  });
});
