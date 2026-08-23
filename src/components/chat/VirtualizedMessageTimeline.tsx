"use client";

import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import AssistantHeader from "@/components/assistant/AssistantHeader";
import FollowUpQuestions from "@/components/chat/FollowUpQuestions";
import MessageItem from "@/components/chat/MessageItem";
import {
  getMessageBranchInfo,
  getMessageBranchOptions,
} from "@/lib/chat/messageTree";
import type { ModelInfo } from "@/services/api/chatService";
import type {
  Message,
  Session,
  SessionMessageTree,
  ToolConfirmationDecision,
} from "@/types";
import { useSettingsStore } from "@/store/core/settingsStore";

export interface VirtualizedMessageTimelineRef {
  scrollToMessage: (messageId: string, behavior?: "auto" | "smooth") => boolean;
}

interface VirtualizedMessageTimelineProps {
  scrollElement: HTMLDivElement | null;
  currentSession?: Session;
  messages: Message[];
  activeMessageTree: SessionMessageTree;
  focusedMessageId?: string;
  isGenerating: boolean;
  actionsDisabled: boolean;
  mutationsDisabled: boolean;
  toolActionsDisabled: boolean;
  availableModels: ModelInfo[];
  onUpdateInstruction: (instruction: string) => void;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onSubmitUserEdit: (id: string, content: string) => void | Promise<void>;
  onRetract: (message: Message) => void;
  onRegenerate: (messageId: string, model?: string) => void;
  onContinue: (messageId: string) => void;
  onStopGeneration?: () => void;
  onReply: (message: Message) => void;
  onNavigateToMessage: (messageId: string) => void;
  onVersionChange: (id: string, direction: "prev" | "next") => void;
  onVersionSelect: (id: string, targetId: string) => void;
  onSuggestionClick: (question: string) => void;
  onToolConfirmationDecision: (
    toolCallId: string,
    decision: ToolConfirmationDecision,
  ) => void;
  onRevokeToolSessionApproval: NonNullable<
    React.ComponentProps<typeof MessageItem>["onRevokeToolSessionApproval"]
  >;
  pendingToolMessageId?: string;
  onPendingToolVisibilityChange?: (visible: boolean) => void;
}

type TimelineRow =
  | { key: string; kind: "assistant" }
  | { key: string; kind: "message"; message: Message; messageIndex: number };

const estimateMessageSize = (message: Message) => {
  const textLength = message.content.length + (message.reasoning?.length || 0);
  const textHeight = Math.ceil(textLength / 72) * 24;
  const attachmentHeight = message.attachments?.length ? 120 : 0;
  return Math.min(720, Math.max(112, 88 + textHeight + attachmentHeight));
};

const FOLLOW_END_THRESHOLD_PX = 48;
// Virtual distances clamp to zero, so -1 disables output following while
// retaining end anchoring for stable rows.
const DISABLED_FOLLOW_THRESHOLD_PX = -1;

const VirtualizedMessageTimeline = React.forwardRef<
  VirtualizedMessageTimelineRef,
  VirtualizedMessageTimelineProps
