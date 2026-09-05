import type { ChatConfig, Session } from "@/types";
import type { ResearchTask } from "@/lib/research";
import { resolveEffectiveChatContext } from "@/lib/chat/effectiveChatContext";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";

import { ResearchModelUnavailableError } from "./dependencyErrors";

function getSessionConfig(session: Session): ChatConfig {
  const base = useChatStore.getState().chatConfig;
  return {
    ...base,
    ...(typeof session.config?.useSearch === "boolean"
      ? { useSearch: session.config.useSearch }
      : {}),
    ...(typeof session.config?.useReasoning === "boolean"
      ? { useReasoning: session.config.useReasoning }
      : {}),
    ...(typeof session.config?.useAgentMode === "boolean"
      ? { useAgentMode: session.config.useAgentMode }
      : {}),
    ...(typeof session.config?.useDeepResearch === "boolean"
      ? { useDeepResearch: session.config.useDeepResearch }
      : {}),
    ...(session.config?.reasoningMode
      ? { reasoningMode: session.config.reasoningMode }
      : {}),
  };
}

export function resolveTaskContext(task: ResearchTask, requestModel?: string) {
  const chatState = useChatStore.getState();
  const settings = useSettingsStore.getState();
  const core = useCoreSettingsStore.getState();
  const session = chatState.sessions.find((item) => item.id === task.sessionId);
  if (!session) throw new Error("The research chat no longer exists.");
  const model =
    task.sourceSnapshot?.model || task.requestModel || requestModel?.trim();
  if (!model) throw new ResearchModelUnavailableError();
  const workspace = session.workspaceId
    ? chatState.workspaces.find((item) => item.id === session.workspaceId)
    : undefined;
  const providerId = model.includes(":") ? model.split(":", 1)[0] : undefined;
  const provider = providerId
    ? core.providers.find((item) => item.id === providerId)
    : core.providers.find((item) => item.enabled);
  if (!provider) {
    throw new Error("The approved research model provider is unavailable.");
  }
  const chatConfig = getSessionConfig(session);
  const effective = resolveEffectiveChatContext({
    session,
    workspace,
    systemPrompt: settings.system.systemPrompt,
    personality: settings.system.personality,
    enableHtmlVisualPrompt: settings.system.enableHtmlVisualPrompt,
    selectedModel: model,
    provider,
    modelMetadata: settings.modelMetadata,
    customModelMetadata: settings.customModelMetadata,
    chatConfig: {
      ...chatConfig,
      chatMode: "research",
      useAgentMode: false,
      useDeepResearch: true,
    },
    search: settings.search,
    rag: settings.rag,
    installedPlugins: settings.installedPlugins,
    installedSkills: settings.installedSkills,
    pluginConfigs: settings.pluginConfigs,
    activePlugins: settings.activePlugins,
  });
  return { session, model, chatConfig, effective, settings };
}

export interface ResearchDependencyError {
  code:
    | "RESEARCH_OFFLINE"
    | "RESEARCH_MODEL_UNAVAILABLE"
    | "RESEARCH_WORKSPACE_UNAVAILABLE"
    | "RESEARCH_SOURCE_SCOPE_WARNING"
    | "RESEARCH_SOURCE_REVOKED"
    | "RESEARCH_CHECKPOINT_UNAVAILABLE";
  message: string;
}

export interface ResearchDependencyText {
  offline: string;
  modelUnavailable: string;
  toolCallingUnavailable: string;
  searchUnavailable: string;
  searchDisabled: string;
  checkpointUnavailable: string;
  sourceUnavailable: (source: string) => string;
}

export function getResearchDependencyError(
  task: ResearchTask,
  text: Omit<ResearchDependencyText, "checkpointUnavailable">,
): ResearchDependencyError | null {
  const snapshot = task.sourceSnapshot;
  if (!snapshot) return null;
  if (
    typeof navigator !== "undefined" &&
    navigator.onLine === false &&
    (snapshot.searchEnabled || snapshot.pluginIds.length > 0)
  ) {
    return {
      code: "RESEARCH_OFFLINE",
      message: text.offline,
    };
  }

  let context: ReturnType<typeof resolveTaskContext>;
  try {
    context = resolveTaskContext(task);
  } catch {
    return {
      code: "RESEARCH_MODEL_UNAVAILABLE",
      message: text.modelUnavailable,
    };
  }
  if (!context.effective.modelCapabilities.toolCall) {
    return {
      code: "RESEARCH_MODEL_UNAVAILABLE",
      message: text.toolCallingUnavailable,
    };
  }
  if (
    snapshot.searchEnabled &&
    !context.effective.searchCompatibility.enabled
  ) {
    return {
      code: "RESEARCH_SOURCE_REVOKED",
      message: text.searchUnavailable,
    };
  }

  const activePluginIds = new Set(context.effective.activePluginIds);
  const missingPlugin = snapshot.pluginIds.find(
    (pluginId) => !activePluginIds.has(pluginId),
  );
  const installedSkillIds = new Set(
    context.settings.installedSkills.map((skill) => skill.id),
  );
  const missingSkill = snapshot.skillIds.find(
    (skillId) => !installedSkillIds.has(skillId),
  );
  const collectionIds = new Set(
    useKnowledgeStore.getState().collections.map((collection) => collection.id),
  );
  const missingCollection = snapshot.knowledgeCollectionIds.find(
    (collectionId) => !collectionIds.has(collectionId),
  );
  const workspaceFileIds = new Set(
    context.effective.workspaceFiles.map((file) => file.id),
  );
  const missingWorkspaceFile = snapshot.workspaceFileIds.find(
    (fileId) => !workspaceFileIds.has(fileId),
  );
  const missingSource =
    missingPlugin || missingSkill || missingCollection || missingWorkspaceFile;
  if (missingSource) {
    return {
      code: "RESEARCH_SOURCE_REVOKED",
      message: text.sourceUnavailable(missingSource),
    };
  }
  return null;
}
