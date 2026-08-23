import { AGENT_ARCHIVE_LIMITS, AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import type { WorkspaceResult } from "@/lib/agent/workspace";
import { createSessionArchive } from "@/services/workspace/sessionArchive";

import type { BuiltinToolBinding } from "./types";

const asRecord = (args: unknown): Record<string, unknown> =>
  args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};

const toToolResult = <T>(result: WorkspaceResult<T>): unknown =>
  result.ok
    ? { ok: true, ...result.value }
    : { error: { ...result.error, recoverable: true } };

export function createArchiveBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "create_archive",
        description:
          "Bundle several workspace files into a single zip archive and show it to the user as a download. Use this instead of sharing many files one by one. The archive does not count against the workspace quota.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            paths: {
              type: "array",
              minItems: 1,
              maxItems: AGENT_ARCHIVE_LIMITS.maxEntries,
              items: {
                type: "string",
                minLength: 1,
                maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
              },
              description: "Workspace file paths to include in the archive.",
            },
            archiveName: {
              type: "string",
              maxLength: AGENT_ARCHIVE_LIMITS.maxArchiveNameChars,
              description:
                'Optional archive file name without the extension, e.g. "report-bundle".',
            },
            title: {
              type: "string",
              maxLength: 180,
              description:
                "Optional display title for the download card. Defaults to the file name.",
            },
          },
          required: ["paths"],
        },
      },
    },
    risk: "read",
    displayKey: "createArchive",
    agentOnly: true,
    executionGroup: "workspace",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input = asRecord(args);

      if (!Array.isArray(input.paths)) {
        return {
          error: {
            code: "WORKSPACE_INVALID_PATH",
            message: "paths must be an array of workspace file paths.",
            recoverable: true,
          },
        };
      }

      // The card is the only way the user ever sees the archive, so refuse
      // before doing the work rather than zipping into nothing.
      if (!context.emit.archiveFile) {
        return {
          error: {
            code: "WORKSPACE_SHARE_UNAVAILABLE",
            message: "Archive downloads are unavailable for this request.",
            recoverable: true,
          },
        };
      }

      const result = await createSessionArchive(
        context.sessionId,
        input.paths,
        input.archiveName,
      );
      if (!result.ok) return toToolResult(result);

      const title =
        typeof input.title === "string" && input.title.trim()
          ? input.title.trim().slice(0, 180)
          : undefined;
      context.emit.archiveFile({ ...result.value, title });
      context.signal?.throwIfAborted();

      return {
        ok: true,
        fileName: result.value.fileName,
        bytes: result.value.bytes,
        entryCount: result.value.entryCount,
        shared: true,
      };
    },
  };
}
