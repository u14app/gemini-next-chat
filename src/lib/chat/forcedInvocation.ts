import type { PluginFunction } from "@/lib/plugin/types";

export interface ForcedPluginInvocation {
  title: string;
  functions: readonly PluginFunction[];
}

/**
 * Builds a system-instruction directive telling the model to call the tools of
 * plugins the user explicitly referenced with `@`.
 *
 * Providers in this project are called with a plain `tools[]` array and no
 * `tool_choice` field, so "forced invocation" is expressed at the prompt level.
 */
export function buildForcedToolDirective(
  plugins: readonly ForcedPluginInvocation[],
): string {
  const lines: string[] = [];

  for (const plugin of plugins) {
    const toolNames = plugin.functions
      .map((fn) => fn.name?.trim())
      .filter((name): name is string => Boolean(name));
    if (toolNames.length === 0) continue;

    const title = plugin.title?.trim() || toolNames[0];
    const formatted = toolNames.map((name) => `\`${name}\``).join(", ");
    lines.push(
      toolNames.length === 1
        ? `- ${title}: you must call the ${formatted} tool.`
        : `- ${title}: you must call at least one of these tools: ${formatted}.`,
    );
  }

  if (lines.length === 0) return "";

  return [
    "## Required tool calls",
    "",
    "The user explicitly requested the following plugins for this message.",
    "Call them before answering, even if you believe you already know the answer.",
    "If a call fails, report the failure instead of silently answering without it.",
    "",
    ...lines,
  ].join("\n");
}

/** Merges explicitly referenced plugin ids into the session's active plugins. */
export function mergeForcedPluginIds(
  activePluginIds: readonly string[] | undefined,
  forcedPluginIds: readonly string[] | undefined,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const id of [...(activePluginIds || []), ...(forcedPluginIds || [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  return merged;
}
