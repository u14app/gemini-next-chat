import type { ToolInvocationPolicy } from "@/lib/plugin/types";
import type { ResearchSourceSnapshot, ResearchSourceType } from "./types";

const RESEARCH_READ_EFFECTS = new Set(["local_read", "network_read"]);

const RESEARCH_SEARCH_TOOLS = ["web_search", "search_web"] as const;
const RESEARCH_FETCH_TOOLS = ["fetch_url", "fetch_urls"] as const;
const RESEARCH_WORKSPACE_READ_TOOLS = [
  "list_workspace_files",
  "stat_workspace_file",
  "search_workspace_files",
  "read_workspace_file",
] as const;
const RESEARCH_WEB_READ_TOOL_SET = new Set<string>([
  ...RESEARCH_SEARCH_TOOLS,
  ...RESEARCH_FETCH_TOOLS,
]);
const RESEARCH_WORKSPACE_READ_TOOL_SET = new Set<string>(
  RESEARCH_WORKSPACE_READ_TOOLS,
);
const RESEARCH_KNOWLEDGE_READ_TOOL_SET = new Set(["search_knowledge"]);
const RESEARCH_ATTACHMENT_READ_TOOL_SET = new Set(["inspect_attachment"]);
const RESEARCH_BUILTIN_SOURCE_TOOL_SET = new Set<string>([
  ...RESEARCH_WEB_READ_TOOL_SET,
  ...RESEARCH_WORKSPACE_READ_TOOL_SET,
  ...RESEARCH_KNOWLEDGE_READ_TOOL_SET,
  ...RESEARCH_ATTACHMENT_READ_TOOL_SET,
]);

export function isResearchWorkspaceSnapshotPath(path: string): boolean {
  return !path.startsWith("research/") && !path.startsWith("tool-results/");
}

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

export function getResearchSourceSnapshotTypes(
  snapshot: ResearchSourceSnapshot,
): ResearchSourceType[] {
  const sourceTypes: ResearchSourceType[] = [];
  if (
    snapshot.searchEnabled ||
    snapshot.toolIds.some((toolId) => RESEARCH_WEB_READ_TOOL_SET.has(toolId))
  ) {
    sourceTypes.push("web");
  }
  if (snapshot.knowledgeCollectionIds.length > 0) {
    sourceTypes.push("knowledge");
  }
  if (snapshot.attachmentIds.length > 0) sourceTypes.push("attachment");
  if (
    snapshot.workspaceFileIds.length > 0 ||
    (snapshot.workspaceSources?.length ?? 0) > 0 ||
    snapshot.toolIds.some((toolId) =>
      RESEARCH_WORKSPACE_READ_TOOL_SET.has(toolId),
    )
  ) {
    sourceTypes.push("workspace");
  }
  if (snapshot.pluginIds.length > 0) sourceTypes.push("plugin", "mcp");
  return sourceTypes.length > 0 ? Array.from(new Set(sourceTypes)) : ["web"];
}

function mergeUnique<T>(left: readonly T[], right: readonly T[]): T[] {
  return Array.from(new Set([...left, ...right]));
}

export function mergeResearchSourceSnapshotForExpansion({
  approved,
  configured,
  requiredSourceTypes,
  capturedAt = Date.now(),
}: {
  approved: ResearchSourceSnapshot;
  configured: ResearchSourceSnapshot;
  requiredSourceTypes: readonly ResearchSourceType[];
  capturedAt?: number;
}): ResearchSourceSnapshot {
  const required = new Set(requiredSourceTypes);
  const includePluginSources = required.has("plugin") || required.has("mcp");
  const configuredToolIds = configured.toolIds.filter((toolId) => {
    if (required.has("web") && RESEARCH_WEB_READ_TOOL_SET.has(toolId)) {
      return true;
    }
    if (
      required.has("knowledge") &&
      RESEARCH_KNOWLEDGE_READ_TOOL_SET.has(toolId)
    ) {
      return true;
    }
    if (
      required.has("attachment") &&
      RESEARCH_ATTACHMENT_READ_TOOL_SET.has(toolId)
    ) {
      return true;
    }
    if (
      required.has("workspace") &&
      RESEARCH_WORKSPACE_READ_TOOL_SET.has(toolId)
    ) {
      return true;
    }
    return (
      includePluginSources && !RESEARCH_BUILTIN_SOURCE_TOOL_SET.has(toolId)
    );
  });
  return {
    ...approved,
    searchEnabled:
      approved.searchEnabled ||
      (required.has("web") && configured.searchEnabled),
    toolIds: mergeUnique(approved.toolIds, configuredToolIds),
    pluginIds: includePluginSources
      ? mergeUnique(approved.pluginIds, configured.pluginIds)
      : [...approved.pluginIds],
    knowledgeCollectionIds: required.has("knowledge")
      ? mergeUnique(
          approved.knowledgeCollectionIds,
          configured.knowledgeCollectionIds,
        )
      : [...approved.knowledgeCollectionIds],
    attachmentIds: required.has("attachment")
      ? mergeUnique(approved.attachmentIds, configured.attachmentIds)
      : [...approved.attachmentIds],
    workspaceFileIds: required.has("workspace")
      ? mergeUnique(approved.workspaceFileIds, configured.workspaceFileIds)
      : [...approved.workspaceFileIds],
    capturedAt,
  };
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
