import { PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import type { McpTransport } from "../plugin/types";
import { callMcpTool, type McpAuthConfig } from "./client";

export interface ExecuteMcpToolRequestOptions {
  serverUrl: string;
  transport?: McpTransport;
  toolName: string;
  args: Record<string, unknown>;
  authConfig?: McpAuthConfig;
  authValue?: string;
  staticHeaders?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getMcpToolErrorMessage(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((item) =>
      isRecord(item) && typeof item.text === "string" ? item.text.trim() : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) return text.slice(0, 4_000);
  if (typeof result.message === "string" && result.message.trim()) {
    return result.message.trim().slice(0, 4_000);
  }
  if (typeof result.error === "string" && result.error.trim()) {
    return result.error.trim().slice(0, 4_000);
  }
  return "MCP tool returned an error.";
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeMcpContentBlock(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const annotations = optionalRecord(value.annotations);
  const meta = optionalRecord(value._meta);

  if (value.type === "text" && typeof value.text === "string") {
    return {
      type: "text",
      text: value.text,
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }

  if (
    (value.type === "image" || value.type === "audio") &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    return {
      type: value.type,
      data: value.data,
      mimeType: value.mimeType,
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }

  if (value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    const uri = optionalString(resource.uri);
    const text = optionalString(resource.text);
    const blob = optionalString(resource.blob);
    if (!uri || (text === undefined && blob === undefined)) return null;

    return {
      type: "resource",
      resource: {
        uri,
        ...(text !== undefined ? { text } : { blob }),
        ...(typeof resource.mimeType === "string"
          ? { mimeType: resource.mimeType }
          : {}),
        ...(optionalRecord(resource._meta)
          ? { _meta: optionalRecord(resource._meta) }
          : {}),
      },
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }

  if (
    value.type === "resource_link" &&
    typeof value.uri === "string" &&
    typeof value.name === "string"
  ) {
    return {
      type: "resource_link",
      uri: value.uri,
      name: value.name,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.description === "string"
        ? { description: value.description }
        : {}),
      ...(typeof value.mimeType === "string"
        ? { mimeType: value.mimeType }
        : {}),
      ...(typeof value.size === "number" && Number.isFinite(value.size)
        ? { size: value.size }
        : {}),
      ...(Array.isArray(value.icons) ? { icons: value.icons } : {}),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }

  return null;
}

function serialize(value: unknown): string | null {
  try {
    return JSON.stringify(value) || null;
  } catch {
    return null;
  }
}

function compactStructuredContent(
  value: Record<string, unknown>,
  maxChars: number,
): Record<string, unknown> {
  const serialized = serialize(value);
  if (serialized && serialized.length <= maxChars) return value;
  return {
    _truncated: true,
    preview: (serialized || "MCP structured content was unserializable.").slice(
      0,
      Math.max(0, maxChars - 80),
    ),
  };
}

function boundContentBlock(
  block: Record<string, unknown>,
  maxChars: number,
): { block: Record<string, unknown>; truncated: boolean } {
  const serialized = serialize(block);
  if (serialized && serialized.length <= maxChars) {
    return { block, truncated: false };
  }

  if (block.type === "text" && typeof block.text === "string") {
    return {
      block: {
        ...block,
        text: `${block.text.slice(0, Math.max(0, maxChars - 160))}...`,
      },
      truncated: true,
    };
  }

  if (block.type === "resource" && isRecord(block.resource)) {
    const resource = block.resource;
    if (typeof resource.text === "string") {
      return {
        block: {
          ...block,
          resource: {
            ...resource,
            text: `${resource.text.slice(0, Math.max(0, maxChars - 240))}...`,
          },
        },
        truncated: true,
      };
    }
  }

  const kind = typeof block.type === "string" ? block.type : "content";
  return {
    block: {
      type: "text",
      text: `[Oversized MCP ${kind} block omitted.]`,
    },
    truncated: true,
  };
}

function compactMcpResult(result: unknown): unknown {
  if (!isRecord(result)) {
    const serialized = serialize(result);
    if (serialized === null) {
      return {
        isError: true,
        error: "MCP tool returned an unserializable result.",
      };
    }
    if (serialized.length > PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars) {
      return {
        content: [
          {
            type: "text",
            text: `${serialized.slice(
              0,
              PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars - 256,
            )}...`,
          },
        ],
        truncated: true,
      };
    }
    return result;
  }

  const hasCallToolShape =
    Array.isArray(result.content) || isRecord(result.structuredContent);
  if (!hasCallToolShape && result.isError !== true) {
    const serialized = serialize(result);
    if (
      serialized &&
      serialized.length <= PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars
    ) {
      return result;
    }

    if (!serialized) {
      return {
        isError: true,
        error: "MCP tool returned an unserializable result.",
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `${serialized.slice(
            0,
            PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars - 256,
          )}...`,
        },
      ],
      truncated: true,
    };
  }

  const rawContent = Array.isArray(result.content) ? result.content : [];
  const content = rawContent
    .map((item) => normalizeMcpContentBlock(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .slice(0, 32);
  const structuredContent = optionalRecord(result.structuredContent);
  const meta = optionalRecord(result._meta);
  const isError = result.isError === true;
  const normalized = {
    content,
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError
      ? { isError: true, error: getMcpToolErrorMessage(result) }
      : {}),
    ...(meta ? { _meta: meta } : {}),
  };
  const normalizedJson = serialize(normalized);
  if (
    normalizedJson &&
    normalizedJson.length <= PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars
  ) {
    return normalized;
  }

  const maxResultChars = PLUGIN_EXECUTION_LIMITS.maxRequestBodyChars;
  const structuredBudget = structuredContent
    ? Math.floor(maxResultChars * 0.45)
    : 0;
  const contentBudget = Math.max(
    1_024,
    maxResultChars - structuredBudget - 8_192,
  );
  const perBlockBudget = Math.max(
    1_024,
    Math.floor(contentBudget / Math.max(1, content.length)),
  );
  let contentWasTruncated = rawContent.length > content.length;
  const boundedContent = content.map((block) => {
    const bounded = boundContentBlock(block, perBlockBudget);
    contentWasTruncated ||= bounded.truncated;
    return bounded.block;
  });
  const bounded = {
    content: boundedContent,
    ...(structuredContent
      ? {
          structuredContent: compactStructuredContent(
            structuredContent,
            structuredBudget,
          ),
        }
      : {}),
    ...(isError
      ? { isError: true, error: getMcpToolErrorMessage(result) }
      : {}),
    ...(meta ? { _meta: meta } : {}),
    truncated: true,
    ...(contentWasTruncated ? { contentTruncated: true } : {}),
  };
  const boundedJson = serialize(bounded);
  if (boundedJson && boundedJson.length <= maxResultChars) return bounded;

  return {
    content: [
      {
        type: "text",
        text: "[MCP result was truncated to the supported response limit.]",
      },
    ],
    ...(structuredContent
      ? {
          structuredContent: compactStructuredContent(
            structuredContent,
            Math.floor(maxResultChars * 0.7),
          ),
        }
      : {}),
    ...(isError
      ? { isError: true, error: getMcpToolErrorMessage(result) }
      : {}),
    truncated: true,
    contentTruncated: true,
  };
}

export async function executeMcpToolRequest(
  options: ExecuteMcpToolRequestOptions,
): Promise<unknown> {
  const result = await callMcpTool({
    serverUrl: options.serverUrl,
    transport: options.transport,
    toolName: options.toolName,
    args: options.args,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    staticHeaders: options.staticHeaders,
    authConfig: {
      ...options.authConfig,
      value: options.authValue,
    },
  });

  return compactMcpResult(result);
}
