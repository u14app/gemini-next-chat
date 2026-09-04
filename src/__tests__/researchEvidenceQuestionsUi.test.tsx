// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import EvidenceQuestionsPanel from "@/components/research/workbench/EvidenceQuestionsPanel";
import messages from "@/i18n/locales/en/EvidenceQuestions.json";

const state = vi.hoisted(() => ({
  selectedId: "topic-a",
  answer: "Saved answer",
  error: null as string | null,
  remove: vi.fn(async () => undefined),
  ask: vi.fn(async () => true),
}));
vi.mock("@/hooks/research/useEvidenceConversation", () => ({
  useEvidenceConversation: () => {
    const threads = ["topic-a", "topic-b"].map((id) => ({
      id,
      title: id,
      turns: [
        {
          id: "turn",
          question: "Explain",
          answer: state.answer,
          status: "completed",
        },
      ],
    }));
    return {
      snapshot: state.error
        ? null
        : {
            reportMarkdown: "Saved report",
            evidence: [],
            claims: [],
            origin: "publication",
          },
      threads,
      selectedId: state.selectedId,
      thread: threads.find((thread) => thread.id === state.selectedId),
      available: true,
      error: state.error,
      loading: false,
      select: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      remove: state.remove,
      ask: state.ask,
    };
  },
}));
const renderPanel = () => (
  <NextIntlClientProvider
    locale="en"
    messages={{ EvidenceQuestions: messages }}
  >
    <EvidenceQuestionsPanel
      taskId="task"
      reportId="report"
      reportVersions={[{ id: "report", version: 1 }]}
      onSelectVersion={vi.fn()}
    />
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.selectedId = "topic-a";
  state.answer = "Saved answer";
  state.error = null;
  state.remove.mockClear();
  state.ask.mockClear();
  Object.defineProperty(navigator, "locks", {
    value: { request: vi.fn() },
    configurable: true,
  });
});
afterEach(cleanup);

it("explains unavailable version snapshots without treating the report as missing", () => {
  state.error = "SNAPSHOT_UNAVAILABLE";
  render(renderPanel());
  expect(screen.getByText(messages.errors.SNAPSHOT_UNAVAILABLE)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "New topic" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(state.ask).not.toHaveBeenCalled();
});

it("keeps deletion bound to the topic whose confirmation was opened", async () => {
  const user = userEvent.setup();
  const view = render(renderPanel());
  await user.click(screen.getByRole("button", { name: "Delete topic" }));
  state.selectedId = "topic-b";
  view.rerender(renderPanel());
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete topic",
    }),
  );
  expect(state.remove).toHaveBeenCalledExactlyOnceWith("topic-a");
});

it("does not render encoded external links or remote images from stored answers", () => {
  state.answer = "![tracking](https&#58;//outside.example/pixel.png)";
  render(renderPanel());
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText(/referenced a source outside/)).toBeTruthy();
});

it("submits an explicitly labelled question using the selected report topic", async () => {
  const user = userEvent.setup();
  render(renderPanel());
  fireEvent.change(screen.getByRole("textbox", { name: "Ask a question" }), {
    target: { value: "Explain the limitations" },
  });
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(state.ask).toHaveBeenCalledExactlyOnceWith("Explain the limitations");
});