>(
  (
    {
      scrollElement,
      currentSession,
      messages,
      activeMessageTree,
      focusedMessageId,
      isGenerating,
      actionsDisabled,
      mutationsDisabled,
      toolActionsDisabled,
      availableModels,
      onUpdateInstruction,
      onEdit,
      onDelete,
      onSubmitUserEdit,
      onRetract,
      onRegenerate,
      onContinue,
      onStopGeneration,
      onReply,
      onNavigateToMessage,
      onVersionChange,
      onVersionSelect,
      onSuggestionClick,
      onToolConfirmationDecision,
      onRevokeToolSessionApproval,
      pendingToolMessageId,
      onPendingToolVisibilityChange,
    },
    ref,
  ) => {
    const autoScrollEnabled = useSettingsStore(
      (state) => state.system.enableAutoScroll === true,
    );
    const rows = React.useMemo<TimelineRow[]>(() => {
      const nextRows: TimelineRow[] = [];
      if (
        currentSession &&
        (messages.length > 0 || currentSession.systemInstruction)
      ) {
        nextRows.push({
          key: `assistant-${currentSession.id}`,
          kind: "assistant",
        });
      }
      messages.forEach((message, messageIndex) => {
        nextRows.push({
          key: message.id,
          kind: "message",
          message,
          messageIndex,
        });
      });
      return nextRows;
    }, [currentSession, messages]);

    const messageRowIndex = React.useMemo(() => {
      const index = new Map<string, number>();
      rows.forEach((row, rowIndex) => {
        if (row.kind === "message") index.set(row.message.id, rowIndex);
      });
      return index;
    }, [rows]);

    const lastUserMessageIndex = React.useMemo(() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") return index;
      }
      return -1;
    }, [messages]);

    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: rows.length,
      getScrollElement: () => scrollElement,
      getItemKey: (index) => rows[index]?.key || index,
      estimateSize: (index) => {
        const row = rows[index];
        return row?.kind === "message" ? estimateMessageSize(row.message) : 96;
      },
      overscan: 8,
      anchorTo: "end",
      followOnAppend: autoScrollEnabled ? "auto" : false,
      scrollEndThreshold: autoScrollEnabled
        ? FOLLOW_END_THRESHOLD_PX
        : DISABLED_FOLLOW_THRESHOLD_PX,
      paddingStart: 8,
      paddingEnd: 144,
      useFlushSync: false,
    });
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _delta,
      instance,
    ) => item.end <= (scrollElement?.scrollTop ?? instance.scrollOffset ?? 0);

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const pendingToolRowIndex = pendingToolMessageId
      ? messageRowIndex.get(pendingToolMessageId)
      : undefined;
    const pendingToolVirtualRow =
      pendingToolRowIndex === undefined
        ? undefined
        : virtualItems.find((item) => item.index === pendingToolRowIndex);
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const viewportHeight =
      virtualizer.scrollRect?.height || scrollElement?.clientHeight || 0;
    const isPendingToolMessageVisible = Boolean(
      pendingToolVirtualRow &&
      pendingToolVirtualRow.end > scrollOffset &&
      pendingToolVirtualRow.start < scrollOffset + viewportHeight,
    );

    React.useEffect(() => {
      onPendingToolVisibilityChange?.(isPendingToolMessageVisible);
    }, [isPendingToolMessageVisible, onPendingToolVisibilityChange]);

    React.useImperativeHandle(
      ref,
      () => ({
        scrollToMessage(messageId, behavior) {
          const index = messageRowIndex.get(messageId);
          if (index === undefined) return false;
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          virtualizer.scrollToIndex(index, {
            align: "center",
            behavior:
              behavior ?? (isGenerating || reduceMotion ? "auto" : "smooth"),
          });
          return true;
        },
      }),
      [isGenerating, messageRowIndex, virtualizer],
    );

    return (
      <div
        className="relative mx-auto w-full max-w-3xl"
        style={{ height: totalSize }}
        data-testid="virtualized-message-timeline"
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.kind === "assistant" ? (
                <AssistantHeader
                  instruction={currentSession?.systemInstruction || ""}
                  disabled={mutationsDisabled}
                  onUpdate={onUpdateInstruction}
                  onDelete={
                    currentSession?.systemInstruction
                      ? () => onUpdateInstruction("")
                      : undefined
                  }
                />
              ) : (
                <div
                  id={`message-${row.message.id}`}
                  data-message-id={row.message.id}
                  tabIndex={-1}
                  className={`rounded-xl outline-none transition-shadow ${
                    focusedMessageId === row.message.id
                      ? "ring-2 ring-blue-500/60 ring-offset-2 ring-offset-background"
                      : ""
                  }`}
                >
                  <MessageItem
                    message={row.message}
                    actionsDisabled={actionsDisabled}
                    mutationsDisabled={mutationsDisabled}
                    toolActionsDisabled={toolActionsDisabled}
                    branchInfo={getMessageBranchInfo(
                      activeMessageTree,
                      row.message.id,
                    )}
                    branchOptions={getMessageBranchOptions(
                      activeMessageTree,
                      row.message.id,
                    )}
                    availableModels={availableModels}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    canEditUserMessage={
                      row.message.role === "user" &&
                      row.messageIndex !== lastUserMessageIndex
                    }
                    onSubmitUserEdit={onSubmitUserEdit}
                    onRetract={
                      row.message.role === "user" &&
                      row.messageIndex === lastUserMessageIndex
                        ? () => onRetract(row.message)
                        : undefined
                    }
                    isLast={row.messageIndex === messages.length - 1}
                    isTyping={
                      isGenerating && row.messageIndex === messages.length - 1
                    }
                    onRegenerate={(model) =>
                      onRegenerate(row.message.id, model)
                    }
                    onContinue={() => onContinue(row.message.id)}
                    onStopGeneration={
                      isGenerating && row.messageIndex === messages.length - 1
                        ? onStopGeneration
                        : undefined
                    }
                    onReply={() => onReply(row.message)}
                    onNavigateToMessage={onNavigateToMessage}
                    onVersionChange={onVersionChange}
                    onVersionSelect={(targetId) =>
                      onVersionSelect(row.message.id, targetId)
                    }
                    onToolConfirmationDecision={onToolConfirmationDecision}
                    onRevokeToolSessionApproval={onRevokeToolSessionApproval}
                  />
                  {row.message.role === "model" &&
                  row.messageIndex === messages.length - 1 &&
                  !isGenerating &&
                  row.message.suggestedQuestions?.length ? (
                    <FollowUpQuestions
                      questions={row.message.suggestedQuestions}
                      onClick={onSuggestionClick}
                      disabled={mutationsDisabled}
                    />
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

VirtualizedMessageTimeline.displayName = "VirtualizedMessageTimeline";

export default VirtualizedMessageTimeline;
