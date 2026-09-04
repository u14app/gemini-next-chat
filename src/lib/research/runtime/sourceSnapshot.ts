import type { Message, SessionMessageTree } from "@/types";
import { freezeResearchSourceContracts } from "@/lib/plugin/researchSources/contracts";
import {
  findInvalidResearchWorkspaceSource,
  getResearchSourceBuiltinToolNames,
  isResearchReadOnlyPolicy,
  isResearchWorkspaceSnapshotPath,
  type ResearchSourceSnapshot,
  type ResearchTask,
} from "@/lib/research";
import { isAgentWorkspaceAvailable } from "@/lib/agent";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import { getEnabledPluginFunctions } from "@/lib/plugin/resolve";
import { getPluginFunctionInvocationPolicy } from "@/lib/plugin/risk";
import {
  createKnowledgeCollectionAttachment,
  isKnowledgeAttachment,
  isKnowledgeCollectionAttachment,
  parseKnowledgeFileAttachmentData,
} from "@/lib/utils/knowledgeAttachments";
import { useChatStore } from "@/store/core/chatStore";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { appDb } from "@/store/storage/storageConfig";
import { listWorkspace } from "@/services/workspace/sessionWorkspace";

import { resolveTaskContext } from "./taskContext";

export async function getInvalidFrozenWorkspaceSource(
  snapshot: ResearchSourceSnapshot,
  sessionId: string,
): Promise<string | undefined> {
  if (!snapshot.workspaceSources?.length) return undefined;
  const listed = await listWorkspace(sessionId).catch(() => null);
  if (!listed?.ok) return snapshot.workspaceSources[0].path;
  return findInvalidResearchWorkspaceSource(
    snapshot.workspaceSources,
    listed.value.files,
  );
}

export async function loadSessionMessages(
  sessionId: string,
): Promise<Message[]> {
  const state = useChatStore.getState();
  if (state.currentSessionId === sessionId) return state.activeMessages;
  const stored = await appDb.getItem<Message[] | SessionMessageTree>(
    `session_messages_${sessionId}`,
  );
  const tree = normalizeSessionMessageTree(stored);
  const messages: Message[] = [];
  let currentId = tree.activeRootMessageId || tree.rootMessageIds[0];
  while (currentId) {
    const node = tree.nodesById[currentId];
    if (!node) break;
    messages.push(node.message);
    currentId = node.activeChildMessageId || "";
  }
  return messages;
}

export async function createSourceSnapshot(
  task: ResearchTask,
  requestModel?: string,
): Promise<ResearchSourceSnapshot> {
  const { model, chatConfig, effective, settings } = resolveTaskContext(
    task,
    requestModel,
  );
  const messages = await loadSessionMessages(task.sessionId);
  const originMessage = messages.find(
    (message) => message.id === task.userMessageId,
  );
  const originAttachments = originMessage?.attachments || [];
  const ordinaryAttachments = originAttachments.filter(
    (attachment) => !isKnowledgeAttachment(attachment),
  );
  const knowledgeCollectionIds = new Set(
    effective.workspaceKnowledgeCollectionIds,
  );
  for (const attachment of originAttachments) {
    if (isKnowledgeCollectionAttachment(attachment) && attachment.data) {
      knowledgeCollectionIds.add(attachment.data);
      continue;
    }
    const file = parseKnowledgeFileAttachmentData(attachment);
    if (file) knowledgeCollectionIds.add(file.collectionId);
  }
  const configuredToolIds = effective.agentToolIds.length
    ? effective.agentToolIds
    : undefined;
  const externalSearchEnabled =
    chatConfig.useSearch === true &&
    effective.searchCompatibility.enabled &&
    effective.searchCompatibility.mode === "external";
  const builtinToolIds = getResearchSourceBuiltinToolNames({
    externalSearchEnabled,
    knowledgeEnabled: knowledgeCollectionIds.size > 0,
    attachmentEnabled: ordinaryAttachments.length > 0,
    workspaceEnabled: isAgentWorkspaceAvailable(),
  });
  const pluginFunctionsById = new Map<string, string[]>();
  effective.activePluginIds.forEach((pluginId) => {
    const plugin = settings.installedPlugins.find(
      (item) => item.id === pluginId,
    );
    if (!plugin) return;
    const functionIds = getEnabledPluginFunctions(
      plugin,
      settings.pluginConfigs[pluginId],
    )
      .filter((functionDef) =>
        isResearchReadOnlyPolicy(
          getPluginFunctionInvocationPolicy(functionDef, {
            origin: plugin.source === "mcp" ? "mcp" : "plugin",
          }),
        ),
      )
      .map((functionDef) => functionDef.name);
    if (functionIds.length > 0) pluginFunctionsById.set(pluginId, functionIds);
  });
  const pluginFunctionIds = [...pluginFunctionsById.values()].flat();
  const availableToolIds = Array.from(
    new Set([...builtinToolIds, ...pluginFunctionIds]),
  );
  const toolIds = configuredToolIds
    ? availableToolIds.filter((toolId) => configuredToolIds.includes(toolId))
    : availableToolIds;
  const searchEnabled =
    externalSearchEnabled &&
    toolIds.some(
      (toolId) => toolId === "web_search" || toolId === "search_web",
    );
  const snapshot: ResearchSourceSnapshot = {
    model,
    reasoningMode: chatConfig.reasoningMode,
    approvalMode: effective.approvalMode,
    searchEnabled,
    toolIds,
    pluginIds: effective.activePluginIds.filter((pluginId) =>
      pluginFunctionsById.has(pluginId),
    ),
    skillIds: [],
    knowledgeCollectionIds: [...knowledgeCollectionIds],
    attachmentIds: Array.from(
      new Set(ordinaryAttachments.map((item) => item.id)),
    ),
    workspaceFileIds: Array.from(
      new Set(effective.workspaceFiles.map((item) => item.id)),
    ),
    memoryScopes: [],
    memoryScopeIds: {},
    capturedAt: Date.now(),
  };
  await freezeResearchSourceContracts(
    task,
    snapshot,
    settings.installedPlugins,
    settings.pluginConfigs,
  );
  return snapshot;
}

