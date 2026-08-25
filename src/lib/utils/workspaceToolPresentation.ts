import type { ToolCall } from "@/types";
import { isToolResultEnvelope } from "@/lib/agent/toolResult";

const PREVIEW_MAX_CHARS = 1_200;
const PREVIEW_MAX_LINES = 12;

const WORKSPACE_TOOL_NAMES = new Set([
  "list_workspace_files",
  "search_workspace_files",
  "read_workspace_file",
  "stat_workspace_file",
  "diff_workspace_file",
  "write_workspace_file",
  "edit_workspace_file",
  "apply_workspace_patch",
  "move_workspace_file",
  "trash_workspace_file",
  "restore_workspace_file",
  "delete_workspace_file",
  "validate_workspace_file",
  "publish_artifact",
  "share_workspace_file",
]);

export type WorkspaceToolPreviewKind = "content" | "before" | "after" | "diff";

export interface WorkspaceToolPreview {
  kind: WorkspaceToolPreviewKind;
  text: string;
  truncated: boolean;
}

export interface WorkspaceToolPresentation {
  target?: string;
  from?: string;
  to?: string;
  revision?: string;
  bytes?: number;
  replacements?: number;
  mode?: "create" | "overwrite" | "append";
  previews: WorkspaceToolPreview[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function unwrapResult(value: unknown): Record<string, unknown> {
  if (isToolResultEnvelope(value)) {
    return value.ok ? asRecord(value.data) : asRecord(value.error);
  }
  return asRecord(value);
}

function boundedPreview(
  kind: WorkspaceToolPreviewKind,
  value: string,
): WorkspaceToolPreview {
  const lines = value.split(/\r?\n/);
  const lineBounded = lines.slice(0, PREVIEW_MAX_LINES).join("\n");
  const text = lineBounded.slice(0, PREVIEW_MAX_CHARS);
  return {
    kind,
    text,
    truncated:
      lines.length > PREVIEW_MAX_LINES ||
      lineBounded.length > PREVIEW_MAX_CHARS,
  };
}

function patchSnapshot(args: Record<string, unknown>): WorkspaceToolPreview[] {
  if (!Array.isArray(args.patches)) return [];
  const patches = args.patches.map(asRecord);
  const before = patches
    .map((patch, index) => {
      const value = stringValue(patch.oldString) ?? "";
      return `${index + 1}. ${value}`;
    })
    .join("\n");
  const after = patches
    .map((patch, index) => {
      const value = stringValue(patch.newString) ?? "";
      return `${index + 1}. ${value}`;
    })
    .join("\n");
  return [boundedPreview("before", before), boundedPreview("after", after)];
}

export function getWorkspaceToolPresentation(
  toolCall: Pick<ToolCall, "name" | "args" | "result">,
): WorkspaceToolPresentation | null {
  if (!WORKSPACE_TOOL_NAMES.has(toolCall.name)) return null;

  const args = asRecord(toolCall.args);
  const result = unwrapResult(toolCall.result);
  const entry = asRecord(result.entry);
  const previews: WorkspaceToolPreview[] = [];

  if (
    toolCall.name === "write_workspace_file" &&
    typeof args.content === "string"
  ) {
    previews.push(boundedPreview("content", args.content));
  } else if (toolCall.name === "read_workspace_file") {
    const content = stringValue(result.content);
    if (content !== undefined) {
      previews.push(boundedPreview("content", content));
    }
  } else if (toolCall.name === "edit_workspace_file") {
    if (typeof args.oldString === "string") {
      previews.push(boundedPreview("before", args.oldString));
    }
    if (typeof args.newString === "string") {
      previews.push(boundedPreview("after", args.newString));
    }
  } else if (toolCall.name === "apply_workspace_patch") {
    previews.push(...patchSnapshot(args));
  } else if (toolCall.name === "diff_workspace_file") {
    const diff = stringValue(result.diff);
    if (diff !== undefined) previews.push(boundedPreview("diff", diff));
  }

  const mode =
    args.mode === "create" ||
    args.mode === "overwrite" ||
    args.mode === "append"
      ? args.mode
      : undefined;
  const from =
    stringValue(result.from) ??
    stringValue(result.originalPath) ??
    stringValue(result.trashPath) ??
    stringValue(args.from) ??
    stringValue(args.trashPath);
  const to =
    stringValue(entry.path) ??
    stringValue(result.trashPath) ??
    stringValue(args.to) ??
    stringValue(args.destinationPath);
  const target =
    stringValue(result.path) ??
    stringValue(entry.path) ??
    stringValue(args.path) ??
    to ??
    from;

  return {
    target,
    from,
    to: to && to !== from ? to : undefined,
    revision: stringValue(result.revision) ?? stringValue(entry.revision),
    bytes: numberValue(result.bytes) ?? numberValue(entry.bytes),
    replacements: numberValue(result.replacements),
    mode,
    previews,
  };
}
