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
  const agentRun = useAgentRunStore((state) =>
    agentRunId ? state.runsById[agentRunId] : undefined,
  );
  const blocks = useMemo(() => {
    const orderedBlocks = getMessageOutputBlocks(message);
    return trimTextBlocksForStreaming(
      orderedBlocks,
      displayedContent,
      isTyping,
    );
  }, [displayedContent, isTyping, message]);
  const isLongTextStreaming =
    isTyping || message.generation?.status === "streaming";

  if (blocks.length === 0 && !agentRun) return null;

  return (
    <div className={isTyping ? "animate-in fade-in duration-500" : ""}>
      {agentRun ? <AgentRunBar run={agentRun} onStop={onStopAgentRun} /> : null}
      {blocks.map((block, index) => {
        switch (block.type) {
          case "text":
            if (block.presentation?.kind === "long_text") {
              return (
                <LongTextBlock
                  key={block.id}
                  content={block.content}
                  presentation={block.presentation}
                  isStreaming={isLongTextStreaming}
                  isInterrupted={message.generation?.status === "interrupted"}
                  forceExpanded={forceExpandLongTextBlocks}
                  onOpen={
                    onLongTextOpen ? () => onLongTextOpen(block) : undefined
                  }
                />
              );
            }
            return (
              <MarkdownRenderer
                key={block.id}
                content={block.content}
                className={isErrorMessage ? "text-red-500" : undefined}
                searchSources={searchSources}
                ragSources={ragSources}
                onFileClick={onFileClick}
                isStreaming={isTyping}
                forcedTheme={forcedTheme}
                forceExpandCodeBlocks={forceExpandCodeBlocks}
              />
            );
          case "reasoning":
            if (hideReasoning) return null;
            return (
              <ReasoningBlock
                key={block.id}
                reasoning={block.content}
                isThinking={isThinking && index === blocks.length - 1}
                durationMs={block.durationMs}
              />
            );
          case "task_plan":
            return (
              <TaskPlanBlock
                key={block.id}
                steps={block.steps}
                note={block.note}
              />
            );
          case "workspace_file":
            return (
              <WorkspaceFileBlock
                key={block.id}
                file={block.file}
                onOpen={onWorkspaceFileOpen}
              />
            );
          case "workspace_archive":
            return <ArchiveFileBlock key={block.id} archive={block.archive} />;
          case "search":
            return (
              <SourceBlock
                key={block.id}
                sources={block.sources}
                images={block.images}
                isSearching={block.isSearching}
                error={block.error}
              />
            );
          case "image":
            return (
              <GeneratedImageBlock
                key={block.id}
                image={block.image}
                onImageCached={onImageCached}
              />
            );
          case "image_generation_status":
            return (
              <ImageGenerationStatusBlock
                key={block.id}
                label={t("generatingImage")}
              />
            );
          case "tool_group": {
            if (hideToolCalls) return null;
            const memoryToolCalls = block.toolCalls.filter((toolCall) =>
              isMemorySearchTool(toolCall.name),
            );
            const otherToolCalls = block.toolCalls.filter(
              (toolCall) =>
                !isMemorySearchTool(toolCall.name) &&
                !isWebSearchTool(toolCall.name) &&
                !isSuccessfulLongTextTool(toolCall),
            );

            return (
              <React.Fragment key={block.id}>
                {memoryToolCalls.length > 0 ? (
                  <MemorySearchBlock toolCalls={memoryToolCalls} />
                ) : null}
                {otherToolCalls.length > 0 ? (
                  <ToolCallBlock
                    toolCalls={otherToolCalls}
                    onConfirmationDecision={onToolConfirmationDecision}
                    onRevokeSessionApproval={onRevokeToolSessionApproval}
                  />
                ) : null}
              </React.Fragment>
            );
          }
        }
      })}
    </div>
  );
};

export default React.memo(MessageOutputRenderer);
