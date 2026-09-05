// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/primitives";
import { trapModalFocus } from "@/components/ui/useModalLifecycle";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function markFocusableElementsAsVisible() {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {} as DOMRect,
  ] as unknown as DOMRectList);
}

describe("modal focus containment", () => {
  it("moves Shift+Tab from the shared lifecycle dialog container to the last control", () => {
    markFocusableElementsAsVisible();
    const dialog = document.createElement("div");
    dialog.tabIndex = -1;
    const first = document.createElement("button");
    const last = document.createElement("button");
    dialog.append(first, last);
    document.body.append(dialog);
    dialog.focus();

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });
    trapModalFocus(event, dialog);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("moves Shift+Tab from a primitive Dialog container to the last control", () => {
    markFocusableElementsAsVisible();
    render(
      <Dialog open onClose={vi.fn()} title="Mode">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Mode" });
    const last = screen.getByRole("button", { name: "Last" });
    dialog.focus();
    const event = createEvent.keyDown(dialog, {
      key: "Tab",
      shiftKey: true,
    });
    fireEvent(dialog, event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("restores the opener after a primitive Dialog closes", async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Mode"
            headerAction={
              <button type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            }
          >
            <button type="button">First</button>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const close = await screen.findByRole("button", { name: "Close" });
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
