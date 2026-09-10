// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramBlock } from "@/components/content/markdown/DiagramBlock";
import type { MarkdownDiagramBlock } from "@/lib/utils/markdownDiagrams";

const runtime = vi.hoisted(() => ({
  mermaidInitialize: vi.fn(),
  mermaidRender: vi.fn(),
  mindMapExport: vi.fn(),
  saveDiagramImage: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: runtime.mermaidInitialize,
    render: runtime.mermaidRender,
  },
}));

vi.mock("@/components/content/markdown/mindmapExtension", () => ({
  exportMindMapToSVG: runtime.mindMapExport,
}));

vi.mock("@/lib/utils/diagramImageExport", () => ({
  saveDiagramImage: runtime.saveDiagramImage,
}));

const mermaidSvg =
  '<svg viewBox="0 0 320 120"><g><text>Mermaid</text></g></svg>';
const mindMapSvg =
  '<svg viewBox="0 0 280 180"><g><text>Mind map</text></g></svg>';

const diagramFor = (
  type: MarkdownDiagramBlock["type"],
): MarkdownDiagramBlock => ({
  type,
  language: type === "mermaid" ? "mermaid" : "mindmap",
  content: type === "mermaid" ? "graph TD\nA --> B" : "Root\n  - Branch",
  incomplete: false,
});

beforeEach(() => {
  runtime.mermaidInitialize.mockReset();
  runtime.mermaidRender.mockReset().mockResolvedValue({ svg: mermaidSvg });
  runtime.mindMapExport.mockReset().mockReturnValue(mindMapSvg);
  runtime.saveDiagramImage.mockReset().mockResolvedValue(undefined);
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
});

describe("DiagramBlock image saving", () => {
  it.each(["mermaid", "mindmap"] as const)(
    "places the image save action before fullscreen for %s diagrams",
    async (type) => {
      const view = render(<DiagramBlock diagram={diagramFor(type)} />);

      await waitFor(() =>
        expect(
          view.container.querySelector(".markdown-diagram-body svg"),
        ).not.toBeNull(),
      );

      const headerButtons = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>(
          ".markdown-diagram-header button",
        ),
      ).map((button) => button.getAttribute("aria-label"));
      expect(headerButtons).toEqual([
        "copyDiagramSourceAria",
        "saveDiagramImage",
        "fullscreenDiagramAria",
      ]);
    },
  );

  it("passes the rendered full SVG to the PNG exporter", async () => {
    const view = render(<DiagramBlock diagram={diagramFor("mermaid")} />);
    await waitFor(() =>
      expect(
        view.container.querySelector(".markdown-diagram-body svg"),
      ).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "saveDiagramImage" }));

    await waitFor(() =>
      expect(runtime.saveDiagramImage).toHaveBeenCalledWith({
        svg: expect.stringContaining('data-diagram-export="mermaid"'),
        filename: "diagram-mermaid.png",
        theme: "light",
      }),
    );
  });

  it("shows a visible error when PNG saving fails", async () => {
    runtime.saveDiagramImage.mockRejectedValueOnce(new Error("canvas failed"));
    const view = render(<DiagramBlock diagram={diagramFor("mindmap")} />);
    await waitFor(() =>
      expect(
        view.container.querySelector(".markdown-diagram-body svg"),
      ).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "saveDiagramImage" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "saveImageFailed",
    );
  });
});
