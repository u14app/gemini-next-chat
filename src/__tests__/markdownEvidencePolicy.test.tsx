// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import {
  artifactResource,
  citationResource,
  diagramResource,
  fileResource,
  htmlResource,
  imageResource,
  readOnlyCodeResource,
} from "@/components/content/markdown/extensionResources";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps evidence answers restricted before and after lazy GFM/highlighting loads", async () => {
  const blocked = [
    artifactResource,
    citationResource,
    diagramResource,
    fileResource,
    htmlResource,
    imageResource,
    readOnlyCodeResource,
  ].map((resource) =>
    vi
      .spyOn(resource, "load")
      .mockRejectedValue(
        new Error("This capability is outside evidence answers"),
      ),
  );
  const content = [
    "Intro **kept** and <span>inline text</span>.",
    '<section><img src="https://example.com/hidden.png">Hidden HTML body</section>',
    "![Blocked Markdown image](https://example.com/markdown.png)",
    '```html\n<button onclick="bad()">literal code</button>\n```',
    "```mermaid\ngraph TD\nA-->B\n```",
    "```mindmap\nRoot\n  - Child\n```",
    '<file name="answer.txt">\nHidden file body\n</file>',
    "| A | B |\n| - | - |\n| one | two |",
    "[Safe source](https://example.com/evidence)",
  ].join("\n\n");
  const view = render(
    <MarkdownRenderer
      content={content}
      contentPolicy="evidence-answer"
      readOnly
    />,
  );
  expect(screen.getByText("kept").tagName).toBe("STRONG");
  expect(view.container.textContent).toContain("inline text");
  expect(view.container.textContent).not.toContain("Hidden HTML body");
  expect(view.container.textContent).not.toContain("Hidden file body");
  expect(
    view.container.querySelector("img, section, iframe, script"),
  ).toBeNull();
  await screen.findByRole("table");
  await waitFor(() =>
    expect(view.container.querySelector(".hljs-name")).not.toBeNull(),
  );
  expect(view.container.textContent).toContain('onclick="bad()"');
  expect(view.container.textContent).toContain("graph TD");
  expect(view.container.textContent).toContain("Root");
  expect(
    view.container.querySelector(
      "button, [data-markdown-diagram], [data-readonly-code], img",
    ),
  ).toBeNull();
  const link = screen.getByRole("link", { name: "Safe source" });
  expect(link.getAttribute("href")).toBe("https://example.com/evidence");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.className).toContain("text-research-accent");
  expect(view.container.firstElementChild?.className).toContain(
    "text-sm leading-7",
  );
  for (const loader of blocked) expect(loader).not.toHaveBeenCalled();
});

it("cannot relax the evidence policy with image aliases, callbacks, or loaded HTML", async () => {
  await htmlResource.load();
  const onFileClick = vi.fn();
  const asset = `${location.origin}/api/shares/${"s".repeat(43)}/assets/${"a".repeat(64)}?revision=1`;
  const marker = `share-asset:${"a".repeat(64)}`;
  const view = render(
    <MarkdownRenderer
      content={`<section>hidden</section>\n\n![hidden](${marker})\n\n<file name="hidden.txt">\nsecret\n</file>\n\n[bad](javascript:alert)`}
      contentPolicy="evidence-answer"
      readOnly
      registeredImageUrls={[asset]}
      imageUrlAliases={{ [marker]: asset }}
      onFileClick={onFileClick}
    />,
  );
  expect(view.container.querySelector("img, section, button")).toBeNull();
  expect(view.container.textContent).not.toContain("hidden");
  expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  expect(onFileClick).not.toHaveBeenCalled();
});
