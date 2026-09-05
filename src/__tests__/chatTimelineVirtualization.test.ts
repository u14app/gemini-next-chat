import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("chat timeline virtualization", () => {
  it("follows output only while the viewport remains at the end", () => {
    const source = readProjectFile(
      "src/components/chat/VirtualizedMessageTimeline.tsx",
    );

    expect(source).toContain("useVirtualizer<HTMLDivElement, HTMLDivElement>");
    expect(source).toContain("getItemKey:");
    expect(source).toContain("ref={virtualizer.measureElement}");
    expect(source).toContain("overscan: 8");
    expect(source).toContain('anchorTo: "end"');
    expect(source).toContain(
      'followOnAppend: autoScrollEnabled ? "auto" : false',
    );
    expect(source).toContain("FOLLOW_END_THRESHOLD_PX = 48");
    expect(source).toContain("DISABLED_FOLLOW_THRESHOLD_PX = -1");
    expect(source).toContain("scrollEndThreshold: autoScrollEnabled");
    expect(source).toContain("state.system.enableAutoScroll === true");
    expect(source).toContain("shouldAdjustScrollPositionOnItemSizeChange");
    expect(source).toContain("virtualizer.scrollToIndex(index");
    expect(source).not.toContain("scheduleFollowToEnd");
    expect(source).not.toContain("requestAnimationFrame");
    expect(source).not.toContain("scrollElement.scrollTo({");
    expect(source).not.toContain("virtualizer.scrollToEnd");
    expect(source).toContain("useFlushSync: false");
  });

  it("routes search, reply, branch, and pending-tool focus through the timeline", () => {
    const shell = readProjectFile("src/components/app/ChatAppShell.tsx");

    expect(shell).toContain("scrollToMessage(focusedMessageId)");
    expect(shell).toContain("onNavigateToMessage={focusMessage}");
    expect(shell).toContain("onPendingToolVisibilityChange");
    expect(shell).toContain("handleTimelineVersionChange");
    expect(shell).toContain("[focusedMessageId, messages.length, viewMode]");
  });

  it("loads detected Markdown extensions without waiting for the chat viewport", () => {
    const markdown = readProjectFile(
      "src/components/content/MarkdownRendererClient.tsx",
    );
    const diagrams = readProjectFile(
      "src/components/content/markdown/DiagramBlock.tsx",
    );

    const resources = readProjectFile(
      "src/components/content/markdown/extensionResources.ts",
    );
    const nodes = readProjectFile(
      "src/components/content/markdown/MarkdownNodes.tsx",
    );

    expect(markdown).toContain(
      "useExtension(gfmResource, prepared.candidates.gfm)",
    );
    expect(markdown).toContain(
      "useExtension(mathSyntaxResource, prepared.candidates.math)",
    );
    expect(markdown).toContain(
      "useExtension(htmlResource, prepared.candidates.html)",
    );
    expect(nodes).toContain(
      "useExtension(diagramResource, Boolean(diagramType))",
    );
    expect(resources).toContain("if (enabled) void resource.load()");
    expect(resources).toContain('() => import("./highlightExtension")');
    expect(markdown).not.toContain("IntersectionObserver");
    expect(markdown).not.toContain("shouldUseHeavyMarkdown");
    expect(diagrams).not.toContain("IntersectionObserver");
  });

  it("avoids smooth page scrolling while reasoning streams", () => {
    const shell = readProjectFile("src/components/app/ChatAppShell.tsx");
    const reasoning = readProjectFile(
      "src/components/content/ReasoningBlock.tsx",
    );

    expect(shell).not.toContain("motion-safe:scroll-smooth");
    expect(reasoning).toContain("isStreaming={isThinking}");
  });
});
