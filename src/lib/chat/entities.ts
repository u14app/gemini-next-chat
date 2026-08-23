import type {
  Attachment,
  Session,
  SessionConfig,
  ToolSessionApproval,
  ToolApprovalIdentityV2,
  Workspace,
} from "@/types";
import { ATTACHMENT_LIMITS, CHAT_ENTITY_LIMITS } from "@/config/limits";
import { normalizePluginIdRefs } from "../plugin/config";
import { normalizeSkillIdRefs } from "../skills";
import { normalizeCompressedContentWithMemoryIds } from "../utils/contextCompression";
import { isReasoningEnabled, normalizeReasoningMode } from "./reasoning";
import {
  normalizeAgentProfile,
  normalizeAgentSkillPolicies,
} from "../assistant/profile";
import {
  createToolApprovalIdentity,
  getToolApprovalIdentityKey,
} from "../plugin/confirmation";
import type { ToolEffect, ToolOrigin } from "../plugin/types";

const WORKSPACE_COLORS = new Set([
  "blue",
  "purple",
  "green",
  "orange",
  "red",
  "pink",
  "cyan",
  "gray",
]);

function trimString(value: unknown, maxChars: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxChars);
  return trimmed || fallback;
}

const TOOL_EFFECTS = new Set<ToolEffect>([
  "local_read",
  "local_write",
  "local_destructive",
  "network_read",
  "external_write",
  "external_destructive",
]);

function normalizeToolApprovalIdentity(
  value: unknown,
): ToolApprovalIdentityV2 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 2 ||
    (raw.origin !== "builtin" &&
      raw.origin !== "plugin" &&
      raw.origin !== "mcp") ||
    !Array.isArray(raw.effects)
  ) {
    return undefined;
  }
  const effects = raw.effects.filter(
    (effect): effect is ToolEffect =>
      typeof effect === "string" && TOOL_EFFECTS.has(effect as ToolEffect),
  );
  try {
    return createToolApprovalIdentity({
      origin: raw.origin as ToolOrigin,
      providerId: trimString(raw.providerId, 240),
      toolName: trimString(raw.toolName, 240),
      toolFingerprint: trimString(raw.toolFingerprint, 65_536),
      effects,
      targetScope: trimString(raw.targetScope, 2_048, "*"),
    });
  } catch {
    return undefined;
  }
}

function stripWrappingQuotes(value: string): string {
  let current = value.trim();

  for (let i = 0; i < 3; i += 1) {
    const first = current[0];
    const last = current[current.length - 1];
    if (
      current.length >= 2 &&
      ((first === `"` && last === `"`) ||
        (first === "'" && last === "'") ||
        (first === "`" && last === "`"))
    ) {
      current = current.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return current;
}

function normalizeTitleLine(value: string): string {
  let title = stripWrappingQuotes(value);

  title = title
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]\s+|\u2022\s+|\d+[\.)]\s*)/, "")
    .replace(/^(?:title|\u6807\u9898)\s*[:\uff1a]\s*/i, "")
    .trim();

  title = stripWrappingQuotes(title);
  return title.replace(/\s+/g, " ").trim();
}

export function normalizeSessionTitle(
  value: unknown,
  fallback = "New Chat",
): string {
  if (typeof value !== "string") return fallback;

  const withoutControlChars = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  const withoutCodeFence = withoutControlChars
    .trim()
    .replace(/^```[^\n]*\n?/, "")
    .replace(/\n?```\s*$/, "");
  const title =
    withoutCodeFence.split("\n").map(normalizeTitleLine).find(Boolean) || "";
  const trimmed = title
    .slice(0, CHAT_ENTITY_LIMITS.maxSessionTitleChars)
    .trim();

  return trimmed || fallback;
}

function normalizeAttachment(attachment: unknown): Attachment | null {
  if (!attachment || typeof attachment !== "object") return null;

  const raw = attachment as Partial<Attachment>;
  const id = trimString(raw.id, 120);
  const fileName = trimString(raw.fileName, ATTACHMENT_LIMITS.maxFileNameChars);
  const mimeType = trimString(raw.mimeType, ATTACHMENT_LIMITS.maxMimeTypeChars);
  const data =
    typeof raw.data === "string"
      ? raw.data.slice(0, ATTACHMENT_LIMITS.maxBase64Chars)
      : undefined;
  const url =
    typeof raw.url === "string"
      ? raw.url.trim().slice(0, ATTACHMENT_LIMITS.maxUrlChars)
      : undefined;
  const localFileMissing = raw.localFileMissing === true;
  const localFileError = localFileMissing
    ? trimString(raw.localFileError, 500)
    : "";

  if (!fileName || !mimeType || (!data && !url && !localFileMissing)) {
    return null;
  }

  return {
    id,
    fileName,
    mimeType,
    ...(data ? { data } : {}),
    ...(url ? { url } : {}),
    ...(localFileMissing
      ? {
          localFileMissing: true,
          ...(localFileError ? { localFileError } : {}),
        }
      : {}),
  };
}

