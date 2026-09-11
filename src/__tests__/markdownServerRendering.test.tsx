import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import {
  artifactResource,
  chartResource,
  citationResource,
  diagramResource,
  fileResource,
  gfmResource,
  highlightResource,
  htmlResource,
  imageResource,
  mathRenderResource,
  mathSyntaxResource,
  readOnlyCodeResource,
} from "@/components/content/markdown/extensionResources";

const imports = vi.hoisted(() => ({ chart: vi.fn(), diagram: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/content/markdown/ChartBlock", () => {
  imports.chart();
  throw new Error("Chart runtime must not load on the server");
});
vi.mock("@/components/content/markdown/DiagramBlock", () => {
  imports.diagram();
  throw new Error("Diagram runtime must not load on the server");
});

describe("server-rendered Markdown", () => {
  it("keeps shared prose and diagram sources readable without visual runtimes", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <MarkdownRenderer
        readOnly
        content={[
          "# Shared report",
          "The **results** remain readable.",
          "```mermaid\nflowchart TD\nAlpha --> Beta\n```",
          "```mindmap\nRoot\n  - Child\n```",
          '```chart\n{"version":1,"renderer":"echarts"}\n```',
        ].join("\n\n")}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Shared report");
    expect(html).toContain("<strong>results</strong>");
    expect(html).toContain("flowchart TD");
    expect(html).toContain("Alpha --&gt; Beta");
    expect(html).toContain("Root\n  - Child");
    expect(html).toContain("&quot;renderer&quot;:&quot;echarts&quot;");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<svg");
    expect(imports.chart).not.toHaveBeenCalled();
    expect(imports.diagram).not.toHaveBeenCalled();
  });

  it("rejects accidental server loads of browser extensions", async () => {
    for (const resource of [
      artifactResource,
      chartResource,
      citationResource,
      diagramResource,
      fileResource,
      gfmResource,
      highlightResource,
      htmlResource,
      imageResource,
      mathRenderResource,
      mathSyntaxResource,
      readOnlyCodeResource,
    ]) {
      await expect(resource.load()).rejects.toThrow(
        "Markdown extensions are loaded in the browser.",
      );
      expect(resource.getServerSnapshot()).toEqual({
        value: null,
        error: null,
      });
    }
    expect(imports.chart).not.toHaveBeenCalled();
    expect(imports.diagram).not.toHaveBeenCalled();
    expect(chartResource.getServerSnapshot()).toEqual({
      value: null,
      error: null,
    });
    expect(diagramResource.getServerSnapshot()).toEqual({
      value: null,
      error: null,
    });
  });
});
