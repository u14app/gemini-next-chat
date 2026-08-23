import type {
  ToolCall,
  ToolConfirmationController,
  ToolConfirmationRequest,
} from "@/types";
import { normalizeToolResultEnvelope } from "@/lib/agent/toolResult";
import type { ChatToolDefinition } from "./types";
import { createAbortError } from "./streamErrors";

function createConfirmationFailureResult(
  toolName: string,
  code: string,
  message: string,
  recoverable: boolean,
) {
  return normalizeToolResultEnvelope(
    { ok: false, error: { code, message, recoverable } },
    {
      trust: "internal",
      provenance: {
        origin: "runtime",
        toolName,
        retrievedAt: Date.now(),
      },
    },
  );
}

export function waitForToolConfirmation(
  controller: ToolConfirmationController,
  request: ToolConfirmationRequest,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return Promise.reject(createAbortError(signal));

  return new Promise<
    Awaited<ReturnType<ToolConfirmationController["requestConfirmation"]>>
  >((resolve, reject) => {
    const onAbort = () => reject(createAbortError(signal));
    signal?.addEventListener("abort", onAbort, { once: true });

    Promise.resolve()
      .then(() => controller.requestConfirmation(request, signal))
      .then(
        (decision) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(decision);
        },
        (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
  });
}

export function createRejectedToolCall(
  toolCall: ToolCall,
  code: string,
  message: string,
  recoverable: boolean,
): ToolCall {
  return {
    ...toolCall,
    status: "denied",
    isError: true,
    confirmation: {
      required: true,
      canPersist: false,
      state: "denied",
      decision: "deny",
      decidedAt: Date.now(),
    },
    errorInfo: { code, message, recoverable },
    result: createConfirmationFailureResult(
      toolCall.name,
      code,
      message,
      recoverable,
    ),
  };
}

export function createConfirmationFailureToolCall(
  toolCall: ToolCall,
  code: string,
  message: string,
  state: "interrupted" | "error",
): ToolCall {
  return {
    ...toolCall,
    status: "error",
    isError: true,
    confirmation: {
      required: true,
      canPersist: false,
      state,
      decidedAt: Date.now(),
    },
    errorInfo: { code, message, recoverable: true },
    result: createConfirmationFailureResult(toolCall.name, code, message, true),
  };
}

export function coerceToolDefinition(tool: unknown): ChatToolDefinition {
  return tool as ChatToolDefinition;
}
