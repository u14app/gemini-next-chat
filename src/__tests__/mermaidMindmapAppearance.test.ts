// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import type { MindmapDB } from "mermaid/dist/diagrams/mindmap/mindmapDb.js";
import type { MindmapNode } from "mermaid/dist/diagrams/mindmap/mindmapTypes.js";
import {
  roundMindmapNodes,
  buildMermaidMindmapCSS,
  curveMermaidMindmapEdges,
} from "@/components/content/markdown/mermaidMindmapAppearance";

afterEach(() => document.documentElement.removeAttribute("style"));

const source = `mindmap
  root((厄尔尼诺全球影响))
    美洲
      秘鲁/厄瓜多尔 暴雨洪涝
      巴西东北部 干旱
      北美南部 暖冬多雨
      北美北部 冷冬
    亚太
      印度尼西亚/澳大利亚 严重干旱+山火
      印度 夏季风减弱+干旱
      中国 南方暖冬+长江流域夏涝
      东南亚 干旱
    非洲
      东非 多雨
      南部非洲 干旱
      西非萨赫勒 干旱
    海洋生态
      秘鲁鳀鱼减产
      珊瑚白化
      海洋缺氧区扩大
    经济
      农业减产
      渔业损失
      大宗商品价格波动`;

const contents = (node: MindmapNode): unknown => ({
  label: node.descr,
  id: node.nodeId,
  children: node.children.map(contents),
});

describe("Mermaid mindmap appearance", () => {
  it("paints the edge layer before nodes without moving the nodes", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g><g class="nodes"><circle cx="20" cy="30" r="10"/></g><g class="edgePaths"/></g></svg>';
    const result = new DOMParser().parseFromString(
      curveMermaidMindmapEdges(svg),
      "image/svg+xml",
    );
    expect(
      result.querySelector("svg > g")?.firstElementChild?.getAttribute("class"),
    ).toBe("edgePaths");
    expect(result.querySelector("circle")?.getAttribute("cx")).toBe("20");
    expect(result.querySelector("circle")?.getAttribute("cy")).toBe("30");
  });

  it("uses slightly brighter muted dark fills with light text and no glow or outline", () => {
    const style = document.documentElement.style;
    style.setProperty("--html-visual-surface", "#0b1220");
    style.setProperty("--html-visual-info-accent", "#22d3ee");
    style.setProperty("--html-visual-info-surface", "rgb(8 145 178 / 0.18)");
    const css = buildMermaidMindmapCSS("dark");
    expect(css).toContain("color-mix(in srgb, #22d3ee 48%, #0b1220)");
    expect(css).toContain("fill: #a5f3fc; color: #a5f3fc");
    expect(css).toContain("filter: none");
    expect(css).toContain("stroke: none");
    expect(css).not.toContain("rgb(8 145 178 / 0.18)");
    expect(css).toContain("fill-opacity: 1");
  });
  it("preserves the supplied climate mindmap content and hierarchy", async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    const before = await mermaid.mermaidAPI.getDiagramFromText(source);
    const original = contents((before.db as MindmapDB).getMindmap()!);
    const after = await mermaid.mermaidAPI.getDiagramFromText(
      roundMindmapNodes(source),
    );
    const db = after.db as MindmapDB;
    expect(contents(db.getMindmap()!)).toEqual(original);
    expect(db.getData().nodes).toHaveLength(23);
    expect(
      db.getData().nodes.every((node) => node.shape === "mindmapCircle"),
    ).toBe(true);
    expect(db.getData().edges).toHaveLength(22);
  });

  it("preserves explicit shapes, decorators, comments and multiline rich labels", () => {
    const simple =
      "mindmap\n  root((Root))\n    node[Rectangle]\n      ::icon(fa fa-book)\n    %% comment\n    plain";
    expect(roundMindmapNodes(simple)).toBe(
      simple.replace("    plain", "    ((plain))"),
    );
    const rich = 'mindmap\n  root["`Multiple\nlines`"]\n    child';
    expect(roundMindmapNodes(rich)).toBe(rich);
  });

  it.each(["light", "dark"] as const)(
    "embeds all five article colors and removes heavy outlines (%s)",
    (theme) => {
      const css = buildMermaidMindmapCSS(theme);
      expect(css).toContain(".mindmap-node.section-root");
      expect(css).toContain(".mindmap-node.section-10");
      expect(css).toContain("stroke-width: 1.3px");
      expect(css).toContain("stroke: none");
      expect(css).not.toContain("var(--");
    },
  );
});
