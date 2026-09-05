import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps research views behind the research output block rather than ordinary Markdown", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/content/MessageOutputRenderer.tsx"),
    "utf8",
  );
  expect(source).not.toMatch(
    /import\s*\{[^}]*ConnectedResearchTaskCard[^}]*\}\s*from\s*["']@\/components\/research\/ConnectedResearchViews["']/,
  );
  expect(source).toContain(
    'import("@/components/research/ConnectedResearchViews")',
  );
  expect(source).toContain("module.ConnectedResearchTaskCard");
  expect(source).toContain("ssr: false");
  expect(source).toContain("loading: ResearchTaskCardLoading");
  expect(source).toContain('t("workbench.loading")');
  expect(source).toContain('role="status"');
  expect(source).toContain('case "research_task":');
  expect(source).toMatch(
    /import MarkdownRenderer,[\s\S]*?from "\.\/MarkdownRenderer"/,
  );
  expect(source).not.toContain('dynamic(() => import("./MarkdownRenderer")');
});
