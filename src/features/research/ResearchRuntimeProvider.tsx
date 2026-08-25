"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslations } from "next-intl";
import { v7 as uuidv7 } from "uuid";

import type {
  AgentUserInputController,
  ChatConfig,
  Message,
  MessageOutputBlock,
  Session,
  SessionMessageTree,
  Source,
  ToolCall,
  ToolConfirmationController,
} from "@/types";
import {
  DEEP_RESEARCH_INSTRUCTION_MAX_CHARS,
  buildEvidenceQuestionPrompt,
  buildResearchPlanPrompt,
  buildResearchPlanRepairPrompt,
  buildResearchScopeExpansionAdjustment,
  buildResearchSynthesisPrompt,
  buildResearchWavePrompt,
  buildDeterministicSalvageReport,
  applyResearchSourceAssessments,
  applyResearchRunUserStop,
  auditResearchReport,
  calculateResearchCoverage,
  createClaimRecordsFromLearningPackets,
  createNextResearchWave,
  createResearchReportRun,
  createResearchTask,
  expandResearchFrontier,
  findInvalidResearchWorkspaceSource,
  getCurrentResearchReportRunIds,
  getResearchEvidenceDedupKeys,
  getResearchExplorationQueryLimit,
  getResearchExplorationToolCallLimit,
  getResearchFrontier,
  getResearchClaimSignature,
  getCoveredResearchStepIds,
  getResearchRunResumeDecision,
  getResearchSourceBodyLimit,
  getResearchSourceBuiltinToolNames,
  getResearchStopReason,
  getResearchVerificationQueryAllowance,
  getReportVersion,
  isResearchReadOnlyPolicy,
  isActiveResearchStatus,
  isTerminalResearchStatus,
  markMutableResearchEvidenceStale,
  normalizeResearchQuery,
  parseResearchPlan,
  parseResearchWavePackets,
  resolveResearchStrategy,
  summarizeResearchReport,
  transitionResearchTask,
  type LearningPacket,
  type ResearchCheckpoint,
  type ResearchEvidence,
  type ResearchPlanVersion,
  type ResearchReconSnapshot,
  type ResearchReportRun,
  type ResearchReportVersion,
  type ResearchSourceSnapshot,
  type ResearchSourceType,
  type ResearchStrategy,
  type ResearchTask,
} from "@/lib/research";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import { getEvidenceMetadata, isAgentWorkspaceAvailable } from "@/lib/agent";
import { resolveEffectiveChatContext } from "@/lib/chat/effectiveChatContext";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import { getEnabledPluginFunctions } from "@/lib/plugin/resolve";
import { getPluginFunctionInvocationPolicy } from "@/lib/plugin/risk";
import { useResearchStore } from "@/store/core/researchStore";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { appDb } from "@/store/storage/storageConfig";
import {
  streamChatResponse,
  type AgentExecutionPhase,
} from "@/services/api/chatService";
import type {
  BuiltinResearchQueryBudget,
  BuiltinResearchSourceBudget,
} from "@/services/api/chat/builtinTools";
import {
  deleteWorkspaceFile,
  listWorkspace,
  readWorkspaceText,
  writeWorkspaceText,
} from "@/services/workspace/sessionWorkspace";
import {
  getResearchTaskRepository,
  publishResearchReportArtifact,
  registerResearchToolEmitters,
} from "@/services/research";
import { resolveOPFSBlob } from "@/utils/opfs";
import { logDevError } from "@/lib/utils/devLogger";
import { AgentRunLeaseConflictError } from "@/services/agent/runLease";
import {
  createKnowledgeCollectionAttachment,
  isKnowledgeAttachment,
  isKnowledgeCollectionAttachment,
  parseKnowledgeFileAttachmentData,
} from "@/lib/utils/knowledgeAttachments";

interface ResearchRuntimeProviderProps {
  children: React.ReactNode;
  userInputController: AgentUserInputController;
  toolConfirmationController?: ToolConfirmationController;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}

export interface ResearchRuntimeActions {
  confirmPlan: (taskId: string) => Promise<void>;
  adjustPlan: (taskId: string, instruction: string) => Promise<void>;
  updatePlanStrategy: (
    taskId: string,
    overrides: Partial<ResearchStrategy>,
  ) => Promise<void>;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  askExistingEvidence: (taskId: string, question: string) => Promise<void>;
  continueResearch: (taskId: string, instruction: string) => Promise<void>;
  updateLatest: (taskId: string) => Promise<void>;
}

const ResearchRuntimeContext = createContext<ResearchRuntimeActions | null>(
  null,
);
let mountedRuntimeActions: ResearchRuntimeActions | null = null;

export async function cancelResearchTasksForSession(
  sessionId: string,
): Promise<void> {
  const store = useResearchStore.getState();
  const taskIds = Object.values(store.tasksById)
    .filter(
      (task) =>
        task.sessionId === sessionId && !isTerminalResearchStatus(task.status),
    )
    .map((task) => task.id);
  for (const taskId of taskIds) {
    if (mountedRuntimeActions) {
      await mountedRuntimeActions.cancelTask(taskId);
    } else {
      await store.updateTask(taskId, (task) =>
        isTerminalResearchStatus(task.status)
          ? task
          : transitionResearchTask(task, "cancelled"),
      );
    }
  }
}

interface RunningOperation {
  kind: "planning" | "research" | "evidence_answer";
  controller: AbortController;
  promise: Promise<void>;
  phase: AgentExecutionPhase;
  pauseRequested: boolean;
}

interface SavedResearchCheckpoint {
  version: 1;
  taskId: string;
  savedAt: number;
  prompt: string;
  partialContent: string;
  toolCalls: ToolCall[];
  outputBlocks: MessageOutputBlock[];
}

