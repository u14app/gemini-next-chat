import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import {
  createEvidenceSource,
  getEvidenceMetadata,
} from "@/lib/agent/evidence";
import {
  WORKSPACE_UPLOADS_DIRECTORY,
  type WorkspaceResult,
} from "@/lib/agent/workspace";
import {
  deleteWorkspaceFile,
  applyWorkspacePatches,
  getWorkspaceFileEntry,
  editWorkspaceFile,
  listWorkspace,
  moveWorkspaceFile,
  readWorkspaceText,
  searchWorkspace,
  writeWorkspaceText,
  type WorkspaceWriteMode,
} from "@/services/workspace/sessionWorkspace";
import { publishWorkspaceArtifact } from "@/services/workspace/sessionArtifact";
import {
  diffWorkspaceFile,
  validateWorkspaceFile,
} from "@/services/workspace/workspaceInspection";
import {
  restoreWorkspaceFile,
  trashWorkspaceFile,
} from "@/services/workspace/workspaceTrash";

import type { BuiltinToolBinding, BuiltinToolContext } from "./types";

export const WORKSPACE_TOOL_NAMES = [
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
] as const;

const PATH_PARAMETER = {
  type: "string",
  minLength: 1,
  maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
  description: `Path relative to the workspace root, e.g. "notes.md" or "${WORKSPACE_UPLOADS_DIRECTORY}/data.csv".`,
} as const;

const EXPECTED_REVISION_PARAMETER = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  description:
    "Optional revision returned by a prior list or read. The operation fails instead of overwriting newer content when it no longer matches.",
} as const;

const asRecord = (args: unknown): Record<string, unknown> =>
  args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};

const normalizeScopedWorkspacePath = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/^\.?\/+|\/+$/g, "") : "";

function isWorkspacePathInScope(
  context: BuiltinToolContext,
  value: unknown,
): boolean {
  if (!context.workspaceReadScope) return true;
  const path = normalizeScopedWorkspacePath(value);
  return Boolean(
    path &&
    (context.workspaceReadScope.includes(path) ||
      context.workspaceInternalReadScope?.has(path)),
  );
}

function isInternalWorkspaceResult(
  context: BuiltinToolContext,
  value: unknown,
): boolean {
  const path = normalizeScopedWorkspacePath(value);
  return Boolean(path && context.workspaceInternalReadScope?.has(path));
}

function workspaceScopeError() {
  return {
    ok: false as const,
    error: {
      code: "WORKSPACE_SCOPE_DENIED",
      message: "The requested file is outside the approved workspace scope.",
      recoverable: true,
    },
  };
}

/** Built-in tool results use `recoverable` so the model can retry after a fix. */
const toToolResult = <T>(result: WorkspaceResult<T>): unknown =>
  result.ok
    ? { ok: true, ...result.value }
    : { ok: false, error: { ...result.error, recoverable: true } };

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

