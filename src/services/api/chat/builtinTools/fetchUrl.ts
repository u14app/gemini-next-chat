import {
  AGENT_FETCH_URL_LIMITS,
  AGENT_WORKSPACE_LIMITS,
} from "@/config/limits";
import { signedApiFetch } from "@/lib/api/client";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";

import type { BuiltinToolBinding } from "./types";

/** Head of the page returned alongside a saved file, so the model can confirm it fetched the right thing without the full body entering the transcript. */
const SAVED_EXCERPT_CHARS = 1_000;

interface FetchUrlResponse {
  url: string;
  title?: string;
  content: string;
  truncated: boolean;
  contentType: string;
}

function errorResult(code: string, message: string) {
  return { error: { code, message, recoverable: true } };
}

export function createFetchUrlBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "fetch_url",
        description:
          "Fetch a single public web page or plain-text document and return its readable text. Use this when you need the actual contents of a specific URL rather than search snippets. Private, local, and non-HTTP addresses are refused.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: {
              type: "string",
              maxLength: 2_048,
              description: "Absolute http(s) URL of the page to read.",
            },
            saveToPath: {
              type: "string",
              maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
              description:
                'Optional workspace path, e.g. "sources/page.md". When set, the page text is written there and only a short excerpt is returned, which keeps a long page out of the conversation.',
            },
          },
          required: ["url"],
        },
      },
    },
    risk: "read",
    displayKey: "fetchUrl",
    agentOnly: true,
    executionGroup: "workspace",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const url = typeof input.url === "string" ? input.url.trim() : "";

      if (!url) {
        return errorResult(
          "FETCH_URL_INVALID",
          "Provide an absolute http(s) URL to fetch.",
        );
      }

      let response: Response;
      try {
        response = await signedApiFetch("/api/agents/fetch-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: context.signal,
        });
      } catch (error) {
        if (context.signal?.aborted) throw error;
        return errorResult(
          "FETCH_URL_FAILED",
          error instanceof Error ? error.message : "The request failed.",
        );
      }

      if (!response.ok) {
        return errorResult(
          "FETCH_URL_FAILED",
          `Could not read ${url} (HTTP ${response.status}). The address may be unreachable or blocked.`,
        );
      }

      const data = (await response.json()) as FetchUrlResponse;
      const saveToPath =
        typeof input.saveToPath === "string" && input.saveToPath.trim()
          ? input.saveToPath.trim()
          : undefined;

      if (saveToPath) {
        const written = await writeWorkspaceText(
          context.sessionId,
          saveToPath,
          data.content,
          "overwrite",
        );
        if (!written.ok) {
          return errorResult(written.error.code, written.error.message);
        }

        return {
          ok: true,
          url: data.url,
          ...(data.title ? { title: data.title } : {}),
          savedTo: written.value.path,
          bytes: written.value.bytes,
          truncated: data.truncated,
          excerpt: data.content.slice(0, SAVED_EXCERPT_CHARS),
        };
      }

      return {
        ok: true,
        url: data.url,
        ...(data.title ? { title: data.title } : {}),
        content: data.content,
        truncated: data.truncated,
        ...(data.truncated
          ? {
              note: `Only the first ${AGENT_FETCH_URL_LIMITS.maxContentChars} characters are shown.`,
            }
          : {}),
      };
    },
  };
}
