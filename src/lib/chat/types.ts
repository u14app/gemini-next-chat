import type {
  PluginFunctionRisk,
  ToolApprovalReason,
  ToolApprovalIdentityV2,
  ToolInvocationPolicy,
} from "../plugin/types";
import type { CitationSource, ImageSource, Source } from "../search/types";
import type { AppliedSkillInvocation } from "../skills/types";
import type { TaskPlanStep } from "../agent/taskPlan";
import type {
  AgentApprovalMode,
  AgentProfileV2,
  AgentRunBudget,
  AgentSkillPolicy,
} from "../assistant/types";
import type { ResearchBudgetPreset, ResearchStrategy } from "../research/types";

export interface Attachment {
  id: string;
  mimeType: string;
  data?: string;
  url?: string;
  fileName: string;
  localFileMissing?: boolean;
  localFileError?: string;
  displayCache?: {
    opfsUrl: string;
    sourceKind: "data" | "url";
    sourceFingerprint: string;
    createdAt: number;
  };
}

export interface MessageVersion {
  id: string;
  content: string;
  reasoning?: string;
  timestamp: number;
  model: string;
  timing?: {
    startTime: number;
    endTime: number;
    duration: number;
  };
}

export interface MessageReplyReference {
  messageId: string;
  role: "user" | "model";
  excerpt: string;
}

export type MessageGenerationStatus = "streaming" | "interrupted" | "completed";

export interface MessageGenerationState {
  status: MessageGenerationStatus;
  requestId: string;
  /** Links this message to its persisted Agent run when Agent mode is active. */
  agentRunId?: string;
  ownerDeviceId: string;
  model: string;
  attempt: number;
  checkpointAt: number;
  continuedFrom?: string;
}

export interface ToolCall {
  id: string;
  /** Links the transcript item to its minimal execution-journal record. */
  executionRecordId?: string;
  name: string;
  pluginId?: string;
  pluginTitle?: string;
  functionFingerprint?: string;
  args: any;
  status:
    | "pending"
    | "awaiting_confirmation"
    | "running"
    | "success"
    | "error"
    | "skipped"
    | "denied";
  result?: any;
  resultImages?: Attachment[];
  isError?: boolean;
  risk?: PluginFunctionRisk;
  invocationPolicy?: ToolInvocationPolicy;
  approvalReason?: ToolApprovalReason;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  confirmation?: {
    required: boolean;
    canPersist?: boolean;
    state: "pending" | "approved" | "denied" | "interrupted" | "error";
    decision?: ToolConfirmationDecision | "automatic";
    decidedAt?: number;
  };
  errorInfo?: {
    code?: string;
    message: string;
    recoverable?: boolean;
  };
  auth?: {
    type: "bearer" | "apiKey" | "oauth2" | "none";
    value?: string;
    key?: string;
    addTo?: "header" | "query";
  };
}

export type ToolConfirmationDecision = "allow_once" | "allow_session" | "deny";

export type AgentUserInputQuestionKind =
  "single_choice" | "multiple_choice" | "confirmation" | "short_text";

export interface AgentUserInputOption {
  value: string;
  label: string;
  description?: string;
}

export interface AgentUserInputQuestion {
  id: string;
  header?: string;
  question: string;
  kind: AgentUserInputQuestionKind;
  required?: boolean;
  maxSelections?: number;
  maxLength?: number;
  options?: AgentUserInputOption[];
}

export interface AgentUserInputRequest {
  requestId: string;
  toolCallId: string;
  sessionId: string;
  questions: AgentUserInputQuestion[];
}

export type AgentUserInputAnswerValue = string | string[] | boolean;

export type AgentUserInputResult =
  | {
      status: "answered";
      answers: Record<string, AgentUserInputAnswerValue>;
    }
  | { status: "cancelled"; answers: Record<string, never> };

export interface AgentUserInputController {
  requestInput: (
    request: AgentUserInputRequest,
    signal?: AbortSignal,
  ) => Promise<AgentUserInputResult>;
}

export interface ToolSessionApproval {
  pluginId: string;
  functionName: string;
  risk: PluginFunctionRisk;
  functionFingerprint: string;
  approvedAt: number;
  identity?: ToolApprovalIdentityV2;
}

