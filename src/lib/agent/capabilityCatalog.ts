import { CHAT_MODE_SWITCH_TOOL_NAME } from "@/lib/chat/mode";

export interface AgentBuiltinCatalogInput {
  agentModeEnabled: boolean;
  automaticModeEnabled?: boolean;
  memoryEnabled: boolean;
  externalSearchEnabled: boolean;
  knowledgeEnabled: boolean;
  skillsEnabled: boolean;
  mcpEnabled: boolean;
  dynamicToolsEnabled: boolean;
  workspaceEnabled: boolean;
  allowedToolIds?: readonly string[];
}

const MEMORY_TOOLS = [
  "memory_list",
  "memory_search",
  "remember",
  "memory_update",
  "forget",
  "memory_restore",
] as const;
const SEARCH_TOOLS = ["web_search", "search_web"] as const;
const SKILL_TOOLS = ["search_skills", "inspect_skill", "load_skill"] as const;
const MCP_TOOLS = [
  "inspect_mcp_server",
  "list_mcp_resources",
  "read_mcp_resource",
  "list_mcp_prompts",
  "get_mcp_prompt",
] as const;
const DYNAMIC_TOOL_TOOLS = ["search_tools", "load_tools"] as const;
const AGENT_CORE_TOOLS = [
  "start_long_text_output",
  "request_user_input",
  "update_task_plan",
  "run_javascript",
  "fetch_url",
  "fetch_urls",
] as const;
const AGENT_WORKSPACE_TOOLS = [
  "inspect_attachment",
  "extract_document",
  "list_workspace_files",
  "stat_workspace_file",
  "diff_workspace_file",
  "search_workspace_files",
  "read_workspace_file",
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
  "create_archive",
] as const;

/**
 * Pure preview of the initial schemas registered for an Agent round. Plugin
 * function schemas loaded after search_tools are intentionally reported as
 * discoverable rather than included here.
 */
export function getAgentBuiltinToolNames(
  input: AgentBuiltinCatalogInput,
): string[] {
  if (!input.agentModeEnabled) {
    return [
      ...(input.automaticModeEnabled ? [CHAT_MODE_SWITCH_TOOL_NAME] : []),
      "start_long_text_output",
    ];
  }
  const names = [
    ...(input.memoryEnabled ? MEMORY_TOOLS : []),
    ...AGENT_CORE_TOOLS.slice(0, 3),
    ...(input.externalSearchEnabled ? SEARCH_TOOLS : []),
    ...(input.knowledgeEnabled ? ["search_knowledge"] : []),
    ...(input.skillsEnabled ? SKILL_TOOLS : []),
    ...AGENT_CORE_TOOLS.slice(3),
    ...(input.workspaceEnabled ? AGENT_WORKSPACE_TOOLS : []),
    ...(input.mcpEnabled ? MCP_TOOLS : []),
    ...(input.dynamicToolsEnabled ? DYNAMIC_TOOL_TOOLS : []),
  ];
  const allowed = new Set(input.allowedToolIds || []);
  return allowed.size > 0 ? names.filter((name) => allowed.has(name)) : names;
}
