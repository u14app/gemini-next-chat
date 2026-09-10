// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../components/content/MarkdownRenderer";
import {
  createExtensionResource,
  artifactResource,
  chartResource,
  gfmResource,
  highlightResource,
  htmlResource,
  mathSyntaxResource,
  useExtension,
} from "../components/content/markdown/extensionResources";
import { isRegisteredShareImageUrl } from "../components/content/markdown/MarkdownNodes";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const controls = vi.hoisted(() => ({ renders: 0 }));
vi.mock("../components/content/markdown/ArtifactBlock", () => ({
  ArtifactBlock: ({
    children,
    readOnly,
  }: {
    children: React.ReactNode;
    readOnly?: boolean;
  }) => {
    controls.renders++;
    const [count, setCount] = React.useState(0);
    return (
      <div data-testid="code-controls">
        <button onClick={() => setCount(count + 1)}>copies {count}</button>
        {!readOnly ? <button>execute</button> : null}
        {children}
      </div>
    );
  },
}));
vi.mock("../components/content/markdown/MarkdownImage", () => ({
  MarkdownImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
}));
vi.mock("../components/content/markdown/ChartBlock", () => ({
  ChartBlock: ({
    source,
    incomplete,
  }: {
    source: string;
    incomplete: boolean;
  }) => (
    <div data-testid="chart-block" data-incomplete={String(incomplete)}>
      {source}
    </div>
  ),
}));
afterEach(cleanup);

