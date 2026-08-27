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
  BuiltinResearchQueryBudget,
  BuiltinResearchSourceBudget,
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
import { createResearchAttachmentInspectionBinding } from "./researchAttachment";
import {
  createDeepResearchBindings,
  createResearchPlanReviewBindings,
} from "./deepResearch";
import { createChatModeSwitchBinding } from "./chatMode";
import {
  getResearchSourceBuiltinToolNames,
  isResearchReadOnlyPolicy,
} from "@/lib/research/toolPolicy";
import { isKnowledgeAttachment } from "@/lib/utils/knowledgeAttachments";

export function collectBuiltinTools({
  message,
  disabled = false,
  agentModeEnabled = false,
  automaticModeEnabled = false,
  researchPhase,
  useSearch = false,
  searchMode,
  knowledgeScope,
  installedSkills = [],
  memoryScopes = ["global"],
  memoryScopeIds = {},
  workspaceAvailable = true,
  researchQueryBudget,
  researchSourceBudget,
}: {
  message: string;
  disabled?: boolean;
  agentModeEnabled?: boolean;
  automaticModeEnabled?: boolean;
  researchPhase?: "start" | "clarify" | "plan" | "execute";
  useSearch?: boolean;
  searchMode?: string;
  knowledgeScope?: BuiltinKnowledgeScope;
  installedSkills?: readonly TextSkill[];
  memoryScopes?: readonly MemoryScope[];
  memoryScopeIds?: { workspace?: string; agent?: string; session?: string };
  workspaceAvailable?: boolean;
  researchQueryBudget?: BuiltinResearchQueryBudget;
  researchSourceBudget?: BuiltinResearchSourceBudget;
}): CollectedBuiltinTools {
  const definitions: CollectedBuiltinTools["definitions"] = [];
  const bindingsByName = new Map<string, BuiltinToolBinding>();
  if (disabled) return { definitions, bindingsByName };

  if (researchPhase) {
    const researchCandidates: BuiltinToolBinding[] = [];
    if (researchPhase === "start") {
      const start = createDeepResearchBindings().find(
        (binding) => binding.definition.function.name === "start_deep_research",
      );
      if (start) researchCandidates.push(start);
    } else if (researchPhase === "plan") {
      // Planning is non-interactive: the user reviews and refines the plan in
      // chat once the plan card is shown, so no question tool is offered here.
      if (useSearch && searchMode === "external") {
        researchCandidates.push(
          createWebSearchBinding({ queryBudget: researchQueryBudget }),
        );
      }
    } else if (researchPhase === "clarify") {
      researchCandidates.push(...createResearchPlanReviewBindings());
    } else {
      const knowledgeEnabled = Boolean(
        knowledgeScope?.attachments.some(isKnowledgeAttachment) ||
        knowledgeScope?.collections.length,
      );
      const attachmentEnabled = Boolean(
        knowledgeScope?.attachments.some(
          (attachment) => !isKnowledgeAttachment(attachment),
        ),
      );
      if (useSearch && searchMode === "external") {
        researchCandidates.push(
          createWebSearchBinding({ queryBudget: researchQueryBudget }),
        );
        researchCandidates.push(
          createSearchWebV2Binding({ queryBudget: researchQueryBudget }),
        );
      }
      if (knowledgeEnabled) {
        researchCandidates.push(
          createKnowledgeSearchBinding({ sourceBudget: researchSourceBudget }),
        );
      }
      if (attachmentEnabled) {
        researchCandidates.push(createResearchAttachmentInspectionBinding());
      }
      researchCandidates.push(
        createFetchUrlBinding({
          workspaceEnabled: false,
          sourceBudget: researchSourceBudget,
        }),
      );
      researchCandidates.push(
        createFetchUrlsBinding({
          workspaceEnabled: false,
          sourceBudget: researchSourceBudget,
        }),
      );
      if (workspaceAvailable) {
        researchCandidates.push(...createWorkspaceBindings());
      }
      const allowedSourceNames = new Set(
        getResearchSourceBuiltinToolNames({
          externalSearchEnabled: useSearch && searchMode === "external",
          knowledgeEnabled,
          attachmentEnabled,
          workspaceEnabled: workspaceAvailable,
        }),
      );
      const readOnlyCandidates = researchCandidates.filter(
        (binding) =>
          allowedSourceNames.has(binding.definition.function.name) &&
          isResearchReadOnlyPolicy(binding.descriptor),
      );
      researchCandidates.splice(
        0,
        researchCandidates.length,
        ...readOnlyCandidates,
      );
    }
    for (const binding of researchCandidates) {
      const name = binding.definition.function.name;
      if (!name || bindingsByName.has(name)) {
        throw new Error(
          `Duplicate or invalid research tool name: ${name || "<missing>"}`,
        );
      }
      bindingsByName.set(name, binding);
      definitions.push(binding.definition);
    }
    return { definitions, bindingsByName };
  }

  const candidates: Array<BuiltinToolBinding | null> = [
    automaticModeEnabled ? createChatModeSwitchBinding() : null,
    agentModeEnabled ? null : collectMemorySearchBinding(message),
    createLongTextOutputBinding(),
  ];
  if (automaticModeEnabled && useSearch && searchMode === "external") {
    candidates.push(createWebSearchBinding());
  }
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
  BuiltinResearchEmitters,
  BuiltinResearchHostContext,
  BuiltinResearchStartResult,
  BuiltinResearchQueryBudget,
  BuiltinResearchSourceBudget,
} from "./types";
export {
  consumeBuiltinResearchSourceBodies,
  resolveBuiltinToolInvocationPolicy,
} from "./types";