export async function captureApprovedWorkspaceSources(
  sessionId: string,
  toolIds: readonly string[],
): Promise<NonNullable<ResearchSourceSnapshot["workspaceSources"]>> {
  if (
    !toolIds.some((toolId) =>
      [
        "list_workspace_files",
        "stat_workspace_file",
        "search_workspace_files",
        "read_workspace_file",
      ].includes(toolId),
    )
  ) {
    return [];
  }
  const listed = await listWorkspace(sessionId).catch(() => null);
  if (!listed?.ok) return [];
  return listed.value.files
    .filter((file) => isResearchWorkspaceSnapshotPath(file.path))
    .map((file) => ({
      path: file.path,
      contentHash: file.contentHash,
      revision: file.revision,
    }));
}

export function buildResearchExecutionSourceContext(
  snapshot: ResearchSourceSnapshot,
  currentAttachments: NonNullable<Message["attachments"]>,
) {
  const frozenAttachments = currentAttachments.filter(
    (attachment) =>
      !isKnowledgeAttachment(attachment) &&
      snapshot.attachmentIds.includes(attachment.id),
  );
  const frozenKnowledgeAttachments = currentAttachments.filter((attachment) => {
    if (isKnowledgeCollectionAttachment(attachment)) {
      return Boolean(
        attachment.data &&
        snapshot.knowledgeCollectionIds.includes(attachment.data),
      );
    }
    const file = parseKnowledgeFileAttachmentData(attachment);
    return Boolean(
      file && snapshot.knowledgeCollectionIds.includes(file.collectionId),
    );
  });
  const collections = useKnowledgeStore
    .getState()
    .collections.filter((collection) =>
      snapshot.knowledgeCollectionIds.includes(collection.id),
    );
  const representedKnowledgeCollectionIds = new Set(
    frozenKnowledgeAttachments.flatMap((attachment) => {
      if (isKnowledgeCollectionAttachment(attachment)) {
        return attachment.data ? [attachment.data] : [];
      }
      const file = parseKnowledgeFileAttachmentData(attachment);
      return file ? [file.collectionId] : [];
    }),
  );
  const approvedKnowledgeAttachments = [
    ...frozenKnowledgeAttachments,
    ...snapshot.knowledgeCollectionIds
      .filter((id) => !representedKnowledgeCollectionIds.has(id))
      .map((id) =>
        createKnowledgeCollectionAttachment({
          collectionId: id,
          collectionName:
            collections.find((collection) => collection.id === id)?.name || id,
        }),
      ),
  ];
  const attachmentCatalog = frozenAttachments.length
    ? [
        "Approved attachment catalog (use inspect_attachment with the exact ID):",
        ...frozenAttachments.map(
          (attachment) =>
            `- ${attachment.id} | ${attachment.fileName} | ${attachment.mimeType}`,
        ),
      ].join("\n")
    : "";
  const workspaceCatalog = snapshot.workspaceSources?.length
    ? [
        "Approved workspace source catalog (read only these exact paths):",
        ...snapshot.workspaceSources.map(
          (source) =>
            `- ${source.path} | revision ${source.revision} | hash ${source.contentHash}`,
        ),
      ].join("\n")
    : "";
  return {
    frozenAttachments,
    approvedKnowledgeAttachments,
    collections,
    attachmentCatalog,
    workspaceCatalog,
  };
}
