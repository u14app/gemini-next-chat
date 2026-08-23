import type { ToolCall } from "@/types";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { parseModelString } from "@/lib/utils/model";
import { getResponseErrorMessage, signedApiFetch } from "@/lib/api/client";
import {
  buildProviderRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import {
  buildDirectProviderConfig,
  describeDirectCallError,
  getBrowserProviderRuntime,
  shouldUseDirectCall,
} from "./transport";
import { logDevError, logDevWarn } from "@/lib/utils/devLogger";
import type { ChatToolDefinition } from "./types";
import {
  ChatStreamEventError,
  IncompleteChatStreamError,
  createAbortError,
  createChatStreamEventError,
  isAbortError,
} from "./streamErrors";

export const streamGenerateContent = async (
  model: string,
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const { providerId, modelName } = parseModelString(model);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider found");

  if (shouldUseDirectCall(provider)) {
    let fullText = "";
    try {
      const [{ runChatStream }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/runChatStream"),
        getBrowserProviderRuntime(),
        buildDirectProviderConfig(provider),
      ]);

      await runChatStream({
        provider: directProvider,
        modelName,
        history: [],
        newMessage: prompt,
        attachments: [],
        config: { temperature: 0.7 },
        signal,
        runtime,
        send: (message) => {
          if (message.type === "content") {
            fullText += message.content;
            onChunk(fullText);
          }
        },
      });

      if (signal?.aborted) throw createAbortError(signal);
      return fullText;
    } catch (error) {
      if (isAbortError(error, signal)) throw createAbortError(signal);
      const normalizedError = describeDirectCallError(error, provider);
      logDevError("Stream generate error:", normalizedError);
      throw normalizedError;
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(provider, signal),
          modelName,
          prompt,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Generate request failed"),
      );
    }

    reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    const processEvent = (event: string): boolean => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");

      if (!data) return false;
      if (data === "[DONE]") return true;

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new ChatStreamEventError(
          "The response stream contained malformed data.",
          "MALFORMED_CHAT_STREAM",
        );
      }

      switch (parsed.type) {
        case "content":
          fullText += parsed.content;
          onChunk(fullText);
          return false;
        case "error":
          throw createChatStreamEventError(parsed);
        case "done":
          return true;
        default:
          return false;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (processEvent(event)) {
          await reader.cancel().catch(() => undefined);
          return fullText;
        }
      }
    }

    if (buffer.trim() && processEvent(buffer)) return fullText;
    if (signal?.aborted) throw createAbortError(signal);
    throw new IncompleteChatStreamError();
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    if (isAbortError(error, signal)) throw createAbortError(signal);
    logDevError("Stream generate error:", error);
    throw error;
  }
};

export const streamGenerateToolCall = async (
  model: string,
  prompt: string,
  tools: ChatToolDefinition[],
  signal?: AbortSignal,
): Promise<ToolCall | null> => {
  if (tools.length === 0) return null;

  const { providerId, modelName } = parseModelString(model);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) {
    logDevWarn("Skill tool selection skipped: no provider found.");
    return null;
  }

  if (shouldUseDirectCall(provider)) {
    let pendingToolCall: ToolCall | null = null;
    try {
      const [{ runChatStream }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/runChatStream"),
        getBrowserProviderRuntime(),
        buildDirectProviderConfig(provider),
      ]);

      await runChatStream({
        provider: directProvider,
        modelName,
        history: [],
        newMessage: prompt,
        attachments: [],
        config: { temperature: 0 },
        tools,
        signal,
        runtime,
        send: (message) => {
          if (message.type === "tool_call") {
            pendingToolCall = message.toolCall || null;
          }
        },
      });

      if (signal?.aborted) throw createAbortError(signal);
      return pendingToolCall;
    } catch (error) {
      if (isAbortError(error, signal)) throw createAbortError(signal);
      logDevWarn(
        "Skill tool selection failed:",
        describeDirectCallError(error, provider),
      );
      return null;
    }
  }

  try {
    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(provider, signal),
          modelName,
          history: [],
          newMessage: prompt,
          attachments: [],
          config: { temperature: 0 },
          tools,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Tool selection failed"),
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let pendingToolCall: ToolCall | null = null;

    const readEvent = (event: string): "done" | "continue" => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");

      if (!data) return "continue";
      if (data === "[DONE]") return "done";

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new ChatStreamEventError(
          "The response stream contained malformed data.",
          "MALFORMED_CHAT_STREAM",
        );
      }
      switch (parsed.type) {
        case "tool_call":
          pendingToolCall = parsed.toolCall || null;
          return "continue";
        case "error":
          throw createChatStreamEventError(parsed);
        case "done":
          return "done";
        default:
          return "continue";
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (readEvent(event) === "done") {
          await reader.cancel().catch(() => undefined);
          return pendingToolCall;
        }
      }
    }

    if (buffer.trim()) {
      if (readEvent(buffer) === "done") return pendingToolCall;
    }

    if (signal?.aborted) throw createAbortError(signal);
    throw new IncompleteChatStreamError();
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError(signal);
    if (
      error instanceof IncompleteChatStreamError ||
      error instanceof ChatStreamEventError
    ) {
      throw error;
    }
    logDevWarn("Skill tool selection failed:", error);
    return null;
  }
};