export interface ToolConfirmationRequest extends ToolSessionApproval {
  toolCallId: string;
  sessionId?: string;
  pluginTitle: string;
  args: unknown;
}

export interface ToolConfirmationController {
  requestConfirmation: (
    request: ToolConfirmationRequest,
    signal?: AbortSignal,
  ) => Promise<ToolConfirmationDecision>;
  isSessionApproved?: (
    approval: Omit<ToolSessionApproval, "approvedAt"> & { sessionId?: string },
  ) => boolean;
  grantSessionApproval?: (
    approval: ToolSessionApproval & { sessionId?: string },
  ) => void;
}

export type LongTextFormat = "markdown" | "plain_text";

export interface LongTextPresentation {
  kind: "long_text";
  title: string;
  format: LongTextFormat;
  document: {
    fileName: string;
    mimeType: "text/markdown" | "text/plain";
    url?: string;
    localFileMissing?: boolean;
    localFileError?: string;
  };
}

/** A workspace file the model has shared into the transcript. */
export interface WorkspaceFilePresentation {
  path: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  url: string;
  /** Changes every time the same workspace path is shared again. */
  revision: string;
  title?: string;
}

/** A zip archive the model has produced from workspace files. */
export interface ArchivePresentation {
  fileName: string;
  bytes: number;
  entryCount: number;
  url: string;
  title?: string;
}

export type MessageOutputBlock =
  | {
      id: string;
      type: "text";
      content: string;
      presentation?: LongTextPresentation;
    }
  | {
      id: string;
      type: "reasoning";
      content: string;
      startedAt?: number;
      endedAt?: number;
      durationMs?: number;
    }
  | {
      id: string;
      type: "search";
      isSearching?: boolean;
      error?: string;
      sources: Source[];
      images: ImageSource[];
    }
  | {
      id: string;
      type: "image";
      image: Attachment;
    }
  | {
      id: string;
      type: "image_generation_status";
      status: "generating";
    }
  | {
      id: string;
      type: "task_plan";
      steps: TaskPlanStep[];
      note?: string;
    }
  | {
      id: string;
      type: "research_task";
      taskId: string;
    }
  | {
      id: string;
      type: "workspace_file";
      file: WorkspaceFilePresentation;
    }
  | {
      id: string;
      type: "workspace_archive";
      archive: ArchivePresentation;
    }
  | {
      id: string;
      type: "tool_group";
      toolCalls: ToolCall[];
    };

export interface Message {
  id: string;
  role: "user" | "model";
  content: string;
  reasoning?: string;
  timestamp: number;
  attachments?: Attachment[];
  replyTo?: MessageReplyReference;
  generation?: MessageGenerationState;
  toolCalls?: ToolCall[];
  skillInvocations?: AppliedSkillInvocation[];
  /** Plugins explicitly referenced for this user request with `@`. */
  forcedPluginIds?: string[];
  memoryContext?: {
    injectedMemoryIds: string[];
    promptContext: string;
    createdAt?: number;
  };
  model?: string;
  generationError?: {
    message: string;
    recoverable?: boolean;
    code?: string;
  };
  searchSources?: Source[];
  citations?: CitationSource[];
  searchImages?: ImageSource[];
  isSearching?: boolean;
  outputBlocks?: MessageOutputBlock[];
  ragSources?: Source[];
  ragError?: {
    message: string;
    code?: string;
  };
  versions?: MessageVersion[];
  activeVersionId?: string;
  timing?: {
    startTime: number;
    endTime: number;
    duration: number;
  };
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  suggestedQuestions?: string[];
}

export interface MessageTreeNode {
  id: string;
  message: Message;
  parentMessageId?: string;
  childMessageIds: string[];
  activeChildMessageId?: string;
}

export interface SessionMessageTree {
  nodesById: Record<string, MessageTreeNode>;
  rootMessageIds: string[];
  activeRootMessageId?: string;
}

export type ChatPipelinePhase =
  "attachments" | "rag" | "search" | "plugins" | "model";

export type ChatPipelinePhaseState =
  "idle" | "running" | "success" | "warning" | "error";

