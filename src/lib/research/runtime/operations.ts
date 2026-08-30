import type { AgentExecutionPhase } from "@/services/api/chatService";

export interface RunningOperation {
  kind: "planning" | "research" | "evidence_answer";
  controller: AbortController;
  promise: Promise<void>;
  phase: AgentExecutionPhase;
  pauseRequested: boolean;
}

export type RunResearchOperation = (
  taskId: string,
  kind: RunningOperation["kind"],
  operation: (controller: AbortController) => Promise<void>,
) => Promise<void>;

export function createAbortError(
  message = "Research operation was interrupted.",
) {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
