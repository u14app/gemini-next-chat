// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ResearchSettingsDialog from "@/components/research/ResearchSettingsDialog";
import researchMessages from "@/i18n/locales/en/Research.json";
import { RESEARCH_STRATEGY_PRESETS } from "@/lib/research";

vi.mock("@/components/agent/AgentArtifactDrawer", () => ({
  default: ({
    active,
    sessionId,
  }: {
    active: boolean;
    sessionId?: string | null;
  }) => (
    <div data-testid="artifact-workspace">
      {active ? "active" : "inactive"}:{sessionId}
    </div>
  ),
}));

afterEach(cleanup);

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ResearchSettingsDialog>> = {},
) {
  const props: React.ComponentProps<typeof ResearchSettingsDialog> = {
    open: true,
    sessionId: "session-1",
    budgetPreset: "standard",
    strategy: { ...RESEARCH_STRATEGY_PRESETS.standard },
    onChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ Research: researchMessages }}
    >
      <ResearchSettingsDialog {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("ResearchSettingsDialog", () => {
  it("loads an exact strategy when a budget preset is selected", async () => {
    const onChange = vi.fn();
    renderDialog({ onChange });

    await userEvent.click(screen.getByRole("radio", { name: /Deep budget/ }));

    expect(onChange).toHaveBeenCalledWith(
      "deep",
      RESEARCH_STRATEGY_PRESETS.deep,
    );
  });

  it("clamps manual strategy values and resets to the active preset", async () => {
    const onChange = vi.fn();
    renderDialog({
      strategy: { ...RESEARCH_STRATEGY_PRESETS.standard, initialBreadth: 5 },
      onChange,
    });

    expect(screen.getByRole("button", { name: "Reset preset" })).toBeTruthy();
    const breadth = screen.getByRole("spinbutton", { name: "Breadth" });
    fireEvent.change(breadth, { target: { value: "99" } });
    fireEvent.blur(breadth);
    expect(onChange).toHaveBeenCalledWith("standard", {
      ...RESEARCH_STRATEGY_PRESETS.standard,
      initialBreadth: 8,
    });

    await userEvent.click(screen.getByRole("button", { name: "Reset preset" }));
    expect(onChange).toHaveBeenLastCalledWith(
      "standard",
      RESEARCH_STRATEGY_PRESETS.standard,
    );
  });

  it("reuses the Artifact workspace and supports keyboard tab navigation", () => {
    renderDialog();
    const researchTab = screen.getByRole("tab", { name: "Research settings" });
    const workspaceTab = screen.getByRole("tab", {
      name: "Artifact and workspace",
    });

    expect(screen.queryByTestId("artifact-workspace")).toBeNull();
    researchTab.focus();
    fireEvent.keyDown(researchTab, { key: "ArrowRight" });

    expect(workspaceTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(workspaceTab);
    expect(screen.getByTestId("artifact-workspace").textContent).toBe(
      "active:session-1",
    );
  });

  it("closes from the header, Escape, or backdrop but not content", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(
      screen.getByRole("button", { name: "Close Deep Research settings" }),
    );
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
