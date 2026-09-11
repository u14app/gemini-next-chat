// @vitest-environment jsdom

import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import MarkdownRenderer from "@/components/content/MarkdownRenderer";

const imports = vi.hoisted(() => ({ chart: vi.fn(), diagram: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/content/markdown/ChartBlock", () => {
  imports.chart();
  return {
    ChartBlock: ({ forcedTheme }: { forcedTheme?: string }) => (
      <div data-hydrated-chart={forcedTheme}>Client chart</div>
    ),
  };
});
vi.mock("@/components/content/markdown/DiagramBlock", () => {
  imports.diagram();
  return {
    DiagramBlock: ({ forcedTheme }: { forcedTheme?: string }) => (
      <div data-hydrated-diagram={forcedTheme}>Client diagram</div>
    ),
  };
});

it("hydrates source fallbacks into visualizations without replacing shared prose", async () => {
  const tree = (
    <MarkdownRenderer
      readOnly
      forcedTheme="dark"
      content={[
        "A shared **report**.",
        "```mermaid\nflowchart TD\nA --> B\n```",
        '```chart\n{"version":1,"renderer":"echarts"}\n```',
      ].join("\n\n")}
    />
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  document.body.append(container);
  const paragraph = container.querySelector("p");
  expect(container.textContent).toContain("flowchart TD");
  expect(container.textContent).toContain('"renderer":"echarts"');
  expect(imports.chart).not.toHaveBeenCalled();
  expect(imports.diagram).not.toHaveBeenCalled();

  const onRecoverableError = vi.fn();
  const root = hydrateRoot(container, tree, { onRecoverableError });
  try {
    await waitFor(() => {
      expect(
        container.querySelector('[data-hydrated-chart="dark"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-hydrated-diagram="dark"]'),
      ).not.toBeNull();
    });
    expect(container.querySelector("p")).toBe(paragraph);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(imports.chart).toHaveBeenCalledTimes(1);
    expect(imports.diagram).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