function normalizeWorkspaceFiles(files: unknown): Attachment[] {
  if (!Array.isArray(files)) return [];

  const normalized: Attachment[] = [];
  let totalInlineChars = 0;

  for (const file of files) {
    const attachment = normalizeAttachment(file);
    if (!attachment) continue;

    const inlineChars = attachment.data?.length || 0;
    if (
      inlineChars > 0 &&
      totalInlineChars + inlineChars > ATTACHMENT_LIMITS.maxTotalBase64Chars
    ) {
      continue;
    }

    totalInlineChars += inlineChars;
    normalized.push(attachment);
    if (normalized.length >= ATTACHMENT_LIMITS.maxCount) break;
  }

  return normalized;
}

function normalizeKnowledgeCollectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const id = trimString(
      item,
      CHAT_ENTITY_LIMITS.maxWorkspaceKnowledgeCollectionIdChars,
    );
    if (!id || seen.has(id)) continue;

    ids.push(id);
    seen.add(id);
    if (ids.length >= CHAT_ENTITY_LIMITS.maxWorkspaceKnowledgeCollections) {
      break;
    }
  }

  return ids;
}

function normalizeSessionCompression(
  compression: Session["compression"],
): Session["compression"] | undefined {
  if (!compression || typeof compression !== "object") return undefined;

  const lastCompressedMessageId = trimString(
    compression.lastCompressedMessageId,
    120,
  );
  const includedMemoryIds: string[] = [];
  const seenMemoryIds = new Set<string>();
  for (const value of Array.isArray(compression.includedMemoryIds)
    ? compression.includedMemoryIds
    : []) {
    const id = trimString(value, 160);
    if (!id || seenMemoryIds.has(id)) continue;
    seenMemoryIds.add(id);
    includedMemoryIds.push(id);
    if (includedMemoryIds.length >= 200) break;
  }
  const normalizedCompression = normalizeCompressedContentWithMemoryIds({
    content:
      typeof compression.compressedContent === "string"
        ? compression.compressedContent
        : "",
    memoryIds: includedMemoryIds,
  });
  const compressedContent = normalizedCompression.content;

  if (!lastCompressedMessageId || !compressedContent) return undefined;

  return {
    compressedContent,
    lastCompressedMessageId,
    includedMemoryIds: normalizedCompression.representedMemoryIds,
  };
}

