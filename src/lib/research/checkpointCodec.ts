import type { MessageOutputBlock, ToolCall } from "@/types";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import { RESEARCH_TOOL_RESULT_LIMITS } from "./toolResultContent";

export interface SavedResearchCheckpoint {
  version: 1;
  taskId: string;
  savedAt: number;
  prompt: string;
  partialContent: string;
  toolCalls: ToolCall[];
  outputBlocks: MessageOutputBlock[];
}

function compactCheckpointValue(
  value: unknown,
  maxChars: number = RESEARCH_TOOL_RESULT_LIMITS.inlineChars,
): unknown {
  try {
    return JSON.stringify(value).length <= maxChars
      ? value
      : { omitted: true, reason: "Value exceeded the checkpoint size limit." };
  } catch {
    return { omitted: true, reason: "Value could not be serialized safely." };
  }
}

function compactCheckpointResult(value: unknown): unknown {
  // New Research results are inline or reference envelopes already bounded by
  // the history writer. Preserve their exact value for tool_cache replay hashes.
  return compactCheckpointValue(
    value,
    RESEARCH_TOOL_RESULT_LIMITS.checkpointResultChars,
  );
}

export function sanitizeCheckpointToolCall(toolCall: ToolCall): ToolCall {
  const { auth: _auth, resultImages: _resultImages, ...safe } = toolCall;
  void _auth;
  void _resultImages;
  const redactedArgs = redactSensitiveToolArgs(toolCall.args);
  const redactedResult = redactSensitiveToolArgs(toolCall.result);
  const boundedArgs = compactCheckpointValue(redactedArgs);
  const boundedResult = compactCheckpointResult(redactedResult);
  return {
    ...safe,
    args: boundedArgs,
    ...(toolCall.result !== undefined ? { result: boundedResult } : {}),
  };
}

export function isCommittedCheckpointToolCall(toolCall: ToolCall): boolean {
  return toolCall.status === "success" && toolCall.isError !== true;
}

export function redactCheckpointText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 200_000);
}
