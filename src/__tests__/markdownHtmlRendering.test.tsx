import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/store/core/uiStore", () => ({
  useUIStore: () => ({
    openImagePreview: vi.fn(),
  }),
}));

vi.mock("@/store/core/settingsStore", () => ({
  getTaskModel: () => "test-model",
  useSettingsStore: () => ({
    system: { enableCodeCollapse: false },
  }),
}));

vi.mock("@/store/core/chatStore", () => ({
  useChatStore: () => ({
    selectedModel: "test-model",
  }),
}));

vi.mock("@/store/core/coreSettingsStore", () => ({
  useCoreSettingsStore: () => ({
    providers: [],
  }),
}));

vi.mock("@/services/api/chatService", () => ({
  executeCode: vi.fn(),
}));

vi.mock("@/utils/sandbox", () => ({
  runInSandbox: vi.fn(),
}));

vi.mock("@/utils/opfs", () => ({
  isOPFSUrl: () => false,
  resolveOPFSUrl: vi.fn(),
}));

vi.mock("@/lib/providers/providerTypes", () => ({
  isOpenAIProviderType: () => false,
}));

vi.mock("@/lib/security/clientUrl", () => ({
  getSafeExternalHref: (href?: string) =>
    href && /^(https?:|#)/i.test(href) ? href : undefined,
  getSafeFaviconProxyUrl: () => undefined,
  getSafeMarkdownImageSrc: (src?: string) =>
    src && /^(https?:|data:image\/|blob:)/i.test(src) ? src : undefined,
  getSafeWebHref: (href?: string) =>
    href && /^https?:/i.test(href) ? href : undefined,
}));

vi.mock("@/lib/utils/htmlPreview", () => ({
  createSandboxedHtmlPreviewSrcDoc: (html: string) => html,
}));

vi.mock("@/lib/utils/htmlStyle", async () =>
  vi.importActual("../lib/utils/htmlStyle"),
);

vi.mock("@/lib/utils/htmlVisualMarkdown", async () =>
  vi.importActual("../lib/utils/htmlVisualMarkdown"),
);

vi.mock("@/lib/utils/markdownFiles", () => ({
  parseMarkdownFileBlocks: (content: string) => [{ kind: "markdown", content }],
}));

vi.mock("@/lib/utils/markdownDiagrams", async () =>
  vi.importActual("../lib/utils/markdownDiagrams"),
);

vi.mock("@/lib/utils/diagramSvg", async () =>
  vi.importActual("../lib/utils/diagramSvg"),
);

vi.mock("@/lib/utils/markdownImages", () => ({
  collectMarkdownImageGallery: () => [],
  getMarkdownImageGalleryIndex: () => 0,
}));

vi.mock("@/lib/utils/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("@/lib/utils/citations", () => ({
  linkifyCitationReferences: (content: string) => content,
}));

vi.mock("@/lib/utils/objectUrlLifecycle", () => ({
  resolveObjectUrlWithLifecycle: () => ({ cancel: vi.fn() }),
}));

vi.mock("@/lib/utils/model", () => ({
  parseModelString: () => ({ modelName: "test-model" }),
}));

// This suite exercises fully loaded output; lazy transitions are tested separately.
vi.mock(
  "../components/content/markdown/extensionResources",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../components/content/markdown/extensionResources")
      >();
    return {
      ...actual,
      useExtension: (
        resource: { getSnapshot: () => unknown },
        enabled = true,
      ) => (enabled ? resource.getSnapshot() : { value: null, error: null }),
    };
  },
);
beforeAll(async () => {
  const modules =
    await import("../components/content/markdown/extensionResources");
  await Promise.all([
    modules.gfmResource.load(),
    modules.mathSyntaxResource.load(),
    modules.htmlResource.load(),
    modules.highlightResource.load(),
    modules.artifactResource.load(),
    modules.diagramResource.load(),
  ]);
});

describe("MarkdownRenderer bundle boundary", () => {
  it("renders the basic client synchronously and keeps heavy extensions behind imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/content/MarkdownRenderer.tsx"),
      "utf8",
    );
    const client = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MarkdownRendererClient.tsx",
      ),
      "utf8",
    );
    expect(source).not.toContain("next/dynamic");
    expect(client).not.toMatch(
      /import .* from ["'](?:remark-gfm|remark-math|rehype-raw|rehype-katex|rehype-highlight)["']/,
    );
    expect(client).not.toContain("IntersectionObserver");
    expect(client).toContain("reconcileMarkdownBlocks");
  });
});

