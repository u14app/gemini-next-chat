import type { ToolInvocationPolicy } from "@/lib/plugin/types";

const RESEARCH_READ_EFFECTS = new Set(["local_read", "network_read"]);

const RESEARCH_SEARCH_TOOLS = ["web_search", "search_web"] as const;
const RESEARCH_FETCH_TOOLS = ["fetch_url", "fetch_urls"] as const;
const RESEARCH_WORKSPACE_READ_TOOLS = [
  "list_workspace_files",
  "stat_workspace_file",
  "search_workspace_files",
  "read_workspace_file",
] as const;

export function getResearchSourceBuiltinToolNames({
  externalSearchEnabled,
  knowledgeEnabled,
  attachmentEnabled,
  workspaceEnabled,
}: {
  externalSearchEnabled: boolean;
  knowledgeEnabled: boolean;
  attachmentEnabled: boolean;
  workspaceEnabled: boolean;
}): string[] {
  return [
    ...(externalSearchEnabled ? RESEARCH_SEARCH_TOOLS : []),
    ...RESEARCH_FETCH_TOOLS,
    ...(knowledgeEnabled ? ["search_knowledge"] : []),
    ...(attachmentEnabled ? ["inspect_attachment"] : []),
    ...(workspaceEnabled ? RESEARCH_WORKSPACE_READ_TOOLS : []),
  ];
}

/** Empty or unknown effect metadata is denied rather than treated as read-only. */
export function isResearchReadOnlyPolicy(
  policy: ToolInvocationPolicy | null | undefined,
): boolean {
  return Boolean(
    policy &&
    policy.effects.length > 0 &&
    policy.effects.every((effect) => RESEARCH_READ_EFFECTS.has(effect)),
  );
}

export function filterResearchReadOnlyTools<
  T extends { policy?: ToolInvocationPolicy | null },
>(tools: readonly T[]): T[] {
  return tools.filter((tool) => isResearchReadOnlyPolicy(tool.policy));
}
