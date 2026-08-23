import type { PluginFunctionRisk } from "@/lib/plugin/types";
import type {
  Attachment,
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

import type { ChatToolDefinition } from "../types";

export type BuiltinToolRisk = Extract<PluginFunctionRisk, "read">;

export interface BuiltinKnowledgeScope {
  attachments: Attachment[];
  collections: Collection[];
  ragConfig: KnowledgeRetrievalRagConfig;
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

export interface BuiltinToolEmitters {
  search?: (event: BuiltinSearchEvent) => void;
  knowledgeSources?: (sources: Source[], ragError?: RagQueryError) => void;
  skillInvocation?: (invocation: AppliedSkillInvocation) => void;
  taskPlan?: (plan: TaskPlanSnapshot) => void;
  workspaceFile?: (file: WorkspaceFileShare) => void;
  archiveFile?: (archive: ArchiveFileShare) => void;
  longText?: (request: LongTextOutputRequest) =>
    | { ok: true }
    | {
        ok: false;
        error: { code: string; message: string };
      };
}

export interface BuiltinToolContext {
  signal?: AbortSignal;
  sessionId: string;
  knowledgeScope?: BuiltinKnowledgeScope;
  emit: BuiltinToolEmitters;
}

export interface BuiltinToolBinding {
  definition: ChatToolDefinition;
  risk: BuiltinToolRisk;
  displayKey: string;
  agentOnly?: boolean;
  /** Built-ins in the same group execute in provider tool-call order. */
  executionGroup?: "workspace";
  execute: (args: unknown, context: BuiltinToolContext) => Promise<unknown>;
}

export interface CollectedBuiltinTools {
  definitions: ChatToolDefinition[];
  bindingsByName: ReadonlyMap<string, BuiltinToolBinding>;
}
