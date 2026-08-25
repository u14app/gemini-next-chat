// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import TaskPlanBlock from "@/components/content/TaskPlanBlock";
import MessageOutputRenderer from "@/components/content/MessageOutputRenderer";
import contentMessages from "@/i18n/locales/en/Content.json";

afterEach(cleanup);

const activeSteps = [
  { title: "Inspect context", status: "completed" as const },
  { title: "Implement UI", status: "in_progress" as const },
  { title: "Verify behavior", status: "pending" as const },
];

function renderTaskPlan(
  steps = activeSteps,
  note: string | undefined = "Keep the change focused.",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ Content: contentMessages }}>
      <TaskPlanBlock steps={steps} note={note} />
    </NextIntlClientProvider>,
  );
}

describe("TaskPlanBlock", () => {
  it("renders an active plan open with live progress and step semantics", () => {
    const { container } = renderTaskPlan();

    const button = screen.getByRole("button", { name: /Task plan/ });
    expect(button.getAttribute("aria-expanded")).toBe("true");

    const progress = screen.getByRole("status", {
      name: "1 of 3 steps completed",
    });
    expect(progress.textContent).toBe("1/3");
    expect(progress.getAttribute("aria-live")).toBe("polite");
    expect(progress.getAttribute("aria-atomic")).toBe("true");

    const region = screen.getByRole("region", {
      name: "Task plan details",
    });
    expect(region.hidden).toBe(false);
    expect(
      screen
        .getByText("Implement UI")
        .closest("li")
        ?.getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.getByText("In progress:").className).toContain("sr-only");
    expect(screen.getByText("Completed:").className).toContain("sr-only");
    expect(screen.getByText("Pending:").className).toContain("sr-only");

    const activeIcon = screen
      .getByText("Implement UI")
      .closest("li")
      ?.querySelector("svg");
    expect(activeIcon?.classList.contains("motion-reduce:animate-none")).toBe(
      true,
    );

    const containerClass = container.firstElementChild?.className || "";
    expect(containerClass).toContain("rounded-lg");
    expect(containerClass).toContain("border");
    expect(containerClass).not.toContain("shadow");
    expect(containerClass).not.toContain("gradient");
  });

  it("keeps collapsed plan content hidden from assistive technology", async () => {
    renderTaskPlan();
    const button = screen.getByRole("button", { name: /Task plan/ });
    const panelId = button.getAttribute("aria-controls");

    await userEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = panelId ? document.getElementById(panelId) : null;
    expect(panel?.hidden).toBe(true);
    expect(panel?.getAttribute("aria-hidden")).toBe("true");
    expect(
      screen.queryByRole("region", { name: "Task plan details" }),
    ).toBeNull();
  });

  it("starts a fully completed plan collapsed without dimming the whole row", () => {
    const { container } = renderTaskPlan([
      { title: "Ship the change", status: "completed" },
    ]);

    expect(
      screen
        .getByRole("button", { name: /Task plan/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    const title = screen.getByText("Ship the change");
    expect(title.className).toContain("line-through");
    expect(title.closest("li")?.className).not.toContain("opacity");
    expect(container.textContent).toContain("1/1");
  });

  it("collapses when work completes without overriding a later manual choice", async () => {
    const user = userEvent.setup();
    const view = renderTaskPlan();
    const button = screen.getByRole("button", { name: /Task plan/ });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: contentMessages }}
      >
        <TaskPlanBlock
          steps={activeSteps.map((step) => ({
            ...step,
            status: "completed" as const,
          }))}
        />
      </NextIntlClientProvider>,
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: contentMessages }}
      >
        <TaskPlanBlock
          steps={activeSteps.map((step) => ({
            ...step,
            status: "completed" as const,
          }))}
        />
      </NextIntlClientProvider>,
    );
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("registers task plan output blocks in the message renderer", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{
          Content: contentMessages,
          Message: { generatingImage: "Generating image" },
        }}
      >
        <MessageOutputRenderer
          message={{
            id: "message-1",
            role: "model",
            content: "",
            timestamp: 1,
            outputBlocks: [
              {
                id: "plan-1",
                type: "task_plan",
                steps: activeSteps,
              },
            ],
          }}
          displayedContent=""
          searchSources={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: /Task plan/ })).toBeTruthy();
  });
});