describe("syntax-triggered rendering", () => {
  it("renders CommonMark synchronously without loading any extension", () => {
    render(<MarkdownRenderer content={"# Title\n\n**Bold** and `literal`"} />);
    expect(screen.getByRole("heading").textContent).toBe("Title");
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(gfmResource.getSnapshot().value).toBeNull();
    expect(chartResource.getSnapshot().value).toBeNull();
    expect(highlightResource.getSnapshot().value).toBeNull();
    expect(htmlResource.getSnapshot().value).toBeNull();
    expect(mathSyntaxResource.getSnapshot().value).toBeNull();
  });

  it("loads chart rendering only for chart fences and accepts the compatibility alias", async () => {
    const source = '{"version":1,"renderer":"echarts"}';
    const view = render(
      <MarkdownRenderer content={`\`\`\`chart\n${source}`} />,
    );

    expect(view.container.textContent).toContain(source);
    expect(screen.queryByTestId("chart-block")).toBeNull();

    view.rerender(
      <MarkdownRenderer content={`\`\`\`chart\n${source}\n\`\`\``} />,
    );
    const chart = await screen.findByTestId("chart-block");
    expect(chart.textContent).toBe(source);
    expect(chart.dataset.incomplete).toBe("false");
    expect(artifactResource.getSnapshot().value).toBeNull();

    view.rerender(
      <MarkdownRenderer
        content={`\`\`\`chart\n${source}\n\`\`\`\n\nFollowing text`}
      />,
    );
    expect(screen.getByTestId("chart-block")).toBe(chart);
    expect(screen.getByText("Following text")).toBeTruthy();

    view.rerender(
      <MarkdownRenderer
        readOnly
        content={`\`\`\`markdown-chart\n${source}\n\`\`\``}
      />,
    );
    expect(await screen.findByTestId("chart-block")).toBeTruthy();
    expect(artifactResource.getSnapshot().value).toBeNull();
  });

  it("uses a pure read-only viewer without loading connected chat stores or actions", async () => {
    expect(artifactResource.getSnapshot().value).toBeNull();
    const view = render(
      <MarkdownRenderer readOnly content={'```js\nalert("hello");\n```'} />,
    );
    await screen.findByRole("button", { name: "copyCodeAria" });
    expect(artifactResource.getSnapshot().value).toBeNull();
    expect(screen.queryByText("execute")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "fullscreenAria" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(
      <MarkdownRenderer
        readOnly
        content={"```html\n<script>window.example=1</script>\n```"}
      />,
    );
    await screen.findByRole("button", { name: "copyCodeAria" });
    expect(screen.queryByRole("button", { name: "previewHtml" })).toBeNull();
    expect(artifactResource.getSnapshot().value).toBeNull();
  });

  it("upgrades only affected blocks and preserves live code controls when GFM loads", async () => {
    const base = "Before **stable**\n\n```js\nconst x = 1;\n```";
    const view = render(<MarkdownRenderer content={base} />);
    expect(view.container.textContent).toContain("const x = 1;");
    await screen.findByTestId("code-controls");
    await waitFor(() =>
      expect(view.container.querySelector(".hljs-keyword")).not.toBeNull(),
    );
    fireEvent.click(screen.getByText("copies 0"));
    const controlsElement = screen.getByTestId("code-controls");
    const paragraph = screen.getByText("stable").parentElement;
    const renderCount = controls.renders;
    view.rerender(
      <MarkdownRenderer
        content={base + "\n\n| A | B |\n| - | - |\n| one | two |"}
      />,
    );
    expect(view.container.textContent).toContain("| A | B |");
    await screen.findByRole("table");
    expect(screen.getByTestId("code-controls")).toBe(controlsElement);
    expect(screen.getByText("copies 1")).toBeTruthy();
    expect(screen.getByText("stable").parentElement).toBe(paragraph);
    expect(controls.renders).toBe(renderCount);
  });

  it("keeps original text on load failure and retries only on request", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ text: "ready" });
    const resource = createExtensionResource<{ text: string }>(importer);
    function Probe() {
      const state = useExtension(resource);
      return (
        <div>
          {state.value?.text || "original source"}
          {state.error ? <button onClick={resource.retry}>retry</button> : null}
        </div>
      );
    }
    render(<Probe />);
    await screen.findByText("retry");
    expect(screen.getByText("original source")).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("retry"));
    await screen.findByText("ready");
    expect(importer).toHaveBeenCalledTimes(2);
    await act(() => Promise.all([resource.load(), resource.load()]));
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("never executes HTML before its complete sanitizing adapter is ready", async () => {
    const view = render(
      <MarkdownRenderer
        content={
          '<section style="display:flex"><script>window.pwned=1</script><span>Safe</span></section>'
        }
      />,
    );
    expect(view.container.querySelector("section")).toBeNull();
    expect(view.container.textContent).toContain("<script>");
    await waitFor(() =>
      expect(view.container.querySelector("section")).not.toBeNull(),
    );
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.textContent).not.toContain("window.pwned");
    expect(screen.getByText("Safe")).toBeTruthy();
  });

  it("renders inline math locally without changing surrounding prose", async () => {
    const view = render(
      <MarkdownRenderer content={"Before\n\nFormula $x^2$ here.\n\nAfter"} />,
    );
    const before = screen.getByText("Before");
    expect(view.container.textContent).toContain("$x^2$");
    await waitFor(() =>
      expect(view.container.querySelector(".katex")).not.toBeNull(),
    );
    expect(screen.getByText("Before")).toBe(before);
  });

  it("preserves inert share markers through HTML sanitization for both image syntaxes", async () => {
    const marker = `share-asset:${"b".repeat(64)}`;
    const asset = `${location.origin}/api/shares/${"s".repeat(43)}/assets/${"b".repeat(64)}?revision=2`;
    const content = `<section><img src="${marker}" alt="HTML image"></section>\n\n![Markdown image](${marker})\n\n<img src="share-asset:invalid" alt="Invalid image">`;
    render(
      <MarkdownRenderer
        readOnly
        content={content}
        registeredImageUrls={[asset]}
        imageUrlAliases={{ [marker]: asset, "share-asset:invalid": asset }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByAltText("HTML image").getAttribute("src")).toBe(asset);
      expect(screen.getByAltText("Markdown image").getAttribute("src")).toBe(
        asset,
      );
    });
    expect(screen.queryByAltText("Invalid image")).toBeNull();
  });

  it("resolves registered aliases only on image nodes, including same-origin localhost", async () => {
    const asset = `${location.origin}/api/shares/${"s".repeat(43)}/assets/${"a".repeat(64)}?revision=1`;
    const marker = `share-asset:${"a".repeat(64)}`;
    const view = render(
      <MarkdownRenderer
        content={`![Shared](${marker})\n\n\`\`\`text\n${marker}\n\`\`\``}
        readOnly
        registeredImageUrls={[asset]}
        imageUrlAliases={{ [marker]: asset }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByAltText("Shared").getAttribute("src")).toBe(asset),
    );
    expect(view.container.textContent).toContain(marker);
    expect(isRegisteredShareImageUrl(asset, [asset], location.origin)).toBe(
      true,
    );
    expect(isRegisteredShareImageUrl(asset, [], location.origin)).toBe(false);
    expect(
      isRegisteredShareImageUrl(
        asset.replace("?revision=1", "?revision=1&other=1"),
        [asset],
        location.origin,
      ),
    ).toBe(false);
    expect(
      isRegisteredShareImageUrl(
        "https://evil.example/api/shares/id/assets/a?revision=1",
        ["https://evil.example/api/shares/id/assets/a?revision=1"],
        location.origin,
      ),
    ).toBe(false);
  });
});
