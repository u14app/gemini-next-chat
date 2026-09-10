// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { buildMermaidPaletteOverrides } from "@/components/content/markdown/mermaidPalette";
import { mermaidPaletteSamples } from "./fixtures/mermaidPaletteSamples";

function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Mermaid derived palette", () => {
  it.each(Object.entries(mermaidPaletteSamples))(
    "recognizes the actual %s source type",
    async (type, source) => {
      mermaid.initialize({ startOnLoad: false, theme: "base" });
      expect(mermaid.detectType(source)).toBe(type);
      expect(await mermaid.parse(source)).toEqual(
        expect.objectContaining({ diagramType: type }),
      );
    },
  );
  it.each(["light", "dark"] as const)(
    "keeps text readable and radar series distinguishable in %s mode",
    (theme) => {
      for (const type of [
        "gitGraph",
        "timeline",
        "kanban",
        "radar",
        "treemap",
      ]) {
        mermaid.initialize({
          theme: "base",
          themeVariables: buildMermaidPaletteOverrides(type, theme),
        });
        const v = mermaid.mermaidAPI.getConfig().themeVariables;
        for (let i = 0; i < 12; i++) {
          if (type === "radar") {
            expect(
              contrast(
                v[`cScale${i}`],
                theme === "dark" ? "#0b1220" : "#f6fbff",
              ),
            ).toBeGreaterThanOrEqual(3);
          } else {
            expect(
              contrast(v[`cScale${i}`], v[`cScaleLabel${i}`]),
            ).toBeGreaterThanOrEqual(4.5);
            if (type !== "treemap") {
              expect(
                contrast(v[`cScalePeer${i}`], v[`cScaleLabel${i}`]),
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
        expect(
          new Set(Array.from({ length: 5 }, (_, i) => v[`cScale${i}`])).size,
        ).toBe(5);
        expect(contrast(v.git0, v.gitBranchLabel0)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it.each(["gitGraph", "timeline", "kanban", "radar", "treemap"])(
    "%s keeps dark palette colors from collapsing to black",
    (type) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          primaryColor: "#0f2a37",
          secondaryColor: "#102b24",
          tertiaryColor: "#221a3a",
          primaryTextColor: "#cffafe",
          ...buildMermaidPaletteOverrides(type, "dark"),
        },
      });
      const colors = mermaid.mermaidAPI.getConfig().themeVariables;
      const prefix = type === "gitGraph" ? "git" : "cScale";
      for (let i = 0; i < 5; i++) {
        expect(colors[`${prefix}${i}`]).not.toMatch(/, 0%\)|#000000|^black$/u);
      }
    },
  );

  it.each([
    "flowchart-v2",
    "sequence",
    "stateDiagram",
    "classDiagram",
    "er",
    "mindmap",
  ])("leaves %s theme variables untouched", (type) =>
    expect(buildMermaidPaletteOverrides(type, "dark")).toBeUndefined(),
  );
});
