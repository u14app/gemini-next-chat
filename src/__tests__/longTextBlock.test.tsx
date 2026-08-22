// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LongTextBlock from "@/components/content/LongTextBlock";
import messageMessages from "@/i18n/locales/en/Message.json";
import type { LongTextPresentation } from "@/types";

vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
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

    const preview = screen.getByTestId("markdown-preview");
    expect(preview.textContent?.length).toBeLessThanOrEqual(2_400);
    expect(preview.textContent).not.toContain("Paragraph text. ".repeat(240));

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
      screen.getByRole("button", {
        name: "Open long text document Architecture report in full screen",
      }),
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
