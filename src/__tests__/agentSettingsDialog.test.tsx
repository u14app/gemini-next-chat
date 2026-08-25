// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentSettingsDialog, {
  type AgentCapabilitySummary,
} from "@/components/agent/AgentSettingsDialog";
import { AGENT_RUN_BUDGET_PRESETS } from "@/lib/agent/run";
import messages from "@/i18n/locales/en/MessageInput.json";

vi.mock("@/components/agent/AgentArtifactDrawer", () => ({
  default: () => null,
}));

afterEach(cleanup);

const summary: AgentCapabilitySummary = {
  approvalMode: "permissive",
  searchEnabled: true,
  registeredToolNames: ["web_search", "read_workspace_file"],
  discoverableToolCount: 2,
  pluginNames: ["Example"],
  automaticSkillNames: ["Research"],
  manualSkillNames: [],
  memoryScopes: ["global", "session"],
  knowledgeCount: 3,
  workspaceAvailable: true,
};

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof AgentSettingsDialog>> = {},
) {
  const props: React.ComponentProps<typeof AgentSettingsDialog> = {
    open: true,
    sessionId: "session-1",
    summary,
    onApprovalModeChange: vi.fn(),
    onBudgetChange: vi.fn(),
    onBudgetReset: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };

  render(
    <NextIntlClientProvider locale="en" messages={{ MessageInput: messages }}>
      <AgentSettingsDialog {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("AgentSettingsDialog", () => {
  it("applies the selected security level immediately", async () => {
    const onApprovalModeChange = vi.fn();
    renderDialog({ onApprovalModeChange });

    await userEvent.click(screen.getByRole("radio", { name: /Balanced/ }));

    expect(onApprovalModeChange).toHaveBeenCalledWith("balanced");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("writes exact budget presets and can restore inheritance", async () => {
    const onBudgetChange = vi.fn();
    const onBudgetReset = vi.fn();
    renderDialog({
      budgetOverride: { ...AGENT_RUN_BUDGET_PRESETS.standard },
      onBudgetChange,
      onBudgetReset,
    });

    expect(
      screen
        .getByRole("button", { name: /Standard/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: /Extended/ }));
    expect(onBudgetChange).toHaveBeenCalledWith(
      AGENT_RUN_BUDGET_PRESETS.extended,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Restore inherited" }),
    );
    expect(onBudgetReset).toHaveBeenCalledTimes(1);
  });

  it("supports arrow-key navigation between the two tabs", () => {
    renderDialog();
    const agentTab = screen.getByRole("tab", { name: "Agent settings" });
    const workspaceTab = screen.getByRole("tab", {
      name: "Artifacts and workspace",
    });

    expect(agentTab.className).toContain("border-b-2");
    expect(agentTab.className).toContain("border-blue-500");
    expect(agentTab.className).not.toContain("bg-blue-50");

    agentTab.focus();
    fireEvent.keyDown(agentTab, { key: "ArrowRight" });

    expect(workspaceTab.getAttribute("aria-selected")).toBe("true");
    expect(workspaceTab.className).toContain("border-blue-500");
    expect(document.activeElement).toBe(workspaceTab);
    expect(
      screen.getByRole("tabpanel", { name: "Artifacts and workspace" }),
    ).toBeTruthy();
  });

  it("keeps the close action in the title header and dismisses from backdrop", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", {
      name: "Close Agent settings",
    });
    const titleHeader = screen.getByRole("heading", {
      name: "Agent settings",
    }).parentElement;
    const tabList = screen.getByRole("tablist", {
      name: "Agent settings sections",
    });

    expect(titleHeader?.contains(closeButton)).toBe(true);
    expect(tabList.contains(closeButton)).toBe(false);

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uses compact padding for security and budget choices", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: /Balanced/ }).className).toContain(
      "px-2.5 py-2",
    );
    expect(
      screen.getByRole("button", { name: /Standard/ }).className,
    ).toContain("px-2.5 py-2");
    expect("agentBudgetResearchNote" in messages).toBe(false);
  });
});
