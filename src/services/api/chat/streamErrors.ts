export class IncompleteChatStreamError extends Error {
  readonly code = "INCOMPLETE_CHAT_STREAM";
  readonly recoverable = true;

  constructor() {
    super("The response stream ended before completion. Please retry.");
    this.name = "IncompleteChatStreamError";
  }
}

export class ChatStreamEventError extends Error {
  constructor(
    message: string,
    readonly code = "CHAT_STREAM_ERROR",
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ChatStreamEventError";
  }
}

export class ChatStreamTimeoutError extends ChatStreamEventError {
  constructor(message: string) {
    super(message, "RESPONSE_TIMEOUT");
    this.name = "ChatStreamTimeoutError";
  }
}

export class ChatStreamSizeLimitError extends ChatStreamEventError {
  constructor(message: string) {
    super(message, "RESPONSE_SIZE_LIMIT");
    this.name = "ChatStreamSizeLimitError";
  }
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function createChatStreamEventError(event: {
  error?: string;
  code?: string;
  statusCode?: number;
}): ChatStreamEventError {
  const message = event.error || "The response stream failed.";
  if (event.code === "INCOMPLETE_PROVIDER_STREAM") {
    return new IncompleteChatStreamError();
  }
  if (event.code === "RESPONSE_TIMEOUT") {
    return new ChatStreamTimeoutError(message);
  }
  if (event.code === "RESPONSE_SIZE_LIMIT") {
    return new ChatStreamSizeLimitError(message);
  }
  return new ChatStreamEventError(message, event.code, event.statusCode);
}
