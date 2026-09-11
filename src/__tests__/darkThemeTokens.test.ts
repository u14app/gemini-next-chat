import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4),
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
}

describe("dark theme token contract", () => {
  it("defines every brand and surface utility referenced by components", () => {
    const globals = readProjectFile("src/app/globals.css");
    const themeBlock = globals.slice(
      globals.indexOf("@theme inline {"),
      globals.indexOf("}", globals.indexOf("@theme inline {")),
    );
    const defined = new Set(
      [...themeBlock.matchAll(/--color-([a-z0-9-]+):/g)].map(
        (match) => match[1],
      ),
    );

    const utility =
      /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|caret|decoration|shadow|accent)-(brand|surface)(?:-([a-z0-9-]+))?(?![\w-])/g;

    const missing = new Set<string>();
    for (const entry of readdirSync(resolve(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(
        resolve(entry.parentPath, entry.name),
        "utf8",
      );
      for (const [, family, suffix] of source.matchAll(utility)) {
        const name = suffix ? `${family}-${suffix}` : family;
        if (!defined.has(name)) missing.add(name);
      }
    }

    // A utility with no `--color-*` behind it silently renders nothing, which
    // is how `hover:bg-brand-hover` sat dead in the chat shell.
    expect([...missing]).toEqual([]);
  });

  it("exposes shadcn-style semantic color utilities and Neo brand tokens", () => {
    const globals = readProjectFile("src/app/globals.css");

    for (const token of [
      "--color-card: var(--card);",
      "--color-popover: var(--popover);",
      "--color-muted: var(--muted);",
      "--color-accent: var(--accent);",
      "--color-border: var(--border);",
      "--color-input: var(--input);",
      "--color-ring: var(--ring);",
      "--color-sidebar: var(--sidebar);",
      "--color-brand: var(--brand);",
    ]) {
      expect(globals).toContain(token);
    }

    expect(globals).toContain("--brand:");
    expect(globals).toContain("--brand-foreground:");
    expect(globals).toContain("--brand-soft:");
    expect(globals).toContain("--brand: #1d88e1;");
    expect(globals).not.toContain("#d23f31");
    expect(globals).not.toContain("--brand: oklch(0.637 0.237 25.331);");
    expect(globals).toContain("--html-visual-surface:");
    expect(globals).toContain("--html-visual-foreground:");
    expect(globals).toContain("--html-visual-on-light:");
    expect(globals).toContain("--html-visual-on-dark:");
    expect(globals).toContain("--html-visual-border:");
    expect(globals).toContain("--html-visual-subtle-border:");
    expect(globals).toContain("--html-visual-shadow:");
    for (const tone of ["info", "knowledge", "success", "warning", "danger"]) {
      expect(globals).toContain(`--html-visual-${tone}-surface:`);
      expect(globals).toContain(`--html-visual-${tone}-foreground:`);
      expect(globals).toContain(`--html-visual-${tone}-border:`);
      expect(globals).toContain(`--html-visual-${tone}-accent:`);
    }
    expect(
      readProjectFile("src/components/content/markdown/html.css"),
    ).toContain(".markdown-html-visual");
    expect(globals).toContain(".glass-shell");
    expect(globals).toContain(".glass-popover");
  });

  it("uses distinct composer border accents for Research and Agent modes", () => {
    const globals = readProjectFile("src/app/globals.css");

    expect(globals).toContain('.glass-shell[data-chat-mode="research"]');
    expect(globals).toContain('.glass-shell[data-chat-mode="agent"]');
    expect(globals).toContain(
      '.dark .glass-shell[data-chat-mode="research"]:focus-within',
    );
    expect(globals).toContain(
      '.dark .glass-shell[data-chat-mode="agent"]:focus-within',
    );
    for (const token of [
      "--research-accent: #3b82f6;",
      "--research-accent-text: #2563eb;",
      "--research-accent-solid: #2563eb;",
      "--research-accent-hover: #1d4ed8;",
      "--research-accent-foreground: #f8fafc;",
      "--research-accent-soft: #eff6ff;",
      "--research-accent-border: rgb(59 130 246 / 0.34);",
      "--research-accent: #60a5fa;",
      "--research-accent-text: #60a5fa;",
      "--research-accent-solid: #60a5fa;",
      "--research-accent-hover: #93c5fd;",
      "--research-accent-foreground: #0f172a;",
      "--research-accent-soft: rgb(96 165 250 / 0.12);",
      "--research-accent-border: rgb(96 165 250 / 0.34);",
      "--color-research-accent-text: var(--research-accent-text);",
      "--color-research-solid: var(--research-accent-solid);",
    ]) {
      expect(globals).toContain(token);
    }
    expect(contrastRatio("#2563eb", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#f8fafc", "#2563eb")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#f8fafc", "#1d4ed8")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#60a5fa", "#18181b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#0f172a", "#60a5fa")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#0f172a", "#93c5fd")).toBeGreaterThanOrEqual(4.5);
    expect(globals).toContain("rgb(192 132 252 / 0.68)");
  });

  it("keeps diagram render containers borderless in normal and enhanced modes", () => {
    const diagramStyles = readProjectFile(
      "src/components/content/markdown/diagram.css",
    );

    expect(diagramStyles).toMatch(
      /\.markdown-diagram-body\s*\{[^}]*border:\s*0;/u,
    );
    expect(diagramStyles).not.toMatch(
      /\.markdown-diagram-body\s*\{[^}]*border:\s*1px/u,
    );
    expect(diagramStyles).not.toMatch(
      /\.markdown-diagram-enhanced \.markdown-diagram-body\s*\{[^}]*box-shadow/u,
    );
  });

  it("defines passive inline SVG diagrams and fullscreen zoom surfaces", () => {
    const diagramStyles = readProjectFile(
      "src/components/content/markdown/diagram.css",
    );

    expect(diagramStyles).toContain(".markdown-diagram-viewport");
    expect(diagramStyles).toContain(".markdown-diagram-zoom-controls");
    expect(diagramStyles).toContain(".markdown-diagram-svg-static");
    expect(diagramStyles).toMatch(
      /\.markdown-diagram-svg-static\s*\{[^}]*pointer-events:\s*none;/u,
    );
    expect(diagramStyles).toContain(".markdown-diagram-svg-interactive");
    expect(diagramStyles).toMatch(
      /\.markdown-diagram-svg-interactive\s*\{[^}]*width:\s*max-content;/u,
    );
    expect(diagramStyles).toMatch(
      /\.markdown-diagram-transform-wrapper\s*\{[^}]*height:\s*100% !important;/u,
    );
    expect(diagramStyles).toMatch(
      /\.markdown-diagram-transform-content\s*\{[^}]*width:\s*max-content;/u,
    );
    expect(diagramStyles).toMatch(
      /\.markdown-diagram-fullscreen \.markdown-diagram-svg svg\s*\{[^}]*max-height:\s*none;/u,
    );
    expect(diagramStyles).not.toContain(".markdown-mindmap-exporter");
  });

  it("uses direct mindmap SVG export and the shared SVG diagram viewer", () => {
    const renderer = `${readProjectFile(
      "src/components/content/MarkdownRendererClient.tsx",
    )}\n${readProjectFile("src/components/content/markdown/DiagramBlock.tsx")}`;
    const diagramSvg = readProjectFile("src/lib/utils/diagramSvg.ts");

    expect(renderer).toContain("react-zoom-pan-pinch");
    expect(renderer).toContain("TransformWrapper");
    expect(renderer).toContain("TransformComponent");
    expect(renderer).toContain("DiagramSvgView");
    expect(renderer).toContain("normalizeMermaidSvg");
    expect(diagramSvg).toContain('preserveAspectRatio",');
    expect(renderer).toContain("centerView(1, 0)");
    expect(renderer).toContain("limitToBounds={false}");
    expect(renderer).toContain("exportMindMapToSVG");
    expect(renderer).toContain("data-diagram-display-mode");
    expect(renderer).toMatch(/kind="mermaid"\s+mode=\{mode\}/u);
    expect(renderer).toMatch(/kind="mindmap"\s+mode=\{mode\}/u);
    expect(renderer).toContain('mode="fullscreen"');
    expect(renderer).toContain('mode="inline"');
    expect(renderer).not.toContain("exportToSVG");
    expect(renderer).not.toContain("MindMapRef");
    expect(renderer).not.toContain("markdown-mindmap-exporter");
    expect(renderer).not.toContain("@xiangfa/mindmap/viewer");
    expect(renderer).not.toContain("MindMapViewer");
  });

  it("keeps HTML visual scope structural instead of framed", () => {
    const htmlStyles = readProjectFile(
      "src/components/content/markdown/html.css",
    );
    const tableStyles = readProjectFile(
      "src/components/content/markdown/table.css",
    );

    expect(htmlStyles).toMatch(
      /\.markdown-html-visual\s*\{[^}]*color:\s*inherit;[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/u,
    );
    expect(tableStyles).toMatch(
      /\.markdown-body :where\(\.markdown-table-wrap\)\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/u,
    );
    expect(htmlStyles).not.toContain(
      ".markdown-html-visual :where(table) {\n  border-color:",
    );
  });

  it("anchors Markdown, diagram, and HTML visual colors to the neon diagram palette", () => {
    const globals = readProjectFile("src/app/globals.css");
    const renderer = `${readProjectFile(
      "src/components/content/MarkdownRendererClient.tsx",
    )}\n${readProjectFile("src/components/content/markdown/DiagramBlock.tsx")}`;

    for (const token of [
      "--html-visual-surface: #f6fbff;",
      "--html-visual-foreground: #0b1324;",
      "--html-visual-border: #c7d8ea;",
      "--html-visual-subtle-border: #dce8f5;",
      "--html-visual-info-surface: #ecfeff;",
      "--html-visual-info-foreground: #155e75;",
      "--html-visual-info-border: #a5f3fc;",
      "--html-visual-knowledge-surface: #f5f3ff;",
      "--html-visual-knowledge-foreground: #6d28d9;",
      "--html-visual-success-surface: #ecfdf5;",
      "--html-visual-success-foreground: #047857;",
      "--html-visual-warning-surface: #fffbeb;",
      "--html-visual-warning-foreground: #92400e;",
      "--html-visual-danger-surface: #fff1f2;",
      "--html-visual-danger-foreground: #be123c;",
      "--diagram-accent: #06b6d4;",
      "--diagram-root-bg: #ecfeff;",
      "--diagram-root-text: #155e75;",
      "--diagram-line: #10b981;",
      "--markdown-link: #0891b2;",
      "--markdown-code-bg: #f5f3ff;",
      "--markdown-code-text: #6d28d9;",
      "--markdown-citation-link: #6b7280;",
      "--markdown-citation-link-hover: #374151;",
      "--markdown-citation-surface: #f3f4f6;",
      "--markdown-soft-surface: rgb(249 250 251 / 0.9);",
      "--markdown-table-head: #f9fafb;",
      "--markdown-table-head-text: #374151;",
      "--markdown-codeblock-surface: rgb(249 250 251 / 0.5);",
      "--markdown-codeblock-header: rgb(255 255 255 / 0.42);",
      "--markdown-surface-muted: #f9fafb;",
      "--markdown-surface-hover: #f3f4f6;",
      "--html-visual-surface: #0b1220;",
      "--html-visual-foreground: #f4f8ff;",
      "--html-visual-border: #1f3a4d;",
      "--html-visual-info-surface: rgb(8 145 178 / 0.18);",
      "--html-visual-info-foreground: #a5f3fc;",
      "--html-visual-knowledge-surface: rgb(124 58 237 / 0.18);",
      "--html-visual-knowledge-foreground: #ddd6fe;",
      "--html-visual-success-surface: rgb(16 185 129 / 0.18);",
      "--html-visual-warning-surface: rgb(245 158 11 / 0.18);",
      "--html-visual-danger-surface: rgb(244 63 94 / 0.18);",
      "--diagram-root-bg: rgb(8 145 178 / 0.24);",
      "--diagram-root-text: #cffafe;",
      "--markdown-link: #67e8f9;",
      "--markdown-code-bg: rgb(124 58 237 / 0.18);",
      "--markdown-code-text: #ddd6fe;",
      "--markdown-citation-link: #9ca3af;",
      "--markdown-citation-link-hover: #d1d5db;",
      "--markdown-citation-surface: rgb(31 41 55 / 0.72);",
      "--markdown-soft-surface: rgb(17 24 39 / 0.74);",
      "--markdown-table-head: rgb(17 24 39 / 0.92);",
      "--markdown-table-head-text: #cbd5e1;",
      "--markdown-codeblock-header: rgb(63 63 70 / 0.18);",
      "--markdown-surface-muted: #111827;",
      "--markdown-surface-hover: #1f2937;",
    ]) {
      expect(globals).toContain(token);
    }

    expect(renderer).toContain('primaryColor: dark ? "#0f2a37" : "#ecfeff"');
    expect(renderer).toContain(
      'primaryBorderColor: dark ? "#22d3ee" : "#67e8f9"',
    );
    expect(renderer).toContain('lineColor: dark ? "#34d399" : "#10b981"');
    expect(renderer).toContain('tertiaryColor: dark ? "#221a3a" : "#f5f3ff"');
    expect(
      readProjectFile("src/components/content/markdown/table.css"),
    ).toMatch(
      /\.markdown-body :where\(th\)\s*\{[^}]*color:\s*var\(--markdown-table-head-text\);[^}]*font-weight:\s*700;/u,
    );
  });

  it("keeps MarkdownRenderer color styling on semantic CSS classes", () => {
    const renderer = [
      "src/components/content/MarkdownRendererClient.tsx",
      "src/components/content/markdown/MarkdownNodes.tsx",
      "src/components/content/markdown/CitationLink.tsx",
      "src/components/content/markdown/FileCard.tsx",
      "src/components/content/markdown/ArtifactBlock.tsx",
      "src/components/content/markdown/ReadOnlyCodeBlock.tsx",
      "src/components/content/markdown/highlightExtension.ts",
    ]
      .map(readProjectFile)
      .join("\n");

    expect(renderer).not.toContain("highlight.js/styles/github-dark.min.css");
    expect(renderer).toContain('className="markdown-citation-card"');
    expect(renderer).toContain('className="markdown-file-card-icon"');
    expect(renderer).toContain("markdown-codeblock");
    expect(renderer).toContain("markdown-console");
    expect(renderer).not.toMatch(
      /\b(?:text|bg|border|from|to|fill|shadow)-(?:gray|slate|zinc|red|rose|blue|purple|green|amber|yellow|violet)-/u,
    );
  });

  it("loads dedicated extension styles with their renderer resources", () => {
    const globals = readProjectFile("src/app/globals.css");
    const resources = readProjectFile(
      "src/components/content/markdown/extensionResources.ts",
    );
    const baseRenderer = [
      "src/components/content/MarkdownRenderer.tsx",
      "src/components/content/MarkdownRendererClient.tsx",
      "src/components/content/markdown/MarkdownNodes.tsx",
      "src/components/content/markdown/markdownDocument.ts",
    ]
      .map(readProjectFile)
      .join("\n");

    for (const [module, stylesheet, selector] of [
      [
        "highlightExtension",
        "highlight",
        ":where(.markdown-body, .markdown-codeblock) .hljs {",
      ],
      ["mathExtension", "math", ".katex-display {"],
      ["DiagramBlock", "diagram", ".markdown-diagram {"],
      ["htmlExtension", "html", ".markdown-html-visual {"],
      ["gfmExtension", "table", ".markdown-body :where(table) {"],
    ]) {
      const extension = readProjectFile(
        `src/components/content/markdown/${module}.${
          module === "DiagramBlock" || module === "htmlExtension" ? "tsx" : "ts"
        }`,
      );
      expect(resources).toContain(`import("./${module}")`);
      expect(extension).toContain(`import "./${stylesheet}.css";`);
      expect(
        readProjectFile(`src/components/content/markdown/${stylesheet}.css`),
      ).toContain(selector);
      expect(globals).not.toContain(selector);
      expect(baseRenderer).not.toContain(`${stylesheet}.css`);
    }

    expect(
      readProjectFile("src/components/content/markdown/htmlExtension.tsx"),
    ).toContain('import "./table.css";');
    expect(globals).toContain(".markdown-codeblock {");
    expect(globals).toContain(".markdown-file-card {");
    expect(globals).toContain(
      ".message-export-content-root .markdown-diagram-header",
    );
    expect(globals).toContain(".message-pdf-print-root .markdown-table-wrap");
  });

  it("uses muted semantic tokens for inline search citations", () => {
    const globals = readProjectFile("src/app/globals.css");

    expect(globals).toContain("--markdown-citation-link");
    expect(globals).toContain("--markdown-citation-link-hover");
    expect(globals).toContain("--markdown-citation-surface");
    expect(globals).toContain("color: var(--markdown-citation-link);");
    expect(globals).toContain("background: var(--markdown-citation-surface);");
  });

  it("defines lightweight markdown body rhythm for common HTML elements", () => {
    const globals = readProjectFile("src/app/globals.css");
    const tableStyles = readProjectFile(
      "src/components/content/markdown/table.css",
    );
    const mathStyles = readProjectFile(
      "src/components/content/markdown/math.css",
    );

    expect(globals).toContain(".markdown-body :where(p)");
    expect(globals).toContain(".markdown-body :where(blockquote)");
    expect(tableStyles).toContain(".markdown-body :where(table)");
    expect(tableStyles).toContain(".markdown-body :where(th)");
    expect(tableStyles).toContain(".markdown-body :where(td)");
    expect(globals).toContain(".markdown-body :where(:not(pre) > code)");
    expect(mathStyles).toContain(".markdown-body :where(.katex-display)");
  });

  it("does not use the legacy GitHub dark color as the app dark base", () => {
    const files = [
      "src/app/globals.css",
      "src/app/layout.tsx",
      "src/app/manifest.ts",
      "src/app/loading.tsx",
      "src/app/error.tsx",
      "src/components/app/ChatApp.tsx",
      "src/components/app/AccessPasswordPage.tsx",
      "tailwind.config.ts",
    ];

    for (const file of files) {
      const contents = readProjectFile(file);
      expect(contents, file).not.toMatch(/#0d1117|#0a0a0a|gray:\s*\{/);
    }
  });

  it("uses system font stacks instead of next/font generated variables", () => {
    const layout = readProjectFile("src/app/layout.tsx");
    const globals = readProjectFile("src/app/globals.css");

    expect(layout).not.toMatch(/next\/font/);
    expect(layout).not.toMatch(/font-geist/);
    expect(globals).not.toMatch(/font-geist/);
    expect(globals).toContain(
      "--font-sans: ui-sans-serif, system-ui, sans-serif;",
    );
    expect(globals).toMatch(
      /--font-mono:\s*ui-monospace,\s*SFMono-Regular,\s*"SF Mono",\s*Consolas,\s*"Liberation Mono",\s*Menlo,\s*monospace;/,
    );
  });
});
