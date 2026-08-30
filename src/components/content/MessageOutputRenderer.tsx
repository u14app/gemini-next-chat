"use client";

import React, { useMemo } from "react";
import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  Attachment,
  Message,
  MessageOutputBlock,
  Source,
  ToolConfirmationDecision,
  WorkspaceFilePresentation,
} from "@/types";
import { getMessageOutputBlocks } from "@/lib/chat/messageOutputBlocks";
import {
  getMessageOutputBlockSpacingClass,
  normalizeMessageOutputPresentation,
} from "@/lib/chat/messageOutputPresentation";
import type { MarkdownGeneratedFile } from "@/lib/utils/markdownFiles";
import { useUIStore } from "@/store/core/uiStore";
import { useAttachmentDisplayUrl } from "@/lib/utils/useAttachmentDisplayUrl";
import MarkdownRenderer, {
  type MarkdownRendererProps,
} from "./MarkdownRenderer";
import ReasoningBlock from "./ReasoningBlock";
import SourceBlock from "./SourceBlock";
import ToolCallBlock from "./ToolCallBlock";
import MemorySearchBlock from "./MemorySearchBlock";
import TaskPlanBlock from "./TaskPlanBlock";
import LongTextBlock from "./LongTextBlock";
import WorkspaceFileBlock from "./WorkspaceFileBlock";
import ArchiveFileBlock from "./ArchiveFileBlock";
import AgentRunBar from "./AgentRunBar";
import SafeImage from "../ui/SafeImage";
import { Button } from "@/components/ui/primitives";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { ConnectedResearchTaskCard } from "@/components/research/ConnectedResearchViews";

interface MessageOutputRendererProps {
  message: Message;
  displayedContent: string;
  isTyping?: boolean;
  isThinking?: boolean;
  isErrorMessage?: boolean;
  searchSources: Source[];
  ragSources?: Source[];
  onFileClick?: (file: MarkdownGeneratedFile) => void;
  forcedTheme?: MarkdownRendererProps["forcedTheme"];
  forceExpandCodeBlocks?: boolean;
  forceExpandLongTextBlocks?: boolean;
  hideReasoning?: boolean;
  hideToolCalls?: boolean;
  onImageCached?: (image: Attachment) => void;
  onToolConfirmationDecision?: (
    toolCallId: string,
    decision: ToolConfirmationDecision,
  ) => void;
  onRevokeToolSessionApproval?: (
    toolCall: NonNullable<Message["toolCalls"]>[number],
  ) => void;
  onLongTextOpen?: (
    block: Extract<MessageOutputBlock, { type: "text" }>,
  ) => void;
  onWorkspaceFileOpen?: (file: WorkspaceFilePresentation) => void;
  onStopAgentRun?: () => void;
}

const isMemorySearchTool = (name: string | undefined) =>
  name === "memory_search";

const isWebSearchTool = (name: string | undefined) => name === "web_search";

const isSuccessfulLongTextTool = (
  toolCall: NonNullable<Message["toolCalls"]>[number],
) =>
  toolCall.name === "start_long_text_output" &&
  toolCall.status === "success" &&
  !toolCall.isError;

const isSuccessfulResearchStartTool = (
  toolCall: NonNullable<Message["toolCalls"]>[number],
) =>
  toolCall.name === "start_deep_research" &&
  toolCall.status === "success" &&
  !toolCall.isError;

const ImageGenerationStatusBlock: React.FC<{ label: string }> = ({ label }) => (
  <div
    className="my-3 w-72 max-w-full overflow-hidden rounded-lg border border-border bg-muted/30"
    role="status"
    aria-live="polite"
    aria-label={label}
  >
    <div className="relative aspect-square overflow-hidden bg-muted/40">
      <div className="absolute inset-0 animate-pulse bg-linear-to-br from-muted via-background/70 to-muted" />
      <div className="absolute left-6 right-16 top-6 h-3 rounded-full bg-background/70" />
      <div className="absolute left-6 right-28 top-12 h-2 rounded-full bg-background/50" />
      <div className="absolute inset-x-10 bottom-9 h-2 rounded-full bg-background/60" />
      <div className="absolute bottom-16 left-8 h-20 w-28 rounded-md bg-background/45" />
      <div className="absolute right-8 top-20 h-28 w-24 rounded-md bg-background/35" />
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.7s_ease-in-out_infinite] bg-linear-to-r from-transparent via-background/60 to-transparent" />
      <span className="sr-only">{label}</span>
    </div>
  </div>
);