function createAbortError(message = "Research operation was interrupted.") {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

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

function resolveTaskContext(task: ResearchTask) {
  const chatState = useChatStore.getState();
  const settings = useSettingsStore.getState();
  const core = useCoreSettingsStore.getState();
  const session = chatState.sessions.find((item) => item.id === task.sessionId);
  if (!session) throw new Error("The research chat no longer exists.");
  const model = task.sourceSnapshot?.model || session.model;
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

interface ResearchDependencyError {
  code:
    | "RESEARCH_OFFLINE"
    | "RESEARCH_MODEL_UNAVAILABLE"
    | "RESEARCH_SOURCE_SCOPE_WARNING"
    | "RESEARCH_SOURCE_REVOKED"
    | "RESEARCH_CHECKPOINT_UNAVAILABLE";
  message: string;
}

function getResearchDependencyError(
  task: ResearchTask,
  text: {
    offline: string;
    modelUnavailable: string;
    toolCallingUnavailable: string;
    searchUnavailable: string;
    searchDisabled: string;
    sourceUnavailable: (source: string) => string;
  },
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

async function getInvalidFrozenWorkspaceSource(
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

async function loadSessionMessages(sessionId: string): Promise<Message[]> {
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

async function createSourceSnapshot(
  task: ResearchTask,
): Promise<ResearchSourceSnapshot> {
  const { model, chatConfig, effective, settings } = resolveTaskContext(task);
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
  return {
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
}

async function captureApprovedWorkspaceSources(
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
    .filter((file) => !file.path.startsWith("research/"))
    .map((file) => ({
      path: file.path,
      contentHash: file.contentHash,
      revision: file.revision,
    }));
}

function getActivePlan(task: ResearchTask): ResearchPlanVersion | undefined {
  return task.planVersions.find(
    (plan) => plan.version === task.activePlanVersion,
  );
}

function trimReportMarkdown(value: string): string {
  const normalized = value.trim();
  const titleIndex = normalized.search(/^#\s+\S/m);
  return titleIndex > 0 ? normalized.slice(titleIndex) : normalized;
}

async function hashText(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function inferEvidenceSourceType(
  toolName: string | undefined,
  pluginId: string | undefined,
  locator: string,
): ResearchSourceType {
  if (toolName === "search_knowledge") return "knowledge";
  if (toolName?.includes("attachment")) return "attachment";
  if (toolName?.includes("workspace")) return "workspace";
  if (toolName?.includes("mcp") || locator.startsWith("mcp://")) return "mcp";
  if (pluginId) return "plugin";
  return "web";
}

async function collectTaskEvidence({
  task,
  runIds,
  webSources,
  knowledgeSources,
  defaultStepId,
  defaultNodeId,
}: {
  task: ResearchTask;
  runIds: string[];
  webSources: Source[];
  knowledgeSources: Source[];
  defaultStepId: string;
  defaultNodeId: string;
}): Promise<{
  evidence: ResearchEvidence[];
  newEvidenceIds: string[];
  searchOnlyCount: number;
}> {
  const runState = useAgentRunStore.getState().runsById;
  const collected: ResearchEvidence[] = [...task.evidence];
  const existingIds = new Set(collected.map((item) => item.id));
  const searchDiscoveryUrls = new Set<string>();
  const evidenceIndexByDedupKey = new Map<string, number>();
  collected.forEach((item, index) => {
    getResearchEvidenceDedupKeys(item).forEach((key) =>
      evidenceIndexByDedupKey.set(key, index),
    );
  });
  const mergeEvidence = (candidate: ResearchEvidence) => {
    const candidateKeys = getResearchEvidenceDedupKeys(candidate);
    const duplicateIndex = candidateKeys.reduce<number | undefined>(
      (found, key) => found ?? evidenceIndexByDedupKey.get(key),
      undefined,
    );
    if (duplicateIndex !== undefined) {
      const previous = collected[duplicateIndex];
      const previousKeys = new Set(getResearchEvidenceDedupKeys(previous));
      const sameLineage = candidateKeys.some(
        (key) =>
          (key.startsWith("locator-content:") ||
            key.startsWith("source-content:")) &&
          previousKeys.has(key),
      );
      collected[duplicateIndex] = {
        ...previous,
        aliasSourceIds: Array.from(
          new Set([
            ...(previous.aliasSourceIds || []),
            ...(candidate.aliasSourceIds || []),
            ...(candidate.sourceId !== previous.sourceId
              ? [candidate.sourceId]
              : []),
          ]),
        ).slice(-500),
        aliasLocators: Array.from(
          new Set([
            ...(previous.aliasLocators || []),
            ...(candidate.aliasLocators || []),
            ...(candidate.locator !== previous.locator
              ? [candidate.locator]
              : []),
          ]),
        ).slice(-500),
        retrievedAt: Math.max(previous.retrievedAt, candidate.retrievedAt),
        freshness: candidate.freshness ?? previous.freshness,
        availability: candidate.availability ?? previous.availability,
        ...(sameLineage && candidate.title ? { title: candidate.title } : {}),
        ...(sameLineage && candidate.toolCallId
          ? { toolCallId: candidate.toolCallId }
          : {}),
        ...(sameLineage && candidate.agentRunId
          ? { agentRunId: candidate.agentRunId }
          : {}),
      };
      getResearchEvidenceDedupKeys(collected[duplicateIndex]).forEach((key) =>
        evidenceIndexByDedupKey.set(key, duplicateIndex),
      );
      return;
    }
    const nextIndex = collected.length;
    collected.push(candidate);
    candidateKeys.forEach((key) => evidenceIndexByDedupKey.set(key, nextIndex));
  };
  for (const runId of runIds) {
    const run = runState[runId];
    if (!run) continue;
    const executions = new Map(
      run.toolExecutions.map((execution) => [execution.callId, execution]),
    );
    for (const record of run.evidence) {
      if (record.retrievalKind === "search") {
        searchDiscoveryUrls.add(record.url);
        continue;
      }
      const execution = executions.get(record.toolCallId);
      const sourceType = inferEvidenceSourceType(
        execution?.toolName,
        execution?.pluginId,
        record.url,
      );
      mergeEvidence({
        id: uuidv7(),
        sourceId: record.sourceId,
        sourceType,
        ...(record.title ? { title: record.title } : {}),
        stepId: defaultStepId,
        nodeId: defaultNodeId,
        locator: record.url,
        retrievedAt: record.retrievedAt,
        contentHash: record.contentHash,
        ...(sourceType === "web" ||
        sourceType === "plugin" ||
        sourceType === "mcp"
          ? {
              publisherId: getPublisherIdentity(
                record.url,
                execution?.pluginId,
              ),
            }
          : {}),
        authority: "unknown",
        toolCallId: record.toolCallId,
        agentRunId: runId,
        claimIds: [],
        stance: "context",
        freshness: record.url.startsWith("http") ? "current" : "unknown",
        availability: "available",
      });
    }
  }
  for (const [sourceType, sources] of [
    ["web", webSources],
    ["knowledge", knowledgeSources],
  ] as const) {
    for (const source of sources) {
      if (!source.url) continue;
      const metadata = getEvidenceMetadata(source);
      if (metadata?.retrievalKind === "search") {
        searchDiscoveryUrls.add(source.url);
        continue;
      }
      const contentHash = await hashText(`${source.url}\n${source.content}`);
      const sourceId =
        metadata?.sourceId ||
        `source-${contentHash.replace(/^[^:]+:/, "").slice(0, 20)}`;
      mergeEvidence({
        id: uuidv7(),
        sourceId,
        sourceType,
        title: source.title,
        stepId: defaultStepId,
        nodeId: defaultNodeId,
        locator: source.url,
        retrievedAt: Date.now(),
        contentHash,
        ...(sourceType === "web"
          ? { publisherId: getPublisherIdentity(source.url) }
          : {}),
        authority: "unknown",
        claimIds: [],
        stance: "context",
        freshness: sourceType === "web" ? "current" : "unknown",
        availability: "available",
      });
    }
  }
  const formalLocators = new Set(
    collected.flatMap((item) => [item.locator, ...(item.aliasLocators || [])]),
  );
  return {
    evidence: collected.slice(0, 2_000),
    newEvidenceIds: collected
      .filter((item) => !existingIds.has(item.id))
      .map((item) => item.id),
    searchOnlyCount: [...searchDiscoveryUrls].filter(
      (url) => !formalLocators.has(url),
    ).length,
  };
}

function getPublisherIdentity(locator: string, fallback?: string): string {
  try {
    const hostname = new URL(locator).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return hostname || fallback || locator;
  } catch {
    return fallback || locator;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getToolResultData(toolCall: ToolCall): Record<string, unknown> | null {
  const result = toolCall.result;
  if (!isRecord(result)) return null;
  if (result.ok === true && isRecord(result.data)) return result.data;
  return result;
}

function getToolResultError(
  toolCall: ToolCall,
): Record<string, unknown> | null {
  const result = toolCall.result;
  if (!isRecord(result) || result.ok !== false || !isRecord(result.error)) {
    return null;
  }
  return result.error;
}

function getResearchQueriesFromToolCalls(
  toolCalls: readonly ToolCall[],
): string[] {
  const queries = toolCalls.flatMap((toolCall) => {
    if (!isRecord(toolCall.args)) return [];
    if (
      toolCall.name === "web_search" &&
      typeof toolCall.args.query === "string"
    ) {
      return [toolCall.args.query];
    }
    if (
      toolCall.name === "search_web" &&
      Array.isArray(toolCall.args.queries)
    ) {
      return toolCall.args.queries.filter(
        (query): query is string => typeof query === "string",
      );
    }
    return [];
  });
  return Array.from(
    new Map(
      queries
        .map((query) => query.trim())
        .filter(Boolean)
        .map((query) => [normalizeResearchQuery(query), query] as const),
    ).values(),
  );
}

function getResearchSourceLocatorsFromToolCalls(
  toolCalls: readonly ToolCall[],
): string[] {
  return Array.from(
    new Set(
      toolCalls.flatMap((toolCall) => {
        if (!isRecord(toolCall.args)) return [];
        if (
          toolCall.name === "fetch_url" &&
          typeof toolCall.args.url === "string"
        ) {
          return [toolCall.args.url];
        }
        if (
          toolCall.name === "fetch_urls" &&
          Array.isArray(toolCall.args.urls)
        ) {
          return toolCall.args.urls.filter(
            (url): url is string => typeof url === "string",
          );
        }
        return [];
      }),
    ),
  );
}

function getSourceDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.flatMap((item) => {
        if (!isRecord(item) || typeof item.url !== "string") return [];
        try {
          return [new URL(item.url).hostname.toLowerCase()];
        } catch {
          return [];
        }
      }),
    ),
  );
}

function buildResearchReconSnapshot({
  enabled,
  providerId,
  startedAt,
  completedAt,
  executedQueries,
  toolCalls,
}: {
  enabled: boolean;
  providerId?: string;
  startedAt: number;
  completedAt: number;
  executedQueries: readonly string[];
  toolCalls: readonly ToolCall[];
}): ResearchReconSnapshot {
  const searchCalls = toolCalls.filter((call) => call.name === "web_search");
  const queries = executedQueries.slice(0, 2).map((query) => {
    const call = searchCalls.find(
      (candidate) =>
        isRecord(candidate.args) &&
        typeof candidate.args.query === "string" &&
        candidate.args.query.trim() === query.trim(),
    );
    const result = call ? getToolResultData(call) : null;
    const error = call ? getToolResultError(call) : null;
    const sources = result?.sources;
    const status =
      typeof error?.code === "string" &&
      error.code.toLowerCase().includes("timeout")
        ? "timed_out"
        : !call || call.status === "error" || error
          ? "failed"
          : "completed";
    return {
      query,
      status,
      resultCount: Array.isArray(sources) ? Math.min(5, sources.length) : 0,
      domains: getSourceDomains(sources),
      ...(error && typeof error.message === "string"
        ? { error: error.message.slice(0, 1_000) }
        : {}),
    } as const;
  });
  const completedCount = queries.filter(
    (query) => query.status === "completed",
  ).length;
  const resultCount = queries.reduce(
    (total, query) => total + query.resultCount,
    0,
  );
  return {
    status: !enabled
      ? "unavailable"
      : completedCount === queries.length && completedCount > 0
        ? "completed"
        : "partial",
    sourceFeasibility: completedCount > 0 ? "verified" : "unverified",
    startedAt,
    completedAt,
    timeoutMs: 30_000,
    queryLimit: 2,
    resultsPerQuery: 5,
    usage: {
      queryCount: queries.length,
      resultCount,
      wallTimeMs: Math.max(0, completedAt - startedAt),
    },
    queries,
    ...(providerId ? { providerId } : {}),
  };
}

function validateResearchPlanHostContract({
  plan,
  strategy,
  allowedSourceTypes,
}: {
  plan: Extract<ReturnType<typeof parseResearchPlan>, { valid: true }>["data"];
  strategy: ResearchStrategy;
  allowedSourceTypes: readonly ResearchSourceType[];
}): string[] {
  const issues: string[] = [];
  for (const key of [
    "initialBreadth",
    "maxDepth",
    "maxQueries",
    "resultsPerQuery",
  ] as const) {
    if (plan.strategy[key] !== strategy[key]) {
      issues.push(
        `strategy.${key}: Expected approved value ${strategy[key]}, received ${plan.strategy[key]}.`,
      );
    }
  }
  const allowed = new Set(allowedSourceTypes);
  for (const sourceType of plan.scope.allowedSourceTypes) {
    if (!allowed.has(sourceType)) {
      issues.push(
        `scope.allowedSourceTypes: ${sourceType} is not available to this task.`,
      );
    }
  }
  return issues;
}

function getAvailableResearchSourceTypes(
  snapshot: ResearchSourceSnapshot,
): ResearchSourceType[] {
  const sourceTypes: ResearchSourceType[] = [];
  if (
    snapshot.searchEnabled ||
    snapshot.toolIds.some((toolId) =>
      ["fetch_url", "fetch_urls", "web_search", "search_web"].includes(toolId),
    )
  ) {
    sourceTypes.push("web");
  }
  if (snapshot.knowledgeCollectionIds.length > 0) sourceTypes.push("knowledge");
  if (snapshot.attachmentIds.length > 0) sourceTypes.push("attachment");
  if (
    snapshot.workspaceFileIds.length > 0 ||
    (snapshot.workspaceSources?.length || 0) > 0 ||
    snapshot.toolIds.some((toolId) =>
      [
        "list_workspace_files",
        "stat_workspace_file",
        "search_workspace_files",
        "read_workspace_file",
      ].includes(toolId),
    )
  ) {
    sourceTypes.push("workspace");
  }
  if (snapshot.pluginIds.length > 0) sourceTypes.push("plugin", "mcp");
  return sourceTypes.length > 0 ? Array.from(new Set(sourceTypes)) : ["web"];
}

function upsertResearchReportRun(
  task: ResearchTask,
  run: ResearchReportRun,
): ResearchTask {
  const index = task.reportRuns.findIndex(
    (candidate) => candidate.id === run.id,
  );
  const reportRuns = [...task.reportRuns];
  if (index >= 0) reportRuns[index] = run;
  else reportRuns.push(run);
  return { ...task, reportRuns, activeReportRunId: run.id };
}

function getActiveResearchReportRun(
  task: ResearchTask,
): ResearchReportRun | undefined {
  return task.reportRuns.find((run) => run.id === task.activeReportRunId);
}

function bindEvidenceToLearningPackets(
  evidence: readonly ResearchEvidence[],
  packets: readonly LearningPacket[],
  researchRunId: string,
  now: number = Date.now(),
): ResearchEvidence[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceBySourceId = new Map<string, ResearchEvidence[]>();
  for (const item of evidence) {
    const candidates = evidenceBySourceId.get(item.sourceId) || [];
    candidates.push(item);
    evidenceBySourceId.set(item.sourceId, candidates);
  }
  const latestEvidenceIdForSource = (sourceId: string) =>
    [...(evidenceBySourceId.get(sourceId) || [])]
      .sort((left, right) => {
        const leftUsable =
          left.availability !== "unavailable" && left.freshness !== "stale";
        const rightUsable =
          right.availability !== "unavailable" && right.freshness !== "stale";
        if (leftUsable !== rightUsable) return rightUsable ? 1 : -1;
        return right.retrievedAt - left.retrievedAt;
      })
      .at(0)?.id;
  const bindings = new Map<
    string,
    Map<
      string,
      {
        stepId: string;
        nodeId: string;
        claimIds: string[];
        stances: Set<string>;
      }
    >
  >();
  for (const packet of packets) {
    for (const learning of packet.learnings) {
      const explicitEvidence = learning.evidenceIds.flatMap((evidenceId) => {
        const item = evidenceById.get(evidenceId);
        return item ? [item] : [];
      });
      const representedSourceIds = new Set(
        explicitEvidence.map((item) => item.sourceId),
      );
      const targetEvidenceIds = Array.from(
        new Set([
          ...explicitEvidence.map((item) => item.id),
          ...learning.sourceIds.flatMap((sourceId) => {
            if (representedSourceIds.has(sourceId)) return [];
            const evidenceId = latestEvidenceIdForSource(sourceId);
            return evidenceId ? [evidenceId] : [];
          }),
        ]),
      );
      for (const evidenceId of targetEvidenceIds) {
        const sourceBindings = bindings.get(evidenceId) || new Map();
        const binding = sourceBindings.get(packet.nodeId) || {
          stepId: learning.stepId,
          nodeId: packet.nodeId,
          claimIds: [],
          stances: new Set<string>(),
        };
        binding.claimIds.push(learning.claimId);
        binding.stances.add(learning.stance);
        sourceBindings.set(packet.nodeId, binding);
        bindings.set(evidenceId, sourceBindings);
      }
    }
  }
  return evidence.map((item) => {
    const sourceBindings = bindings.get(item.id);
    if (!sourceBindings) return item;
    const nextRelations = [...sourceBindings.values()].map((binding) => ({
      researchRunId,
      stepId: binding.stepId,
      nodeId: binding.nodeId,
      claimIds: Array.from(new Set(binding.claimIds)),
      stance: binding.stances.has("contradicts")
        ? ("contradicts" as const)
        : binding.stances.has("supports")
          ? ("supports" as const)
          : ("context" as const),
      boundAt: now,
    }));
    const relationByIdentity = new Map(
      (item.relations || []).map((relation) => [
        `${relation.researchRunId}\u0000${relation.nodeId}`,
        relation,
      ]),
    );
    nextRelations.forEach((relation) =>
      relationByIdentity.set(
        `${relation.researchRunId}\u0000${relation.nodeId}`,
        relation,
      ),
    );
    const relations = [...relationByIdentity.values()]
      .sort((left, right) => left.boundAt - right.boundAt)
      .slice(-500);
    const primaryRelation = nextRelations.at(-1)!;
    return {
      ...item,
      stepId: primaryRelation.stepId,
      nodeId: primaryRelation.nodeId,
      claimIds: Array.from(
        new Set([
          ...item.claimIds,
          ...nextRelations.flatMap((r) => r.claimIds),
        ]),
      ).slice(-500),
      stance: primaryRelation.stance,
      relations,
    };
  });
}

function integrateLearningPackets({
  run,
  plan,
  evidence,
  packets,
  waveId,
  newEvidenceCount,
  expandFrontier,
}: {
  run: ResearchReportRun;
  plan: ResearchPlanVersion;
  evidence: ResearchEvidence[];
  packets: LearningPacket[];
  waveId: string;
  newEvidenceCount: number;
  expandFrontier: boolean;
}): { run: ResearchReportRun; evidence: ResearchEvidence[] } {
  const beforeVerified = run.claims.filter(
    (claim) => claim.verificationStatus === "verified",
  ).length;
  let nextRun = run;
  if (expandFrontier) {
    for (const packet of packets) {
      nextRun = expandResearchFrontier(nextRun, packet).run;
    }
  } else {
    nextRun = {
      ...nextRun,
      learningPackets: [...nextRun.learningPackets, ...packets],
      nodes: nextRun.nodes.map((node) =>
        packets.some((packet) => packet.nodeId === node.id)
          ? {
              ...node,
              status: "completed" as const,
              learningPacketId:
                packets.find((packet) => packet.nodeId === node.id)?.id ||
                node.learningPacketId,
              updatedAt: Date.now(),
            }
          : node,
      ),
      updatedAt: Date.now(),
    };
  }
  let linkedEvidence = bindEvidenceToLearningPackets(evidence, packets, run.id);
  linkedEvidence = applyResearchSourceAssessments(linkedEvidence, packets);
  const generatedClaims = createClaimRecordsFromLearningPackets(
    nextRun.learningPackets,
    linkedEvidence,
  );
  const previousClaims = new Map(run.claims.map((claim) => [claim.id, claim]));
  const claims = generatedClaims.map((claim) => ({
    ...claim,
    createdAt: previousClaims.get(claim.id)?.createdAt ?? claim.createdAt,
  }));
  const evidenceBySource = new Map(
    linkedEvidence.map((item) => [item.sourceId, item]),
  );
  const packetByNode = new Map(
    packets.map((packet) => [packet.nodeId, packet]),
  );
  const nodes = nextRun.nodes.map((node) => {
    const packet = packetByNode.get(node.id);
    if (!packet) return node;
    const sourceIds = Array.from(
      new Set(packet.learnings.flatMap((learning) => learning.sourceIds)),
    );
    return {
      ...node,
      sourceIds: Array.from(new Set([...node.sourceIds, ...sourceIds])),
      evidenceIds: Array.from(
        new Set([
          ...node.evidenceIds,
          ...sourceIds.flatMap((sourceId) => {
            const item = evidenceBySource.get(sourceId);
            return item ? [item.id] : [];
          }),
        ]),
      ),
      claimIds: Array.from(
        new Set([
          ...node.claimIds,
          ...packet.learnings.map((learning) => learning.claimId),
        ]),
      ),
    };
  });
  const coverage = calculateResearchCoverage(plan.steps, nodes, claims);
  const afterVerified = claims.filter(
    (claim) => claim.verificationStatus === "verified",
  ).length;
  const completedAt = Date.now();
  return {
    evidence: linkedEvidence,
    run: {
      ...nextRun,
      nodes,
      claims,
      coverage,
      waves: nextRun.waves.map((wave) =>
        wave.id === waveId
          ? {
              ...wave,
              status: "completed" as const,
              newEvidenceCount,
              newVerifiedClaimCount: Math.max(
                0,
                afterVerified - beforeVerified,
              ),
              completedAt,
            }
          : wave,
      ),
      updatedAt: completedAt,
    },
  };
}

function countTrailingWaves(
  run: ResearchReportRun,
  field: "newEvidenceCount" | "newVerifiedClaimCount",
): number {
  let count = 0;
  for (const wave of [...run.waves].reverse()) {
    if (wave.status !== "completed" || wave[field] > 0) break;
    count += 1;
  }
  return count;
}

function buildResearchReportRepairPrompt({
  task,
  plan,
  run,
  evidence,
  report,
  issues,
}: {
  task: ResearchTask;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  evidence: readonly ResearchEvidence[];
  report: string;
  issues: readonly string[];
}): string {
  const relevantEvidenceIds = new Set(
    run.claims.flatMap((claim) => [
      ...claim.supportingEvidenceIds,
      ...claim.contradictingEvidenceIds,
    ]),
  );
  const repairEvidence = [
    ...evidence.filter((item) => relevantEvidenceIds.has(item.id)),
    ...evidence.slice(-100),
  ]
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .slice(0, 200);
  return [
    "Repair this Deep Research report with tools disabled.",
    "Use only the verified claim ledger and committed evidence index. Remove any unsupported claim or citation; do not invent replacements.",
    `Honor the ${plan.deliverable.kind} contract and required sections: ${plan.deliverable.requiredSections.join(", ")}.`,
    `Audit issues:\n${issues.join("\n")}`,
    `Research goal:\n${task.goal}`,
    `Verified claims:\n${JSON.stringify(
      run.claims.filter((claim) => claim.verificationStatus === "verified"),
    )}`,
    `Evidence index:\n${JSON.stringify(
      repairEvidence.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        title: item.title,
        locator: item.locator,
        claimIds: item.claimIds,
      })),
    )}`,
    `Invalid report:\n${report.slice(0, 60_000)}`,
    "Return only the complete repaired Markdown report.",
  ].join("\n\n");
}

function aggregateExecutionUsage(runIds: string[]) {
  const runs = useAgentRunStore.getState().runsById;
  return runIds.reduce(
    (usage, runId) => {
      const run = runs[runId];
      if (!run) return usage;
      usage.toolRounds += run.usage.toolRounds;
      usage.toolCalls += run.usage.toolCalls;
      usage.wallTimeMs += run.usage.wallTimeMs;
      usage.totalTokens += run.usage.totalTokens;
      return usage;
    },
    { toolRounds: 0, toolCalls: 0, wallTimeMs: 0, totalTokens: 0 },
  );
}

function aggregateTaskUsage(task: ResearchTask) {
  return aggregateExecutionUsage(task.executionRunIds);
}

function remainingBudget(task: ResearchTask) {
  const currentRunUsage = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(task),
  );
  const maxToolRounds = task.budget.maxToolRounds - currentRunUsage.toolRounds;
  const maxToolCalls = task.budget.maxToolCalls - currentRunUsage.toolCalls;
  const maxDurationMs = task.budget.maxDurationMs - currentRunUsage.wallTimeMs;
  const maxTotalTokens = task.budget.maxTotalTokens
    ? task.budget.maxTotalTokens - currentRunUsage.totalTokens
    : undefined;
  if (
    maxToolRounds <= 0 ||
    maxToolCalls <= 0 ||
    maxDurationMs <= 0 ||
    (maxTotalTokens !== undefined && maxTotalTokens <= 0)
  ) {
    return null;
  }
  return {
    maxToolRounds,
    maxToolCalls,
    maxDurationMs,
    ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
  };
}

async function readReportMarkdown(
  task: ResearchTask,
  versionId?: string,
): Promise<string> {
  const report = getReportVersion(task, versionId);
  if (!report) return "";
  const blob = await resolveOPFSBlob(report.artifactId);
  return blob ? blob.text() : "";
}

async function publishResearchReportVersion({
  taskId,
  plan,
  run,
  markdown,
  evidence,
  extraGaps,
  agentRunId,
  noEvidenceGap,
  noKeyFindingsGap,
  unsupportedClaimsGap,
  unresolvedConflictsGap,
  incompleteQuestionsGap,
  signal,
  persistenceError,
}: {
  taskId: string;
  plan: ResearchPlanVersion;
  run: ResearchReportRun;
  markdown: string;
  evidence: ResearchEvidence[];
  extraGaps: string[];
  agentRunId?: string;
  noEvidenceGap: string;
  noKeyFindingsGap: string;
  unsupportedClaimsGap: (count: number) => string;
  unresolvedConflictsGap: (count: number) => string;
  incompleteQuestionsGap: (count: number) => string;
  signal?: AbortSignal;
  persistenceError: string;
}): Promise<string[]> {
  const store = useResearchStore.getState();
  const normalizedMarkdown = trimReportMarkdown(markdown);
  if (!normalizedMarkdown) {
    throw new Error("The model returned an empty report.");
  }
  const metadata = summarizeResearchReport(normalizedMarkdown);
  const runEvidenceIds = new Set([
    ...run.nodes.flatMap((node) => node.evidenceIds),
    ...run.claims.flatMap((claim) => [
      ...claim.supportingEvidenceIds,
      ...claim.contradictingEvidenceIds,
    ]),
  ]);
  const reportEvidence = evidence.filter(
    (item) =>
      runEvidenceIds.has(item.id) ||
      normalizedMarkdown.includes(item.locator) ||
      item.aliasLocators?.some((locator) =>
        normalizedMarkdown.includes(locator),
      ) ||
      normalizedMarkdown.includes(`[${item.sourceId}]`) ||
      item.aliasSourceIds?.some((sourceId) =>
        normalizedMarkdown.includes(`[${sourceId}]`),
      ),
  );
  const gaps = [...metadata.gaps, ...extraGaps];
  if (reportEvidence.length === 0) {
    gaps.push(noEvidenceGap);
  }
  if (metadata.keyFindings.length === 0) {
    gaps.push(noKeyFindingsGap);
  }
  const unverifiedMajorClaims = run.claims.filter(
    (claim) =>
      claim.importance === "major" && claim.verificationStatus !== "verified",
  );
  if (unverifiedMajorClaims.length > 0) {
    gaps.push(unsupportedClaimsGap(unverifiedMajorClaims.length));
  }
  const unresolvedConflicts = run.claims.filter(
    (claim) => claim.verificationStatus === "unresolved",
  ).length;
  if (unresolvedConflicts > 0) {
    gaps.push(unresolvedConflictsGap(unresolvedConflicts));
  }
  const coveredStepIds = getCoveredResearchStepIds(plan, run);
  if (coveredStepIds.length < plan.steps.length) {
    gaps.push(
      incompleteQuestionsGap(plan.steps.length - coveredStepIds.length),
    );
  }
  const audit = auditResearchReport({
    markdown: normalizedMarkdown,
    plan,
    run,
    evidence,
  });
  gaps.push(...audit.issues);
  const uniqueGaps = Array.from(new Set(gaps.map((gap) => gap.trim()))).filter(
    Boolean,
  );

  await store.updateTask(taskId, (current) => ({
    ...(current.status === "researching"
      ? transitionResearchTask(
          transitionResearchTask(current, "verifying"),
          "synthesizing",
        )
      : current.status === "verifying"
        ? transitionResearchTask(current, "synthesizing")
        : current),
    evidence,
    usage: aggregateTaskUsage(current),
  }));
  signal?.throwIfAborted();
  if (!getResearchTaskRepository().getStatus().durable) {
    throw new Error(persistenceError);
  }
  const task = useResearchStore.getState().tasksById[taskId];
  if (!task) throw new Error("Research task was not found.");
  const previousReport = task.reportVersions.at(-1);
  const previousEvidenceIds = new Set(previousReport?.evidenceIds || []);
  const previousEvidence = previousReport?.evidenceIds
    ? task.evidence.filter((item) => previousEvidenceIds.has(item.id))
    : [];
  const addedEvidenceIds = reportEvidence
    .filter((item) => !previousEvidenceIds.has(item.id))
    .map((item) => item.id);
  const changedSourceIds = Array.from(
    new Set(
      reportEvidence
        .filter(
          (item) =>
            addedEvidenceIds.includes(item.id) &&
            previousEvidence.some(
              (previous) =>
                (previous.sourceId === item.sourceId ||
                  previous.locator === item.locator) &&
                previous.contentHash !== item.contentHash,
            ),
        )
        .map((item) => item.sourceId),
    ),
  );
  const changedSources = new Set(changedSourceIds);
  const unchangedSourceIds = Array.from(
    new Set(
      previousEvidence
        .filter(
          (previous) =>
            !changedSources.has(previous.sourceId) &&
            reportEvidence.some(
              (item) =>
                item.sourceId === previous.sourceId &&
                item.contentHash === previous.contentHash,
            ),
        )
        .map((item) => item.sourceId),
    ),
  );
  const version = task.reportVersions.length + 1;
  const reportPath = `research/${task.id}/report-v${version}.md`;
  const written = await writeWorkspaceText(
    task.sessionId,
    reportPath,
    normalizedMarkdown,
    "overwrite",
  );
  if (!written.ok) throw new Error(written.error.message);
  signal?.throwIfAborted();
  const published = await publishResearchReportArtifact(
    task.sessionId,
    reportPath,
  );
  if (!published.ok) throw new Error(published.error.message);
  signal?.throwIfAborted();
  const report: ResearchReportVersion = {
    id: uuidv7(),
    version,
    artifactId: published.value.url,
    planVersion: plan.version,
    createdAt: Date.now(),
    summary: metadata.summary,
    keyFindings: metadata.keyFindings,
    gaps: uniqueGaps,
    researchRunId: run.id,
    coveredStepIds,
    evidenceIds: reportEvidence.map((item) => item.id),
    diff: {
      addedEvidenceIds,
      changedSourceIds,
      unchangedSourceIds,
    },
    ...(agentRunId ? { agentRunId } : {}),
    kind: task.pendingReportKind,
  };
  await store.updateTask(taskId, (current) => {
    const completedRun: ResearchReportRun = {
      ...run,
      phase: uniqueGaps.length > 0 ? "partial_completed" : "completed",
      endedAt: Date.now(),
      updatedAt: Date.now(),
      checkpoint: undefined,
    };
    const withReport = {
      ...upsertResearchReportRun(current, completedRun),
      evidence,
      reportVersions: [...current.reportVersions, report],
      activeReportVersion: version,
      usage: aggregateTaskUsage(current),
      checkpoint: undefined,
    };
    return transitionResearchTask(
      withReport,
      uniqueGaps.length > 0 ? "partial_completed" : "completed",
    );
  });
  if (!getResearchTaskRepository().getStatus().durable) {
    throw new Error(persistenceError);
  }
  await deleteWorkspaceFile(task.sessionId, reportPath).catch((error) => {
    logDevError(
      "Failed to remove published research report scratch file",
      error,
    );
  });
  return uniqueGaps;
}

function sanitizeCheckpointToolCall(toolCall: ToolCall): ToolCall {
  const { auth: _auth, resultImages: _resultImages, ...safe } = toolCall;
  void _auth;
  void _resultImages;
  const redactedArgs = redactSensitiveToolArgs(toolCall.args);
  const redactedResult = redactSensitiveToolArgs(toolCall.result);
  const boundedArgs = compactCheckpointValue(redactedArgs);
  const boundedResult = compactCheckpointResult(redactedResult);
  return {
    ...safe,
    args: boundedArgs,
    ...(toolCall.result !== undefined ? { result: boundedResult } : {}),
  };
}

function compactCheckpointValue(value: unknown): unknown {
  try {
    return JSON.stringify(value).length <= 8_000
      ? value
      : { omitted: true, reason: "Value exceeded the checkpoint size limit." };
  } catch {
    return { omitted: true, reason: "Value could not be serialized safely." };
  }
}

function compactCheckpointResult(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.ok === true && "data" in record) {
      return {
        ...record,
        data: "[Committed result body omitted from checkpoint; rely on the partial report and persisted result references.]",
      };
    }
  }
  return compactCheckpointValue(value);
}

function isCommittedCheckpointToolCall(toolCall: ToolCall): boolean {
  return toolCall.status === "success" && toolCall.isError !== true;
}

function redactCheckpointText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 200_000);
}

async function readCheckpoint(
  task: ResearchTask,
): Promise<SavedResearchCheckpoint | null> {
  const path = task.checkpoint?.historyPath;
  if (!path) return null;
  const result = await readWorkspaceText(task.sessionId, path);
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.value.content) as SavedResearchCheckpoint;
    return parsed?.version === 1 && parsed.taskId === task.id
      ? {
          ...parsed,
          prompt: redactCheckpointText(parsed.prompt || ""),
          partialContent: redactCheckpointText(parsed.partialContent || ""),
          toolCalls: Array.isArray(parsed.toolCalls)
            ? parsed.toolCalls
                .filter(isCommittedCheckpointToolCall)
                .map(sanitizeCheckpointToolCall)
            : [],
          outputBlocks: [],
        }
      : null;
  } catch {
    return null;
  }
}

