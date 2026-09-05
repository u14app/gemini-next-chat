import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import zh from "../i18n/locales/zh";

describe("MessageItem composition", () => {
  it("keeps the active model loading indicator below the latest output", () => {
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );

    expect(messageItem).toContain("const isModelResponseLoading =");
    expect(messageItem).toContain("isLast &&");
    expect(messageItem).toContain('message.role === "model"');
    expect(messageItem).toContain("isTyping &&");
    expect(messageItem.lastIndexOf("<MessageOutputRenderer")).toBeLessThan(
      messageItem.lastIndexOf("<BubblesLoading"),
    );
    expect(messageItem).toContain('aria-label={t("generatingResponse")}');
    expect(messageItem).toContain(
      'className="mt-2 first:mt-0 h-8 w-14 text-red-300 dark:text-red-400"',
    );
  });

  it("opens shared workspace text files in the existing reading dialog", () => {
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );
    const messageOutputRenderer = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MessageOutputRenderer.tsx",
      ),
      "utf8",
    );
    const workspaceFileBlock = readFileSync(
      resolve(process.cwd(), "src/components/content/WorkspaceFileBlock.tsx"),
      "utf8",
    );

    expect(messageItem).toContain("const handleWorkspaceFileOpen");
    expect(messageItem).toContain('setReadingMode("workspace_file")');
    expect(messageItem).toContain(
      "onWorkspaceFileOpen={handleWorkspaceFileOpen}",
    );
    expect(messageItem).toContain("const activeWorkspaceFile =");
    expect(messageItem).toContain("file={activeWorkspaceFile}");
    expect(messageItem).toContain("forceExpanded");
    expect(messageOutputRenderer).toContain("onWorkspaceFileOpen?:");
    expect(messageOutputRenderer).toContain("onOpen={onWorkspaceFileOpen}");
    expect(workspaceFileBlock).toContain("!forceExpanded && isText && onOpen");
  });

  it("places the model reply action immediately after read aloud", () => {
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );
    const readAloud = messageItem.lastIndexOf(
      'tooltip={isPlaying ? t("stop") : t("readAloud")}',
    );
    const reply = messageItem.lastIndexOf('tooltip={t("reply")}');
    const nextModelAction = messageItem.indexOf(
      "icon={<Maximize2 size={13} />}",
      reply,
    );

    expect(readAloud).toBeGreaterThan(-1);
    expect(reply).toBeGreaterThan(readAloud);
    expect(nextModelAction).toBeGreaterThan(reply);
  });

  it("keeps attachment/media rendering in a dedicated component", () => {
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );
    const userMessageEditor = readFileSync(
      resolve(process.cwd(), "src/components/chat/UserMessageEditor.tsx"),
      "utf8",
    );
    const messageItemSurface = `${messageItem}\n${userMessageEditor}`;
    const attachmentView = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageAttachmentView.tsx"),
      "utf8",
    );

    expect(messageItemSurface).toContain("MessageAttachmentView");
    expect(messageItemSurface).toContain(
      "const skillInvocations = message.skillInvocations || []",
    );
    expect(messageItemSurface).toContain("portal");
    expect(messageItemSurface).toContain("AddToKnowledgeModal");
    expect(messageItemSurface).toContain("handleAddToKnowledge");
    expect(messageItemSurface).toContain("canEditUserMessage");
    expect(messageItemSurface).toContain("UserMessageEditor");
    expect(messageItemSurface).toContain("focus-within:ring-2");
    expect(messageItemSurface).toContain("focus-visible:ring-ring");
    expect(messageItemSurface).toContain("PencilSparkles");
    expect(messageItemSurface).toContain('t("polishUserMessageShort")');
    expect(messageItemSurface).not.toContain("text-amber-500");
    expect(messageItemSurface).not.toContain("hover:bg-amber-50");
    expect(messageItemSurface).not.toContain("dark:text-amber-300");
    expect(messageItemSurface).not.toContain("PencilSparklesIcon");
    expect(messageItemSurface).not.toContain("const AttachmentView");
    expect(messageItemSurface).not.toContain("activeSkillIds");
    expect(messageItemSurface).not.toContain("onBranch");
    expect(messageItemSurface).not.toContain("<Split");
    expect(attachmentView).toContain("AudioPlayer");
    expect(attachmentView).toContain("resolveObjectUrlWithLifecycle");
  });

  it("keeps the reasoning panel focused on expand and read controls", () => {
    const reasoningBlock = readFileSync(
      resolve(process.cwd(), "src/components/content/ReasoningBlock.tsx"),
      "utf8",
    );

    expect(reasoningBlock).toContain(
      "mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/50",
    );
    expect(reasoningBlock).toContain(
      "w-full flex items-center gap-2 px-3 py-2 text-xs font-medium",
    );
    expect(reasoningBlock).toContain("formatReasoningDuration");
    expect(reasoningBlock).toContain("durationMs?: number");
    expect(reasoningBlock).toContain("LoaderCircle");
    expect(reasoningBlock).toContain("useEffect");
    expect(reasoningBlock).toContain(
      "const [isExpanded, setIsExpanded] = useState(isThinking);",
    );
    expect(reasoningBlock).toContain("setIsExpanded(isThinking);");
    expect(reasoningBlock).toContain("}, [isThinking]);");
    expect(reasoningBlock).toContain(
      "onClick={() => setIsExpanded((expanded) => !expanded)}",
    );
    expect(reasoningBlock).not.toContain("useState(false)");
    expect(reasoningBlock).not.toContain("bg-violet-100");
    expect(reasoningBlock).not.toContain("dark:bg-violet-900/30");
    expect(reasoningBlock).toContain(
      "flex min-w-0 flex-1 items-center gap-2 text-left",
    );
    expect(reasoningBlock).toContain("bg-white/40 dark:bg-card/40");
    expect(reasoningBlock).not.toContain("mr-2 rounded p-1");
    expect(reasoningBlock).not.toContain("Languages");
    expect(reasoningBlock).not.toContain("Copy");
    expect(reasoningBlock).not.toContain("Undo2");
    expect(reasoningBlock).not.toContain("copyTextToClipboard");
    expect(reasoningBlock).not.toContain("createReasoningTranslationPrompt");
    expect(reasoningBlock).not.toContain("streamGenerateContent");
  });

  it("offers model message downloads as Markdown, PDF, or image", () => {
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );
    const globals = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const messageOutputRenderer = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MessageOutputRenderer.tsx",
      ),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(messageItem).toContain("handleDownloadMarkdown");
    expect(messageItem).toContain("handleDownloadPdf");
    expect(messageItem).toContain("beginDownload");
    expect(messageItem).toContain("finishDownload");
    expect(messageItem).toContain("downloadingFormat");
    expect(messageItem).toContain('t("downloadInProgress")');
    expect(messageItem).toContain("aria-busy={isDownloading}");
    expect(messageItem).toContain("disabled={isDownloading}");
    expect(messageItem).toContain("hideReasoning");
    expect(messageItem).toContain("hideToolCalls");
    expect(messageOutputRenderer).toContain("hideReasoning?: boolean");
    expect(messageOutputRenderer).toContain("hideToolCalls?: boolean");
    expect(messageOutputRenderer).toContain(
      "if (hideReasoning || !block.content) return;",
    );
    expect(messageOutputRenderer).toContain("if (hideToolCalls) return;");
    expect(messageItem).toContain("handleDownloadImage");
    expect(messageItem).toContain("imageExportError");
    expect(messageItem).toContain('t("downloadImageFailed")');
    expect(messageItem).toContain('role="alert"');
    expect(messageItem).toContain("message-pdf-print-root");
    expect(messageItem).toContain("message-image-export-root");
    expect(messageItem).toContain("message={pdfPrintJob.message}");
    expect(messageItem).toContain("message={imageExportJob.message}");
    expect(messageItem).toContain("window.print");
    expect(messageItem).toContain("afterprint");
    expect(messageItem).toContain("toPng");
    expect(messageItem).toContain("html-to-image");
    expect(messageItem).toContain("backgroundColor");
    expect(messageItem).toContain("getImageExportBackgroundColor");
    expect(messageItem).toContain("getMessageImageExportWidth");
    expect(messageItem).toContain("cacheBust: false");
    expect(messageItem).not.toContain("cacheBust: true");
    expect(messageItem).toContain("visibleMessageContentRef");
    expect(messageItem).toContain("width: imageExportJob.width");
    expect(messageItem).toContain("canvasWidth: imageExportJob.width");
    expect(messageItem).toContain("message-image-export-canvas");
    expect(messageItem).toContain(".markdown-diagram-header");
    expect(messageItem).toContain("forceExpandCodeBlocks");
    expect(messageItem).toContain("MessageOutputRenderer");
    expect(messageItem).toContain("proxyMessageExportImages");
    expect(messageItem).toContain("MESSAGE_IMAGE_PROXY_PATH");
    expect(messageItem).toContain("signedApiFetch");
    expect(messageItem).toContain("URL.createObjectURL");
    expect(messageItem).toContain("URL.revokeObjectURL");
    expect(messageItem).not.toContain("serveproxy.com");
    expect(messageItem).toContain("waitForMessageExportImages");
    const runExportStart = messageItem.indexOf(
      "const runExport = async () => {",
    );
    const runExportEnd = messageItem.indexOf(
      "firstFrame = requestAnimationFrame",
      runExportStart,
    );
    const runExport = messageItem.slice(runExportStart, runExportEnd);
    expect(runExport.indexOf("await proxyMessageExportImages")).toBeLessThan(
      runExport.indexOf("await exportRootToPng"),
    );
    expect(messageItem).toContain("DropdownMenuSub");
    expect(messageItem).toContain("DropdownMenuSubTrigger");
    expect(messageItem).toContain("DropdownMenuSubContent");
    expect(messageItem).toContain("Signature");
    expect(messageItem).toContain("FileImage");
    expect(messageItem).toContain('forcedTheme="light"');
    expect(messageItem).toContain('t("downloadMarkdown")');
    expect(messageItem).toContain('t("downloadPdf")');
    expect(messageItem).toContain('t("downloadImage")');
    expect(messageItem).toContain('t("downloadFormat")');
    expect(messageItem).toContain("handleDownloadPdf");
    expect(messageItem).toContain("md:hidden");

    const markdownRenderer = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MarkdownRendererClient.tsx",
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
    const markdownSurface = [
      markdownRenderer,
      diagramBlock,
      ...[
        "src/components/content/markdown/types.ts",
        "src/components/content/markdown/MarkdownNodes.tsx",
        "src/components/content/markdown/ArtifactBlock.tsx",
        "src/components/content/markdown/ReadOnlyCodeBlock.tsx",
      ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")),
    ].join("\n");
    expect(markdownSurface).toContain("forcedTheme?: DiagramTheme");
    expect(markdownSurface).toContain("forcedTheme || resolvedTheme");
    expect(markdownSurface).toContain("forceExpandCodeBlocks?: boolean");
    expect(markdownSurface).toContain(
      "!forceExpandCodeBlocks && (system.enableCodeCollapse ?? true)",
    );
    expect(messageOutputRenderer).toContain(
      "forceExpandCodeBlocks={forceExpandCodeBlocks}",
    );
    expect(markdownSurface).toContain(
      "forceExpandCodeBlocks={options.forceExpandCodeBlocks}",
    );

    expect(globals).toContain("@page");
    expect(globals).toContain("size: A4");
    expect(globals).toContain(".message-pdf-print-root");
    expect(globals).toContain(".markdown-codeblock-header");
    expect(globals).toContain(
      ".message-export-content-root .markdown-diagram-header",
    );
    expect(globals).toContain(
      ".message-pdf-print-root .markdown-diagram-header",
    );
    expect(globals).toContain("max-height: none !important");
    expect(globals).toContain(".markdown-codeblock-fade");
    expect(globals).toContain(".markdown-console");
    expect(globals).toContain(".message-image-export-root");
    expect(globals).toContain(".message-image-export-canvas");
    expect(globals).toContain("padding: 24px");
    expect(globals).toContain(".message-export-content-root");
    expect(globals).toContain(".message-export-content-root .markdown-body");
    expect(globals).toContain("box-sizing: border-box");
    expect(globals).not.toContain("width: min(820px");
    expect(packageJson.dependencies?.["html-to-image"]).toBeDefined();
    expect(en.Message.downloadMarkdown).toBe("Markdown");
    expect(en.Message.downloadPdf).toBe("PDF");
    expect(en.Message.downloadImage).toBe("Image");
    expect(en.Message.downloadInProgress).toBe("Downloading…");
    expect(en.Message.downloadFormat).toBe("Download format");
    expect(zh.Message.downloadMarkdown).toBe("Markdown");
    expect(zh.Message.downloadPdf).toBe("PDF");
    expect(zh.Message.downloadImage).toBe("图片");
    expect(zh.Message.downloadInProgress).toBe("下载中…");
    expect(zh.Message.downloadFormat).toBe("下载格式");
  });

  it("caches stable message output without changing code collapse behavior", () => {
    const markdownRenderer = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MarkdownRendererClient.tsx",
      ),
      "utf8",
    );
    const markdownBoundary = readFileSync(
      resolve(process.cwd(), "src/components/content/MarkdownRenderer.tsx"),
      "utf8",
    );
    const messageOutputRenderer = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/MessageOutputRenderer.tsx",
      ),
      "utf8",
    );

    const markdownNodes = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/markdown/MarkdownNodes.tsx",
      ),
      "utf8",
    );
    const artifactBlock = readFileSync(
      resolve(
        process.cwd(),
        "src/components/content/markdown/ArtifactBlock.tsx",
      ),
      "utf8",
    );

    expect(markdownRenderer).toContain("reconcileMarkdownBlocks");
    expect(markdownRenderer).toContain("snapshot.blocks.map");
    expect(markdownRenderer).toContain("key={snapshot.id}");
    expect(markdownNodes).toContain(
      "const MarkdownBlock = memo(function MarkdownBlock",
    );
    expect(markdownNodes).toContain(
      "<CodeNode value={value} options={options} />",
    );
    expect(markdownNodes).toContain("isStreaming={value.incomplete}");
    expect(artifactBlock).toContain(
      "if (isStreaming) return; // Do not calculate during streaming",
    );
    expect(artifactBlock).toContain("const vh50 = window.innerHeight * 0.5");
    expect(artifactBlock).toContain("onClick={toggleCollapse}");
    expect(artifactBlock).toContain("aria-expanded={!isCollapsed}");
    expect(artifactBlock).toContain("isMountedRef.current = true");
    expect(markdownBoundary).toContain(
      "export default memo(MarkdownRendererClient)",
    );
    expect(messageOutputRenderer).toContain(
      "export default React.memo(MessageOutputRenderer)",
    );
  });
});
