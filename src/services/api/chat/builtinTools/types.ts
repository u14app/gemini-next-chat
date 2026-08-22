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

export interface BuiltinToolEmitters {
  search?: (event: BuiltinSearchEvent) => void;
  knowledgeSources?: (sources: Source[], ragError?: RagQueryError) => void;
  skillInvocation?: (invocation: AppliedSkillInvocation) => void;
  taskPlan?: (plan: TaskPlanSnapshot) => void;
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
  execute: (args: unknown, context: BuiltinToolContext) => Promise<unknown>;
}

export interface CollectedBuiltinTools {
  definitions: ChatToolDefinition[];
  bindingsByName: ReadonlyMap<string, BuiltinToolBinding>;
}