describe("MarkdownRenderer HTML support", () => {
  it("renders safe inline HTML while preserving allowed layout styles", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '<section style="display:grid; grid-template-columns:1fr 1fr; gap:12px; color:#2563eb"><span>Hello</span><span>HTML</span></section>'
        }
      />,
    );

    expect(html).toContain("<section");
    expect(html).toContain("display:grid");
    expect(html).toContain("grid-template-columns:1fr 1fr");
    expect(html).toContain("gap:12px");
    expect(html).toContain("Hello");
    expect(html).toContain("HTML");
  });

  it("makes wide Markdown table scrollers keyboard-focusable", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer content={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
    );

    expect(html).toContain('class="markdown-table-wrap"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="tableScrollRegion"');
  });

  it("wraps inline HTML in a theme scope and corrects low-contrast colors", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '<section style="background:#edf8ff; color:#ffffff; border:1px solid #ffffff"><span>Readable</span></section>'
        }
      />,
    );

    expect(html).toContain("markdown-html-visual");
    expect(html).toContain("background:#edf8ff");
    expect(html).toContain("color:var(--html-visual-on-light)");
    expect(html).toContain("border:1px solid var(--html-visual-subtle-border)");
    expect(html).toContain("Readable");
    expect(html).not.toContain("color:#ffffff");
  });

  it("maps pale visual surface colors away from text color", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '<section style="background:#ffffff; color:#ecfeff; border:1px solid #ecfeff"><span>Readable</span></section>'
        }
      />,
    );

    expect(html).toContain("markdown-html-visual");
    expect(html).toContain("background:var(--html-visual-surface)");
    expect(html).toContain("color:var(--html-visual-info-foreground)");
    expect(html).toContain("border:1px solid var(--html-visual-info-border)");
    expect(html).toContain("Readable");
    expect(html).not.toContain("color:var(--html-visual-info-surface)");
  });

  it("removes decorative styling from HTML visual containers that wrap tables", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '<section style="display:block; overflow-x:auto; background:#fff1f2; border:1px solid #fecaca; box-shadow:0 8px 24px rgba(0,0,0,0.12); padding:32px; border-radius:16px; color:#0f172a"><table><thead><tr><th>地区</th><th>影响</th></tr></thead><tbody><tr><td>南美洲</td><td>暴雨、洪水</td></tr></tbody></table></section>'
        }
      />,
    );

    expect(html).toContain("markdown-html-visual");
    expect(html).toContain("markdown-table-wrap");
    expect(html).toContain("地区");
    expect(html).toContain("南美洲");
    expect(html).toContain("display:block");
    expect(html).toContain("overflow-x:auto");
    expect(html).toContain("color:#0f172a");
    expect(html).not.toContain("background:#fff1f2");
    expect(html).not.toContain("border:1px solid #fecaca");
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("padding:32px");
    expect(html).not.toContain("border-radius:16px");
  });

  it("preserves all code fences literally, including markdown and unlabeled HTML examples", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const visualHtml = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '```markdown\n<section style="display:grid; gap:8px"><span>Visual</span></section>\n```'
        }
      />,
    );

    expect(visualHtml).not.toContain("<section");
    expect(visualHtml).toContain("Visual");
    expect(visualHtml).toContain("Visual");

    const unlabeledVisualHtml = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '```\n<section style="display:flex; gap:8px"><span>Unlabeled</span></section>\n```'
        }
      />,
    );

    expect(unlabeledVisualHtml).not.toContain("<section");
    expect(unlabeledVisualHtml).toContain("display:flex");
    expect(unlabeledVisualHtml).toContain("Unlabeled");

    const codeHtml = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '```html\n<section style="display:grid; gap:8px"><span>Code</span></section>\n```'
        }
        forceExpandCodeBlocks
      />,
    );

    expect(codeHtml).not.toContain('<section style="display:grid');
    expect(codeHtml).toContain("<span>html</span>");
    expect(codeHtml).toContain("previewHtml");
    expect(codeHtml).toContain("hljs-name");
    expect(codeHtml).not.toContain("markdown-html-visual hljs");
    expect(codeHtml).toContain('class="group/codeblock');
    expect(codeHtml).not.toContain('<pre><div class="group/codeblock');

    const plainCodeHtml = renderToStaticMarkup(
      <MarkdownRenderer content={"```\nconst value = 1;\n```"} />,
    );

    expect(plainCodeHtml).toContain("<pre><code");
    expect(plainCodeHtml).toContain("const value = 1;");
    expect(plainCodeHtml).not.toContain("group/codeblock");

    const emptyCodeHtml = renderToStaticMarkup(
      <MarkdownRenderer content={"Before\n\n```\n   \n```\n\nAfter"} />,
    );

    expect(emptyCodeHtml).toContain("Before");
    expect(emptyCodeHtml).toContain("After");
    expect(emptyCodeHtml).not.toContain("<pre");
  });

  it("keeps collapsed code blocks scrollable and HTML previews script-enabled in an opaque sandbox", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/markdown/ArtifactBlock.tsx",
      ),
      "utf8",
    );

    expect(source).not.toContain("overflow-y-hidden");
    expect(source).toContain("overflow-auto");
    expect(source).toContain('sandbox={readOnly ? "" : "allow-scripts"}');
    expect(source).not.toContain('sandbox=""');
    expect(source).not.toContain("allow-same-origin");
    const toggleCollapseSource = source.slice(
      source.indexOf("const toggleCollapse = () => {"),
      source.indexOf(
        "React.useEffect(() => {",
        source.indexOf("const toggleCollapse = () => {"),
      ),
    );
    expect(toggleCollapseSource).not.toMatch(
      /setIsCollapsed\(false\);[\s\S]*?setMaxHeight\("none"\)/u,
    );
  });

  it("keeps fullscreen code controls and highlighting aligned with inline code blocks", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/markdown/ArtifactBlock.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "src/components/content/markdown/highlight.css"),
      { encoding: "utf8" },
    );

    expect(source.indexOf("/* Copy Button */")).toBeLessThan(
      source.indexOf("/* Fullscreen Toggle */"),
    );
    expect(css).toContain(":where(.markdown-body, .markdown-codeblock) .hljs");
    expect(css).toContain(
      ":where(.markdown-body, .markdown-codeblock) .hljs-keyword",
    );
    expect(css).toContain(
      ":where(.markdown-body, .markdown-codeblock) .hljs-meta",
    );
    expect(css).not.toContain(".markdown-html-visual.hljs");
  });

  it("normalizes escaped HTML attribute quotes before rendering", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '<section style=\\"display:grid; gap:8px\\"><span>Escaped</span></section>'
        }
      />,
    );

    expect(html).toContain("<section");
    expect(html).toContain("display:grid");
    expect(html).toContain("gap:8px");
    expect(html).toContain("Escaped");
  });

  it("removes unsafe inline HTML tags, attributes, links, and page-covering styles", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          '<section onclick="alert(1)" style="position:fixed; inset:0; z-index:9999; background:url(javascript:alert(1)); display:flex"><script>alert(1)</script><style>.bad{color:red}</style><iframe>bad frame</iframe><a href="javascript:alert(1)">bad</a><span style="color:#16a34a">safe</span></section>'
        }
      />,
    );

    expect(html).toContain("<section");
    expect(html).toContain("display:flex");
    expect(html).toContain("safe");
    expect(html).toContain("color:var(--html-visual-success-foreground)");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain(".bad");
    expect(html).not.toContain("bad frame");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("z-index");
    expect(html).not.toContain("url(");
  });

  it("routes mermaid and mindmap fences to diagram blocks", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          "Before",
          "```mermaid",
          "graph TD",
          "  A --> B",
          "```",
          "```mindmap",
          "Root",
          "  - Branch",
          "```",
          "After",
        ].join("\n")}
      />,
    );

    expect(html).toContain('data-markdown-diagram="mermaid"');
    expect(html).toContain('data-markdown-diagram="mindmap"');
    expect(html).toContain("diagramMermaid");
    expect(html).toContain("diagramMindmap");
    expect(html).toContain("copyDiagramSource");
    expect(html).toContain("fullscreenDiagram");
    expect(html).not.toContain("<span>mermaid</span>");
    expect(html).not.toContain("<span>mindmap</span>");
  });

  it("contains Mermaid render errors inside the renderer-owned host", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/markdown/ArtifactBlock.tsx",
      ),
      "utf8",
    );
    const diagramBlock = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/markdown/DiagramBlock.tsx",
      ),
      "utf8",
    );
    const rendererSource = `${source}\n${diagramBlock}`;

    expect(rendererSource).toContain("suppressErrorRendering: true");
    expect(rendererSource).toContain(
      "const mermaidRenderHostRef = useRef<HTMLDivElement | null>(null)",
    );
    expect(rendererSource).toContain(
      "const mermaidRenderHost = mermaidRenderHostRef.current",
    );
    expect(rendererSource).toContain(
      'role={tone === "error" ? "alert" : "status"}',
    );
    expect(rendererSource).toContain(
      'aria-live={tone === "error" ? "assertive" : "polite"}',
    );
    expect(rendererSource).toMatch(
      /mermaid\.render\(\s*`\$\{renderId\}-\$\{hashDiagramKey\(cacheKey\)\}`,\s*trimmedSource,\s*mermaidRenderHost/u,
    );
  });

  it("shows streaming state for incomplete diagram fences", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        isStreaming
        content={["```mindmap", "Roadmap", "  - Phase 1"].join("\n")}
      />,
    );

    expect(html).toContain('data-markdown-diagram="mindmap"');
    expect(html).toContain("Roadmap");
    expect(html).toContain("diagramStreaming");
    expect(html).toContain("diagramMindmap");
  });

  it("preserves footnote targets and inert task checkboxes when HTML is present", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={
          "<section>Article</section>\n\nA[^note]\n\n- [x] Done\n\n[^note]: Footnote"
        }
      />,
    );
    const target = html.match(/href="#([^"]*-fn-note)"/)?.[1];
    expect(target).toBeTruthy();
    expect(html).toContain(`id="${target}"`);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('checked=""');
  });

  it("renders tables and blockquotes without legacy heavy borders", async () => {
    const { default: MarkdownRenderer } =
      await import("../components/content/MarkdownRendererClient");

    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          "> A quiet note",
          "",
          "| Metric | Value |",
          "| --- | --- |",
          "| Alpha | 42 |",
        ].join("\n")}
      />,
    );

    expect(html).toContain("markdown-table-wrap");
    expect(html).not.toContain("border-l-4");
    expect(html).not.toContain("divide-y");
    expect(html).not.toContain("border dark:border-border");
    expect(html).not.toContain("bg-gray-50");
    expect(html).toContain("A quiet note");
    expect(html).toContain("Alpha");
  });
});
