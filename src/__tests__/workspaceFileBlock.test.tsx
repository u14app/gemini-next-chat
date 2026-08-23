// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceFileBlock from "@/components/content/WorkspaceFileBlock";
import messageMessages from "@/i18n/locales/en/Message.json";
import type { WorkspaceFilePresentation } from "@/types";

const resolveOPFSBlob = vi.hoisted(() => vi.fn());

vi.mock("@/utils/opfs", () => ({ resolveOPFSBlob }));
vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

const textFile: WorkspaceFilePresentation = {
  path: "out/report.md",
  fileName: "report.md",
  mimeType: "text/markdown",
  bytes: 24,
  url: "opfs://chat/workspace/session-1/out/report.md",
  revision: "share-1",
  title: "Quarterly report",
};

const binaryFile: WorkspaceFilePresentation = {
  path: "out/chart.png",
  fileName: "chart.png",
  mimeType: "image/png",
  bytes: 2048,
  url: "opfs://chat/workspace/session-1/out/chart.png",
  revision: "share-image-1",
};

let observerCallback: IntersectionObserverCallback | undefined;
const observe = vi.fn();

const renderBlockElement = (
  props: Partial<React.ComponentProps<typeof WorkspaceFileBlock>> = {},
) => (
  <NextIntlClientProvider locale="en" messages={{ Message: messageMessages }}>
    <div data-chat-scroll-container>
      <WorkspaceFileBlock file={textFile} {...props} />
    </div>
  </NextIntlClientProvider>
);

const renderBlock = (
  props: Partial<React.ComponentProps<typeof WorkspaceFileBlock>> = {},
) => render(renderBlockElement(props));

const scrollIntoView = () =>
  act(() => {
    observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });

describe("WorkspaceFileBlock", () => {
  beforeEach(() => {
    observerCallback = undefined;
    observe.mockReset();
    resolveOPFSBlob.mockReset();
    resolveOPFSBlob.mockResolvedValue(new Blob(["# Report\n\nAll good."]));
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function MockIntersectionObserver(
        callback: IntersectionObserverCallback,
      ) {
        observerCallback = callback;
        return {
          observe,
          disconnect: vi.fn(),
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

  it("shows the title, path, and size without reading the file", () => {
    renderBlock();

    expect(screen.getByText("Quarterly report")).toBeTruthy();
    expect(screen.getByText("out/report.md")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Open workspace file Quarterly report in full screen",
      }),
    ).toBeNull();
    expect(resolveOPFSBlob).not.toHaveBeenCalled();
  });

  it("opens a text file when a full-screen handler is available", async () => {
    const onOpen = vi.fn();
    renderBlock({ onOpen });

    await userEvent.click(
      screen.getByRole("button", {
        name: "Open workspace file Quarterly report in full screen",
      }),
    );

    expect(onOpen).toHaveBeenCalledWith(textFile);
  });

  it("loads the preview only once the block nears the viewport", async () => {
    const { container } = renderBlock();
    expect(screen.queryByTestId("markdown-preview")).toBeNull();

    scrollIntoView();

    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview").textContent).toContain(
        "All good.",
      ),
    );
    expect(resolveOPFSBlob).toHaveBeenCalledWith(textFile.url);
    expect(container.querySelector(".bg-linear-to-b")).toBeNull();
  });

  it("invalidates the preview when the same path is shared again", async () => {
    const view = renderBlock();
    scrollIntoView();

    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview").textContent).toContain(
        "All good.",
      ),
    );

    const refreshedFile = { ...textFile, revision: "share-2" };
    resolveOPFSBlob.mockResolvedValue(new Blob(["# Report\n\nUpdated."]));
    view.rerender(renderBlockElement({ file: refreshedFile }));

    expect(screen.queryByText(/All good/)).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview").textContent).toContain(
        "Updated.",
      ),
    );
    expect(resolveOPFSBlob).toHaveBeenCalledTimes(2);
  });

  it("keeps the loaded preview across presentation clones of one share", async () => {
    const view = renderBlock();
    scrollIntoView();

    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview").textContent).toContain(
        "All good.",
      ),
    );

    view.rerender(renderBlockElement({ file: { ...textFile } }));

    expect(screen.getByTestId("markdown-preview").textContent).toContain(
      "All good.",
    );
    expect(resolveOPFSBlob).toHaveBeenCalledTimes(1);
  });

  it("reloads a truncated preview before rendering the full-screen body", async () => {
    const content = "x".repeat(3_000);
    resolveOPFSBlob.mockResolvedValue(new Blob([content]));
    const view = renderBlock();
    scrollIntoView();

    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview").textContent).toHaveLength(
        2_400,
      ),
    );
    expect(view.container.querySelector(".bg-linear-to-b")).toBeTruthy();

    view.rerender(renderBlockElement({ forceExpanded: true }));

    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview").textContent).toBe(content),
    );
    expect(view.container.querySelector(".bg-linear-to-b")).toBeNull();
    expect(resolveOPFSBlob).toHaveBeenCalledTimes(2);
  });

  it("reports a missing file instead of rendering an empty preview", async () => {
    resolveOPFSBlob.mockResolvedValue(null);
    renderBlock();
    scrollIntoView();

    await waitFor(() =>
      expect(
        screen.getByText("This file is no longer available in the workspace."),
      ).toBeTruthy(),
    );
  });

  it("offers download but no preview for a binary file", () => {
    renderBlock({ file: binaryFile });
    scrollIntoView();

    expect(screen.getByLabelText(/Download/i)).toBeTruthy();
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
    expect(resolveOPFSBlob).not.toHaveBeenCalled();
  });

  it("downloads the file through an object URL", async () => {
    const createObjectURL = vi.fn(() => "blob:workspace");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    renderBlock();
    await userEvent.click(screen.getByLabelText(/Download/i));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workspace");
  });

  it("reports a failed download without leaking a rejected promise", async () => {
    resolveOPFSBlob.mockRejectedValue(new Error("read failed"));
    renderBlock({ file: binaryFile });

    await userEvent.click(screen.getByLabelText(/Download/i));

    await waitFor(() =>
      expect(
        screen.getByText("This file is no longer available in the workspace."),
      ).toBeTruthy(),
    );
  });
});