const GeneratedImageBlock: React.FC<{
  image: Attachment;
  onImageCached?: (image: Attachment) => void;
}> = ({ image, onImageCached }) => {
  const t = useTranslations("Message");
  const openImagePreview = useUIStore((state) => state.openImagePreview);
  const src = useAttachmentDisplayUrl(image, {
    enableCacheBackfill: true,
    onCacheReady: onImageCached,
  });
  const canPreview = Boolean(src);

  if (image.localFileMissing) {
    return (
      <div
        role="status"
        aria-label={t("localFileMissingAria", { fileName: image.fileName })}
        className="my-3 flex h-40 w-72 max-w-full flex-col items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-4 text-center text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200"
      >
        <ImageOff size={24} aria-hidden="true" />
        <span className="max-w-full truncate text-sm font-medium">
          {image.fileName}
        </span>
        <span className="text-xs">{t("localFileMissing")}</span>
      </div>
    );
  }

  return (
    <Button
      variant="bare"
      type="button"
      disabled={!canPreview}
      onClick={() => {
        if (!src) return;
        openImagePreview(
          [
            {
              url: src,
              alt: image.fileName,
              description: image.fileName,
            },
          ],
          0,
        );
      }}
      className="my-3 block max-w-full overflow-hidden rounded-lg border border-border bg-muted/30 text-left shadow-sm transition-shadow enabled:cursor-pointer enabled:hover:shadow-md disabled:cursor-default"
      aria-label={image.fileName}
    >
      <SafeImage
        src={src}
        alt={image.fileName}
        className="max-h-[70vh] max-w-full object-contain"
        fallback={
          <div className="flex h-40 w-72 max-w-full items-center justify-center text-muted-foreground">
            <ImageOff size={24} aria-hidden="true" />
          </div>
        }
      />
    </Button>
  );
};

function trimTextBlocksForStreaming(
  blocks: MessageOutputBlock[],
  displayedContent: string,
  isStreaming: boolean,
): MessageOutputBlock[] {
  if (!isStreaming) return blocks;

  const fullText = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content)
    .join("");
  if (displayedContent === fullText) return blocks;

  let remaining = displayedContent;
  return blocks
    .map((block) => {
      if (block.type !== "text") return block;
      const content = remaining.slice(0, block.content.length);
      remaining = remaining.slice(content.length);
      return { ...block, content };
    })
    .filter((block) => block.type !== "text" || block.content.length > 0);
}

