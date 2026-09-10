import type { DiagramTheme } from "./types";

const affectedTypes = new Set([
  "gitGraph",
  "timeline",
  "kanban",
  "radar",
  "treemap",
]);

// Opaque article-family surfaces and readable strokes. Explicit derived colors
// survive Mermaid base theme's automatic darkening (which otherwise reaches black).
function paletteFor(theme: DiagramTheme) {
  return theme === "dark"
    ? [
        ["#165369", "#cffafe", "#22d3ee"],
        ["#174f40", "#bbf7d0", "#34d399"],
        ["#423665", "#ddd6fe", "#a78bfa"],
        ["#625021", "#fde68a", "#fbbf24"],
        ["#613440", "#fecdd3", "#fb7185"],
      ]
    : [
        ["#ecfeff", "#155e75", "#0891b2"],
        ["#ecfdf5", "#047857", "#047857"],
        ["#f5f3ff", "#6d28d9", "#7c3aed"],
        ["#fffbeb", "#92400e", "#b45309"],
        ["#fff1f2", "#be123c", "#e11d48"],
      ];
}

export function buildMermaidPaletteOverrides(
  type: string,
  theme: DiagramTheme,
): Record<string, unknown> | undefined {
  if (!affectedTypes.has(type)) return undefined;
  const palette = paletteFor(theme);
  const dark = theme === "dark";
  const canvas = dark ? "#0b1220" : "#f6fbff";
  const foreground = dark ? "#f4f8ff" : "#0b1324";
  const variables: Record<string, unknown> = {};
  for (let i = 0; i < 12; i++) {
    const [surface, text, line] = palette[i % palette.length];
    variables[`cScale${i}`] = type === "radar" ? line : surface;
    variables[`cScalePeer${i}`] = type === "treemap" ? line : surface;
    variables[`cScaleInv${i}`] = line;
    // Treemap assigns its label scale independently from its fill scale.
    variables[`cScaleLabel${i}`] = type === "treemap" ? foreground : text;
    variables[`lineColor${i}`] = line;
    if (i < 8) {
      variables[`git${i}`] = surface;
      variables[`gitInv${i}`] = line;
      variables[`gitBranchLabel${i}`] = text;
    }
  }
  if (type === "gitGraph") {
    Object.assign(variables, {
      commitLabelColor: foreground,
      commitLabelBackground: canvas,
      tagLabelColor: foreground,
      tagLabelBackground: canvas,
      tagLabelBorder: palette[0][2],
    });
  }
  if (type === "radar") {
    variables.radar = {
      axisColor: dark ? "#cbd5e1" : "#475569",
      graticuleColor: dark ? "#94a3b8" : "#64748b",
    };
  }
  return variables;
}

export function buildMermaidPaletteCSS(
  type: string,
  theme: DiagramTheme,
): string {
  if (!affectedTypes.has(type)) return "";
  const palette = paletteFor(theme);
  const foreground = theme === "dark" ? "#f4f8ff" : "#0b1324";
  if (type === "gitGraph") {
    return (
      Array.from({ length: 12 }, (_, i) => {
        const [, , line] = palette[(i % 8) % palette.length];
        return `.arrow${i}, .commit${i} { stroke: ${line}; }`;
      }).join("\n") + "\n.commit-label-bkg { opacity: 1; }"
    );
  }
  if (type === "radar") {
    return `.radarTitle, .radarAxisLabel, .radarLegendText { fill: ${foreground}; color: ${foreground}; }`;
  }
  if (type === "kanban") {
    // Kanban lightens each section by another 10%, washing light fills to white
    // and weakening dark-mode label contrast. Use the final surface directly.
    return Array.from({ length: 12 }, (_, i) => {
      const [surface] = palette[i % palette.length];
      return `.section-${i - 1} > rect { fill: ${surface}; stroke: ${surface}; }`;
    }).join("\n");
  }
  if (type === "treemap") {
    return `.treemapLeaf { stroke: ${theme === "dark" ? "#64748b" : "#94a3b8"}; }`;
  }
  return "";
}
