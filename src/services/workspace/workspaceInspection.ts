import {
  isTextWorkspaceFile,
  workspaceFailure,
  type WorkspaceResult,
} from "@/lib/agent/workspace";

import {
  getWorkspaceFileEntry,
  readWorkspaceBlob,
  type WorkspaceFileEntry,
} from "./sessionWorkspace";

const MAX_DIFF_LINES = 400;

export interface WorkspaceDiffResult {
  path: string;
  revision: string;
  comparePath?: string;
  compareRevision?: string;
  additions: number;
  deletions: number;
  unchanged: boolean;
  truncated: boolean;
  diff: string;
}

function compactDiff(
  before: string,
  after: string,
): Omit<
  WorkspaceDiffResult,
  "path" | "revision" | "comparePath" | "compareRevision"
> {
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = left.slice(prefix, left.length - suffix);
  const added = right.slice(prefix, right.length - suffix);
  const lines = [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
  const truncated = lines.length > MAX_DIFF_LINES;
  return {
    additions: added.length,
    deletions: removed.length,
    unchanged: removed.length === 0 && added.length === 0,
    truncated,
    diff: lines.slice(0, MAX_DIFF_LINES).join("\n"),
  };
}

async function readText(
  sessionId: string,
  path: unknown,
): Promise<WorkspaceResult<{ entry: WorkspaceFileEntry; content: string }>> {
  const read = await readWorkspaceBlob(sessionId, path);
  if (!read.ok) return read;
  if (!isTextWorkspaceFile(read.value.entry.path)) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      `"${read.value.entry.path}" is not a text file.`,
    );
  }
  return {
    ok: true,
    value: { entry: read.value.entry, content: await read.value.blob.text() },
  };
}

export async function diffWorkspaceFile(
  sessionId: string,
  path: unknown,
  options: { comparePath?: unknown; proposedContent?: string },
): Promise<WorkspaceResult<WorkspaceDiffResult>> {
  const current = await readText(sessionId, path);
  if (!current.ok) return current;

  if (typeof options.proposedContent === "string") {
    return {
      ok: true,
      value: {
        path: current.value.entry.path,
        revision: current.value.entry.revision,
        ...compactDiff(current.value.content, options.proposedContent),
      },
    };
  }
  if (options.comparePath === undefined) {
    return workspaceFailure(
      "WORKSPACE_READ_FAILED",
      "Provide comparePath or proposedContent.",
    );
  }
  const compare = await readText(sessionId, options.comparePath);
  if (!compare.ok) return compare;
  return {
    ok: true,
    value: {
      path: current.value.entry.path,
      revision: current.value.entry.revision,
      comparePath: compare.value.entry.path,
      compareRevision: compare.value.entry.revision,
      ...compactDiff(current.value.content, compare.value.content),
    },
  };
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

export async function validateWorkspaceFile(
  sessionId: string,
  path: unknown,
): Promise<
  WorkspaceResult<{
    entry: WorkspaceFileEntry;
    valid: boolean;
    format: string;
    errors: string[];
    warnings: string[];
  }>
> {
  const entry = await getWorkspaceFileEntry(sessionId, path);
  if (!entry.ok) return entry;
  const errors: string[] = [];
  const warnings: string[] = [];
  const extension = entry.value.fileName.split(".").pop()?.toLowerCase() || "";
  if (!isTextWorkspaceFile(entry.value.path)) {
    return {
      ok: true,
      value: {
        entry: entry.value,
        valid: entry.value.bytes > 0,
        format: entry.value.mimeType,
        errors: entry.value.bytes > 0 ? [] : ["The file is empty."],
        warnings: ["Binary validation is limited to metadata and readability."],
      },
    };
  }
  const read = await readText(sessionId, path);
  if (!read.ok) return read;
  const content = read.value.content;
  if (!content.trim()) errors.push("The file is empty.");
  if (extension === "json") {
    try {
      JSON.parse(content);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid JSON.");
    }
  } else if (extension === "jsonl") {
    content.split("\n").forEach((line, index) => {
      if (!line.trim()) return;
      try {
        JSON.parse(line);
      } catch {
        errors.push(`Line ${index + 1} is not valid JSON.`);
      }
    });
  } else if (extension === "csv") {
    const rows = content.split("\n").filter((line) => line.length > 0);
    const expected = rows[0] ? parseCsvRow(rows[0]).length : 0;
    rows.slice(1).forEach((line, index) => {
      const count = parseCsvRow(line).length;
      if (count !== expected) {
        errors.push(
          `CSV row ${index + 2} has ${count} columns; expected ${expected}.`,
        );
      }
    });
  } else if (!["md", "markdown", "txt", "yaml", "yml"].includes(extension)) {
    warnings.push(
      "No format-specific validator is available for this text file.",
    );
  }
  return {
    ok: true,
    value: {
      entry: entry.value,
      valid: errors.length === 0,
      format: extension || entry.value.mimeType,
      errors: errors.slice(0, 50),
      warnings: warnings.slice(0, 20),
    },
  };
}
