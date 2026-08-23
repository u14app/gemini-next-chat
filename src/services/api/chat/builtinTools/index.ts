import type { MemoryScope, TextSkill } from "@/types";

import { createArchiveBinding } from "./archive";
import { createFetchUrlBinding, createFetchUrlsBinding } from "./fetchUrl";
import { createJavaScriptBinding } from "./javascript";
import { createKnowledgeSearchBinding } from "./knowledgeSearch";
import { createLoadSkillBinding } from "./loadSkill";
import {
  collectMemorySearchBinding,
  isMemorySearchEnabled,
} from "./memorySearch";
import { createAgentMemoryBindings } from "./agentMemory";
import type {
  BuiltinKnowledgeScope,
  BuiltinToolBinding,
  CollectedBuiltinTools,
} from "./types";
import { createSearchWebV2Binding, createWebSearchBinding } from "./webSearch";
import { createTaskPlanBinding } from "./taskPlan";
import { createLongTextOutputBinding } from "./longText";
import { createWorkspaceBindings } from "./workspace";
import { createRequestUserInputBinding } from "./requestUserInput";
import { createSkillDiscoveryBindings } from "./skillDiscovery";
import { createDocumentExtractionBindings } from "./documentExtraction";

export function collectBuiltinTools({
  message,
  disabled = false,
  agentModeEnabled = false,
  useSearch = false,
  searchMode,
  knowledgeScope,
  installedSkills = [],
  memoryScopes = ["global"],
  memoryScopeIds = {},
  workspaceAvailable = true,
}: {
  message: string;
  disabled?: boolean;
  agentModeEnabled?: boolean;
  useSearch?: boolean;
  searchMode?: string;
  knowledgeScope?: BuiltinKnowledgeScope;
  installedSkills?: readonly TextSkill[];
  memoryScopes?: readonly MemoryScope[];
  memoryScopeIds?: { workspace?: string; agent?: string; session?: string };
  workspaceAvailable?: boolean;
}): CollectedBuiltinTools {
  const definitions: CollectedBuiltinTools["definitions"] = [];
  const bindingsByName = new Map<string, BuiltinToolBinding>();
  if (disabled) return { definitions, bindingsByName };

  const candidates: Array<BuiltinToolBinding | null> = [
    agentModeEnabled ? null : collectMemorySearchBinding(message),
    createLongTextOutputBinding(),
  ];
  if (agentModeEnabled) {
    if (isMemorySearchEnabled()) {
      candidates.push(
        ...createAgentMemoryBindings({
          allowedScopes: memoryScopes,
          scopeIds: memoryScopeIds,
        }),
      );
    }
    candidates.push(createRequestUserInputBinding());
    candidates.push(createTaskPlanBinding());
    if (useSearch && searchMode === "external") {
      candidates.push(createWebSearchBinding());
      candidates.push(createSearchWebV2Binding());
    }
    if (
      knowledgeScope?.attachments.length ||
      knowledgeScope?.collections.length
    ) {
      candidates.push(createKnowledgeSearchBinding());
    }
    if (installedSkills.length > 0) {
      candidates.push(...createSkillDiscoveryBindings(installedSkills));
      candidates.push(createLoadSkillBinding(installedSkills));
    }
    candidates.push(
      createJavaScriptBinding({ workspaceEnabled: workspaceAvailable }),
    );
    candidates.push(
      createFetchUrlBinding({ workspaceEnabled: workspaceAvailable }),
    );
    candidates.push(
      createFetchUrlsBinding({ workspaceEnabled: workspaceAvailable }),
    );
    if (workspaceAvailable) {
      candidates.push(...createDocumentExtractionBindings());
      candidates.push(...createWorkspaceBindings());
      candidates.push(createArchiveBinding());
    }
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
export { resolveBuiltinToolInvocationPolicy } from "./types";
