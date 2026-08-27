import type {
  PluginFunctionRisk,
  ToolDescriptorV2,
  ToolInvocationPolicy,
  ToolInvocationPolicyResolver,
} from "@/lib/plugin/types";
import type {
  AgentUserInputController,
  Attachment,
  ChatMode,
  Collection,
  ImageSource,
  Source,
  AppliedSkillInvocation,
} from "@/types";
import type {
  KnowledgeRetrievalRagConfig,
  RagQueryError,
} from "@/lib/knowledge/retrieveKnowledgeSources";
import type { TaskPlanSnapshot } from "@/lib/agent/taskPlan";
import type { LongTextOutputRequest } from "@/lib/chat/longText";
import type {
  AdjustResearchPlanArgs,
  ConfirmResearchPlanArgs,
  StartDeepResearchArgs,
} from "@/lib/research/toolArguments";
import type { ResearchTaskStatus } from "@/lib/research/types";

import type { ChatToolDefinition } from "../types";

export type BuiltinToolRisk = Extract<PluginFunctionRisk, "read">;

export interface BuiltinKnowledgeScope {
  attachments: Attachment[];
  collections: Collection[];
  ragConfig: KnowledgeRetrievalRagConfig;
}

export interface BuiltinResearchQueryBudget {
  remainingQueries: number;
  maxResultsPerQuery: number;
  /** Shared normalized-query ledger used to reject replayed query variants. */
  seenQueries?: Set<string>;
  /** Optional hard deadline used by the pre-approval reconnaissance stage. */
  deadlineAt?: number;
  onQueriesExecuted?: (queries: string[]) => void;
}

export interface BuiltinResearchSourceBudget {
  remainingSourceBodies: number;
  onSourceBodiesRead?: (locators: string[]) => void;
}

export function consumeBuiltinResearchSourceBodies(
  budget: BuiltinResearchSourceBudget | undefined,
  locators: readonly string[],
): boolean {
  if (!budget) return true;
  if (locators.length > budget.remainingSourceBodies) return false;
  budget.remainingSourceBodies -= locators.length;
  budget.onSourceBodiesRead?.([...locators]);
  return true;
}

export type BuiltinSearchEvent =
  | { phase: "start" }
  | { phase: "cancel" }
  | {
      phase: "complete";
      sources: Source[];
      images: ImageSource[];
    }
  | { phase: "error"; message: string };

export interface WorkspaceFileShare {
  path: string;
  url: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  revision: string;
  title?: string;
}

export interface ArchiveFileShare {
  fileName: string;
  url: string;
  bytes: number;
  entryCount: number;
  title?: string;
}

export interface BuiltinResearchHostContext {
  sessionId: string;
  model: string;
  userMessageId?: string;
  modelMessageId?: string;
  agentRunId?: string;
  signal?: AbortSignal;
}

export interface BuiltinResearchStartResult {
  taskId: string;
  status: ResearchTaskStatus;
}

export interface BuiltinResearchEmitters {
  start: (
    request: StartDeepResearchArgs,
    context: BuiltinResearchHostContext,
  ) => Promise<BuiltinResearchStartResult> | BuiltinResearchStartResult;
  adjustPlan: (
    request: AdjustResearchPlanArgs,
    context: BuiltinResearchHostContext,
  ) => Promise<void> | void;
  confirmPlan: (
    request: ConfirmResearchPlanArgs,
    context: BuiltinResearchHostContext,
  ) => Promise<void> | void;
}

export interface BuiltinToolEmitters {
  chatMode?: (mode: Extract<ChatMode, "agent" | "research">) => void;
  search?: (event: BuiltinSearchEvent) => void;
  knowledgeSources?: (sources: Source[], ragError?: RagQueryError) => void;
  skillInvocation?: (invocation: AppliedSkillInvocation) => void;
  skillToolRestriction?: (allowedTools: readonly string[]) => void;
  taskPlan?: (plan: TaskPlanSnapshot) => void;
  workspaceFile?: (file: WorkspaceFileShare) => void;
  archiveFile?: (archive: ArchiveFileShare) => void;
  longText?: (request: LongTextOutputRequest) =>
    | { ok: true }
    | {
        ok: false;
        error: { code: string; message: string };
      };
  research?: BuiltinResearchEmitters;
}

export interface BuiltinToolContext {
  signal?: AbortSignal;
  sessionId: string;
  model: string;
  userMessageId?: string;
  modelMessageId?: string;
  agentRunId?: string;
  toolCallId?: string;
  userInputController?: AgentUserInputController;
  knowledgeScope?: BuiltinKnowledgeScope;
  /** Frozen workspace paths available to an approval-gated Research run. */
  workspaceReadScope?: readonly string[];
  /** Exact large-result files created by this execution run. */
  workspaceInternalReadScope?: ReadonlySet<string>;
  emit: BuiltinToolEmitters;
}

export interface BuiltinToolBinding {
  definition: ChatToolDefinition;
  /** Compatibility label for existing message/UI contracts; V2 policy is authoritative. */
  risk: BuiltinToolRisk;
  descriptor: ToolDescriptorV2;
  resolveInvocationPolicy?: ToolInvocationPolicyResolver;
  displayKey: string;
  agentOnly?: boolean;
  /** Built-ins in the same group execute in provider tool-call order. */
  executionGroup?: "workspace" | "interaction";
  execute: (args: unknown, context: BuiltinToolContext) => Promise<unknown>;
}

export function resolveBuiltinToolInvocationPolicy(
  binding: BuiltinToolBinding,
  args: unknown,
): ToolInvocationPolicy {
  const descriptor = binding.descriptor;
  if (binding.resolveInvocationPolicy) {
    return binding.resolveInvocationPolicy(args, descriptor);
  }
  return {
    effects: descriptor.effects,
    idempotency: descriptor.idempotency,
    sensitivity: descriptor.sensitivity,
    origin: descriptor.origin,
  };
}

export interface CollectedBuiltinTools {
  definitions: ChatToolDefinition[];
  bindingsByName: ReadonlyMap<string, BuiltinToolBinding>;
}
