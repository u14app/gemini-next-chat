import type { ChatToolDefinition } from "../types";
import type { BuiltinToolBinding } from "./types";

export interface DiscoverableToolEntry {
  name: string;
  originalName: string;
  providerId: string;
  providerTitle: string;
  description?: string;
  definition: ChatToolDefinition;
}

export interface LoadDiscoverableToolsResult {
  loaded: string[];
  alreadyLoaded: string[];
  unavailable: string[];
  capacityRemaining: number;
}

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean)
    .slice(0, 20);
}

function searchCatalog(
  entries: readonly DiscoverableToolEntry[],
  query: string,
  limit: number,
) {
  const tokens = tokenize(query);
  return entries
    .map((entry, index) => {
      const haystack = [
        entry.name,
        entry.originalName,
        entry.providerId,
        entry.providerTitle,
        entry.description || "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      const score = tokens.reduce(
        (total, token) => total + (haystack.includes(token) ? 1 : 0),
        0,
      );
      return { entry, index, score };
    })
    .filter((candidate) => tokens.length === 0 || candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ entry }) => ({
      name: entry.name,
      originalName: entry.originalName,
      providerId: entry.providerId,
      providerTitle: entry.providerTitle,
      description: entry.description,
    }));
}

export function createToolDiscoveryBindings({
  entries,
  isLoaded,
  load,
}: {
  entries: readonly DiscoverableToolEntry[];
  isLoaded: (name: string) => boolean;
  load: (names: string[]) => LoadDiscoverableToolsResult;
}): BuiltinToolBinding[] {
  const commonDescriptor: NonNullable<BuiltinToolBinding["descriptor"]> = {
    version: 2,
    effects: ["local_read"],
    idempotency: "idempotent",
    sensitivity: "none",
    origin: "builtin",
  };

  return [
    {
      definition: {
        type: "function",
        function: {
          name: "search_tools",
          description:
            "Search the tools available from enabled Plugins and MCP servers. Search before loading a tool that is not already registered.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", minLength: 1, maxLength: 300 },
              limit: { type: "integer", minimum: 1, maximum: 12 },
            },
            required: ["query"],
          },
        },
      },
      risk: "read",
      descriptor: commonDescriptor,
      displayKey: "searchTools",
      agentOnly: true,
      async execute(args) {
        const input =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) {
          return {
            ok: false,
            error: {
              code: "INVALID_TOOL_SEARCH",
              message: "A non-empty tool search query is required.",
              recoverable: true,
            },
          };
        }
        const limit = Number.isInteger(input.limit)
          ? Math.min(12, Math.max(1, Number(input.limit)))
          : 8;
        return {
          tools: searchCatalog(entries, query, limit).map((entry) => ({
            ...entry,
            loaded: isLoaded(entry.name),
          })),
          totalAvailable: entries.length,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "load_tools",
          description:
            "Load selected Plugin or MCP tool schemas for the next model round. Use exact names returned by search_tools.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              names: {
                type: "array",
                minItems: 1,
                maxItems: 12,
                uniqueItems: true,
                items: { type: "string", minLength: 1, maxLength: 80 },
              },
            },
            required: ["names"],
          },
        },
      },
      risk: "read",
      descriptor: commonDescriptor,
      displayKey: "loadTools",
      agentOnly: true,
      async execute(args) {
        const names =
          args &&
          typeof args === "object" &&
          Array.isArray((args as Record<string, unknown>).names)
            ? ((args as Record<string, unknown>).names as unknown[])
                .filter((name): name is string => typeof name === "string")
                .map((name) => name.trim())
                .filter(Boolean)
                .slice(0, 12)
            : [];
        if (names.length === 0) {
          return {
            ok: false,
            error: {
              code: "INVALID_TOOL_LOAD",
              message: "At least one tool name is required.",
              recoverable: true,
            },
          };
        }
        return load([...new Set(names)]);
      },
    },
  ];
}