export function ResearchRuntimeProvider({
  children,
  userInputController,
  toolConfirmationController,
  onError,
  onNotice,
}: ResearchRuntimeProviderProps) {
  const t = useTranslations("Research");
  const operationsRef = useRef(new Map<string, RunningOperation>());
  const localizedRuntimeError = useCallback(
    (
      error: unknown,
      fallbackKey: "planFallback" | "executionFallback" | "budgetFallback",
    ) =>
      error instanceof Error && error.message === t("runtime.error.persistence")
        ? error.message
        : t(`runtime.error.${fallbackKey}`),
    [t],
  );
  const dependencyText = useMemo(
    () => ({
      offline: t("runtime.dependency.offline"),
      modelUnavailable: t("runtime.dependency.modelUnavailable"),
      toolCallingUnavailable: t("runtime.dependency.toolCallingUnavailable"),
      searchUnavailable: t("runtime.dependency.searchUnavailable"),
      searchDisabled: t("runtime.dependency.searchDisabled"),
      checkpointUnavailable: t("runtime.dependency.checkpointUnavailable"),
      sourceUnavailable: (source: string) =>
        t("runtime.dependency.sourceUnavailable", { source }),
    }),
    [t],
  );

  const runOperation = useCallback(
    (
      taskId: string,
      kind: RunningOperation["kind"],
      operation: (controller: AbortController) => Promise<void>,
    ) => {
      const existing = operationsRef.current.get(taskId);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const promise = operation(controller)
        .catch((error) => {
          if (!isAbortError(error)) {
            logDevError(`Research ${kind} failed`, error);
          }
          throw error;
        })
        .finally(() => {
          const current = operationsRef.current.get(taskId);
          if (current?.controller === controller) {
            operationsRef.current.delete(taskId);
          }
        });
      operationsRef.current.set(taskId, {
        kind,
        controller,
        promise,
        phase: "idle",
        pauseRequested: false,
      });
      return promise;
    },
    [],
  );

  const pauseTask = useCallback(async (taskId: string) => {
    const store = useResearchStore.getState();
    const task = store.tasksById[taskId];
    if (!task || isTerminalResearchStatus(task.status)) return;
    const operation = operationsRef.current.get(taskId);
    if (
      operation?.kind === "research" &&
      operation.phase === "tool_execution"
    ) {
      operation.pauseRequested = true;
    } else {
      operation?.controller.abort(
        createAbortError("Research paused by the user."),
      );
    }
    await store.updateTask(taskId, (current) =>
      current.status === "paused" || isTerminalResearchStatus(current.status)
        ? current
        : transitionResearchTask(current, "paused"),
    );
    if (store.activeTaskId === taskId) store.setActiveTask(null);
    await operation?.promise.catch(() => undefined);
  }, []);

  const cancelTask = useCallback(async (taskId: string) => {
    const store = useResearchStore.getState();
    const task = store.tasksById[taskId];
    if (
      !task ||
      task.status === "completed" ||
      task.status === "partial_completed" ||
      task.status === "cancelled"
    ) {
      return;
    }
    const operation = operationsRef.current.get(taskId);
    operation?.controller.abort(
      createAbortError("Research cancelled by the user."),
    );
    await store.updateTask(taskId, (current) =>
      current.status === "completed" ||
      current.status === "partial_completed" ||
      current.status === "cancelled"
        ? current
        : {
            ...transitionResearchTask(current, "cancelled"),
            reportRuns: current.reportRuns.map((run) =>
              run.id === current.activeReportRunId
                ? applyResearchRunUserStop(run, "cancel")
                : run,
            ),
            checkpoint: undefined,
          },
    );
    if (store.activeTaskId === taskId) store.setActiveTask(null);
    await operation?.promise.catch(() => undefined);
  }, []);

  const claimActiveSlot = useCallback(
    async (sessionId: string, nextTaskId?: string): Promise<boolean> => {
      const store = useResearchStore.getState();
      const activeId =
        store.activeTaskId ||
        [...operationsRef.current.keys()].find(
          (taskId) => taskId !== nextTaskId,
        );
      if (!activeId || activeId === nextTaskId) return true;
      const active = store.tasksById[activeId];
      if (
        !active ||
        (!isActiveResearchStatus(active.status) &&
          !operationsRef.current.has(activeId))
      ) {
        store.setActiveTask(null);
        return true;
      }
      const response = await userInputController.requestInput({
        requestId: uuidv7(),
        toolCallId: `research-slot-${uuidv7()}`,
        sessionId,
        questions: [
          {
            id: "research_slot",
            header: t("global.label"),
            question: t("runtime.slot.question"),
            kind: "single_choice",
            options: [
              {
                value: "pause",
                label: t("runtime.slot.pause"),
                description: t("runtime.slot.pauseDescription"),
              },
              {
                value: "cancel",
                label: t("runtime.slot.cancel"),
                description: t("runtime.slot.cancelDescription"),
              },
              {
                value: "return",
                label: t("runtime.slot.return"),
                description: t("runtime.slot.returnDescription"),
              },
            ],
          },
        ],
      });
      if (response.status !== "answered") return false;
      const decision = response.answers.research_slot;
      if (decision === "pause") await pauseTask(activeId);
      else if (decision === "cancel") await cancelTask(activeId);
      else return false;
      return true;
    },
    [cancelTask, pauseTask, t, userInputController],
  );

  const preparePlan = useCallback(
    async (taskId: string, adjustment?: string) =>
      runOperation(taskId, "planning", async (controller) => {
        const store = useResearchStore.getState();
        const initial = store.tasksById[taskId];
        if (!initial) throw new Error("Research task was not found.");
        try {
          const { model, chatConfig, effective, settings } =
            resolveTaskContext(initial);
          const provisionalSnapshot = await createSourceSnapshot(initial);
          const allowedSourceTypes =
            getAvailableResearchSourceTypes(provisionalSnapshot);
          const strategy = resolveResearchStrategy(initial.budgetPreset);
          const clarificationRunId = uuidv7();
          const reconRunId = uuidv7();
          const criticRunId = uuidv7();
          await store.updateTask(taskId, (current) => {
            const nextStatus =
              current.status === "clarifying"
                ? current
                : transitionResearchTask(current, "clarifying");
            return {
              ...nextStatus,
              agentRunIds: [
                ...nextStatus.agentRunIds,
                clarificationRunId,
                reconRunId,
                criticRunId,
              ],
              error: undefined,
            };
          });
          if (!getResearchTaskRepository().getStatus().durable) {
            throw new Error(t("runtime.error.persistence"));
          }

          let clarifiedBrief = "";
          clarifiedBrief = await streamChatResponse(
            initial.sessionId,
            model,
            [],
            buildResearchPlanPrompt({
              task: initial,
              adjustment,
              reconnaissanceAllowed: false,
              allowedSourceTypes,
              strategy,
            }),
            [],
            {
              ...chatConfig,
              chatMode: "research",
              useAgentMode: false,
              useDeepResearch: true,
              useSearch: false,
              useReasoning: false,
            },
            (text) => {
              clarifiedBrief = text;
            },
            [
              effective.systemInstruction,
              "This is the clarification boundary for Deep Research. Source access is forbidden. Ask at most three questions in one request_user_input call only when the answer materially changes scope, audience, time range, source permission, or deliverable.",
            ]
              .filter(Boolean)
              .join("\n\n"),
            undefined,
            undefined,
            undefined,
            undefined,
            controller.signal,
            [],
            undefined,
            undefined,
            toolConfirmationController,
            {
              executionWorkflow: { kind: "research", phase: "plan" },
              allowedToolIds: ["request_user_input"],
              enforceAllowedToolIds: true,
              allowedToolEffects: ["local_read"],
              approvalMode: effective.approvalMode,
              agentBudget: {
                maxToolRounds: Math.min(3, initial.budget.maxToolRounds),
                maxToolCalls: Math.min(1, initial.budget.maxToolCalls),
                maxDurationMs: Math.min(
                  10 * 60 * 1_000,
                  initial.budget.maxDurationMs,
                ),
                ...(initial.budget.maxTotalTokens
                  ? { maxTotalTokens: initial.budget.maxTotalTokens }
                  : {}),
              },
              agentRun: {
                id: clarificationRunId,
                userMessageId: initial.userMessageId,
                modelMessageId: initial.cardMessageId,
              },
              abortAgentRunAsInterrupted: true,
              userInputController,
            },
          );
          controller.signal.throwIfAborted();

          const reconEnabled =
            provisionalSnapshot.searchEnabled &&
            effective.searchCompatibility.enabled &&
            effective.searchCompatibility.mode === "external";
          const reconStartedAt = Date.now();
          const executedQueries: string[] = [];
          let planningToolCalls: ToolCall[] = [];
          const reconQueryBudget: BuiltinResearchQueryBudget = {
            remainingQueries: 2,
            maxResultsPerQuery: 5,
            seenQueries: new Set<string>(),
            deadlineAt: reconStartedAt + 30_000,
            onQueriesExecuted: (queries) => executedQueries.push(...queries),
          };
          const reconAdjustment = [
            adjustment?.trim(),
            clarifiedBrief.trim()
              ? `Clarified provisional plan (not evidence):\n${clarifiedBrief.slice(0, 30_000)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n");
          let candidateContent = "";
          candidateContent = await streamChatResponse(
            initial.sessionId,
            model,
            [],
            buildResearchPlanPrompt({
              task: initial,
              adjustment: reconAdjustment,
              reconnaissanceAllowed: reconEnabled,
              allowedSourceTypes,
              strategy,
            }),
            [],
            {
              ...chatConfig,
              chatMode: "research",
              useAgentMode: false,
              useDeepResearch: true,
              useSearch: reconEnabled,
              useReasoning: false,
            },
            (text) => {
              candidateContent = text;
            },
            [
              effective.systemInstruction,
              reconEnabled
                ? "This is bounded pre-approval reconnaissance. Only public web search summaries are allowed: at most two queries, five results per query, and thirty seconds total. Do not fetch source bodies. Reconnaissance is audit metadata, not report evidence."
                : "Public reconnaissance is unavailable. Generate the plan with source feasibility explicitly treated as unverified.",
            ]
              .filter(Boolean)
              .join("\n\n"),
            undefined,
            (toolCalls) => {
              planningToolCalls = toolCalls;
            },
            undefined,
            undefined,
            controller.signal,
            [],
            undefined,
            undefined,
            toolConfirmationController,
            {
              executionWorkflow: { kind: "research", phase: "plan" },
              allowedToolIds: reconEnabled ? ["web_search"] : [],
              enforceAllowedToolIds: true,
              allowedToolEffects: reconEnabled
                ? ["network_read"]
                : ["local_read"],
              approvalMode: effective.approvalMode,
              researchQueryBudget: reconQueryBudget,
              agentBudget: {
                maxToolRounds: Math.min(3, initial.budget.maxToolRounds),
                maxToolCalls: Math.min(2, initial.budget.maxToolCalls),
                maxDurationMs: Math.min(
                  10 * 60 * 1_000,
                  initial.budget.maxDurationMs,
                ),
                ...(initial.budget.maxTotalTokens
                  ? { maxTotalTokens: initial.budget.maxTotalTokens }
                  : {}),
              },
              agentRun: {
                id: reconRunId,
                userMessageId: initial.userMessageId,
                modelMessageId: initial.cardMessageId,
              },
              abortAgentRunAsInterrupted: true,
            },
          );
          controller.signal.throwIfAborted();
          const reconCompletedAt = Date.now();

          const candidate = parseResearchPlan(candidateContent, initial.goal);
          const candidateIssues = candidate.valid
            ? validateResearchPlanHostContract({
                plan: candidate.data,
                strategy,
                allowedSourceTypes,
              })
            : candidate.error.issues;
          let criticContent = "";
          criticContent = await streamChatResponse(
            initial.sessionId,
            model,
            [],
            buildResearchPlanRepairPrompt({
              task: initial,
              invalidOutput: candidateContent,
              issues:
                candidateIssues.length > 0
                  ? candidateIssues
                  : [
                      "No structural errors were found. Critique scope, overlap, evidence thresholds, source strategy, and completion criteria; preserve every host budget and permission constraint.",
                    ],
              allowedSourceTypes,
              strategy,
            }),
            [],
            {
              ...chatConfig,
              chatMode: "research",
              useAgentMode: false,
              useDeepResearch: false,
              useSearch: false,
              useReasoning: false,
            },
            (text) => {
              criticContent = text;
            },
            `${effective.systemInstruction}\n\nThis is a closed-book plan critique and repair. All tools and source access are disabled.`,
            undefined,
            undefined,
            undefined,
            undefined,
            controller.signal,
            [],
            undefined,
            undefined,
            undefined,
            {
              disableTools: true,
              agentRun: {
                id: criticRunId,
                userMessageId: initial.userMessageId,
                modelMessageId: initial.cardMessageId,
              },
            },
          );
          controller.signal.throwIfAborted();
          const criticized = parseResearchPlan(criticContent, initial.goal);
          const criticizedIssues = criticized.valid
            ? validateResearchPlanHostContract({
                plan: criticized.data,
                strategy,
                allowedSourceTypes,
              })
            : criticized.error.issues;
          const parsed =
            criticized.valid && criticizedIssues.length === 0
              ? criticized
              : candidate.valid && candidateIssues.length === 0
                ? candidate
                : null;
          if (!parsed) {
            await store.updateTask(taskId, (current) =>
              current.status === "cancelled"
                ? current
                : {
                    ...transitionResearchTask(current, "failed"),
                    error: {
                      code: "RESEARCH_PLAN_INVALID",
                      message: [
                        "The research plan remained invalid after one repair.",
                        ...criticizedIssues.slice(0, 8),
                      ].join(" "),
                      recoverable: true,
                    },
                  },
            );
            onError?.(t("runtime.error.plan"));
            return;
          }

          const recon = buildResearchReconSnapshot({
            enabled: reconEnabled,
            providerId: settings.search.provider,
            startedAt: reconStartedAt,
            completedAt: reconCompletedAt,
            executedQueries,
            toolCalls: planningToolCalls,
          });
          const sourceSnapshot = await createSourceSnapshot(
            store.tasksById[taskId] || initial,
          );
          await store.updateTask(taskId, (current) => {
            if (current.status === "cancelled") return current;
            const version = current.planVersions.length + 1;
            const plan: ResearchPlanVersion = {
              id: uuidv7(),
              version,
              ...parsed.data,
              strategy,
              recon,
              createdAt: Date.now(),
              ...(adjustment?.trim()
                ? { adjustment: adjustment.trim().slice(0, 8_000) }
                : {}),
            };
            const planningTask =
              current.status === "clarifying"
                ? current
                : transitionResearchTask(current, "clarifying");
            return {
              ...transitionResearchTask(planningTask, "plan_ready"),
              planVersions: [...current.planVersions, plan],
              activePlanVersion: version,
              sourceSnapshot,
              checkpoint: undefined,
              error: undefined,
            };
          });
          if (!getResearchTaskRepository().getStatus().durable) {
            throw new Error(t("runtime.error.persistence"));
          }
          onNotice?.(t("runtime.notice.planReady"));
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) {
            await store.updateTask(taskId, (current) =>
              current.status === "cancelled" || current.status === "paused"
                ? current
                : transitionResearchTask(current, "paused"),
            );
            return;
          }
          if (error instanceof AgentRunLeaseConflictError) {
            const message = t("runtime.dependency.leaseConflict");
            await store.updateTask(taskId, (current) =>
              current.status === "cancelled"
                ? current
                : {
                    ...current,
                    error: {
                      code: "AGENT_RUN_LEASE_CONFLICT",
                      message,
                      recoverable: true,
                    },
                  },
            );
            onError?.(message);
            return;
          }
          await store.updateTask(taskId, (current) =>
            current.status === "cancelled"
              ? current
              : {
                  ...transitionResearchTask(current, "failed"),
                  error: {
                    code: "RESEARCH_PLAN_FAILED",
                    message: localizedRuntimeError(error, "planFallback"),
                    recoverable: true,
                  },
                },
          );
          onError?.(t("runtime.error.plan"));
        }
      }),
    [
      onError,
      onNotice,
      localizedRuntimeError,
      runOperation,
      t,
      toolConfirmationController,
      userInputController,
    ],
  );

  const executeResearch = useCallback(
    async (taskId: string) => {
      let pendingScopeAdjustment: string | undefined;
      await runOperation(taskId, "research", async (controller) => {
        const store = useResearchStore.getState();
        let task = store.tasksById[taskId];
        if (!task) throw new Error("Research task was not found.");
        const plan = getActivePlan(task);
        const snapshot = task.sourceSnapshot;
        if (!plan || !snapshot?.model) {
          throw new Error("The approved research plan is incomplete.");
        }
        const dependencyError = getResearchDependencyError(
          task,
          dependencyText,
        );
        if (dependencyError) {
          await store.updateTask(taskId, (current) => ({
            ...transitionResearchTask(current, "paused"),
            error: { ...dependencyError, recoverable: true },
          }));
          store.setActiveTask(null);
          onNotice?.(dependencyError.message);
          return;
        }
        const invalidWorkspaceSource = await getInvalidFrozenWorkspaceSource(
          snapshot,
          task.sessionId,
        );
        if (invalidWorkspaceSource) {
          const workspaceError: ResearchDependencyError = {
            code: "RESEARCH_SOURCE_REVOKED",
            message: dependencyText.sourceUnavailable(invalidWorkspaceSource),
          };
          await store.updateTask(taskId, (current) => ({
            ...transitionResearchTask(current, "paused"),
            error: { ...workspaceError, recoverable: true },
          }));
          store.setActiveTask(null);
          onNotice?.(workspaceError.message);
          return;
        }

        const { chatConfig, effective, settings } = resolveTaskContext(task);
        const messages = await loadSessionMessages(task.sessionId);
        const originMessage = messages.find(
          (message) => message.id === task.userMessageId,
        );
        const currentAttachments = originMessage?.attachments || [];
        const currentAttachmentIds = new Set(
          currentAttachments.map((attachment) => attachment.id),
        );
        const missingAttachment = snapshot.attachmentIds.find(
          (attachmentId) => !currentAttachmentIds.has(attachmentId),
        );
        if (missingAttachment) {
          const missingSourceError: ResearchDependencyError = {
            code: "RESEARCH_SOURCE_REVOKED",
            message: dependencyText.sourceUnavailable(missingAttachment),
          };
          await store.updateTask(taskId, (current) => ({
            ...transitionResearchTask(current, "paused"),
            error: { ...missingSourceError, recoverable: true },
          }));
          store.setActiveTask(null);
          onNotice?.(missingSourceError.message);
          return;
        }
        const frozenAttachments = currentAttachments.filter(
          (attachment) =>
            !isKnowledgeAttachment(attachment) &&
            snapshot.attachmentIds.includes(attachment.id),
        );
        const frozenKnowledgeAttachments = currentAttachments.filter(
          (attachment) => {
            if (isKnowledgeCollectionAttachment(attachment)) {
              return Boolean(
                attachment.data &&
                snapshot.knowledgeCollectionIds.includes(attachment.data),
              );
            }
            const file = parseKnowledgeFileAttachmentData(attachment);
            return Boolean(
              file &&
              snapshot.knowledgeCollectionIds.includes(file.collectionId),
            );
          },
        );
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
                  collections.find((collection) => collection.id === id)
                    ?.name || id,
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
        const priorReport =
          task.pendingReportKind === "initial"
            ? ""
            : await readReportMarkdown(task);
        await useAgentRunStore.getState().loadSessionRuns(task.sessionId);

        const resumeAtVerification =
          task.checkpoint?.resumeStatus === "verifying";
        const resumeAtSynthesis =
          task.checkpoint?.resumeStatus === "synthesizing";
        const existingRun = getActiveResearchReportRun(task);
        let researchRun: ResearchReportRun;
        if (
          !existingRun ||
          existingRun.planVersion !== plan.version ||
          ["completed", "partial_completed", "failed", "cancelled"].includes(
            existingRun.phase,
          )
        ) {
          researchRun = createResearchReportRun({
            taskId: task.id,
            plan,
            reportKind: task.pendingReportKind,
          });
        } else if (existingRun.phase === "paused") {
          researchRun = {
            ...existingRun,
            phase: resumeAtSynthesis
              ? "synthesizing"
              : resumeAtVerification
                ? "verifying"
                : "exploring",
            stopReason: undefined,
            updatedAt: Date.now(),
          };
        } else {
          researchRun = existingRun;
        }
        await store.updateTask(taskId, (current) => ({
          ...upsertResearchReportRun(current, researchRun!),
          error: undefined,
        }));
        task = store.tasksById[taskId];

        const explorationQueryLimit = getResearchExplorationQueryLimit(
          researchRun.strategy,
        );
        const explorationToolCallCap = getResearchExplorationToolCallLimit(
          task.budget,
        );
        const sourceBodyLimit = getResearchSourceBodyLimit(
          researchRun.strategy,
          explorationToolCallCap,
        );
        let currentEvidence = [...task.evidence];
        let searchOnlyCount = 0;
        let failedSourceOperationCount = 0;
        let lastAgentRunId: string | undefined;

        const persistRun = async (
          nextRun: ResearchReportRun,
          evidence: ResearchEvidence[] = currentEvidence,
          checkpoint?: ResearchCheckpoint,
        ) => {
          await store.updateTask(taskId, (current) => {
            const withRun = upsertResearchReportRun(current, nextRun);
            return {
              ...withRun,
              evidence,
              usage: aggregateTaskUsage(withRun),
              ...(checkpoint ? { checkpoint } : { checkpoint: undefined }),
            };
          });
          researchRun = nextRun;
          currentEvidence = evidence;
          task = store.tasksById[taskId];
        };

        const executeWave = async ({
          run,
          waveId,
          nodeIds,
          phase,
          queryAllowance,
          expandFrontier,
        }: {
          run: ResearchReportRun;
          waveId: string;
          nodeIds: string[];
          phase: "exploring" | "verifying";
          queryAllowance: number;
          expandFrontier: boolean;
        }): Promise<ResearchReportRun> => {
          const invalidWorkspaceSource = await getInvalidFrozenWorkspaceSource(
            snapshot,
            task.sessionId,
          );
          if (invalidWorkspaceSource) {
            throw new Error(
              dependencyText.sourceUnavailable(invalidWorkspaceSource),
            );
          }
          const currentTask = store.tasksById[taskId];
          const availableBudget = remainingBudget(currentTask);
          if (!availableBudget) return run;
          const currentExecutionUsage = aggregateExecutionUsage(
            getCurrentResearchReportRunIds(currentTask),
          );
          const phaseToolCallAllowance =
            phase === "exploring"
              ? Math.min(
                  availableBudget.maxToolCalls,
                  Math.max(
                    0,
                    explorationToolCallCap - currentExecutionUsage.toolCalls,
                  ),
                )
              : availableBudget.maxToolCalls;
          const reservedModelRounds = phase === "exploring" ? 2 : 1;
          if (
            phaseToolCallAllowance <= 0 ||
            availableBudget.maxToolRounds <= reservedModelRounds
          ) {
            return run;
          }

          const resumeDecision = getResearchRunResumeDecision(
            currentTask,
            useAgentRunStore.getState().runsById,
          );
          const resumeThisWave =
            currentTask.checkpoint?.researchRunId === run.id &&
            resumeDecision.action === "resume";
          if (
            currentTask.checkpoint?.researchRunId === run.id &&
            resumeDecision.action === "unavailable"
          ) {
            throw new Error(dependencyText.checkpointUnavailable);
          }
          const agentRunId = resumeThisWave ? resumeDecision.runId : uuidv7();
          lastAgentRunId = agentRunId;
          if (!resumeThisWave) {
            await store.updateTask(taskId, (current) => ({
              ...current,
              agentRunIds: [...current.agentRunIds, agentRunId],
              executionRunIds: [...current.executionRunIds, agentRunId],
            }));
          }

          const checkpointPath = `research/checkpoints/${task.id}-${run.id}-wave-${run.waves.find((wave) => wave.id === waveId)?.index || 0}.json`;
          const savedCheckpoint = resumeThisWave
            ? await readCheckpoint(currentTask)
            : null;

          const startedAt = Date.now();
          let activeRun: ResearchReportRun = {
            ...run,
            phase,
            waves: run.waves.map((wave) =>
              wave.id === waveId
                ? {
                    ...wave,
                    status: "running" as const,
                    startedAt: wave.startedAt ?? startedAt,
                  }
                : wave,
            ),
            nodes: run.nodes.map((node) =>
              nodeIds.includes(node.id)
                ? {
                    ...node,
                    status: "searching" as const,
                    stopReason: undefined,
                    updatedAt: startedAt,
                  }
                : node,
            ),
            updatedAt: startedAt,
          };
          await persistRun(
            activeRun,
            currentEvidence,
            resumeThisWave ? currentTask.checkpoint : undefined,
          );
          let latestContent = savedCheckpoint?.partialContent || "";
          let latestToolCalls = savedCheckpoint?.toolCalls || [];
          let webSources: Source[] = [];
          let knowledgeSources: Source[] = [];
          let checkpointQueue = Promise.resolve();
          const executedQueries: string[] = getResearchQueriesFromToolCalls(
            savedCheckpoint?.toolCalls || [],
          );
          const readLocators: string[] = getResearchSourceLocatorsFromToolCalls(
            savedCheckpoint?.toolCalls || [],
          );
          const queryBudget: BuiltinResearchQueryBudget = {
            remainingQueries: Math.max(0, queryAllowance),
            maxResultsPerQuery: run.strategy.resultsPerQuery,
            seenQueries: new Set(
              [...run.executedQueries, ...executedQueries].map(
                normalizeResearchQuery,
              ),
            ),
            onQueriesExecuted: (queries) => executedQueries.push(...queries),
          };
          const sourceBudget: BuiltinResearchSourceBudget = {
            remainingSourceBodies: Math.max(
              0,
              sourceBodyLimit - run.usage.sourceBodyCount - readLocators.length,
            ),
            onSourceBodiesRead: (locators) => readLocators.push(...locators),
          };
          const wavePrompt = [
            buildResearchWavePrompt({
              task: store.tasksById[taskId],
              plan,
              run: activeRun,
              nodeIds,
              evidence: currentEvidence,
            }),
            phase === "verifying"
              ? `This is the reserved verification pass. Target unresolved, pending, or unsupported major claims only. At most ${queryAllowance} new queries are permitted. Do not expand the frontier.`
              : `This wave may execute at most ${queryAllowance} new queries. Batch up to four queries in search_web when useful.`,
            attachmentCatalog,
            workspaceCatalog,
          ]
            .filter(Boolean)
            .join("\n\n");
          const persistWaveCheckpoint = () => {
            const payload: SavedResearchCheckpoint = {
              version: 1,
              taskId: task.id,
              savedAt: Date.now(),
              prompt: redactCheckpointText(wavePrompt),
              partialContent: redactCheckpointText(latestContent),
              toolCalls: latestToolCalls
                .filter(isCommittedCheckpointToolCall)
                .map(sanitizeCheckpointToolCall),
              outputBlocks: [],
            };
            checkpointQueue = checkpointQueue
              .catch(() => undefined)
              .then(async () => {
                const written = await writeWorkspaceText(
                  task.sessionId,
                  checkpointPath,
                  JSON.stringify(payload),
                  "overwrite",
                );
                if (!written.ok) throw new Error(written.error.message);
                const agentRun =
                  useAgentRunStore.getState().runsById[agentRunId];
                const runCheckpoint = {
                  createdAt: Date.now(),
                  waveIndex:
                    activeRun.waves.find((wave) => wave.id === waveId)?.index ||
                    0,
                  frontierNodeIds: [...activeRun.frontierNodeIds],
                  committedEvidenceIds: currentEvidence.map((item) => item.id),
                  committedToolExecutionIds:
                    agentRun?.toolExecutions
                      .filter((execution) => execution.status === "committed")
                      .map((execution) => execution.id) || [],
                };
                activeRun = { ...activeRun, checkpoint: runCheckpoint };
                await store.updateTask(taskId, (current) => ({
                  ...upsertResearchReportRun(current, activeRun),
                  checkpoint: {
                    createdAt: runCheckpoint.createdAt,
                    resumeStatus:
                      phase === "verifying" ? "verifying" : "researching",
                    committedEvidenceIds: runCheckpoint.committedEvidenceIds,
                    committedToolExecutionIds:
                      runCheckpoint.committedToolExecutionIds,
                    researchRunId: activeRun.id,
                    historyPath: checkpointPath,
                  },
                }));
              });
            return checkpointQueue;
          };
          const resumeHistory: Message[] = savedCheckpoint
            ? [
                {
                  id: uuidv7(),
                  role: "user",
                  content: savedCheckpoint.prompt,
                  timestamp: savedCheckpoint.savedAt,
                },
                {
                  id: uuidv7(),
                  role: "model",
                  content: savedCheckpoint.partialContent,
                  toolCalls: savedCheckpoint.toolCalls,
                  outputBlocks: savedCheckpoint.outputBlocks,
                  timestamp: savedCheckpoint.savedAt,
                },
              ]
            : [];

          try {
            const result = await streamChatResponse(
              task.sessionId,
              snapshot.model!,
              resumeHistory,
              savedCheckpoint
                ? `${wavePrompt}\n\nResume only from committed results above. Do not replay an already committed external call.`
                : wavePrompt,
              frozenAttachments,
              {
                ...chatConfig,
                chatMode: "research",
                useAgentMode: false,
                useDeepResearch: true,
                useSearch: snapshot.searchEnabled,
                useReasoning: snapshot.reasoningMode !== "off",
                reasoningMode:
                  snapshot.reasoningMode || chatConfig.reasoningMode,
              },
              (text) => {
                latestContent = text;
              },
              `${effective.systemInstruction}\n\nThe host-controlled wave, source snapshot, query allowance, and read-only policy are authoritative.`,
              (isSearching, results) => {
                if (!isSearching && results?.sources) {
                  webSources = results.sources;
                }
              },
              (toolCalls) => {
                latestToolCalls = toolCalls;
                void persistWaveCheckpoint();
              },
              undefined,
              undefined,
              controller.signal,
              snapshot.pluginIds,
              undefined,
              undefined,
              toolConfirmationController,
              {
                executionWorkflow: { kind: "research", phase: "execute" },
                knowledgeScope: {
                  attachments: [
                    ...approvedKnowledgeAttachments,
                    ...frozenAttachments,
                  ],
                  collections,
                  ragConfig: { ...settings.rag },
                },
                workspaceReadScope: (snapshot.workspaceSources || []).map(
                  (source) => source.path,
                ),
                onKnowledgeSources: (sources) => {
                  knowledgeSources = sources;
                },
                allowedToolIds: snapshot.toolIds,
                enforceAllowedToolIds: true,
                allowedToolEffects: ["local_read", "network_read"],
                approvalMode: snapshot.approvalMode,
                researchQueryBudget: queryBudget,
                researchSourceBudget: sourceBudget,
                agentBudget: {
                  ...availableBudget,
                  maxToolRounds: Math.min(
                    3,
                    availableBudget.maxToolRounds - reservedModelRounds,
                  ),
                  maxToolCalls: phaseToolCallAllowance,
                },
                agentRun: {
                  id: agentRunId,
                  userMessageId: task.userMessageId,
                  modelMessageId: task.cardMessageId,
                },
                resumeAgentRun: resumeThisWave,
                abortAgentRunAsInterrupted: true,
                onAgentExecutionPhase: (nextPhase) => {
                  const operation = operationsRef.current.get(taskId);
                  if (operation?.controller === controller) {
                    operation.phase = nextPhase;
                  }
                },
                shouldPauseAfterToolBatch: () => {
                  const operation = operationsRef.current.get(taskId);
                  return Boolean(
                    operation?.controller === controller &&
                    operation.pauseRequested,
                  );
                },
                userInputController,
                memoryScopes: snapshot.memoryScopes,
                memoryScopeIds: snapshot.memoryScopeIds,
              },
            );
            latestContent = result || latestContent;
            controller.signal.throwIfAborted();
            await checkpointQueue.catch(() => undefined);
            const currentTaskAfterWave = store.tasksById[taskId];
            const firstNode = activeRun.nodes.find((node) =>
              nodeIds.includes(node.id),
            );
            if (!firstNode) {
              throw new Error(
                "The research wave no longer has an approved node.",
              );
            }
            const collected = await collectTaskEvidence({
              task: currentTaskAfterWave,
              runIds: [agentRunId],
              webSources,
              knowledgeSources,
              defaultStepId: firstNode.stepId,
              defaultNodeId: firstNode.id,
            });
            searchOnlyCount += collected.searchOnlyCount;
            failedSourceOperationCount += latestToolCalls.filter(
              (toolCall) =>
                toolCall.status === "error" ||
                toolCall.status === "denied" ||
                toolCall.status === "skipped",
            ).length;
            const parsedPackets = parseResearchWavePackets(latestContent, {
              allowedNodeIds: nodeIds,
              allowedSourceIds: collected.evidence.map((item) => item.sourceId),
              allowedEvidenceIds: collected.evidence.map((item) => item.id),
              allowedStepIds: plan.steps.map((step) => step.id),
              expectedStepIdByNode: Object.fromEntries(
                activeRun.nodes
                  .filter((node) => nodeIds.includes(node.id))
                  .map((node) => [node.id, node.stepId]),
              ),
              existingClaimSignatures: Object.fromEntries(
                activeRun.claims.map((claim) => [
                  claim.id,
                  getResearchClaimSignature(claim.stepId, claim.text),
                ]),
              ),
              existingMirrorBySourceId: Object.fromEntries(
                collected.evidence.flatMap((item) =>
                  item.mirrorOfSourceId
                    ? [[item.sourceId, item.mirrorOfSourceId]]
                    : [],
                ),
              ),
              canonicalSourceIdByAlias: Object.fromEntries(
                collected.evidence.flatMap((item) =>
                  (item.aliasSourceIds || []).map((aliasSourceId) => [
                    aliasSourceId,
                    item.sourceId,
                  ]),
                ),
              ),
            });
            const executionUsage = aggregateExecutionUsage(
              getCurrentResearchReportRunIds(store.tasksById[taskId]),
            );
            const baseUsage = {
              ...activeRun.usage,
              queryCount: activeRun.usage.queryCount + executedQueries.length,
              sourceBodyCount: Math.min(
                sourceBodyLimit,
                Math.max(
                  activeRun.usage.sourceBodyCount + readLocators.length,
                  activeRun.usage.sourceBodyCount +
                    collected.newEvidenceIds.length,
                ),
              ),
              ...executionUsage,
            };
            if (!parsedPackets.valid) {
              const completedAt = Date.now();
              const failedRun: ResearchReportRun = {
                ...activeRun,
                usage: baseUsage,
                executedQueries: [
                  ...activeRun.executedQueries,
                  ...executedQueries,
                ],
                waves: activeRun.waves.map((wave) =>
                  wave.id === waveId
                    ? {
                        ...wave,
                        status: "failed" as const,
                        completedAt,
                        newEvidenceCount: collected.newEvidenceIds.length,
                      }
                    : wave,
                ),
                nodes: activeRun.nodes.map((node) =>
                  nodeIds.includes(node.id)
                    ? {
                        ...node,
                        status: "failed" as const,
                        updatedAt: completedAt,
                      }
                    : node,
                ),
                frontierNodeIds: activeRun.frontierNodeIds.filter(
                  (nodeId) => !nodeIds.includes(nodeId),
                ),
                stopReason: {
                  code: "no_new_sources",
                  at: completedAt,
                  detail: parsedPackets.error.issues.slice(0, 4).join(" "),
                },
                updatedAt: completedAt,
                checkpoint: undefined,
              };
              await persistRun(failedRun, collected.evidence);
              await deleteWorkspaceFile(task.sessionId, checkpointPath).catch(
                () => undefined,
              );
              return failedRun;
            }
            const integrated = integrateLearningPackets({
              run: activeRun,
              plan,
              evidence: collected.evidence,
              packets: parsedPackets.data,
              waveId,
              newEvidenceCount: collected.newEvidenceIds.length,
              expandFrontier,
            });
            const requiresScopeApproval = parsedPackets.data.some((packet) =>
              packet.followUps.some(
                (followUp) => followUp.scopeImpact !== "within",
              ),
            );
            if (requiresScopeApproval && !pendingScopeAdjustment) {
              pendingScopeAdjustment = buildResearchScopeExpansionAdjustment(
                parsedPackets.data,
              );
            }
            const completedRun: ResearchReportRun = {
              ...integrated.run,
              phase: requiresScopeApproval ? "awaiting_scope_approval" : phase,
              usage: baseUsage,
              executedQueries: [
                ...integrated.run.executedQueries,
                ...executedQueries,
              ],
              ...(requiresScopeApproval
                ? {
                    stopReason: {
                      code: "scope_approval_required" as const,
                      at: Date.now(),
                    },
                  }
                : {}),
              checkpoint: {
                createdAt: Date.now(),
                waveIndex:
                  integrated.run.waves.find((wave) => wave.id === waveId)
                    ?.index || 0,
                frontierNodeIds: [...integrated.run.frontierNodeIds],
                committedEvidenceIds: integrated.evidence.map(
                  (item) => item.id,
                ),
                committedToolExecutionIds:
                  useAgentRunStore
                    .getState()
                    .runsById[agentRunId]?.toolExecutions.filter(
                      (execution) => execution.status === "committed",
                    )
                    .map((execution) => execution.id) || [],
              },
              updatedAt: Date.now(),
            };
            const completedCheckpoint = completedRun.checkpoint!;
            await persistRun(completedRun, integrated.evidence, {
              createdAt: completedCheckpoint.createdAt,
              resumeStatus: phase === "verifying" ? "verifying" : "researching",
              committedEvidenceIds: completedCheckpoint.committedEvidenceIds,
              committedToolExecutionIds:
                completedCheckpoint.committedToolExecutionIds,
              researchRunId: completedRun.id,
            });
            await deleteWorkspaceFile(task.sessionId, checkpointPath).catch(
              () => undefined,
            );
            return completedRun;
          } catch (error) {
            await persistWaveCheckpoint().catch(() => undefined);
            await checkpointQueue.catch(() => undefined);
            throw error;
          }
        };

        try {
          if (!resumeAtVerification && !resumeAtSynthesis) {
            let waveGuard = 0;
            while (waveGuard < 64) {
              waveGuard += 1;
              controller.signal.throwIfAborted();
              if (
                researchRun.phase === "awaiting_scope_approval" ||
                researchRun.stopReason
              ) {
                break;
              }
              if (
                researchRun.usage.queryCount >= explorationQueryLimit ||
                researchRun.usage.sourceBodyCount >= sourceBodyLimit
              ) {
                break;
              }
              const executionUsage = aggregateExecutionUsage(
                getCurrentResearchReportRunIds(store.tasksById[taskId]),
              );
              if (
                executionUsage.toolCalls >= explorationToolCallCap ||
                executionUsage.toolRounds >=
                  Math.max(0, task.budget.maxToolRounds - 2)
              ) {
                break;
              }
              let activeWave = researchRun.waves.find((wave) =>
                ["queued", "running", "paused"].includes(wave.status),
              );
              if (!activeWave) {
                const next = createNextResearchWave(researchRun);
                if (!next) break;
                researchRun = next.run;
                activeWave = next.wave;
              }
              const queryAllowance = Math.min(
                explorationQueryLimit - researchRun.usage.queryCount,
                Math.max(1, activeWave.breadth),
              );
              researchRun = await executeWave({
                run: researchRun,
                waveId: activeWave.id,
                nodeIds: [...activeWave.nodeIds],
                phase: "exploring",
                queryAllowance,
                expandFrontier: true,
              });
              if (researchRun.phase === "awaiting_scope_approval") break;
              const remaining = remainingBudget(store.tasksById[taskId]);
              const stopReason = getResearchStopReason(researchRun.strategy, {
                coverage: researchRun.coverage,
                frontierCount: getResearchFrontier(researchRun).length,
                currentDepth: Math.max(
                  0,
                  ...researchRun.nodes.map((node) => node.depth),
                ),
                queryCount: researchRun.usage.queryCount,
                sourceBodyCount: researchRun.usage.sourceBodyCount,
                sourceBodyLimit,
                remainingToolCalls: remaining?.maxToolCalls || 0,
                wavesWithoutNewSources: countTrailingWaves(
                  researchRun,
                  "newEvidenceCount",
                ),
                wavesWithoutNewVerifiedClaims: countTrailingWaves(
                  researchRun,
                  "newVerifiedClaimCount",
                ),
              });
              if (stopReason) {
                researchRun = {
                  ...researchRun,
                  stopReason,
                  updatedAt: Date.now(),
                };
                await persistRun(researchRun);
                break;
              }
            }
          }

          if (researchRun.phase === "awaiting_scope_approval") {
            const checkpoint: ResearchCheckpoint = {
              createdAt: Date.now(),
              resumeStatus: "clarifying",
              committedEvidenceIds: currentEvidence.map((item) => item.id),
              committedToolExecutionIds:
                researchRun.checkpoint?.committedToolExecutionIds || [],
              researchRunId: researchRun.id,
            };
            await store.updateTask(taskId, (current) => {
              const withRun = upsertResearchReportRun(current, researchRun);
              return {
                ...transitionResearchTask(withRun, "paused", { checkpoint }),
                checkpoint,
                error: {
                  code: "RESEARCH_SCOPE_APPROVAL_REQUIRED",
                  message: t("run.scopeApproval"),
                  recoverable: true,
                },
              };
            });
            store.setActiveTask(null);
            onNotice?.(t("run.scopeApproval"));
            return;
          }

          if (!resumeAtSynthesis) {
            await store.updateTask(taskId, (current) =>
              current.status === "researching"
                ? transitionResearchTask(current, "verifying")
                : current,
            );
            researchRun = {
              ...researchRun,
              phase: "verifying",
              updatedAt: Date.now(),
            };
            await persistRun(
              researchRun,
              currentEvidence,
              resumeAtVerification
                ? store.tasksById[taskId].checkpoint
                : undefined,
            );
            const uncoveredSteps = plan.steps.filter(
              (step) =>
                !researchRun.claims.some(
                  (claim) =>
                    claim.stepId === step.id &&
                    claim.importance === "major" &&
                    claim.verificationStatus === "verified",
                ),
            );
            const verificationNodeIds = Array.from(
              new Set([
                ...researchRun.claims
                  .filter(
                    (claim) =>
                      claim.importance === "major" &&
                      claim.verificationStatus !== "verified",
                  )
                  .flatMap((claim) => claim.nodeIds),
                ...uncoveredSteps.flatMap((step) => {
                  const node = researchRun.nodes.find(
                    (candidate) => candidate.stepId === step.id,
                  );
                  return node ? [node.id] : [];
                }),
              ]),
            ).slice(0, Math.max(1, researchRun.strategy.initialBreadth));
            const verificationQueryAllowance =
              getResearchVerificationQueryAllowance(
                researchRun.strategy,
                researchRun.usage.queryCount,
              );
            if (
              verificationNodeIds.length > 0 &&
              verificationQueryAllowance > 0 &&
              remainingBudget(store.tasksById[taskId])
            ) {
              const resumableWave = researchRun.waves.find((wave) =>
                ["queued", "running", "paused"].includes(wave.status),
              );
              const verificationWaveId =
                resumableWave?.id || `research-wave-${uuidv7()}`;
              const targetNodeIds = resumableWave
                ? [...resumableWave.nodeIds]
                : verificationNodeIds;
              if (!resumableWave) {
                const verificationWave = {
                  id: verificationWaveId,
                  index: researchRun.waves.length + 1,
                  depth: Math.max(
                    1,
                    ...researchRun.nodes
                      .filter((node) => targetNodeIds.includes(node.id))
                      .map((node) => node.depth),
                  ),
                  breadth: targetNodeIds.length,
                  nodeIds: targetNodeIds,
                  status: "queued" as const,
                  newEvidenceCount: 0,
                  newVerifiedClaimCount: 0,
                };
                researchRun = {
                  ...researchRun,
                  waves: [...researchRun.waves, verificationWave],
                  updatedAt: Date.now(),
                };
              }
              researchRun = await executeWave({
                run: researchRun,
                waveId: verificationWaveId,
                nodeIds: targetNodeIds,
                phase: "verifying",
                queryAllowance: verificationQueryAllowance,
                expandFrontier: false,
              });
            }
          }

          if (researchRun.phase === "awaiting_scope_approval") {
            const checkpoint: ResearchCheckpoint = {
              createdAt: Date.now(),
              resumeStatus: "clarifying",
              committedEvidenceIds: currentEvidence.map((item) => item.id),
              committedToolExecutionIds:
                researchRun.checkpoint?.committedToolExecutionIds || [],
              researchRunId: researchRun.id,
            };
            await store.updateTask(taskId, (current) => {
              const withRun = upsertResearchReportRun(current, researchRun);
              return {
                ...transitionResearchTask(withRun, "paused", { checkpoint }),
                checkpoint,
                error: {
                  code: "RESEARCH_SCOPE_APPROVAL_REQUIRED",
                  message: t("run.scopeApproval"),
                  recoverable: true,
                },
              };
            });
            store.setActiveTask(null);
            onNotice?.(t("run.scopeApproval"));
            return;
          }

          const finalCoverage = calculateResearchCoverage(
            plan.steps,
            researchRun.nodes,
            researchRun.claims,
          );
          const evaluatedStopReason = getResearchStopReason(
            researchRun.strategy,
            {
              coverage: finalCoverage,
              frontierCount: getResearchFrontier(researchRun).length,
              currentDepth: Math.max(
                0,
                ...researchRun.nodes.map((node) => node.depth),
              ),
              queryCount: researchRun.usage.queryCount,
              sourceBodyCount: researchRun.usage.sourceBodyCount,
              sourceBodyLimit,
              remainingToolCalls:
                remainingBudget(store.tasksById[taskId])?.maxToolCalls || 0,
              wavesWithoutNewSources: countTrailingWaves(
                researchRun,
                "newEvidenceCount",
              ),
              wavesWithoutNewVerifiedClaims: countTrailingWaves(
                researchRun,
                "newVerifiedClaimCount",
              ),
            },
          );
          const finalStopReason = finalCoverage.complete
            ? { code: "coverage_satisfied" as const, at: Date.now() }
            : researchRun.stopReason ||
              evaluatedStopReason || {
                code:
                  researchRun.usage.queryCount >=
                  researchRun.strategy.maxQueries
                    ? ("max_queries" as const)
                    : ("frontier_exhausted" as const),
                at: Date.now(),
                detail:
                  researchRun.usage.queryCount >=
                  researchRun.strategy.maxQueries
                    ? "The report run exhausted its approved query limit."
                    : "No further in-scope wave was scheduled.",
              };
          researchRun = {
            ...researchRun,
            coverage: finalCoverage,
            stopReason: finalStopReason,
            phase: "synthesizing",
            updatedAt: Date.now(),
          };
          await store.updateTask(taskId, (current) =>
            current.status === "verifying"
              ? transitionResearchTask(current, "synthesizing")
              : current,
          );
          await persistRun(researchRun);

          const synthesisRunId = uuidv7();
          lastAgentRunId = synthesisRunId;
          await store.updateTask(taskId, (current) => ({
            ...current,
            agentRunIds: [...current.agentRunIds, synthesisRunId],
            executionRunIds: [...current.executionRunIds, synthesisRunId],
          }));
          let reportMarkdown = "";
          reportMarkdown = await streamChatResponse(
            task.sessionId,
            snapshot.model,
            [],
            buildResearchSynthesisPrompt({
              task: store.tasksById[taskId],
              plan,
              run: researchRun,
              evidence: currentEvidence,
              priorReport,
            }),
            [],
            {
              ...chatConfig,
              chatMode: "research",
              useAgentMode: false,
              useDeepResearch: false,
              useSearch: false,
              useReasoning: false,
            },
            (text) => {
              reportMarkdown = text;
            },
            `${effective.systemInstruction}\n\nThis is closed-book synthesis. Tools and external source access are disabled; only the supplied verified claim ledger and evidence index may be used.`,
            undefined,
            undefined,
            undefined,
            undefined,
            controller.signal,
            [],
            undefined,
            undefined,
            undefined,
            {
              disableTools: true,
              agentRun: {
                id: synthesisRunId,
                userMessageId: task.userMessageId,
                modelMessageId: task.cardMessageId,
              },
            },
          );
          controller.signal.throwIfAborted();
          let audit = auditResearchReport({
            markdown: reportMarkdown,
            plan,
            run: researchRun,
            evidence: currentEvidence,
          });
          if (audit.issues.length > 0) {
            const repairRunId = uuidv7();
            lastAgentRunId = repairRunId;
            await store.updateTask(taskId, (current) => ({
              ...current,
              agentRunIds: [...current.agentRunIds, repairRunId],
              executionRunIds: [...current.executionRunIds, repairRunId],
            }));
            let repaired = "";
            repaired = await streamChatResponse(
              task.sessionId,
              snapshot.model,
              [],
              buildResearchReportRepairPrompt({
                task: store.tasksById[taskId],
                plan,
                run: researchRun,
                evidence: currentEvidence,
                report: reportMarkdown,
                issues: audit.issues,
              }),
              [],
              {
                ...chatConfig,
                chatMode: "research",
                useAgentMode: false,
                useDeepResearch: false,
                useSearch: false,
                useReasoning: false,
              },
              (text) => {
                repaired = text;
              },
              `${effective.systemInstruction}\n\nThis is the single closed-book publication repair. Tools are disabled.`,
              undefined,
              undefined,
              undefined,
              undefined,
              controller.signal,
              [],
              undefined,
              undefined,
              undefined,
              {
                disableTools: true,
                agentRun: {
                  id: repairRunId,
                  userMessageId: task.userMessageId,
                  modelMessageId: task.cardMessageId,
                },
              },
            );
            if (repaired.trim()) reportMarkdown = repaired;
            audit = auditResearchReport({
              markdown: reportMarkdown,
              plan,
              run: researchRun,
              evidence: currentEvidence,
            });
          }
          const aggregate = aggregateExecutionUsage(
            getCurrentResearchReportRunIds(store.tasksById[taskId]),
          );
          researchRun = {
            ...researchRun,
            usage: { ...researchRun.usage, ...aggregate },
            updatedAt: Date.now(),
          };
          const extraGaps: string[] = [...audit.issues];
          if (failedSourceOperationCount > 0) {
            extraGaps.push(
              t("runtime.gaps.sourceOperations", {
                count: failedSourceOperationCount,
              }),
            );
          }
          if (searchOnlyCount > 0) {
            extraGaps.push(
              t("runtime.gaps.searchOnly", { count: searchOnlyCount }),
            );
          }
          if (
            researchRun.stopReason &&
            researchRun.stopReason.code !== "coverage_satisfied"
          ) {
            extraGaps.push(t(`run.stop.${researchRun.stopReason.code}`));
          }
          const uniqueGaps = await publishResearchReportVersion({
            taskId,
            plan,
            run: researchRun,
            markdown: reportMarkdown,
            evidence: currentEvidence,
            extraGaps,
            agentRunId: lastAgentRunId,
            noEvidenceGap: t("runtime.gaps.noEvidence"),
            noKeyFindingsGap: t("runtime.gaps.noKeyFindings"),
            unsupportedClaimsGap: (count) =>
              t("runtime.gaps.unsupportedClaims", { count }),
            unresolvedConflictsGap: (count) =>
              t("runtime.gaps.unresolvedConflicts", { count }),
            incompleteQuestionsGap: (count) =>
              t("runtime.gaps.incompleteQuestions", { count }),
            signal: controller.signal,
            persistenceError: t("runtime.error.persistence"),
          });
          store.setActiveTask(null);
          onNotice?.(
            uniqueGaps.length > 0
              ? t("runtime.notice.reportPartial")
              : t("runtime.notice.reportReady"),
          );
        } catch (error) {
          const current = store.tasksById[taskId];
          if (!current || current.status === "cancelled") return;
          if (isAbortError(error) || controller.signal.aborted) {
            const pausedRun = applyResearchRunUserStop(researchRun, "pause");
            const checkpoint: ResearchCheckpoint = current.checkpoint || {
              createdAt: Date.now(),
              resumeStatus:
                current.status === "verifying" ? "verifying" : "researching",
              committedEvidenceIds: currentEvidence.map((item) => item.id),
              committedToolExecutionIds:
                pausedRun.checkpoint?.committedToolExecutionIds || [],
              researchRunId: pausedRun.id,
            };
            await store.updateTask(taskId, (latest) => {
              if (latest.status === "cancelled") return latest;
              const withRun = upsertResearchReportRun(latest, pausedRun);
              return latest.status === "paused"
                ? { ...withRun, checkpoint }
                : transitionResearchTask(withRun, "paused", { checkpoint });
            });
            store.setActiveTask(null);
            return;
          }
          try {
            const salvage = buildDeterministicSalvageReport({
              task: current,
              plan,
              run: researchRun,
              evidence: currentEvidence,
              reason: t("runtime.gaps.executionInterrupted"),
            });
            const uniqueGaps = await publishResearchReportVersion({
              taskId,
              plan,
              run: {
                ...researchRun,
                phase: "synthesizing",
                stopReason: researchRun.stopReason || {
                  code: "dependency_unavailable",
                  at: Date.now(),
                },
              },
              markdown: salvage,
              evidence: currentEvidence,
              extraGaps: [
                t("runtime.gaps.executionInterrupted"),
                localizedRuntimeError(error, "executionFallback"),
              ],
              agentRunId: lastAgentRunId,
              noEvidenceGap: t("runtime.gaps.noEvidence"),
              noKeyFindingsGap: t("runtime.gaps.noKeyFindings"),
              unsupportedClaimsGap: (count) =>
                t("runtime.gaps.unsupportedClaims", { count }),
              unresolvedConflictsGap: (count) =>
                t("runtime.gaps.unresolvedConflicts", { count }),
              incompleteQuestionsGap: (count) =>
                t("runtime.gaps.incompleteQuestions", { count }),
              persistenceError: t("runtime.error.persistence"),
            });
            store.setActiveTask(null);
            onNotice?.(
              uniqueGaps.length > 0
                ? t("runtime.notice.reportPartial")
                : t("runtime.notice.reportReady"),
            );
            return;
          } catch (salvageError) {
            logDevError("Failed to salvage Deep Research report", salvageError);
          }
          await store.updateTask(taskId, (latest) => ({
            ...transitionResearchTask(latest, "failed"),
            usage: aggregateTaskUsage(latest),
            error: {
              code: "RESEARCH_EXECUTION_FAILED",
              message: localizedRuntimeError(error, "executionFallback"),
              recoverable: true,
            },
          }));
          store.setActiveTask(null);
          onError?.(t("runtime.error.report"));
        }
      });
      const scopedTask = useResearchStore.getState().tasksById[taskId];
      if (
        pendingScopeAdjustment &&
        scopedTask?.status === "paused" &&
        scopedTask.error?.code === "RESEARCH_SCOPE_APPROVAL_REQUIRED"
      ) {
        await preparePlan(taskId, pendingScopeAdjustment);
      }
    },
    [
      dependencyText,
      localizedRuntimeError,
      onError,
      onNotice,
      preparePlan,
      runOperation,
      t,
      toolConfirmationController,
      userInputController,
    ],
  );

  const launchResearch = useCallback(
    (taskId: string) => {
      void executeResearch(taskId).catch(async (error) => {
        const store = useResearchStore.getState();
        const task = store.tasksById[taskId];
        if (
          !task ||
          task.status === "paused" ||
          isTerminalResearchStatus(task.status)
        ) {
          return;
        }
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "failed"),
          usage: aggregateTaskUsage(current),
          error: {
            code: "RESEARCH_EXECUTION_FAILED",
            message: localizedRuntimeError(error, "executionFallback"),
            recoverable: true,
          },
        }));
        store.setActiveTask(null);
        onError?.(t("runtime.error.report"));
      });
    },
    [executeResearch, localizedRuntimeError, onError, t],
  );

  const confirmPlan = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (!task || task.status !== "plan_ready" || !getActivePlan(task)) return;
      if (!(await claimActiveSlot(task.sessionId, taskId))) return;
      let sourceSnapshot: ResearchSourceSnapshot;
      try {
        const baseSourceSnapshot =
          task.sourceSnapshot || (await createSourceSnapshot(task));
        sourceSnapshot = {
          ...baseSourceSnapshot,
          workspaceSources: await captureApprovedWorkspaceSources(
            task.sessionId,
            baseSourceSnapshot.toolIds,
          ),
          capturedAt: Date.now(),
        };
      } catch {
        const dependencyError: ResearchDependencyError = {
          code: "RESEARCH_MODEL_UNAVAILABLE",
          message: t("runtime.dependency.modelUnavailable"),
        };
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "paused"),
          error: { ...dependencyError, recoverable: true },
        }));
        onNotice?.(dependencyError.message);
        return;
      }
      const dependencyError = getResearchDependencyError(
        { ...task, sourceSnapshot },
        dependencyText,
      );
      if (dependencyError) {
        await store.updateTask(taskId, (current) => ({
          ...transitionResearchTask(current, "paused"),
          sourceSnapshot,
          error: { ...dependencyError, recoverable: true },
        }));
        onNotice?.(dependencyError.message);
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...transitionResearchTask(current, "researching"),
        sourceSnapshot,
        checkpoint: undefined,
        error: undefined,
      }));
      store.setActiveTask(taskId);
      launchResearch(taskId);
    },
    [claimActiveSlot, dependencyText, launchResearch, onNotice, t],
  );

  const adjustPlan = useCallback(
    async (taskId: string, instruction: string) => {
      const value = instruction
        .trim()
        .slice(0, DEEP_RESEARCH_INSTRUCTION_MAX_CHARS);
      if (!value) return;
      const task = useResearchStore.getState().tasksById[taskId];
      if (!task || isTerminalResearchStatus(task.status)) return;
      if (isActiveResearchStatus(task.status)) await pauseTask(taskId);
      await preparePlan(taskId, value);
    },
    [pauseTask, preparePlan],
  );

  const updatePlanStrategy = useCallback(
    async (taskId: string, overrides: Partial<ResearchStrategy>) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      const plan = task ? getActivePlan(task) : undefined;
      if (!task || task.status !== "plan_ready" || !plan) return;
      const strategy = resolveResearchStrategy(task.budgetPreset, {
        ...plan.strategy,
        ...overrides,
      });
      if (
        (Object.keys(strategy) as Array<keyof ResearchStrategy>).every(
          (key) => strategy[key] === plan.strategy[key],
        )
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => {
        const active = getActivePlan(current);
        if (current.status !== "plan_ready" || !active) return current;
        const version = current.planVersions.length + 1;
        const nextPlan: ResearchPlanVersion = {
          ...active,
          id: uuidv7(),
          version,
          strategy,
          createdAt: Date.now(),
          adjustment: "Approved numeric strategy tuning.",
        };
        return {
          ...current,
          planVersions: [...current.planVersions, nextPlan],
          activePlanVersion: version,
          updatedAt: Date.now(),
        };
      });
    },
    [],
  );

  const retryTask = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (
        !task?.error?.recoverable ||
        (task.status !== "failed" && task.status !== "clarifying")
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...(current.status === "failed"
          ? transitionResearchTask(current, "clarifying")
          : current),
        error: undefined,
      }));
      await preparePlan(taskId);
    },
    [preparePlan],
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (!task || task.status !== "paused") return;
      const resumeStatus = task.checkpoint?.resumeStatus || "plan_ready";
      if (resumeStatus === "draft" || resumeStatus === "clarifying") {
        await preparePlan(taskId);
        return;
      }
      if (resumeStatus === "plan_ready" || !task.sourceSnapshot) {
        await store.updateTask(taskId, (current) =>
          transitionResearchTask(current, "plan_ready"),
        );
        return;
      }
      if (!(await claimActiveSlot(task.sessionId, taskId))) return;
      const activeResumeStatus =
        resumeStatus === "verifying" || resumeStatus === "synthesizing"
          ? resumeStatus
          : "researching";
      await store.updateTask(taskId, (current) =>
        transitionResearchTask(current, activeResumeStatus),
      );
      store.setActiveTask(taskId);
      launchResearch(taskId);
    },
    [claimActiveSlot, launchResearch, preparePlan],
  );

  const askExistingEvidence = useCallback(
    async (taskId: string, question: string) =>
      runOperation(taskId, "evidence_answer", async (controller) => {
        const task = useResearchStore.getState().tasksById[taskId];
        if (!task || !question.trim()) return;
        const report = await readReportMarkdown(task);
        if (!report)
          throw new Error("The stored research report is unavailable.");
        const { model, chatConfig, effective } = resolveTaskContext(task);
        const userMessage: Message = {
          id: uuidv7(),
          role: "user",
          content: question.trim(),
          timestamp: Date.now(),
          model,
        };
        await useChatStore.getState().addMessage(task.sessionId, userMessage);
        let answer = "";
        answer = await streamChatResponse(
          task.sessionId,
          model,
          [],
          buildEvidenceQuestionPrompt({
            question: question.trim(),
            report,
            evidence: task.evidence,
          }),
          [],
          {
            ...chatConfig,
            chatMode: "chat",
            useAgentMode: false,
            useDeepResearch: false,
            useSearch: false,
            useReasoning: false,
          },
          (text) => {
            answer = text;
          },
          `${effective.systemInstruction}\n\nThis turn is closed-book: only the supplied stored report and evidence index may be used.`,
          undefined,
          undefined,
          undefined,
          undefined,
          controller.signal,
          [],
          undefined,
          undefined,
          undefined,
          { disableTools: true },
        );
        controller.signal.throwIfAborted();
        await useChatStore.getState().addMessage(task.sessionId, {
          id: uuidv7(),
          role: "model",
          content: answer,
          timestamp: Date.now(),
          model,
        });
        onNotice?.(t("runtime.notice.evidenceAnswer"));
      }),
    [onNotice, runOperation, t],
  );

  const continueResearch = useCallback(
    async (taskId: string, instruction: string) => {
      const value = instruction
        .trim()
        .slice(0, DEEP_RESEARCH_INSTRUCTION_MAX_CHARS);
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (
        !task ||
        (task.status !== "completed" && task.status !== "partial_completed") ||
        !value
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...transitionResearchTask(current, "clarifying"),
        pendingReportKind: "continue",
        error: undefined,
      }));
      await preparePlan(taskId, value);
    },
    [preparePlan],
  );

  const updateLatest = useCallback(
    async (taskId: string) => {
      const store = useResearchStore.getState();
      const task = store.tasksById[taskId];
      if (
        !task ||
        (task.status !== "completed" && task.status !== "partial_completed")
      ) {
        return;
      }
      await store.updateTask(taskId, (current) => ({
        ...transitionResearchTask(current, "clarifying"),
        pendingReportKind: "update",
        evidence: markMutableResearchEvidenceStale(current.evidence),
        error: undefined,
      }));
      await preparePlan(
        taskId,
        "Update the report to the latest available state. Re-fetch every mutable web, plugin, and MCP source; reuse local evidence only when its content hash is unchanged. Preserve prior conclusions when the evidence has not changed and call out any changes explicitly.",
      );
    },
    [preparePlan],
  );

  useEffect(() => {
    void useResearchStore.getState().hydrateTasks();
  }, []);

  useEffect(() => {
    const dispose = registerResearchToolEmitters({
      start: async (args, context) => {
        context.signal?.throwIfAborted();
        if (!(await claimActiveSlot(context.sessionId))) {
          throw new Error(t("runtime.error.activeTaskKept"));
        }
        const session = useChatStore
          .getState()
          .sessions.find((item) => item.id === context.sessionId);
        if (!session) throw new Error(t("runtime.error.chatMissing"));
        const draftContext = resolveTaskContext({
          ...createResearchTask({
            sessionId: context.sessionId,
            goal: args.query,
            budgetPreset: args.budgetPreset,
          }),
          sourceSnapshot: undefined,
        });
        const task = createResearchTask({
          sessionId: context.sessionId,
          userMessageId: context.userMessageId,
          cardMessageId: context.modelMessageId,
          goal: args.query,
          budgetPreset: args.budgetPreset,
          profileBudget: draftContext.effective.agentBudget,
        });
        const withRun = context.agentRunId
          ? { ...task, agentRunIds: [context.agentRunId] }
          : task;
        await useResearchStore.getState().upsertTask(withRun);
        if (!getResearchTaskRepository().getStatus().durable) {
          const failed = {
            ...transitionResearchTask(withRun, "failed"),
            error: {
              code: "RESEARCH_PERSISTENCE_UNAVAILABLE",
              message: t("runtime.error.persistence"),
              recoverable: true,
            },
          };
          await useResearchStore.getState().upsertTask(failed);
          return { taskId: failed.id, status: failed.status };
        }
        void preparePlan(withRun.id);
        return { taskId: withRun.id, status: withRun.status };
      },
      adjustPlan: async (args, context) => {
        context.signal?.throwIfAborted();
        let task: ResearchTask | null | undefined =
          useResearchStore.getState().tasksById[args.taskId];
        if (!task) {
          task = await getResearchTaskRepository().get(args.taskId);
          if (task) await useResearchStore.getState().upsertTask(task);
        }
        if (!task || task.sessionId !== context.sessionId) {
          throw new Error(t("runtime.error.taskMissing"));
        }
        await adjustPlan(args.taskId, args.instruction);
        context.signal?.throwIfAborted();
      },
    });
    return dispose;
  }, [adjustPlan, claimActiveSlot, preparePlan, t]);

  useEffect(() => {
    const pauseActiveResearch = () => {
      const taskId = useResearchStore.getState().activeTaskId;
      if (taskId) void pauseTask(taskId);
    };
    window.addEventListener("pagehide", pauseActiveResearch);
    return () => window.removeEventListener("pagehide", pauseActiveResearch);
  }, [pauseTask]);

  useEffect(
    () => () => {
      for (const operation of operationsRef.current.values()) {
        operation.controller.abort(createAbortError());
      }
      operationsRef.current.clear();
    },
    [],
  );

  const actions = useMemo<ResearchRuntimeActions>(
    () => ({
      confirmPlan,
      adjustPlan,
      updatePlanStrategy,
      pauseTask,
      resumeTask,
      retryTask,
      cancelTask,
      askExistingEvidence,
      continueResearch,
      updateLatest,
    }),
    [
      adjustPlan,
      askExistingEvidence,
      cancelTask,
      confirmPlan,
      continueResearch,
      pauseTask,
      retryTask,
      resumeTask,
      updateLatest,
      updatePlanStrategy,
    ],
  );

  useEffect(() => {
    mountedRuntimeActions = actions;
    return () => {
      if (mountedRuntimeActions === actions) mountedRuntimeActions = null;
    };
  }, [actions]);

  return (
    <ResearchRuntimeContext.Provider value={actions}>
      {children}
    </ResearchRuntimeContext.Provider>
  );
}

export function useResearchRuntime(): ResearchRuntimeActions {
  const value = useContext(ResearchRuntimeContext);
  if (!value) {
    throw new Error(
      "useResearchRuntime must be used inside ResearchRuntimeProvider.",
    );
  }
  return value;
}
