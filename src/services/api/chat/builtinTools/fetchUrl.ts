import {
  AGENT_FETCH_URL_LIMITS,
  AGENT_WORKSPACE_LIMITS,
} from "@/config/limits";
import { signedApiFetch } from "@/lib/api/client";
import { getToolArgumentSensitivity } from "@/lib/plugin/risk";
import {
  createEvidenceSource,
  getEvidenceMetadata,
} from "@/lib/agent/evidence";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";

import {
  consumeBuiltinResearchSourceBodies,
  type BuiltinResearchSourceBudget,
  type BuiltinToolBinding,
} from "./types";

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
  return { ok: false as const, error: { code, message, recoverable: true } };
}

async function fetchReadableUrl(
  url: string,
  signal?: AbortSignal,
): Promise<FetchUrlResponse> {
  const response = await signedApiFetch("/api/agents/fetch-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!response.ok) {
    let detail = "The address may be unreachable or blocked.";
    try {
      const value: unknown = await response.json();
      if (value && typeof value === "object") {
        const error = (value as { error?: unknown }).error;
        if (typeof error === "string" && error.trim()) {
          detail = error.slice(0, 2_000);
        } else if (error && typeof error === "object") {
          const record = error as { code?: unknown; message?: unknown };
          if (typeof record.message === "string" && record.message.trim()) {
            detail =
              `${typeof record.code === "string" ? `${record.code}: ` : ""}${record.message}`.slice(
                0,
                2_000,
              );
          }
        }
      }
    } catch {
      // Non-JSON error pages still retain the reader endpoint's HTTP status.
    }
    throw new Error(
      `Could not read ${url} (HTTP ${response.status}). ${detail}`,
    );
  }
  return (await response.json()) as FetchUrlResponse;
}

