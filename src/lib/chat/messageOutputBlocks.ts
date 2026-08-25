import { v7 as uuidv7 } from "uuid";
import type {
  ImageSource,
  Message,
  MessageOutputBlock,
  Source,
  ToolCall,
  WorkspaceFilePresentation,
  ArchivePresentation,
} from "@/types";
import type { TaskPlanSnapshot } from "@/lib/agent/taskPlan";
import {
  createLongTextPresentation,
  type LongTextOutputRequest,
} from "@/lib/chat/longText";

export interface MessageOutputBlockBuilderOptions {
  createId?: () => string;
  initialBlocks?: MessageOutputBlock[];
}

interface SearchBlockUpdate {
  isSearching?: boolean;
  error?: string;
  results?: {
    sources?: Source[];
    images?: ImageSource[];
  };
}

const cloneToolCall = (toolCall: ToolCall): ToolCall => ({
  ...toolCall,
  ...(toolCall.resultImages
    ? { resultImages: toolCall.resultImages.map((image) => ({ ...image })) }
    : {}),
});

const cloneImage = (
  image: Extract<MessageOutputBlock, { type: "image" }>["image"],
) => ({ ...image });

const cloneBlock = (block: MessageOutputBlock): MessageOutputBlock => {
  switch (block.type) {
    case "text":
      return {
        ...block,
        ...(block.presentation
          ? {
              presentation: {
                ...block.presentation,
                document: { ...block.presentation.document },
              },
            }
          : {}),
      };
    case "reasoning":
      return { ...block };
    case "search":
      return {
        ...block,
        error: block.error,
        sources: [...block.sources],
        images: [...block.images],
      };
    case "image":
      return {
        ...block,
        image: cloneImage(block.image),
      };
    case "image_generation_status":
      return { ...block };
    case "task_plan":
      return {
        ...block,
        steps: block.steps.map((step) => ({ ...step })),
      };
    case "research_task":
      return { ...block };
    case "workspace_file":
      return { ...block, file: { ...block.file } };
    case "workspace_archive":
      return { ...block, archive: { ...block.archive } };
    case "tool_group":
      return {
        ...block,
        toolCalls: block.toolCalls.map(cloneToolCall),
      };
  }
};