const MessageOutputRenderer: React.FC<MessageOutputRendererProps> = ({
  message,
  displayedContent,
  isTyping = false,
  isThinking = false,
  isErrorMessage = false,
  searchSources,
  ragSources,
  onFileClick,
  forcedTheme,
  forceExpandCodeBlocks,
  forceExpandLongTextBlocks = false,
  hideReasoning = false,
  hideToolCalls = false,
  onImageCached,
  onToolConfirmationDecision,
  onRevokeToolSessionApproval,
  onLongTextOpen,
  onWorkspaceFileOpen,
  onStopAgentRun,
}) => {
  const t = useTranslations("Message");
  const agentRunId = message.generation?.agentRunId;
  const agentRun = useAgentRunStore((state) => {
    const run = agentRunId ? state.runsById[agentRunId] : undefined;
    return run?.workflowKind === "research" ? undefined : run;
  });
  const blocks = useMemo(() => {
    const orderedBlocks = getMessageOutputBlocks(message);
    const presentationBlocks =
      normalizeMessageOutputPresentation(orderedBlocks);
    return trimTextBlocksForStreaming(
      presentationBlocks,
      displayedContent,
      isTyping,
    );
  }, [displayedContent, isTyping, message]);
  const activeReasoningBlockId = useMemo(() => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (
        block.type === "reasoning" &&
        !block.endedAt &&
        (block.startedAt !== undefined || isThinking)
      ) {
        return block.id;
      }
    }
    return undefined;
  }, [blocks, isThinking]);
  const isLongTextStreaming =
    isTyping || message.generation?.status === "streaming";
  const renderedItems: Array<{
    key: string;
    framed: boolean;
    node: React.ReactNode;
  }> = [];
  if (agentRun) {
    renderedItems.push({
      key: `agent:${agentRun.id}`,
      framed: true,
      node: <AgentRunBar run={agentRun} onStop={onStopAgentRun} />,
    });
  }
  blocks.forEach((block) => {
    switch (block.type) {
      case "text":
        if (block.presentation?.kind === "long_text") {
          renderedItems.push({
            key: block.id,
            framed: true,
            node: (
              <LongTextBlock
                content={block.content}
                presentation={block.presentation}
                isStreaming={isLongTextStreaming}
                isInterrupted={message.generation?.status === "interrupted"}
                forceExpanded={forceExpandLongTextBlocks}
                onOpen={
                  onLongTextOpen ? () => onLongTextOpen(block) : undefined
                }
              />
            ),
          });
          return;
        }
        renderedItems.push({
          key: block.id,
          framed: false,
          node: (
            <MarkdownRenderer
              content={block.content}
              className={isErrorMessage ? "text-red-500" : undefined}
              searchSources={searchSources}
              ragSources={ragSources}
              onFileClick={onFileClick}
              isStreaming={isTyping}
              forcedTheme={forcedTheme}
              forceExpandCodeBlocks={forceExpandCodeBlocks}
            />
          ),
        });
        return;
      case "reasoning":
        if (hideReasoning || !block.content) return;
        renderedItems.push({
          key: block.id,
          framed: true,
          node: (
            <ReasoningBlock
              reasoning={block.content}
              isThinking={block.id === activeReasoningBlockId}
              durationMs={block.durationMs}
            />
          ),
        });
        return;
      case "task_plan":
        if (block.steps.length === 0) return;
        renderedItems.push({
          key: block.id,
          framed: true,
          node: <TaskPlanBlock steps={block.steps} note={block.note} />,
        });
        return;
      case "research_task":
        renderedItems.push({
          key: block.id,
          framed: true,
          node: (
            <ConnectedResearchTaskCard
              taskId={block.taskId}
              messageId={message.id}
              blockId={block.id}
            />
          ),
        });
        return;
      case "workspace_file":
        renderedItems.push({
          key: block.id,
          framed: true,
          node: (
            <WorkspaceFileBlock
              file={block.file}
              onOpen={onWorkspaceFileOpen}
            />
          ),
        });
        return;
      case "workspace_archive":
        renderedItems.push({
          key: block.id,
          framed: true,
          node: <ArchiveFileBlock archive={block.archive} />,
        });
        return;
      case "search":
        renderedItems.push({
          key: block.id,
          framed: true,
          node: (
            <SourceBlock
              sources={block.sources}
              images={block.images}
              isSearching={block.isSearching}
              error={block.error}
            />
          ),
        });
        return;
      case "image":
        renderedItems.push({
          key: block.id,
          framed: true,
          node: (
            <GeneratedImageBlock
              image={block.image}
              onImageCached={onImageCached}
            />
          ),
        });
        return;
      case "image_generation_status":
        renderedItems.push({
          key: block.id,
          framed: true,
          node: <ImageGenerationStatusBlock label={t("generatingImage")} />,
        });
        return;
      case "tool_group": {
        if (hideToolCalls) return;
        const memoryToolCalls = block.toolCalls.filter((toolCall) =>
          isMemorySearchTool(toolCall.name),
        );
        const otherToolCalls = block.toolCalls.filter(
          (toolCall) =>
            !isMemorySearchTool(toolCall.name) &&
            !isWebSearchTool(toolCall.name) &&
            !isSuccessfulLongTextTool(toolCall) &&
            !isSuccessfulResearchStartTool(toolCall),
        );
        if (memoryToolCalls.length > 0) {
          renderedItems.push({
            key: `${block.id}:memory`,
            framed: true,
            node: <MemorySearchBlock toolCalls={memoryToolCalls} />,
          });
        }
        if (otherToolCalls.length > 0) {
          renderedItems.push({
            key: `${block.id}:tools`,
            framed: true,
            node: (
              <ToolCallBlock
                toolCalls={otherToolCalls}
                onConfirmationDecision={onToolConfirmationDecision}
                onRevokeSessionApproval={onRevokeToolSessionApproval}
              />
            ),
          });
        }
      }
    }
  });

  if (renderedItems.length === 0) return null;

  return (
    <div className={isTyping ? "animate-in fade-in duration-500" : ""}>
      {renderedItems.map((item, index) =>
        item.framed ? (
          <div
            key={item.key}
            data-message-output-block
            className={`${getMessageOutputBlockSpacingClass(index > 0)} [&>*]:m-0!`}
          >
            {item.node}
          </div>
        ) : (
          <React.Fragment key={item.key}>{item.node}</React.Fragment>
        ),
      )}
    </div>
  );
};

export default React.memo(MessageOutputRenderer);
