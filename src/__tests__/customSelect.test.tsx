// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomSelect } from "@/components/ui/controls";
import SkillParameterDialog from "@/components/skill/SkillParameterDialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      noOptions: "No options",
      select: "Select",
      title: "Complete skill parameters",
      description: "Complete the fields.",
      selectPlaceholder: "Choose an option",
      selectRequired: "Choose an option for this required field.",
      cancel: "Cancel",
      continue: "Continue",
    })[key] || key,
}));

const OPTIONS = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
];

function ControlledSelect({
  initialValue = "alpha",
}: {
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <CustomSelect
      value={value}
      onChange={setValue}
      options={OPTIONS}
      ariaLabel="Choice"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CustomSelect", () => {
  it("selects with the mouse and keeps focus on the trigger", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    const trigger = screen.getByRole("combobox", { name: "Choice" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Beta" }));

    expect(trigger.textContent).toContain("Beta");
    expect(document.activeElement).toBe(trigger);
  });

  it("supports direction keys, Home, End, Enter, and Escape", async () => {
    render(<ControlledSelect />);
    const trigger = screen.getByRole("combobox", { name: "Choice" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.textContent).toContain("Beta");
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );

    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.textContent).toContain("Gamma");
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );

    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.textContent).toContain("Alpha");
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("renders disabled and business-specific empty states", () => {
    render(
      <CustomSelect
        value=""
        onChange={vi.fn()}
        options={[]}
        emptyLabel="Nothing available"
        ariaLabel="Empty choice"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Empty choice" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.textContent).toContain("Nothing available");
  });

  it("honors an explicit disabled state even when options exist", async () => {
    const user = userEvent.setup();
    render(
      <CustomSelect
        value="alpha"
        onChange={vi.fn()}
        options={OPTIONS}
        disabled
        ariaLabel="Disabled choice"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Disabled choice" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("forwards its trigger ref and preserves named form values and ARIA", () => {
    const ref = React.createRef<HTMLButtonElement>();
    const { container } = render(
      <form data-testid="form">
        <p id="choice-help">Choice help</p>
        <CustomSelect
          ref={ref}
          value="beta"
          onChange={vi.fn()}
          options={OPTIONS}
          name="choice"
          required
          aria-invalid
          aria-describedby="choice-help"
          ariaLabel="Named choice"
        />
      </form>,
    );

    const trigger = screen.getByRole("combobox", { name: "Named choice" });
    expect(ref.current).toBe(trigger);
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBe("choice-help");
    expect(
      new FormData(screen.getByTestId("form") as HTMLFormElement).get("choice"),
    ).toBe("beta");
    expect(
      (container.querySelector('input[name="choice"]') as HTMLInputElement)
        .required,
    ).toBe(true);
  });
});

describe("SkillParameterDialog select validation", () => {
  it("blocks submission and focuses the first missing required select", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SkillParameterDialog
        open
        requests={[
          {
            key: "writer",
            title: "Writer",
            parameters: [
              {
                key: "tone",
                label: "Tone",
                input: "select",
                required: true,
                maxLength: 20,
                options: [{ value: "warm", label: "Warm" }],
              },
            ],
          },
        ]}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));

    const trigger = screen.getByRole("combobox", { name: "Tone" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose an option for this required field.",
    );
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Warm" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({ writer: { tone: "warm" } });
  });
});