export function createMessageOutputBlockBuilder(
  options: MessageOutputBlockBuilderOptions = {},
) {
  const createId = options.createId ?? (() => uuidv7());
  const blocks = (options.initialBlocks || []).map(cloneBlock);
  let activeSearchBlockId: string | undefined;
  let activeReasoningBlockId: string | undefined;
  let pendingLongTextRequest: LongTextOutputRequest | undefined;
  let pendingLongTextContent = "";
  let activeLongTextBlockId: string | undefined;
  let taskPlanBlockId: string | undefined;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== "task_plan") continue;
    if (!taskPlanBlockId) {
      taskPlanBlockId = block.id;
      continue;
    }
    blocks.splice(index, 1);
    index -= 1;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "search" && block.isSearching) {
      activeSearchBlockId = block.id;
      break;
    }
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "reasoning" && block.startedAt && !block.endedAt) {
      activeReasoningBlockId = block.id;
      break;
    }
  }

  const getLastBlock = () => blocks[blocks.length - 1];

  const findActiveLongTextBlock = () =>
    activeLongTextBlockId
      ? blocks.find(
          (block): block is Extract<MessageOutputBlock, { type: "text" }> =>
            block.type === "text" && block.id === activeLongTextBlockId,
        )
      : undefined;

  const finalizeLongTextCapture = () => {
    if (!activeLongTextBlockId) return false;
    activeLongTextBlockId = undefined;
    return true;
  };

  const finalizeActiveReasoning = (endedAt = Date.now()) => {
    if (!activeReasoningBlockId) return false;
    const block = blocks.find(
      (item): item is Extract<MessageOutputBlock, { type: "reasoning" }> =>
        item.type === "reasoning" && item.id === activeReasoningBlockId,
    );
    activeReasoningBlockId = undefined;
    if (!block || block.endedAt) return false;
    const startedAt = block.startedAt ?? endedAt;
    block.startedAt = startedAt;
    block.endedAt = endedAt;
    block.durationMs = Math.max(0, endedAt - startedAt);
    return true;
  };

  const findToolCallLocation = (toolCallId: string) => {
    for (const block of blocks) {
      if (block.type !== "tool_group") continue;
      const index = block.toolCalls.findIndex((tc) => tc.id === toolCallId);
      if (index !== -1) return { block, index };
    }
    return null;
  };

  const updateToolCallInGroup = (
    block: Extract<MessageOutputBlock, { type: "tool_group" }>,
    toolCall: ToolCall,
  ) => {
    const index = block.toolCalls.findIndex((tc) => tc.id === toolCall.id);
    if (index === -1) {
      block.toolCalls.push(cloneToolCall(toolCall));
      return;
    }
    block.toolCalls[index] = {
      ...block.toolCalls[index],
      ...toolCall,
    };
  };

  return {
    appendText(content: string) {
      if (!content) return;
      finalizeActiveReasoning();

      if (pendingLongTextRequest) {
        pendingLongTextContent += content;
        if (!pendingLongTextContent.trim()) return;
        const block: Extract<MessageOutputBlock, { type: "text" }> = {
          id: createId(),
          type: "text",
          content: pendingLongTextContent,
          presentation: createLongTextPresentation(pendingLongTextRequest),
        };
        pendingLongTextRequest = undefined;
        pendingLongTextContent = "";
        activeLongTextBlockId = block.id;
        blocks.push(block);
        return;
      }

      const activeLongTextBlock = findActiveLongTextBlock();
      if (activeLongTextBlock) {
        activeLongTextBlock.content += content;
        return;
      }

      const last = getLastBlock();
      if (last?.type === "text" && !last.presentation) {
        last.content += content;
        return;
      }
      blocks.push({
        id: createId(),
        type: "text",
        content,
      });
    },

    appendReasoning(content: string) {
      if (!content) return;
      const activeReasoning = activeReasoningBlockId
        ? blocks.find(
            (
              block,
            ): block is Extract<MessageOutputBlock, { type: "reasoning" }> =>
              block.type === "reasoning" && block.id === activeReasoningBlockId,
          )
        : undefined;
      if (activeReasoning && !activeReasoning.endedAt) {
        if (!activeReasoning.startedAt) {
          activeReasoning.startedAt = Date.now();
        }
        activeReasoning.content += content;
        return;
      }
      const startedAt = Date.now();
      const reasoningBlock: Extract<MessageOutputBlock, { type: "reasoning" }> =
        {
          id: createId(),
          type: "reasoning",
          content,
          startedAt,
        };
      const activeLongTextIndex = activeLongTextBlockId
        ? blocks.findIndex((block) => block.id === activeLongTextBlockId)
        : -1;
      if (activeLongTextIndex >= 0) {
        blocks.splice(activeLongTextIndex, 0, reasoningBlock);
      } else {
        blocks.push(reasoningBlock);
      }
      activeReasoningBlockId = reasoningBlock.id;
    },

    startLongTextCapture(request: LongTextOutputRequest) {
      const hasLongTextBlock = blocks.some(
        (block) =>
          block.type === "text" && block.presentation?.kind === "long_text",
      );
      if (pendingLongTextRequest || activeLongTextBlockId || hasLongTextBlock) {
        return {
          ok: false as const,
          error: {
            code: "LONG_TEXT_OUTPUT_ALREADY_STARTED",
            message: "Only one long text document can be created per response.",
          },
        };
      }
      pendingLongTextRequest = { ...request };
      pendingLongTextContent = "";
      return { ok: true as const };
    },

    resumeLongTextCapture(blockId: string) {
      if (pendingLongTextRequest || activeLongTextBlockId) return false;
      const target = blocks.find(
        (block) =>
          block.type === "text" &&
          block.id === blockId &&
          block.presentation?.kind === "long_text",
      );
      if (!target) return false;
      activeLongTextBlockId = blockId;
      return true;
    },

    cancelPendingLongTextCapture() {
      if (!pendingLongTextRequest) return false;
      pendingLongTextRequest = undefined;
      pendingLongTextContent = "";
      return true;
    },

    finalizeLongTextCapture,

    getLongTextCaptureState() {
      const activeBlock = findActiveLongTextBlock();
      return {
        pending: Boolean(pendingLongTextRequest),
        activeBlockId: activeBlock?.id,
        hasContent: Boolean(activeBlock?.content),
      };
    },

    upsertSearch(update: SearchBlockUpdate) {
      finalizeActiveReasoning();
      const activeTarget = activeSearchBlockId
        ? blocks.find(
            (block) =>
              block.type === "search" && block.id === activeSearchBlockId,
          )
        : undefined;
      const lastBlock = getLastBlock();
      const target:
        Extract<MessageOutputBlock, { type: "search" }> | undefined =
        activeTarget?.type === "search"
          ? activeTarget
          : lastBlock?.type === "search"
            ? lastBlock
            : undefined;

      const sources = update.results?.sources || [];
      const images = update.results?.images || [];
      const isSearching = update.isSearching ?? target?.isSearching ?? false;
      const error = update.error;

      if (target?.type === "search") {
        target.isSearching = isSearching;
        target.error = error;
        if (update.results) {
          target.sources = sources;
          target.images = images;
        }
        activeSearchBlockId = isSearching ? target.id : undefined;
        return;
      }

      const block: MessageOutputBlock = {
        id: createId(),
        type: "search",
        isSearching,
        ...(error ? { error } : {}),
        sources,
        images,
      };
      blocks.push(block);
      activeSearchBlockId = isSearching ? block.id : undefined;
    },

    appendImage(
      image: Extract<MessageOutputBlock, { type: "image" }>["image"],
    ) {
      finalizeActiveReasoning();
      blocks.push({
        id: createId(),
        type: "image",
        image: cloneImage(image),
      });
    },

    appendImageGenerationStatus() {
      finalizeActiveReasoning();
      const id = createId();
      blocks.push({
        id,
        type: "image_generation_status",
        status: "generating",
      });
      return id;
    },

    clearImageGenerationStatus(id?: string) {
      const index = blocks.findIndex(
        (block) =>
          block.type === "image_generation_status" && (!id || block.id === id),
      );
      if (index === -1) return false;
      blocks.splice(index, 1);
      return true;
    },

    upsertTaskPlan(plan: TaskPlanSnapshot) {
      finalizeActiveReasoning();
      const target = taskPlanBlockId
        ? blocks.find(
            (
              block,
            ): block is Extract<MessageOutputBlock, { type: "task_plan" }> =>
              block.type === "task_plan" && block.id === taskPlanBlockId,
          )
        : undefined;
      const steps = plan.steps.map((step) => ({ ...step }));

      if (target) {
        target.steps = steps;
        if (plan.note) {
          target.note = plan.note;
        } else {
          delete target.note;
        }
        return;
      }

      const block: Extract<MessageOutputBlock, { type: "task_plan" }> = {
        id: createId(),
        type: "task_plan",
        steps,
        ...(plan.note ? { note: plan.note } : {}),
      };
      blocks.push(block);
      taskPlanBlockId = block.id;
    },

    completeTaskPlan() {
      if (!taskPlanBlockId) return false;
      const target = blocks.find(
        (block): block is Extract<MessageOutputBlock, { type: "task_plan" }> =>
          block.type === "task_plan" && block.id === taskPlanBlockId,
      );
      if (!target) return false;

      let changed = false;
      target.steps = target.steps.map((step) => {
        if (step.status === "completed") return step;
        changed = true;
        return { ...step, status: "completed" };
      });
      return changed;
    },

    upsertResearchTask(taskId: string) {
      finalizeActiveReasoning();
      const normalizedTaskId = taskId.trim();
      if (!normalizedTaskId) return false;
      const existing = blocks.find(
        (
          block,
        ): block is Extract<MessageOutputBlock, { type: "research_task" }> =>
          block.type === "research_task" && block.taskId === normalizedTaskId,
      );
      if (existing) return true;
      blocks.push({
        id: createId(),
        type: "research_task",
        taskId: normalizedTaskId,
      });
      return true;
    },

    /**
     * Shows a workspace file in the transcript. Re-sharing the same path
     * refreshes the existing card instead of stacking duplicates.
     */
    upsertWorkspaceFile(file: WorkspaceFilePresentation) {
      finalizeActiveReasoning();
      const existing = blocks.find(
        (
          block,
        ): block is Extract<MessageOutputBlock, { type: "workspace_file" }> =>
          block.type === "workspace_file" && block.file.path === file.path,
      );

      if (existing) {
        existing.file = { ...file };
        return;
      }

      blocks.push({
        id: createId(),
        type: "workspace_file",
        file: { ...file },
      });
    },

    /**
     * Shows an archive download in the transcript. Rebuilding the same archive
     * name refreshes the existing card instead of stacking duplicates.
     */
    upsertArchiveFile(archive: ArchivePresentation) {
      finalizeActiveReasoning();
      const existing = blocks.find(
        (
          block,
        ): block is Extract<
          MessageOutputBlock,
          { type: "workspace_archive" }
        > =>
          block.type === "workspace_archive" &&
          block.archive.fileName === archive.fileName,
      );

      if (existing) {
        existing.archive = { ...archive };
        return;
      }

      blocks.push({
        id: createId(),
        type: "workspace_archive",
        archive: { ...archive },
      });
    },

    appendToolCall(toolCall: ToolCall) {
      finalizeActiveReasoning();
      const last = getLastBlock();
      if (last?.type === "tool_group") {
        updateToolCallInGroup(last, toolCall);
        return;
      }

      blocks.push({
        id: createId(),
        type: "tool_group",
        toolCalls: [cloneToolCall(toolCall)],
      });
    },

    updateToolCall(toolCall: ToolCall) {
      const location = findToolCallLocation(toolCall.id);
      if (location) {
        updateToolCallInGroup(location.block, toolCall);
        return;
      }
      const last = getLastBlock();
      if (last?.type === "tool_group") {
        updateToolCallInGroup(last, toolCall);
        return;
      }
      blocks.push({
        id: createId(),
        type: "tool_group",
        toolCalls: [cloneToolCall(toolCall)],
      });
    },

    getBlocks(): MessageOutputBlock[] {
      return blocks.map(cloneBlock);
    },

    finalizeActiveReasoning,
  };
}

export function getMessageOutputBlocks(message: Message): MessageOutputBlock[] {
  if (message.outputBlocks?.length) {
    return message.outputBlocks.map(cloneBlock);
  }

  const blocks: MessageOutputBlock[] = [];
  const sources = message.searchSources || [];
  const images = message.searchImages || [];

  if (message.isSearching || sources.length > 0 || images.length > 0) {
    blocks.push({
      id: `${message.id}-legacy-search`,
      type: "search",
      isSearching: message.isSearching,
      sources,
      images,
    });
  }

  if (message.toolCalls?.length) {
    blocks.push({
      id: `${message.id}-legacy-tools`,
      type: "tool_group",
      toolCalls: message.toolCalls.map(cloneToolCall),
    });
  }

  if (message.reasoning) {
    blocks.push({
      id: `${message.id}-legacy-reasoning`,
      type: "reasoning",
      content: message.reasoning,
    });
  }

  if (message.content) {
    blocks.push({
      id: `${message.id}-legacy-text`,
      type: "text",
      content: message.content,
    });
  }

  return blocks;
}
