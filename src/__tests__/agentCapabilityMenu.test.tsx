// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentCapabilityMenu from "@/components/agent/AgentCapabilityMenu";
import messages from "@/i18n/locales/en/MessageInput.json";

afterEach(cleanup);

const options = [
  {
    value: "auto" as const,
    label: "Auto",
    description: "Chooses the right mode for the task.",
    supported: true,
  },
  {
    value: "chat" as const,
    label: "Chat",
    description:
      "Answers without automatically starting Agent or Deep Research.",
    supported: true,
  },
];

function renderMenu(onModeChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ MessageInput: messages }}>
      <AgentCapabilityMenu
        mode="auto"
        options={options}
        onModeChange={onModeChange}
        onOpenSettings={vi.fn()}
        buttonClassName="h-8 w-8"
      />
    </NextIntlClientProvider>,
  );
  return onModeChange;
}

describe("AgentCapabilityMenu mobile dialog", () => {
  it("keeps the mode unchanged when the localized close control or backdrop dismisses it", async () => {
    const onModeChange = renderMenu();
    const triggers = screen.getAllByRole("button", { name: "Mode: Auto" });
    const mobileTrigger = triggers[1];
    mobileTrigger.focus();
    mobileTrigger.click();

    const dialog = await screen.findByRole("dialog", { name: "Mode" });
    const close = screen.getByRole("button", { name: "Close mode picker" });
    expect(dialog.parentElement?.contains(close)).toBe(true);
    expect(onModeChange).not.toHaveBeenCalled();

    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog", { name: "Mode" })).toBe(dialog);

    fireEvent.click(close);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Mode" })).toBeNull(),
    );
    expect(onModeChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(mobileTrigger);
  });

  it("dismisses from the backdrop itself", async () => {
    renderMenu();
    const triggers = screen.getAllByRole("button", { name: "Mode: Auto" });
    triggers[1].focus();
    triggers[1].click();
    const dialog = await screen.findByRole("dialog", { name: "Mode" });

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Mode" })).toBeNull(),
    );
  });
});
