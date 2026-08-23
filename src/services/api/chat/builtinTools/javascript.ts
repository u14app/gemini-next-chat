import {
  AGENT_WORKSPACE_LIMITS,
  BROWSER_SANDBOX_LIMITS,
} from "@/config/limits";
import { isTextWorkspaceFile } from "@/lib/agent/workspace";
import { runInSandbox } from "@/utils/sandbox";
import {
  readWorkspaceBlob,
  writeWorkspaceText,
} from "@/services/workspace/sessionWorkspace";

import type { BuiltinToolBinding, BuiltinToolContext } from "./types";

function errorResult(code: string, message: string) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      recoverable: true,
    },
  };
}

function boundOutput(output: string): string {
  if (output.length <= BROWSER_SANDBOX_LIMITS.maxOutputChars) return output;
  const notice = "\n[Output truncated to the browser sandbox limit.]";
  return (
    output.slice(
      0,
      Math.max(0, BROWSER_SANDBOX_LIMITS.maxOutputChars - notice.length),
    ) + notice
  );
}

interface LoadedFiles {
  files: Record<string, string>;
  error?: { code: string; message: string };
}

/**
 * Loads the requested workspace files on the host side. The sandbox has no
 * storage access of its own, so this is the only way content reaches it.
 */
async function loadRequestedFiles(
  paths: string[],
  context: BuiltinToolContext,
): Promise<LoadedFiles> {
  if (paths.length > AGENT_WORKSPACE_LIMITS.maxSandboxReadFiles) {
    return {
      files: {},
      error: {
        code: "JAVASCRIPT_TOO_MANY_FILES",
        message: `readFiles accepts at most ${AGENT_WORKSPACE_LIMITS.maxSandboxReadFiles} files per run.`,
      },
    };
  }

  const files: Record<string, string> = {};
  let totalChars = 0;

  for (const path of paths) {
    const result = await readWorkspaceBlob(context.sessionId, path);
    if (!result.ok) {
      return { files: {}, error: result.error };
    }
    if (!isTextWorkspaceFile(result.value.entry.path)) {
      return {
        files: {},
        error: {
          code: "WORKSPACE_READ_FAILED",
          message: `"${result.value.entry.path}" is not a text file and cannot be loaded into the JavaScript sandbox.`,
        },
      };
    }

    let content: string;
    try {
      content = await result.value.blob.text();
    } catch (error) {
      return {
        files: {},
        error: {
          code: "WORKSPACE_READ_FAILED",
          message:
            error instanceof Error ? error.message : "Failed to read the file.",
        },
      };
    }
    context.signal?.throwIfAborted();

    totalChars += content.length;
    if (totalChars > AGENT_WORKSPACE_LIMITS.maxSandboxFileChars) {
      return {
        files: {},
        error: {
          code: "JAVASCRIPT_FILES_TOO_LARGE",
          message: `readFiles may load at most ${AGENT_WORKSPACE_LIMITS.maxSandboxFileChars} characters in total. Read the file in ranges instead.`,
        },
      };
    }
    files[result.value.entry.path] = content;
  }

  return { files };
}