export function createFetchUrlBinding({
  workspaceEnabled = true,
  sourceBudget,
}: {
  workspaceEnabled?: boolean;
  sourceBudget?: BuiltinResearchSourceBudget;
} = {}): BuiltinToolBinding {
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
            ...(workspaceEnabled
              ? {
                  saveToPath: {
                    type: "string",
                    maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
                    description:
                      'Optional workspace path, e.g. "sources/page.md". When set, the page text is written there and only a short excerpt is returned, which keeps a long page out of the conversation.',
                  },
                  expectedRevision: {
                    type: "string",
                    minLength: 1,
                    maxLength: 256,
                    description:
                      "Required to replace an existing destination. Omit to create a new file and fail if it already exists.",
                  },
                }
              : {}),
          },
          required: ["url"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    resolveInvocationPolicy(args, descriptor) {
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const savesToWorkspace =
        workspaceEnabled &&
        typeof input.saveToPath === "string" &&
        input.saveToPath.trim() !== "";
      return {
        effects: savesToWorkspace
          ? ["network_read", "local_write"]
          : descriptor.effects,
        idempotency: descriptor.idempotency,
        sensitivity: getToolArgumentSensitivity(args),
        origin: descriptor.origin,
      };
    },
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
      if (!consumeBuiltinResearchSourceBodies(sourceBudget, [url])) {
        return errorResult(
          "RESEARCH_SOURCE_BUDGET_EXHAUSTED",
          "The approved full-source reading budget is exhausted.",
        );
      }

      let data: FetchUrlResponse;
      try {
        data = await fetchReadableUrl(url, context.signal);
      } catch (error) {
        if (context.signal?.aborted) throw error;
        return errorResult(
          "FETCH_URL_FAILED",
          error instanceof Error ? error.message : "The request failed.",
        );
      }

      const evidence = await createEvidenceSource(
        {
          url: data.url,
          title: data.title || data.url,
          content: data.content,
        },
        { kind: "fetch" },
      );
      const evidenceMetadata = getEvidenceMetadata(evidence)!;
      const saveToPath =
        typeof input.saveToPath === "string" && input.saveToPath.trim()
          ? input.saveToPath.trim()
          : undefined;

      if (saveToPath) {
        const expectedRevision =
          typeof input.expectedRevision === "string"
            ? input.expectedRevision
            : undefined;
        const written = await writeWorkspaceText(
          context.sessionId,
          saveToPath,
          data.content,
          expectedRevision ? "overwrite" : "create",
          { expectedRevision },
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
          sourceId: evidenceMetadata.sourceId,
          retrievedAt: evidenceMetadata.retrievedAt,
          contentHash: evidenceMetadata.contentHash,
        };
      }

      return {
        ok: true,
        url: data.url,
        ...(data.title ? { title: data.title } : {}),
        content: data.content,
        sourceId: evidenceMetadata.sourceId,
        retrievedAt: evidenceMetadata.retrievedAt,
        contentHash: evidenceMetadata.contentHash,
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

export function createFetchUrlsBinding({
  workspaceEnabled = true,
  sourceBudget,
}: {
  workspaceEnabled?: boolean;
  sourceBudget?: BuiltinResearchSourceBudget;
} = {}): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "fetch_urls",
        description:
          "Fetch up to six public URLs with bounded concurrency. Each successful result includes a stable source ID, retrieval time, and content hash for evidence tracking.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            urls: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 2_048 },
            },
            ...(workspaceEnabled
              ? {
                  save_to_directory: {
                    type: "string",
                    maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
                    description:
                      "Optional workspace directory. When provided, each full page is saved and only excerpts enter model context.",
                  },
                }
              : {}),
          },
          required: ["urls"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    resolveInvocationPolicy(args, descriptor) {
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      return {
        effects:
          workspaceEnabled &&
          typeof input.save_to_directory === "string" &&
          input.save_to_directory.trim()
            ? ["network_read", "local_write"]
            : descriptor.effects,
        idempotency: descriptor.idempotency,
        sensitivity: getToolArgumentSensitivity(args),
        origin: descriptor.origin,
      };
    },
    displayKey: "fetchUrls",
    agentOnly: true,
    executionGroup: "workspace",
    async execute(args, context) {
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const urls = Array.isArray(input.urls)
        ? [
            ...new Set(
              input.urls
                .filter((url): url is string => typeof url === "string")
                .map((url) => url.trim())
                .filter(Boolean),
            ),
          ].slice(0, 6)
        : [];
      if (urls.length === 0) {
        return errorResult(
          "FETCH_URL_INVALID",
          "fetch_urls requires between one and six URLs.",
        );
      }
      if (!consumeBuiltinResearchSourceBodies(sourceBudget, urls)) {
        return errorResult(
          "RESEARCH_SOURCE_BUDGET_EXHAUSTED",
          "The approved full-source reading budget is exhausted.",
        );
      }
      const directory =
        typeof input.save_to_directory === "string" &&
        input.save_to_directory.trim()
          ? input.save_to_directory.trim().replace(/\/+$/, "")
          : undefined;
      context.emit.search?.({ phase: "start" });
      const results = await mapWithConcurrency(urls, 3, async (url, index) => {
        try {
          const data = await fetchReadableUrl(url, context.signal);
          const evidence = await createEvidenceSource(
            {
              url: data.url,
              title: data.title || data.url,
              content: data.content,
            },
            { kind: "fetch" },
          );
          const metadata = getEvidenceMetadata(evidence)!;
          let savedTo: string | undefined;
          if (directory) {
            const written = await writeWorkspaceText(
              context.sessionId,
              `${directory}/${String(index + 1).padStart(2, "0")}.md`,
              data.content,
              "create",
            );
            if (!written.ok) throw new Error(written.error.message);
            savedTo = written.value.path;
          }
          return {
            ok: true as const,
            url: data.url,
            title: data.title,
            sourceId: metadata.sourceId,
            retrievedAt: metadata.retrievedAt,
            contentHash: metadata.contentHash,
            truncated: data.truncated,
            ...(savedTo
              ? {
                  savedTo,
                  excerpt: data.content.slice(0, SAVED_EXCERPT_CHARS),
                }
              : { content: data.content }),
            evidence,
          };
        } catch (error) {
          if (context.signal?.aborted) throw error;
          return {
            ok: false as const,
            url,
            error:
              error instanceof Error ? error.message : "The request failed.",
          };
        }
      });
      const sources = results.flatMap((result) =>
        result.ok && "evidence" in result ? [result.evidence] : [],
      );
      context.emit.search?.({ phase: "complete", sources, images: [] });
      return {
        ...(sources.length === 0
          ? errorResult(
              "FETCH_URLS_FAILED",
              results
                .flatMap((result) => (!result.ok ? [result.error] : []))
                .join("\n")
                .slice(0, 4_000),
            )
          : { ok: true as const }),
        results: results.map((result) => {
          if (!("evidence" in result)) return result;
          const { evidence, ...visible } = result;
          void evidence;
          return visible;
        }),
        sourceCount: sources.length,
        failedCount: results.length - sources.length,
      };
    },
  };
}