export interface ChatPipelineStatus {
  phase: ChatPipelinePhase;
  state: ChatPipelinePhaseState;
  message?: string;
}

export interface ChatPipelineState {
  attachments: ChatPipelineStatus;
  rag: ChatPipelineStatus;
  search: ChatPipelineStatus;
  plugins: ChatPipelineStatus;
  model: ChatPipelineStatus;
}

export type ChatGenerationStatus =
  | "idle"
  | "pending"
  | "attachments"
  | "rag"
  | "searching"
  | "tool"
  | "model"
  | "done"
  | "error"
  | "aborted";

export interface ChatGenerationState {
  status: ChatGenerationStatus;
  activeRunId?: number;
  sessionId?: string;
  userMessageId?: string;
  modelMessageId?: string;
  pipeline: ChatPipelineState;
  stopRequested: boolean;
  error?: {
    message: string;
    recoverable?: boolean;
    code?: string;
  };
}

export interface BackgroundTaskSnapshot {
  runId: number;
  sessionId: string;
  messageId: string;
  messageContent: string;
  sessionUpdatedAt?: number;
}

export type ChatGenerationEvent =
  | {
      type: "start";
      runId: number;
      sessionId: string;
      userMessageId: string;
    }
  | {
      type: "pipeline";
      runId: number;
      phase: ChatPipelinePhase;
      phaseState: ChatPipelinePhaseState;
      message?: string;
    }
  | {
      type: "optional-capability-failed";
      runId: number;
      phase: Exclude<ChatPipelinePhase, "model">;
      message: string;
    }
  | {
      type: "stream-started";
      runId: number;
      modelMessageId: string;
    }
  | { type: "stop-requested"; runId: number }
  | { type: "completed"; runId: number }
  | {
      type: "failed";
      runId: number;
      error: string;
      recoverable?: boolean;
      code?: string;
    }
  | { type: "aborted"; runId: number; reason?: string }
  | { type: "reset" };

export interface SessionConfig {
  chatMode?: ChatMode;
  useSearch?: boolean;
  useReasoning?: boolean;
  useAgentMode?: boolean;
  useDeepResearch?: boolean;
  reasoningMode?: ReasoningMode;
  activePlugins?: string[];
  activeSkills?: string[];
  toolApprovals?: ToolSessionApproval[];
  agentProfileId?: string;
  /** Sanitized snapshot keeps an existing chat stable if a market Profile changes. */
  agentProfile?: AgentProfileV2;
  approvalMode?: AgentApprovalMode;
  agentBudget?: AgentRunBudget;
  skillPolicies?: AgentSkillPolicy[];
  researchBudgetPreset?: ResearchBudgetPreset;
  researchStrategy?: ResearchStrategy;
}

export interface Session {
  id: string;
  title: string;
  messages?: Message[];
  messageCount: number;
  updatedAt: number;
  model: string;
  systemInstruction?: string;
  pinned?: boolean;
  workspaceId?: string;
  config?: SessionConfig;
  compression?: {
    compressedContent: string;
    lastCompressedMessageId: string;
    includedMemoryIds?: string[];
  };
  memoryContext?: {
    injectedMemoryIds: string[];
    updatedAt?: number;
  };
}

export interface Workspace {
  id: string;
  name: string;
  systemPrompt?: string;
  knowledgeCollectionIds: string[];
  files: Attachment[];
  color?: string;
  enableSearch?: boolean;
  enableReasoning?: boolean;
  activePlugins?: string[];
  activeSkills?: string[];
  agentProfile?: AgentProfileV2;
  createdAt: number;
}

export interface Assistant {
  id: string;
  name: string;
  description: string;
  icon: string;
  systemInstruction?: string;
  color: string;
}

export interface ChatConfig {
  chatMode?: ChatMode;
  useSearch: boolean;
  useReasoning: boolean;
  useAgentMode?: boolean;
  useDeepResearch?: boolean;
  reasoningMode: ReasoningMode;
  useRAG?: boolean;
  temperature: number;
  imageCount?: number;
}

export type ChatMode = "auto" | "chat" | "research" | "agent";

export type ReasoningMode = "off" | "auto" | "low" | "medium" | "high";