function normalizeSessionMemoryContext(
  memoryContext: Session["memoryContext"],
): Session["memoryContext"] | undefined {
  if (!memoryContext || typeof memoryContext !== "object") return undefined;
  const injectedMemoryIds: string[] = [];
  const seen = new Set<string>();

  for (const value of Array.isArray(memoryContext.injectedMemoryIds)
    ? memoryContext.injectedMemoryIds
    : []) {
    const id = trimString(value, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    injectedMemoryIds.push(id);
    if (injectedMemoryIds.length >= 200) break;
  }

  if (injectedMemoryIds.length === 0) return undefined;
  return {
    injectedMemoryIds,
    ...(typeof memoryContext.updatedAt === "number" &&
    Number.isFinite(memoryContext.updatedAt)
      ? { updatedAt: Math.floor(memoryContext.updatedAt) }
      : {}),
  };
}

function normalizeToolApprovals(value: unknown): ToolSessionApproval[] {
  if (!Array.isArray(value)) return [];
  const approvals: ToolSessionApproval[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const approval = candidate as Partial<ToolSessionApproval>;
    if (approval.risk !== "write" && approval.risk !== "external") continue;

    const pluginId = trimString(approval.pluginId, 160);
    const functionName = trimString(approval.functionName, 160);
    const functionFingerprint = trimString(
      approval.functionFingerprint,
      65_536,
    );
    const approvedAt = Number(approval.approvedAt);
    const identity = normalizeToolApprovalIdentity(approval.identity);
    if (
      !pluginId ||
      !functionName ||
      !functionFingerprint ||
      !Number.isFinite(approvedAt) ||
      approvedAt < 0
    ) {
      continue;
    }

    const key = `${pluginId}\u0000${functionName}\u0000${approval.risk}\u0000${functionFingerprint}\u0000${identity ? getToolApprovalIdentityKey(identity) : "legacy"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    approvals.push({
      pluginId,
      functionName,
      risk: approval.risk,
      functionFingerprint,
      approvedAt: Math.floor(approvedAt),
      ...(identity ? { identity } : {}),
    });
    if (approvals.length >= 100) break;
  }

  return approvals;
}

export function normalizeSessionConfig(
  config?: SessionConfig,
): SessionConfig | undefined {
  if (!config) return undefined;
  const {
    activePlugins: rawActivePlugins,
    activeSkills: rawActiveSkills,
    reasoningMode: rawReasoningMode,
    useReasoning: rawUseReasoning,
    useAgentMode: rawUseAgentMode,
    toolApprovals: rawToolApprovals,
    agentProfileId: rawAgentProfileId,
    agentProfile: rawAgentProfile,
    approvalMode: rawApprovalMode,
    agentBudget: rawAgentBudget,
    skillPolicies: rawSkillPolicies,
    ...rest
  } = config;
  const activePlugins = normalizePluginIdRefs(rawActivePlugins);
  const activeSkills = normalizeSkillIdRefs(rawActiveSkills, []);
  const toolApprovals = normalizeToolApprovals(rawToolApprovals);
  const hasReasoningConfig =
    rawReasoningMode !== undefined || rawUseReasoning !== undefined;
  const reasoningMode = hasReasoningConfig
    ? normalizeReasoningMode(rawReasoningMode, rawUseReasoning)
    : undefined;
  const agentProfile = normalizeAgentProfile(rawAgentProfile);
  const normalizedBudget = normalizeAgentProfile({
    schemaVersion: 2,
    runtime: {
      agentEnabled: false,
      approvalMode: "permissive",
      budget: rawAgentBudget,
    },
    capabilities: {},
  })?.runtime.budget;
  const skillPolicies = normalizeAgentSkillPolicies(rawSkillPolicies);

  return {
    ...rest,
    ...(typeof rawUseAgentMode === "boolean"
      ? { useAgentMode: rawUseAgentMode }
      : {}),
    ...(reasoningMode
      ? {
          useReasoning: isReasoningEnabled(reasoningMode),
          reasoningMode,
        }
      : {}),
    ...(Array.isArray(rawActivePlugins) ? { activePlugins } : {}),
    ...(Array.isArray(rawActiveSkills) ? { activeSkills } : {}),
    ...(toolApprovals.length > 0 ? { toolApprovals } : {}),
    ...(typeof rawAgentProfileId === "string" && rawAgentProfileId.trim()
      ? { agentProfileId: rawAgentProfileId.trim().slice(0, 160) }
      : {}),
    ...(agentProfile ? { agentProfile } : {}),
    ...(rawApprovalMode === "permissive" ||
    rawApprovalMode === "balanced" ||
    rawApprovalMode === "strict"
      ? { approvalMode: rawApprovalMode }
      : {}),
    ...(normalizedBudget ? { agentBudget: normalizedBudget } : {}),
    ...(Array.isArray(rawSkillPolicies)
      ? { skillPolicies: skillPolicies || [] }
      : {}),
  };
}

export function normalizeSession(session: Session): Session {
  return {
    ...session,
    title: normalizeSessionTitle(session.title),
    systemInstruction:
      typeof session.systemInstruction === "string"
        ? session.systemInstruction.slice(
            0,
            CHAT_ENTITY_LIMITS.maxSessionSystemInstructionChars,
          )
        : undefined,
    messageCount: Math.max(0, Math.floor(Number(session.messageCount) || 0)),
    updatedAt: Number.isFinite(Number(session.updatedAt))
      ? Number(session.updatedAt)
      : Date.now(),
    pinned: session.pinned === true,
    config: normalizeSessionConfig(session.config),
    compression: normalizeSessionCompression(session.compression),
    memoryContext: normalizeSessionMemoryContext(session.memoryContext),
  };
}

export function normalizeWorkspace(workspace: Workspace): Workspace {
  const color = trimString(
    workspace.color,
    CHAT_ENTITY_LIMITS.maxWorkspaceColorChars,
  );

  return {
    ...workspace,
    name: trimString(
      workspace.name,
      CHAT_ENTITY_LIMITS.maxWorkspaceNameChars,
      "Workspace",
    ),
    systemPrompt:
      typeof workspace.systemPrompt === "string"
        ? workspace.systemPrompt.slice(
            0,
            CHAT_ENTITY_LIMITS.maxWorkspaceSystemPromptChars,
          )
        : undefined,
    knowledgeCollectionIds: normalizeKnowledgeCollectionIds(
      workspace.knowledgeCollectionIds,
    ),
    files: normalizeWorkspaceFiles(workspace.files),
    color: WORKSPACE_COLORS.has(color) ? color : "blue",
    enableSearch: workspace.enableSearch === true,
    enableReasoning: workspace.enableReasoning === true,
    activePlugins: normalizePluginIdRefs(workspace.activePlugins),
    activeSkills: normalizeSkillIdRefs(workspace.activeSkills, []),
    agentProfile: normalizeAgentProfile(workspace.agentProfile),
    createdAt: Number.isFinite(Number(workspace.createdAt))
      ? Number(workspace.createdAt)
      : Date.now(),
  };
}