async function publishAndEmitArtifact(
  input: Record<string, unknown>,
  context: BuiltinToolContext,
) {
  if (!context.emit.workspaceFile) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_SHARE_UNAVAILABLE",
        message: "Artifact publishing is unavailable for this request.",
        recoverable: true,
      },
    };
  }
  const result = await publishWorkspaceArtifact(context.sessionId, input.path);
  if (!result.ok) return toToolResult(result);
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 180)
      : undefined;
  context.emit.workspaceFile({
    path: result.value.sourcePath,
    url: result.value.url,
    fileName: result.value.fileName,
    mimeType: result.value.mimeType,
    bytes: result.value.bytes,
    revision: result.value.revision,
    title,
  });
  context.signal?.throwIfAborted();
  return {
    ok: true,
    path: result.value.sourcePath,
    url: result.value.url,
    contentHash: result.value.contentHash,
    revision: result.value.revision,
    published: true,
    shared: true,
  };
}

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
      descriptor: {
        version: 2,
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
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
        if (result.ok && context.workspaceReadScope) {
          const allowed = new Set(context.workspaceReadScope);
          const requestedPrefix = normalizeScopedWorkspacePath(input.path);
          const expectedPaths = context.workspaceReadScope.filter(
            (path) =>
              !requestedPrefix ||
              path === requestedPrefix ||
              path.startsWith(`${requestedPrefix}/`),
          );
          const files = result.value.files.filter((file) =>
            allowed.has(file.path),
          );
          return {
            ok: true,
            ...result.value,
            files,
            truncated: files.length < expectedPaths.length,
            usage: {
              ...result.value.usage,
              fileCount: files.length,
              totalBytes: files.reduce((total, file) => total + file.bytes, 0),
              trashedFileCount: files.filter((file) =>
                file.path.startsWith("trash/"),
              ).length,
            },
          };
        }
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "stat_workspace_file",
          description:
            "Read workspace file metadata without loading its content, including MIME type, size, content hash, revision, source, and update time.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { path: PATH_PARAMETER },
            required: ["path"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "statWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        if (!isWorkspacePathInScope(context, asRecord(args).path)) {
          return workspaceScopeError();
        }
        const result = await getWorkspaceFileEntry(
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
          name: "diff_workspace_file",
          description:
            "Compare a workspace text file with another workspace file or proposed full content. Returns a bounded diff and both revisions.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              comparePath: PATH_PARAMETER,
              proposedContent: { type: "string" },
            },
            required: ["path"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "diffWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await diffWorkspaceFile(context.sessionId, input.path, {
          comparePath: input.comparePath,
          proposedContent:
            typeof input.proposedContent === "string"
              ? input.proposedContent
              : undefined,
        });
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
      descriptor: {
        version: 2,
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
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
            ...(context.workspaceReadScope
              ? { allowedPaths: context.workspaceReadScope }
              : {}),
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
      descriptor: {
        version: 2,
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "readWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const internalResult = isInternalWorkspaceResult(context, input.path);
        if (!isWorkspacePathInScope(context, input.path)) {
          return workspaceScopeError();
        }
        const result = await readWorkspaceText(context.sessionId, input.path, {
          offset: readNumber(input.offset),
          limit: readNumber(input.limit),
        });
        context.signal?.throwIfAborted();
        if (!result.ok) return toToolResult(result);
        if (internalResult) {
          return { ok: true, ...result.value };
        }
        const evidence = await createEvidenceSource(
          {
            title: result.value.path,
            url: `workspace:///${result.value.path
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`,
            content: result.value.content,
          },
          { kind: "attachment" },
        );
        const metadata = getEvidenceMetadata(evidence)!;
        return {
          ok: true,
          ...result.value,
          sourceId: metadata.sourceId,
          retrievedAt: metadata.retrievedAt,
          evidenceContentHash: metadata.contentHash,
          evidence: {
            title: evidence.title,
            url: evidence.url,
            metadata: evidence.metadata,
          },
        };
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
              expectedRevision: EXPECTED_REVISION_PARAMETER,
            },
            required: ["path", "content"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      resolveInvocationPolicy(args, descriptor) {
        const input = asRecord(args);
        const mode =
          input.mode === "create" || input.mode === "append"
            ? input.mode
            : "overwrite";
        return {
          effects: descriptor.effects,
          idempotency:
            mode === "append" ? "non_idempotent" : descriptor.idempotency,
          sensitivity: descriptor.sensitivity,
          origin: descriptor.origin,
        };
      },
      displayKey: "writeWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        if (typeof input.content !== "string") {
          return {
            ok: false,
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
        const expectedRevision =
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined;
        if (mode !== "create" && !expectedRevision) {
          const current = await getWorkspaceFileEntry(
            context.sessionId,
            input.path,
          );
          if (current.ok) {
            return {
              ok: false,
              error: {
                code: "WORKSPACE_REVISION_REQUIRED",
                message: `"${current.value.path}" already exists. Retry with expectedRevision ${current.value.revision}.`,
                recoverable: true,
                latestRevision: current.value.revision,
              },
            };
          }
          if (current.error.code !== "WORKSPACE_FILE_NOT_FOUND") {
            return toToolResult(current);
          }
        }
        const result = await writeWorkspaceText(
          context.sessionId,
          input.path,
          input.content,
          mode,
          {
            expectedRevision,
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
              expectedRevision: EXPECTED_REVISION_PARAMETER,
            },
            required: ["path", "oldString", "newString"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
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
            ok: false,
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
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "apply_workspace_patch",
          description:
            "Atomically apply 1-50 exact text replacements to one workspace file. expectedRevision is required so a stale patch never overwrites newer content.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              expectedRevision: EXPECTED_REVISION_PARAMETER,
              patches: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    oldString: { type: "string", minLength: 1 },
                    newString: { type: "string" },
                    replaceAll: { type: "boolean", default: false },
                  },
                  required: ["oldString", "newString"],
                },
              },
            },
            required: ["path", "expectedRevision", "patches"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "applyWorkspacePatch",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const patches = Array.isArray(input.patches)
          ? input.patches.flatMap((value) => {
              const patch = asRecord(value);
              return typeof patch.oldString === "string" &&
                typeof patch.newString === "string"
                ? [
                    {
                      oldString: patch.oldString,
                      newString: patch.newString,
                      replaceAll: patch.replaceAll === true,
                    },
                  ]
                : [];
            })
          : [];
        const result = await applyWorkspacePatches(
          context.sessionId,
          input.path,
          patches,
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined,
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
              expectedRevision: {
                ...EXPECTED_REVISION_PARAMETER,
                description:
                  "Optional revision of the source file returned by a prior list or read.",
              },
            },
            required: ["from", "to"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      resolveInvocationPolicy(args, descriptor) {
        return {
          effects: descriptor.effects,
          idempotency: descriptor.idempotency,
          sensitivity: descriptor.sensitivity,
          origin: descriptor.origin,
        };
      },
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
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "trash_workspace_file",
          description:
            "Move a workspace scratch file to the recoverable trash. Prefer this over permanent deletion.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              expectedRevision: EXPECTED_REVISION_PARAMETER,
            },
            required: ["path", "expectedRevision"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "non_idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "trashWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await trashWorkspaceFile(
          context.sessionId,
          input.path,
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "restore_workspace_file",
          description:
            "Restore a file from workspace trash to an unoccupied destination path.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              trashPath: PATH_PARAMETER,
              destinationPath: PATH_PARAMETER,
              expectedRevision: EXPECTED_REVISION_PARAMETER,
            },
            required: ["trashPath", "destinationPath", "expectedRevision"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "restoreWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await restoreWorkspaceFile(
          context.sessionId,
          input.trashPath,
          input.destinationPath,
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined,
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
            "Permanently delete a workspace scratch or trash file. This is irreversible and always requires one-time confirmation; prefer trash_workspace_file.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              expectedRevision: EXPECTED_REVISION_PARAMETER,
            },
            required: ["path"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_destructive"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "deleteWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = asRecord(args);
        const result = await deleteWorkspaceFile(
          context.sessionId,
          input.path,
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined,
        );
        context.signal?.throwIfAborted();
        return toToolResult(result);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "validate_workspace_file",
          description:
            "Validate a workspace file against its format when supported (JSON, JSONL, CSV, common text, or binary metadata).",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { path: PATH_PARAMETER },
            required: ["path"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_read"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "validateWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const result = await validateWorkspaceFile(
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
          name: "publish_artifact",
          description:
            "Publish the current workspace file revision as a content-addressed immutable Artifact and show it to the user.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH_PARAMETER,
              title: { type: "string", maxLength: 180 },
            },
            required: ["path"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "publishArtifact",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        return publishAndEmitArtifact(asRecord(args), context);
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
      descriptor: {
        version: 2,
        effects: ["local_write"],
        idempotency: "non_idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "shareWorkspaceFile",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        return publishAndEmitArtifact(asRecord(args), context);
      },
    },
  ];
}
