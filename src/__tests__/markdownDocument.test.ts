import { describe, expect, it } from "vitest";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  compileMarkdown,
  prepareMarkdown,
  reconcileMarkdownBlocks,
} from "../components/content/markdown/markdownDocument";
import { normalizeHtmlVisualMarkdown } from "../lib/utils/htmlVisualMarkdown";

const enabled = { gfm: true, math: true, html: false };
const compile = (source: string, ready = true) =>
  compileMarkdown({
    prepared: prepareMarkdown(source),
    enabled: ready ? enabled : { gfm: false, math: false, html: false },
    remarkPlugins: ready ? [remarkGfm, remarkMath] : [],
    documentId: "test",
  });
const value = (tree: unknown) => JSON.stringify(tree);

describe("whole-document Markdown compilation", () => {
  it("does not discover extension syntax inside literal fences or inline code", () => {
    const source =
      '# Basic\n\n`$x$ ~~no~~`\n\n````text\n```mermaid\ngraph TD\n```\n<file name="x">\n$x$\n</file>\n````';
    const prepared = prepareMarkdown(source);
    expect(prepared.candidates).toEqual({
      gfm: false,
      math: false,
      html: false,
    });
    expect(prepared.files).toEqual([]);
    expect(value(compile(source))).not.toContain('"kind":"file"');
    expect(value(compile(source))).not.toContain('"language":"mermaid"');
  });

  it("recognizes CommonMark links and reference definitions without importing GFM", () => {
    expect(
      prepareMarkdown(
        "<https://example.com> and [https://example.com][ref]\n\n[ref]: https://example.com",
      ).candidates.gfm,
    ).toBe(false);
  });

  it("keeps nested code fences in the correct list and quote containers", () => {
    const tree = compile(
      "- Item\n\n  > Before\n  >\n  > ```mermaid\n  > graph TD\n  > A-->B\n  > ```\n\nAfter",
    );
    const json = value(tree);
    expect(json).toContain('"tagName":"ul"');
    expect(json).toContain('"tagName":"blockquote"');
    expect(json).toContain('"kind":"code"');
    expect(json).toContain('"language":"mermaid"');
    expect(json).toContain('"incomplete":false');
  });

  it("resolves a table reference from the complete document and only replaces its block", () => {
    const source =
      "Before **stable**\n\n| Name | Link |\n| - | - |\n| A | [site][ref] |\n\nAfter\n\n[ref]: https://example.com";
    const pending = reconcileMarkdownBlocks(compile(source, false), new Map());
    const ready = reconcileMarkdownBlocks(
      compile(source),
      new Map(pending.map((block) => [block.id, block])),
    );
    expect(ready[0]).toBe(pending[0]);
    expect(ready[2]).toBe(pending[2]);
    expect(value(ready[1])).toContain('"tagName":"table"');
    expect(value(ready[1])).toContain('"href":"https://example.com"');
  });

  it("keeps a single footnote definition and backreferences across separated paragraphs", () => {
    const tree = compile(
      "A[^note]\n\nB[^note]\n\n[^note]: First paragraph\n\n    Second paragraph",
    );
    const json = value(tree);
    expect(json).toContain("Second paragraph");
    expect(json.match(/\"id\":\"md-test-fn-note\"/g)).toHaveLength(1);
    expect(json).toContain("md-test-fnref-note-2");
  });

  it("parses inline math and math spanning blank lines without splitting the document", () => {
    const tree = compile(
      "Before $x^2$ after\n\n$$\nx = 1\n\ny = 2\n$$\n\nLast",
    );
    const json = value(tree);
    expect(json).toContain('"inline":true');
    expect(json).toContain('"inline":false');
    expect(json).toContain("x = 1\\n\\ny = 2");
    expect(json).toContain('"value":"Last"');
  });

  it("shows the entire math and footnote continuation as raw text until the grammar is ready", () => {
    const math = value(
      compile("Before\n\n$$\nx=1\n\n- formula text\n\ny=2\n$$\n\nAfter", false),
    );
    expect(math).toContain(
      '"source":"$$\\nx=1\\n\\n- formula text\\n\\ny=2\\n$$"',
    );
    expect(math).not.toContain('"tagName":"ul"');
    const footnote = value(
      compile("A[^x]\n\n[^x]: note\n\n    continued", false),
    );
    expect(footnote).not.toContain('"kind":"code"');
    expect(footnote).toContain("continued");
  });

  it("keeps stream identities when an open block closes and ignores fake citations in code", () => {
    const source = "Before\n\n```js\nconsole.log('[1]')";
    const before = reconcileMarkdownBlocks(compile(source), new Map());
    const after = reconcileMarkdownBlocks(
      compile(source + "\n```\n\nAfter"),
      new Map(before.map((block) => [block.id, block])),
    );
    expect(after[0]).toBe(before[0]);
    expect(after[1].id).toBe(before[1].id);
    expect(value(before[1])).toContain('"incomplete":true');
    expect(value(after[1])).toContain('"incomplete":false');
    const citations = compileMarkdown({
      prepared: prepareMarkdown("[1]\n\n~~~js\n[1]\n~~~"),
      enabled,
      remarkPlugins: [remarkGfm],
      documentId: "citations",
      web: [{ title: "Source", url: "https://example.com", content: "Fact" }],
    });
    expect(value(citations)).toContain("#citation-0");
    expect(value(citations)).toContain('"value":"[1]"');
  });

  it("bounds real file blocks and keeps subsequent Markdown in the same document", () => {
    const source =
      '<file name="a.md">\n# private\n\n```mermaid\nA-->B\n```\n</file>\n\n[link][ref]\n\n[ref]: https://example.com';
    const prepared = prepareMarkdown(source);
    expect(prepared.files).toHaveLength(1);
    expect(prepared.candidates).toEqual({
      gfm: false,
      math: false,
      html: false,
    });
    const json = value(compile(source));
    expect(json).toContain('"kind":"file"');
    expect(json).toContain('"href":"https://example.com"');
    expect(json).not.toContain('"language":"mermaid"');
  });

  it("handles consecutive files without requiring blank lines and ignores file examples in raw pre", () => {
    const files = prepareMarkdown(
      '<file name="a.txt">\na\n</file>\n<file name="b.txt">\nb\n</file>',
    );
    expect(files.files).toHaveLength(2);
    expect(
      prepareMarkdown('<pre>\n<file name="example.txt">\ntext\n</file>\n</pre>')
        .files,
    ).toHaveLength(0);
  });

  it("normalizes actual HTML attributes without unwrapping or editing code examples", () => {
    const code =
      '```markdown\n<section style=\\"color:red\\">example</section>\n```';
    expect(normalizeHtmlVisualMarkdown(code)).toBe(code);
    expect(
      normalizeHtmlVisualMarkdown(
        '<section style=\\"color:red\\">text</section>',
      ),
    ).toBe('<section style="color:red">text</section>');
  });
});
