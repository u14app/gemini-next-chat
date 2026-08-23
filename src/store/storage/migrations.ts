import {
  Message,
  MessageOutputBlock,
  SessionMessageTree,
  ToolCall,
} from "@/types";
import { normalizeSearchSettings } from "@/lib/settings/searchRag";
import { parseTaskPlan } from "@/lib/agent/taskPlan";
import {
  normalizeArchivePresentation,
  normalizeWorkspaceFilePresentation,
} from "@/lib/agent/workspace";
import { ATTACHMENT_LIMITS, MARKET_LIMITS } from "@/config/limits";
import { normalizeLongTextPresentation } from "@/lib/chat/longText";

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, 160);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

export function normalizeToolCall(toolCall: Partial<ToolCall>): ToolCall {
  let status = toolCall.status;
  if (!status) {
    if (toolCall.isError) {
      status = "error";
    } else if (toolCall.result !== undefined) {
      status = "success";
    } else {
      status = "pending";
    }
  }

  const interruptedConfirmation = status === "awaiting_confirmation";
  if (interruptedConfirmation) status = "error";

  const confirmation = interruptedConfirmation
    ? {
        required: true,
        state: "interrupted" as const,
        decidedAt: Date.now(),
      }
    : toolCall.confirmation
      ? {
          required: toolCall.confirmation.required === true,
          state: toolCall.confirmation.state,
          ...(toolCall.confirmation.decision
            ? { decision: toolCall.confirmation.decision }
            : {}),
          ...(typeof toolCall.confirmation.decidedAt === "number"
            ? { decidedAt: toolCall.confirmation.decidedAt }
            : {}),
        }
      : undefined;
  const interruptedResult = {
    error: {
      code: "CONFIRMATION_INTERRUPTED",
      message: "Tool confirmation was interrupted before a decision.",
    },
  };
  const resultImages = Array.isArray(toolCall.resultImages)
    ? toolCall.resultImages
        .slice(0, ATTACHMENT_LIMITS.maxCount)
        .map((image) => ({ ...image }))
    : undefined;

  return {
    id: toolCall.id || `tool_${Date.now()}`,
    name: toolCall.name || "unknown_tool",
    pluginId: toolCall.pluginId,
    pluginTitle: toolCall.pluginTitle,
    functionFingerprint: toolCall.functionFingerprint,
    args: toolCall.args ?? {},
    status,
    result: interruptedConfirmation ? interruptedResult : toolCall.result,
    ...(resultImages?.length ? { resultImages } : {}),
    isError: interruptedConfirmation ? true : toolCall.isError,
    risk: toolCall.risk,
    confirmation,
    errorInfo: interruptedConfirmation
      ? {
          code: "CONFIRMATION_INTERRUPTED",
          message: "Tool confirmation was interrupted before a decision.",
          recoverable: true,
        }
      : toolCall.errorInfo,
    auth: toolCall.auth,
  };
}

export function normalizeMessage(message: Message): Message {
  const hasForcedPluginIds = Array.isArray(message.forcedPluginIds);
  const forcedPluginIds = normalizeStringList(
    message.forcedPluginIds,
    MARKET_LIMITS.maxPlugins,
  );
  const memoryContext =
    message.memoryContext &&
    typeof message.memoryContext === "object" &&
    typeof message.memoryContext.promptContext === "string"
      ? {
          injectedMemoryIds: normalizeStringList(
            message.memoryContext.injectedMemoryIds,
            100,
          ),
          promptContext: message.memoryContext.promptContext
            .trim()
            .slice(0, 8_000),
          ...(typeof message.memoryContext.createdAt === "number" &&
          Number.isFinite(message.memoryContext.createdAt)
            ? { createdAt: Math.floor(message.memoryContext.createdAt) }
            : {}),
        }
      : undefined;
  let normalizedBlocks: MessageOutputBlock[] | undefined;
  if (Array.isArray(message.outputBlocks)) {
    normalizedBlocks = [];
    for (const block of message.outputBlocks) {
      if (block.type === "text") {
        const presentation = normalizeLongTextPresentation(block.presentation);
        normalizedBlocks.push({
          id: block.id,
          type: "text",
          content: block.content,
          ...(presentation ? { presentation } : {}),
        });
        continue;
      }
      if (block.type === "task_plan") {
        const parsed = parseTaskPlan({
          steps: block.steps,
          note: block.note,
        });
        if (!parsed.ok) continue;
        const { note: _note, ...blockWithoutNote } = block;
        void _note;
        normalizedBlocks.push({
          ...blockWithoutNote,
          ...parsed.plan,
        });
        continue;
      }
      if (block.type === "workspace_file") {
        const file = normalizeWorkspaceFilePresentation(block.file);
        if (!file) continue;
        normalizedBlocks.push({ id: block.id, type: "workspace_file", file });
        continue;
      }
      if (block.type === "workspace_archive") {
        const archive = normalizeArchivePresentation(block.archive);
        if (!archive) continue;
        normalizedBlocks.push({
          id: block.id,
          type: "workspace_archive",
          archive,
        });
        continue;
      }
      if (block.type !== "tool_group") {
        normalizedBlocks.push(block);
        continue;
      }
      normalizedBlocks.push({
        ...block,
        toolCalls: block.toolCalls.map((toolCall) =>
          normalizeToolCall(toolCall),
        ),
      });
    }
  }

  if (
    !message.toolCalls?.length &&
    !normalizedBlocks &&
    !memoryContext &&
    !hasForcedPluginIds
  ) {
    return message;
  }

  return {
    ...message,
    ...(memoryContext?.promptContext &&
    memoryContext.injectedMemoryIds.length > 0
      ? { memoryContext }
      : { memoryContext: undefined }),
    ...(forcedPluginIds.length
      ? { forcedPluginIds }
      : { forcedPluginIds: undefined }),
    ...(message.toolCalls?.length
      ? {
          toolCalls: message.toolCalls.map((toolCall) =>
            normalizeToolCall(toolCall),
          ),
        }
      : {}),
    ...(normalizedBlocks ? { outputBlocks: normalizedBlocks } : {}),
  };
}

export function normalizeMessages(messages: Message[] | null | undefined) {
  return (messages || []).map((message) => normalizeMessage(message));
}

export function normalizeMessageTreeMessages(
  tree: SessionMessageTree,
): SessionMessageTree {
  const nodesById: SessionMessageTree["nodesById"] = {};
  for (const [id, node] of Object.entries(tree.nodesById)) {
    nodesById[id] = {
      ...node,
      message: normalizeMessage(node.message),
      childMessageIds: [...node.childMessageIds],
    };
  }

  return {
    ...tree,
    nodesById,
    rootMessageIds: [...tree.rootMessageIds],
  };
}

export function migrateSearchSettings(search: any) {
  return normalizeSearchSettings(search);
}
