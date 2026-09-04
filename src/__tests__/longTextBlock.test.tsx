// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LongTextBlock from "@/components/content/LongTextBlock";
import messageMessages from "@/i18n/locales/en/Message.json";
import type { LongTextPresentation } from "@/types";

vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">
      <a href="#internal">Internal link</a>
      <button type="button">Inner action</button>
      <span data-testid="markdown-content">{content}</span>
    </div>
  ),
}));

const presentation: LongTextPresentation = {
  kind: "long_text",
  title: "Architecture report",
  format: "markdown",
  document: {
    fileName: "Architecture report.md",
    mimeType: "text/markdown",
  },
};

let observerCallback: IntersectionObserverCallback | undefined;
const observe = vi.fn();
const disconnect = vi.fn();

const renderBlock = (
  props: Partial<React.ComponentProps<typeof LongTextBlock>> = {},
) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ Message: messageMessages }}>
      <div data-chat-scroll-container>
        <LongTextBlock
          content={`# Report\n\n${"Paragraph text. ".repeat(240)}`}
          presentation={presentation}
          {...props}
        />
      </div>
    </NextIntlClientProvider>,
  );

describe("LongTextBlock", () => {
  beforeEach(() => {
    observerCallback = undefined;
    observe.mockReset();
    disconnect.mockReset();
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function MockIntersectionObserver(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        observerCallback = callback;
        expect(options).toMatchObject({
          rootMargin: "600px 0px",
        });
        return {
          observe,
          disconnect,
          unobserve: vi.fn(),
          takeRecords: vi.fn(),
        };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mounts the bounded Markdown preview only near the chat viewport", () => {
    renderBlock();

    expect(screen.getByLabelText("Loading document preview")).toBeTruthy();
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(
      screen.getByTestId("markdown-content").textContent?.length,
    ).toBeLessThanOrEqual(2_400);
    expect(screen.getByTestId("markdown-content").textContent).not.toContain(
      "Paragraph text. ".repeat(240),
    );

    act(() => {
      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
    expect(screen.getByLabelText("Loading document preview")).toBeTruthy();
  });

  it("disables document actions while streaming", () => {
    renderBlock({ isStreaming: true });

    expect(screen.getByText("Generating…")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Download long text document Architecture report",
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Open long text document Architecture report in full screen",
      }).disabled,
    ).toBe(true);
  });

  it("opens and downloads an interrupted partial document", async () => {
    const onOpen = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:document"),
      revokeObjectURL: vi.fn(),
    });
    renderBlock({ isInterrupted: true, onOpen, content: "Partial body" });

    expect(screen.getByText("Incomplete")).toBeTruthy();
    await userEvent.click(
      screen.getAllByRole<HTMLButtonElement>("button", {
        name: "Open long text document Architecture report in full screen",
      })[0],
    );
    expect(onOpen).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Download long text document Architecture report",
      }),
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("opens from the title and body while leaving nested controls and selections alone", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderBlock({ onOpen, content: "Short body" });
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    const title = screen.getByRole("button", { name: "Architecture report" });
    await user.click(title);
    expect(onOpen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("markdown-preview"));
    expect(onOpen).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("link", { name: "Internal link" }));
    await user.click(screen.getByRole("button", { name: "Inner action" }));
    expect(onOpen).toHaveBeenCalledTimes(2);

    title.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(3);

    const selection = window.getSelection();
    const preview = screen.getByTestId("markdown-preview");
    selection?.selectAllChildren(preview);
    fireEvent.click(preview);
    expect(onOpen).toHaveBeenCalledTimes(3);
    selection?.removeAllRanges();
  });

  it("does not expose open entry points while streaming or forced expanded", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderBlock({ onOpen, isStreaming: true });
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Open long text document Architecture report in full screen",
      }).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Architecture report" }),
    ).toBeNull();
    await user.click(screen.getByTestId("markdown-preview"));
    expect(onOpen).not.toHaveBeenCalled();

    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Message: messageMessages }}
      >
        <div data-chat-scroll-container>
          <LongTextBlock
            content="Forced body"
            presentation={presentation}
            forceExpanded
            onOpen={onOpen}
          />
        </div>
      </NextIntlClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: /Architecture report/ }),
    ).toBeNull();
    await user.click(screen.getByText("Forced body"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders complete plain text when forced open for export", () => {
    const content = "line one\nline two\n" + "x".repeat(3_000);
    const { container } = renderBlock({
      content,
      forceExpanded: true,
      presentation: {
        ...presentation,
        format: "plain_text",
        document: {
          fileName: "Architecture report.txt",
          mimeType: "text/plain",
        },
      },
    });

    expect(container.querySelector("pre")?.textContent).toBe(content);
    expect(observe).not.toHaveBeenCalled();
  });
});
