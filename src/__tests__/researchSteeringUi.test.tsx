// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchSteeringPanel } from "@/components/research/ui/ResearchSteeringPanel";
import { ResearchNodeSteering } from "@/components/research/ui/ResearchNodeSteering";
import en from "@/i18n/locales/en/ResearchSteering.json";
import zh from "@/i18n/locales/zh/ResearchSteering.json";
import ja from "@/i18n/locales/ja/ResearchSteering.json";

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  add: vi.fn(),
  priority: vi.fn(),
}));
vi.mock("@/hooks/research/useResearchSteering", () => ({
  useResearchSteering: () => mocks.hook(),
}));

function hookValue() {
  const run = {
    id: "run",
    phase: "exploring",
    nodes: [
      {
        id: "node",
        stepId: "step",
        query: "Storage behavior",
        status: "pending",
      },
    ],
  };
  return {
    task: {
      id: "task",
      status: "researching",
      activeReportRunId: "run",
      reportRuns: [run],
    },
    run,
    plan: {
      steps: [
        { id: "step", title: "Storage" },
        { id: "other", title: "Concurrency" },
      ],
    },
    record: { commands: [], closed: false },
    available: true,
    loading: false,
    busy: false,
    error: null,
    addQuestion: mocks.add,
    setPriority: mocks.priority,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.add.mockResolvedValue(true);
  mocks.priority.mockResolvedValue(true);
  mocks.hook.mockReturnValue(hookValue());
});
afterEach(cleanup);

describe("research steering controls", () => {
  it("labels the add form, submits the selected existing step, and closes on durable enqueue", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={{ ResearchSteering: en }}>
        <ResearchSteeringPanel taskId="task" />
      </NextIntlClientProvider>,
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: en.addQuestion }),
    );
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("combobox", { name: en.step }));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(
      screen.getByRole("textbox", { name: en.question }),
      "What does a power failure lose?",
    );
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(mocks.add).toHaveBeenCalledWith(
      "other",
      "What does a power failure lose?",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("sends absolute promote, demote, and reset priorities", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={{ ResearchSteering: en }}>
        <ResearchNodeSteering taskId="task" nodeId="node" />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: en.promote }));
    await user.click(screen.getByRole("button", { name: en.demote }));
    await user.click(screen.getByRole("button", { name: en.reset }));
    expect(mocks.priority.mock.calls).toEqual([
      ["node", -1],
      ["node", 1],
      ["node", 0],
    ]);
  });

  it("offers no adjustment for an already scheduled node", () => {
    const value = hookValue();
    value.run.nodes[0].status = "queued";
    mocks.hook.mockReturnValue(value);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ ResearchSteering: en }}>
        <ResearchNodeSteering taskId="task" nodeId="node" />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it.each([
    ["en", en],
    ["zh", zh],
    ["ja", ja],
  ] as const)(
    "shows pending and unavailable state in %s",
    (locale, messages) => {
      const value = hookValue();
      mocks.hook.mockReturnValue({
        ...value,
        available: false,
        error: "duplicate",
        record: {
          ...value.record,
          commands: [
            {
              id: "command",
              intent: {
                kind: "add",
                nodeId: "new",
                question: "Recovery after a power failure",
              },
              status: "pending",
            },
          ],
        },
      });
      render(
        <NextIntlClientProvider
          locale={locale}
          messages={{ ResearchSteering: messages }}
        >
          <ResearchSteeringPanel taskId="task" />
        </NextIntlClientProvider>,
      );
      expect(
        (
          screen.getByRole("button", {
            name: messages.addQuestion,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(screen.getByText(messages.pending)).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toBe(
        messages.errors.duplicate,
      );
    },
  );
});
