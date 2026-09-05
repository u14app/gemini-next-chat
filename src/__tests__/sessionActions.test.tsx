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
import {
  SessionActionsMenu,
  SessionActionsProvider,
} from "@/components/chat/SessionActions";
import type { Session } from "@/types";
import Sidebar from "@/i18n/locales/en/Sidebar.json";
import Common from "@/i18n/locales/en/Common.json";

const state = vi.hoisted(() => ({
  workspaces: [],
  moveSessionToWorkspace: vi.fn(),
  serverConfig: { sharing: { available: true } },
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: (selector: (value: typeof state) => unknown) =>
    selector(state),
}));
vi.mock("@/components/chat/sessionPresentation", () => ({
  readSessionForPresentation: vi.fn(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(() => {
  cleanup();
  state.serverConfig.sharing.available = true;
});

const session: Session = {
  id: "chat-1",
  title: "A conversation",
  messageCount: 2,
  model: "model",
  updatedAt: 1,
};
function mount(overrides: Partial<Session> = {}) {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ Sidebar, Common }}>
      <SessionActionsProvider onRename={onRename} onDelete={onDelete}>
        <SessionActionsMenu session={{ ...session, ...overrides }} />
      </SessionActionsProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `More actions for ${overrides.title === "" ? "New Chat" : (overrides.title ?? session.title)}`,
    }),
    { key: "Enter" },
  );
  return { onRename, onDelete };
}

describe("shared session actions", () => {
  it("does not persist a localized default title when saved unchanged", async () => {
    const { onRename } = mount({ title: "New Chat" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    await screen.findByRole("textbox", { name: "Chat title" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("renames from the titlebar menu without any sidebar", async () => {
    const { onRename } = mount();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Chat title" });
    fireEvent.change(input, { target: { value: "Updated title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(session.id, "Updated title"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requires the existing second selection before deletion", async () => {
    const { onDelete } = mount();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete A conversation" }),
    );
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Confirm delete A conversation" }),
    );
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(session.id));
  });

  it("hides sharing when Redis is unavailable", async () => {
    state.serverConfig.sharing.available = false;
    mount();
    await screen.findByRole("menuitem", { name: "Export" });
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
  });

  it("offers only export and ending for temporary conversations", async () => {
    mount({ retention: "temporary" });
    await screen.findByRole("menuitem", { name: "Export" });
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Export", "End temporary chat"]);
  });
});