export function createJavaScriptBinding({
  workspaceEnabled = true,
}: { workspaceEnabled?: boolean } = {}): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "run_javascript",
        description: workspaceEnabled
          ? "Run bounded synchronous JavaScript in an isolated browser sandbox. The sandbox has no network, DOM, storage, imports, or external libraries. Workspace files named in readFiles are exposed as the `files` object (path to text); when writeFiles is true, call writeFile(path, content) to save results back to the workspace."
          : "Run bounded synchronous JavaScript in an isolated browser sandbox. The sandbox has no network, DOM, storage, imports, external libraries, or workspace access in this browser.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: {
              type: "string",
              minLength: 1,
              maxLength: BROWSER_SANDBOX_LIMITS.maxCodeChars,
              description:
                "Synchronous JavaScript. Use console.log or a return value for output.",
            },
            ...(workspaceEnabled
              ? {
                  readFiles: {
                    type: "array",
                    maxItems: AGENT_WORKSPACE_LIMITS.maxSandboxReadFiles,
                    items: { type: "string", minLength: 1 },
                    description:
                      "Workspace text files to load into the `files` object before running.",
                  },
                  writeFiles: {
                    type: "boolean",
                    default: false,
                    description:
                      "Enables writeFile(path, content) so the run can save files to the workspace.",
                  },
                  expectedRevisions: {
                    type: "object",
                    maxProperties: AGENT_WORKSPACE_LIMITS.maxSandboxWriteFiles,
                    additionalProperties: {
                      type: "string",
                      minLength: 1,
                      maxLength: 256,
                    },
                    description:
                      "Map each existing output path to the revision previously read. Paths omitted here are created and fail if they already exist.",
                  },
                }
              : {}),
          },
          required: ["code"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_read"],
      idempotency: "idempotent",
      sensitivity: "none",
      origin: "builtin",
    },
    resolveInvocationPolicy(args, descriptor) {
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const readsWorkspace =
        workspaceEnabled &&
        Array.isArray(input.readFiles) &&
        input.readFiles.length > 0;
      const writesWorkspace = workspaceEnabled && input.writeFiles === true;
      return {
        effects: writesWorkspace
          ? [
              ...(readsWorkspace ? (["local_read"] as const) : []),
              "local_write",
            ]
          : descriptor.effects,
        idempotency: writesWorkspace ? "unknown" : descriptor.idempotency,
        sensitivity: readsWorkspace ? "user_data" : descriptor.sensitivity,
        origin: descriptor.origin,
      };
    },
    displayKey: "javascript",
    agentOnly: true,
    executionGroup: "workspace",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!code) {
        return errorResult(
          "JAVASCRIPT_INVALID_CODE",
          "run_javascript requires non-empty JavaScript code.",
        );
      }
      if (code.length > BROWSER_SANDBOX_LIMITS.maxCodeChars) {
        return errorResult(
          "JAVASCRIPT_CODE_TOO_LARGE",
          "JavaScript code exceeds the browser sandbox limit.",
        );
      }

      const requestedPaths = Array.isArray(input.readFiles)
        ? input.readFiles.filter(
            (path): path is string => typeof path === "string",
          )
        : [];
      const captureFiles = input.writeFiles === true;
      const expectedRevisions =
        input.expectedRevisions &&
        typeof input.expectedRevisions === "object" &&
        !Array.isArray(input.expectedRevisions)
          ? (input.expectedRevisions as Record<string, unknown>)
          : {};

      const loaded = await loadRequestedFiles(requestedPaths, context);
      if (loaded.error) {
        return errorResult(loaded.error.code, loaded.error.message);
      }
      context.signal?.throwIfAborted();

      try {
        const run = await runInSandbox(code, context.signal, {
          files: loaded.files,
          captureFiles,
        });
        const output = boundOutput(run.output);
        context.signal?.throwIfAborted();
        if (/(^|\n)Error:/.test(output)) {
          return errorResult("JAVASCRIPT_EXECUTION_FAILED", output);
        }

        // Only commit files after a clean run, so a failed script leaves the
        // workspace untouched.
        const writtenPaths: string[] = [];
        const writeErrors: string[] = [];
        if (captureFiles) {
          for (const [path, content] of Object.entries(run.files)) {
            const expectedRevision =
              typeof expectedRevisions[path] === "string"
                ? String(expectedRevisions[path])
                : undefined;
            const written = await writeWorkspaceText(
              context.sessionId,
              path,
              content,
              expectedRevision ? "overwrite" : "create",
              { expectedRevision },
            );
            if (written.ok) {
              writtenPaths.push(written.value.path);
            } else {
              writeErrors.push(`${path}: ${written.error.message}`);
            }
          }
        }

        return {
          output,
          ...(writtenPaths.length ? { writtenFiles: writtenPaths } : {}),
          ...(writeErrors.length ? { writeErrors } : {}),
        };
      } catch (error) {
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        return errorResult(
          "JAVASCRIPT_EXECUTION_FAILED",
          error instanceof Error
            ? error.message
            : "JavaScript execution failed.",
        );
      }
    },
  };
}
