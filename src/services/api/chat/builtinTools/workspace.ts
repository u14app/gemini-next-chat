import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import { v7 as uuidv7 } from "uuid";
import {
  WORKSPACE_UPLOADS_DIRECTORY,
  type WorkspaceResult,
} from "@/lib/agent/workspace";
import {
  deleteWorkspaceFile,
  editWorkspaceFile,
  getWorkspaceFileEntry,
  listWorkspace,
  moveWorkspaceFile,
  readWorkspaceText,
  searchWorkspace,
  writeWorkspaceText,
  type WorkspaceWriteMode,
} from "@/services/workspace/sessionWorkspace";

import type { BuiltinToolBinding } from "./types";

export const WORKSPACE_TOOL_NAMES = [
  "list_workspace_files",
  "search_workspace_files",
  "read_workspace_file",
  "write_workspace_file",
  "edit_workspace_file",
  "move_workspace_file",
  "delete_workspace_file",
  "share_workspace_file",
] as const;

const PATH_PARAMETER = {
  type: "string",
  minLength: 1,
  maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
  description: `Path relative to the workspace root, e.g. "notes.md" or "${WORKSPACE_UPLOADS_DIRECTORY}/data.csv".`,
} as const;

const asRecord = (args: unknown): Record<string, unknown> =>
  args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};

/** Built-in tool results use `recoverable` so the model can retry after a fix. */
const toToolResult = <T>(result: WorkspaceResult<T>): unknown =>
  result.ok
    ? { ok: true, ...result.value }
    : { error: { ...result.error, recoverable: true } };

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function createWorkspaceBindings(): BuiltinToolBinding[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "list_workspace_files",
          description:
            "List the files in this conversation's workspace, with their sizes. Call this before assuming a file does or does not exist.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: {
                type: "string",
                maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
                description:
                  "Optional directory prefix to list. Omit to list the whole workspace.",
              },
            },
          },
        },
      },
      risk: "read",
      displayKey: "listWorkspaceFiles",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await listWorkspace(
          context.sessionId,
          typeof input.path === "string" ? input.path : undefined,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "search_workspace_files",
          description:
            "Find which workspace text files contain a phrase, and on which lines. Use this to locate content instead of reading whole files. The query is matched as literal text, not a regular expression.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: {
                type: "string",
                minLength: 1,
                maxLength: 500,
                description: "The literal text to look for.",
              },
              path: {
                type: "string",
                maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
                description:
                  "Optional directory prefix to restrict the search to.",
              },
              caseSensitive: { type: "boolean", default: false },
              maxResults: {
                type: "integer",
                minimum: 1,
                maximum: AGENT_WORKSPACE_LIMITS.maxSearchMatches,
                description: `Maximum matching lines to return (default ${AGENT_WORKSPACE_LIMITS.maxSearchMatches}).`,
              },
            },
            required: ["query"],
          },
        },
      },
      risk: "read",
      displayKey: "searchWorkspaceFiles",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await searchWorkspace(
          context.sessionId,
          typeof input.query === "string" ? input.query : "",
          {
            path: typeof input.path === "string" ? input.path : undefined,
            caseSensitive: input.caseSensitive === true,
            maxResults: readNumber(input.maxResults),
          },
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "read_workspace_file",
          description:
            "Read a text file from the workspace. Use offset and limit to page through a large file instead of reading it whole.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              offset: {
                type: "integer",
                minimum: 0,
                description: "Zero-based line to start reading from.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                description: "Number of lines to read.",
              },
            },
            required: ["path"],
          },
        },
      },
      risk: "read",
      displayKey: "readWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await readWorkspaceText(context.sessionId, input.path, {
          offset: readNumber(input.offset),
          limit: readNumber(input.limit),
        });
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "write_workspace_file",
          description:
            "Write a text file to the workspace. Prefer edit_workspace_file when changing part of an existing file.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              content: {
                type: "string",
                description: "The full file content to write.",
              },
              mode: {
                type: "string",
                enum: ["create", "overwrite", "append"],
                default: "overwrite",
                description:
                  '"create" fails if the file already exists; "append" adds to the end.',
              },
            },
            required: ["path", "content"],
          },
        },
      },
      risk: "read",
      displayKey: "writeWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        if (typeof input.content !== "string") {
          return {
            error: {
              code: "WORKSPACE_WRITE_FAILED",
              message: "content must be a string.",
              recoverable: true,
            },
          };
        }
        const mode =
          input.mode === "create" || input.mode === "append"
            ? (input.mode as WorkspaceWriteMode)
            : "overwrite";
        const result = await writeWorkspaceText(
          context.sessionId,
          input.path,
          input.content,
          mode,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "edit_workspace_file",
          description:
            "Replace an exact string in a workspace text file. oldString must match the file's current text exactly and uniquely, unless replaceAll is true.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              oldString: {
                type: "string",
                minLength: 1,
                description: "The exact text to replace.",
              },
              newString: {
                type: "string",
                description: "The replacement text.",
              },
              replaceAll: { type: "boolean", default: false },
            },
            required: ["path", "oldString", "newString"],
          },
        },
      },
      risk: "read",
      displayKey: "editWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        if (
          typeof input.oldString !== "string" ||
          typeof input.newString !== "string"
        ) {
          return {
            error: {
              code: "WORKSPACE_WRITE_FAILED",
              message: "oldString and newString must both be strings.",
              recoverable: true,
            },
          };
        }
        const result = await editWorkspaceFile(
          context.sessionId,
          input.path,
          input.oldString,
          input.newString,
          input.replaceAll === true,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "move_workspace_file",
          description:
            "Move or rename a file within the workspace. Works for binary files as well as text, and does not change how much of the workspace quota is used.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: PATH_PARAMETER,
              to: PATH_PARAMETER,
              overwrite: {
                type: "boolean",
                default: false,
                description:
                  "Replace the destination if it already exists. Defaults to false.",
              },
            },
            required: ["from", "to"],
          },
        },
      },
      risk: "read",
      displayKey: "moveWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await moveWorkspaceFile(
          context.sessionId,
          input.from,
          input.to,
          input.overwrite === true,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "delete_workspace_file",
          description:
            "Delete a file from this conversation's workspace. Only affects workspace scratch files.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { path: PATH_PARAMETER },
            required: ["path"],
          },
        },
      },
      risk: "read",
      displayKey: "deleteWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const result = await deleteWorkspaceFile(
          context.sessionId,
          asRecord(args).path,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "share_workspace_file",
          description:
            "Show a workspace file to the user as a viewable, downloadable card in the conversation. Use this for every file that is part of your answer — the user cannot see workspace files otherwise.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              title: {
                type: "string",
                maxLength: 180,
                description:
                  "Optional display title. Defaults to the file name.",
              },
            },
            required: ["path"],
          },
        },
      },
      risk: "read",
      displayKey: "shareWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await getWorkspaceFileEntry(
          context.sessionId,
          input.path,
        );
        if (!result.ok) return toToolResult(result);

        if (!context.emit.workspaceFile) {
          return {
            error: {
              code: "WORKSPACE_SHARE_UNAVAILABLE",
              message: "File sharing is unavailable for this request.",
              recoverable: true,
            },
          };
        }

        const title =
          typeof input.title === "string" && input.title.trim()
            ? input.title.trim().slice(0, 180)
            : undefined;
        context.emit.workspaceFile({
          ...result.value,
          revision: uuidv7(),
          title,
        });
        context.signal?.throwIfAborted();
        return { ok: true, path: result.value.path, shared: true };
      },
    },
  ];
}
