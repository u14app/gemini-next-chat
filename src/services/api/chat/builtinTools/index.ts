import type { TextSkill } from "@/types";

import { createArchiveBinding } from "./archive";
import { createFetchUrlBinding } from "./fetchUrl";
import { createJavaScriptBinding } from "./javascript";
import { createKnowledgeSearchBinding } from "./knowledgeSearch";
import { createLoadSkillBinding } from "./loadSkill";
import { collectMemorySearchBinding } from "./memorySearch";
import type {
  BuiltinKnowledgeScope,
  BuiltinToolBinding,
  CollectedBuiltinTools,
} from "./types";
import { createWebSearchBinding } from "./webSearch";
import { createTaskPlanBinding } from "./taskPlan";
import { createLongTextOutputBinding } from "./longText";
import { createWorkspaceBindings } from "./workspace";

export function collectBuiltinTools({
  message,
  disabled = false,
  agentModeEnabled = false,
  useSearch = false,
  searchMode,
  knowledgeScope,
  installedSkills = [],
}: {
  message: string;
  disabled?: boolean;
  agentModeEnabled?: boolean;
  useSearch?: boolean;
  searchMode?: string;
  knowledgeScope?: BuiltinKnowledgeScope;
  installedSkills?: readonly TextSkill[];
}): CollectedBuiltinTools {
  const definitions: CollectedBuiltinTools["definitions"] = [];
  const bindingsByName = new Map<string, BuiltinToolBinding>();
  if (disabled) return { definitions, bindingsByName };

  const candidates: Array<BuiltinToolBinding | null> = [
    collectMemorySearchBinding(message),
    createLongTextOutputBinding(),
  ];
  if (agentModeEnabled) {
    candidates.push(createTaskPlanBinding());
    if (useSearch && searchMode === "external") {
      candidates.push(createWebSearchBinding());
    }
    if (
      knowledgeScope?.attachments.length ||
      knowledgeScope?.collections.length
    ) {
      candidates.push(createKnowledgeSearchBinding());
    }
    if (installedSkills.length > 0) {
      candidates.push(createLoadSkillBinding(installedSkills));
    }
    candidates.push(createJavaScriptBinding());
    candidates.push(createFetchUrlBinding());
    candidates.push(...createWorkspaceBindings());
    candidates.push(createArchiveBinding());
  }
  for (const binding of candidates) {
    if (!binding) continue;
    const name = binding.definition.function.name;
    if (!name || bindingsByName.has(name)) {
      throw new Error(
        `Duplicate or invalid built-in tool name: ${name || "<missing>"}`,
      );
    }
    bindingsByName.set(name, binding);
    definitions.push(binding.definition);
  }

  return { definitions, bindingsByName };
}

export type {
  BuiltinToolBinding,
  BuiltinToolContext,
  BuiltinToolEmitters,
  BuiltinToolRisk,
  BuiltinKnowledgeScope,
  BuiltinSearchEvent,
  CollectedBuiltinTools,
  WorkspaceFileShare,
  ArchiveFileShare,
} from "./types";
