import type {
  ToolCall,
  ToolConfirmationController,
  ToolConfirmationRequest,
} from "@/types";
import type { ChatToolDefinition } from "./types";
import { createAbortError } from "./streamErrors";

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
      state: "denied",
      decision: "deny",
      decidedAt: Date.now(),
    },
    errorInfo: { code, message, recoverable },
    result: { error: { code, message } },
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
      state,
      decidedAt: Date.now(),
    },
    errorInfo: { code, message, recoverable: true },
    result: { error: { code, message } },
  };
}

export function coerceToolDefinition(tool: unknown): ChatToolDefinition {
  return tool as ChatToolDefinition;
}
