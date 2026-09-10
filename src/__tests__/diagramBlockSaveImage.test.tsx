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
import { mermaidPaletteSamples } from "./fixtures/mermaidPaletteSamples";

const runtime = vi.hoisted(() => ({
  mermaidInitialize: vi.fn(),
  mermaidRender: vi.fn(),
  mermaidDetectType: vi.fn(),
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
    detectType: runtime.mermaidDetectType,
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
  runtime.mermaidDetectType.mockReset().mockReturnValue("flowchart-v2");
  runtime.mindMapExport.mockReset().mockReturnValue(mindMapSvg);
  runtime.saveDiagramImage.mockReset().mockResolvedValue(undefined);
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
});

describe("DiagramBlock image saving", () => {
  it.each(Object.entries(mermaidPaletteSamples))(
    "repairs %s colors without rewriting source or leaking to flowcharts",
    async (type, content) => {
      runtime.mermaidDetectType.mockReturnValue(type);
      render(<DiagramBlock diagram={{ ...diagramFor("mermaid"), content }} />);
      await waitFor(() =>
        expect(runtime.mermaidRender.mock.calls.at(-1)?.[1]).toBe(content),
      );
      const config = runtime.mermaidInitialize.mock.calls.at(-1)?.[0];
      expect(config.themeVariables).toHaveProperty("cScale0");
      expect(config.flowchart).toEqual({ htmlLabels: false });
      expect(config).not.toHaveProperty("layout");
      cleanup();
      runtime.mermaidDetectType.mockReturnValue("flowchart-v2");
      const source = `graph LR\n${type}[Keep this shape] --> other`;
      render(
        <DiagramBlock
          diagram={{ ...diagramFor("mermaid"), content: source }}
        />,
      );
      await waitFor(() =>
        expect(runtime.mermaidRender.mock.calls.at(-1)?.[1]).toBe(source),
      );
      expect(
        runtime.mermaidInitialize.mock.calls.at(-1)?.[0].themeVariables,
      ).not.toHaveProperty("cScale0");
      expect(
        runtime.mermaidInitialize.mock.calls.at(-1)?.[0],
      ).not.toHaveProperty("themeCSS");
    },
  );
  it("scopes the new appearance to Mermaid mindmap source", async () => {
    runtime.mermaidDetectType.mockReturnValue("mindmap");
    const diagram = {
      ...diagramFor("mermaid"),
      content: "mindmap\n  Root\n    Child",
    };
    const view = render(<DiagramBlock diagram={diagram} />);
    await waitFor(() =>
      expect(
        view.container.querySelector(".markdown-diagram-body svg"),
      ).not.toBeNull(),
    );
    expect(runtime.mermaidInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mindmap: { padding: 18, maxNodeWidth: 120 },
        themeCSS: expect.stringContaining(".mindmap-node.section-root"),
      }),
    );
    expect(runtime.mermaidRender.mock.calls.at(-1)?.[1]).toBe(
      "mindmap\n  ((Root))\n    ((Child))",
    );
    cleanup();
    runtime.mermaidDetectType.mockReturnValue("flowchart-v2");
    const flowchart = {
      ...diagramFor("mermaid"),
      content: "graph LR\nOriginal[Keep rectangle] --> Target",
    };
    render(<DiagramBlock diagram={flowchart} />);
    await waitFor(() =>
      expect(runtime.mermaidRender.mock.calls.at(-1)?.[1]).toBe(
        flowchart.content,
      ),
    );
    expect(runtime.mermaidInitialize.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "themeCSS",
    );
    expect(runtime.mermaidInitialize.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "mindmap",
    );
  });
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
