import type { DiagramTheme } from "./types";

/** Only plain mindmap labels are restyled; explicit shapes and rich labels stay literal. */
export function roundMindmapNodes(source: string): string {
  // Quoted/Markdown labels can span lines, so leave their source untouched.
  if (/["`]/u.test(source)) return source;
  let inMindmap = false;
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*mindmap\s*$/iu.test(line)) {
        inMindmap = true;
        return line;
      }
      if (!inMindmap) return line;
      const label = line.trim();
      if (!label || label.startsWith("%%") || /[()[\]{}:]|::/u.test(label))
        return line;
      const indent = line.match(/^\s*/u)?.[0] ?? "";
      return `${indent}((${label}))`;
    })
    .join("\n");
}

/** Embed resolved article tokens in the SVG rather than relying on page styles. */
export function buildMermaidMindmapCSS(theme: DiagramTheme): string {
  const dark = theme === "dark";
  const styles = getComputedStyle(document.documentElement);
  // Article tone surfaces are translucent in dark mode. Use the opaque article
  // canvas instead, so edges behind a node cannot show through its fill.
  const surface =
    styles.getPropertyValue("--html-visual-surface").trim() ||
    (dark ? "#0b1220" : "#f6fbff");
  const tones = ["info", "success", "knowledge", "warning", "danger"];
  const fallback = dark
    ? ["#a5f3fc", "#bbf7d0", "#ddd6fe", "#fde68a", "#fecdd3"]
    : ["#155e75", "#047857", "#6d28d9", "#92400e", "#be123c"];
  const palette = tones.map((tone, index) => {
    const color = (part: string, defaultColor: string) =>
      styles.getPropertyValue(`--html-visual-${tone}-${part}`).trim() ||
      defaultColor;
    const foreground = color("foreground", fallback[index]);
    const accent = color("accent", fallback[index]);
    return {
      fill: `color-mix(in srgb, ${accent} ${dark ? 48 : 28}%, ${surface})`,
      foreground,
    };
  });
  // Mermaid uses 11 branch sections plus a separate root section.
  const sections = Array.from({ length: 12 }, (_, index) => {
    const selector =
      index === 11
        ? ".mindmap-node.section-root"
        : `.mindmap-node.section-${index}`;
    const { fill, foreground } =
      palette[index === 11 ? 0 : index % palette.length];
    return `${selector} :is(circle, rect, polygon, path) { fill: ${fill}; fill-opacity: 1; stroke: none; }
      ${selector} text, ${selector} .nodeLabel { fill: ${foreground}; color: ${foreground}; }
      ${selector} span { color: ${foreground}; }`;
  });
  return `${sections.join("\n")}
    .mindmap-node { filter: none; opacity: 1; }
    .mindmap-node line { stroke: none; }
    .mindmap-node .label { font-size: 14px; }
    .mindmap-node .label text, .mindmap-node .text-outer-tspan { text-anchor: middle; }
    .edgePaths path.edge { stroke: ${dark ? "#94a3b8" : "#9ca3af"}; stroke-width: 1.3px; fill: none; stroke-linecap: round; }
  `;
}

/** Keep the renderer's attachment points while giving radial links a gentle arc. */
export function curveMermaidMindmapEdges(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  // SVG paint order, rather than CSS z-index, keeps connections below nodes.
  for (const edges of doc.querySelectorAll(".edgePaths")) {
    edges.parentNode?.insertBefore(edges, edges.parentNode.firstChild);
  }
  for (const path of doc.querySelectorAll<SVGPathElement>(
    ".edgePaths path.edge",
  )) {
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length < 1) continue;
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(length);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) continue;
    const bend = Math.min(16, distance * 0.12);
    const x = (start.x + end.x) / 2 - (dy / distance) * bend;
    const y = (start.y + end.y) / 2 + (dx / distance) * bend;
    path.setAttribute(
      "d",
      `M ${start.x} ${start.y} Q ${x} ${y} ${end.x} ${end.y}`,
    );
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
