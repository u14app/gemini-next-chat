import { z } from "zod";

import {
  INTERNAL_AGENT_RESEARCH_PROVIDER_ID,
  RESEARCH_TASK_SCHEMA_VERSION,
  type ResearchPlanVersion,
  type ResearchReportRun,
  type ResearchStopReason,
  type ResearchTask,
  type ResearchTaskError,
} from "@/lib/research/types";

export const RESEARCH_TASK_STORAGE_VERSION = 2 as const;

const DEFAULT_DB_NAME = "neo-chat-research-tasks";
const STORE_NAME = "tasks";
const SESSION_INDEX = "sessionId";
const MAX_ERROR_CHARS = 240;

export type ResearchTaskRepositoryFallbackReason =
  "indexeddb_unavailable" | "indexeddb_operation_failed";

export interface ResearchTaskRepositoryStatus {
  mode: "persistent" | "memory";
  durable: boolean;
  fallbackReason?: ResearchTaskRepositoryFallbackReason;
}

export interface ResearchTaskRepository {
  getStatus(): ResearchTaskRepositoryStatus;
  save(task: ResearchTask): Promise<void>;
  get(taskId: string): Promise<ResearchTask | null>;
  list(sessionId?: string): Promise<ResearchTask[]>;
  remove(taskId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export interface CreateResearchTaskRepositoryOptions {
  indexedDb?: IDBFactory | null;
  dbName?: string;
}

interface StoredResearchTaskRecord {
  storageVersion: typeof RESEARCH_TASK_STORAGE_VERSION;
  taskId: string;
  sessionId: string;
  updatedAt: number;
  task: ResearchTask;
}

interface ResearchTaskBackend {
  put(record: StoredResearchTaskRecord): Promise<void>;
  get(taskId: string): Promise<unknown>;
  getAll(): Promise<unknown[]>;
  remove(taskId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

const statusSchema = z.enum([
  "draft",
  "clarifying",
  "plan_ready",
  "researching",
  "verifying",
  "synthesizing",
  "paused",
  "completed",
  "partial_completed",
  "failed",
  "cancelled",
]);

const budgetSchema = z
  .object({
    maxToolRounds: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
    maxDurationMs: z.number().int().positive(),
    maxTotalTokens: z.number().int().positive().optional(),
  })
  .strict();

const usageSchema = z
  .object({
    toolRounds: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

const sourceTypeSchema = z.enum([
  "web",
  "knowledge",
  "attachment",
  "workspace",
  "plugin",
  "mcp",
]);

const prioritySchema = z.enum(["high", "medium", "low"]);

const strategySchema = z
  .object({
    initialBreadth: z.number().int().min(1).max(8),
    maxDepth: z.number().int().min(1).max(4),
    maxQueries: z.number().int().min(2).max(48),
    resultsPerQuery: z.number().int().min(3).max(10),
  })
  .strict();

const reconSchema = z
  .object({
    status: z.enum(["completed", "partial", "unavailable"]),
    sourceFeasibility: z.enum(["verified", "unverified"]),
    startedAt: z.number().finite().nonnegative(),
    completedAt: z.number().finite().nonnegative(),
    timeoutMs: z.number().int().positive().max(30_000),
    queryLimit: z.number().int().min(1).max(2),
    resultsPerQuery: z.number().int().min(1).max(5),
    usage: z
      .object({
        queryCount: z.number().int().nonnegative().max(2),
        resultCount: z.number().int().nonnegative().max(10),
        wallTimeMs: z.number().int().nonnegative(),
      })
      .strict(),
    queries: z
      .array(
        z
          .object({
            query: z.string().min(1).max(8_000),
            status: z.enum(["completed", "failed", "timed_out"]),
            resultCount: z.number().int().nonnegative().max(5),
            domains: z.array(z.string().min(1).max(255)).max(5),
            error: z.string().min(1).max(MAX_ERROR_CHARS).optional(),
          })
          .strict(),
      )
      .max(2),
    providerId: z.string().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((recon, context) => {
    if (
      recon.completedAt < recon.startedAt ||
      recon.queries.length > recon.queryLimit ||
      recon.usage.queryCount > recon.queryLimit
    ) {
      context.addIssue({
        code: "custom",
        message: "Research reconnaissance metadata is inconsistent.",
      });
    }
  });

const planSchema = z
  .object({
    id: z.string().min(1).max(240),
    version: z.number().int().positive(),
    title: z.string().min(1).max(500),
    summary: z.string().min(1).max(8_000),
    objective: z.string().min(1).max(4_000),
    scope: z
      .object({
        audience: z.string().min(1).max(500),
        timeRange: z
          .object({
            start: z.string().min(1).max(100).optional(),
            end: z.string().min(1).max(100).optional(),
            description: z.string().min(1).max(500).optional(),
          })
          .strict()
          .optional(),
        includes: z.array(z.string().min(1).max(1_000)).max(20),
        excludes: z.array(z.string().min(1).max(1_000)).max(20),
        allowedSourceTypes: z.array(sourceTypeSchema).min(1).max(6),
      })
      .strict(),
    assumptions: z.array(z.string().min(1).max(1_000)).max(20),
    deliverable: z
      .object({
        kind: z.enum([
          "research_report",
          "comparison",
          "decision_memo",
          "exact_answer",
        ]),
        description: z.string().min(1).max(2_000),
        requiredSections: z.array(z.string().min(1).max(500)).min(1).max(12),
      })
      .strict(),
    strategy: strategySchema,
    recon: reconSchema,
    steps: z
      .array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(64)
              .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
            title: z.string().min(1).max(500),
            objective: z.string().min(1).max(2_000),
            questions: z.array(z.string().min(1).max(2_000)).min(1).max(8),
            queryTopics: z.array(z.string().min(1).max(1_000)).min(1).max(8),
            sourcePriorities: z
              .array(
                z
                  .object({
                    sourceType: sourceTypeSchema,
                    priority: prioritySchema,
                    rationale: z.string().min(1).max(1_000).optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(6),
            evidenceCriteria: z
              .array(z.string().min(1).max(1_000))
              .min(1)
              .max(8),
            priority: prioritySchema,
          })
          .strict(),
      )
      .min(3)
      .max(8),
    completionCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    createdAt: z.number().finite().nonnegative(),
    adjustment: z.string().min(1).max(8_000).optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    const stepIds = new Set<string>();
    plan.steps.forEach((step, index) => {
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "Research plan step IDs must be unique.",
        });
      }
      stepIds.add(step.id);
      if (
        step.sourcePriorities.some(
          (source) =>
            !plan.scope.allowedSourceTypes.includes(source.sourceType),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "sourcePriorities"],
          message: "Research plan source priorities exceed the scope.",
        });
      }
    });
  });

const sourceSnapshotSchema = z
  .object({
    model: z.string().min(1).max(240).optional(),
    reasoningMode: z.enum(["off", "auto", "low", "medium", "high"]).optional(),
    approvalMode: z.enum(["permissive", "balanced", "strict"]),
    searchEnabled: z.boolean(),
    toolIds: z.array(z.string().min(1).max(240)).max(500),
    pluginIds: z.array(z.string().min(1).max(240)).max(500),
    skillIds: z.array(z.string().min(1).max(240)).max(500),
    knowledgeCollectionIds: z.array(z.string().min(1).max(240)).max(500),
    attachmentIds: z.array(z.string().min(1).max(240)).max(500),
    workspaceFileIds: z.array(z.string().min(1).max(240)).max(500),
    workspaceSources: z
      .array(
        z
          .object({
            path: z.string().min(1).max(4_096),
            contentHash: z.string().min(1).max(256),
            revision: z.string().min(1).max(256),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    memoryScopes: z
      .array(z.enum(["global", "workspace", "agent", "session"]))
      .max(4),
    memoryScopeIds: z
      .object({
        workspace: z.string().min(1).max(240).optional(),
        agent: z.string().min(1).max(240).optional(),
        session: z.string().min(1).max(240).optional(),
      })
      .strict(),
    capturedAt: z.number().finite().nonnegative(),
  })
  .strict();

const evidenceSchema = z
  .object({
    id: z.string().min(1).max(240),
    sourceId: z.string().min(1).max(240),
    aliasSourceIds: z.array(z.string().min(1).max(240)).max(500).optional(),
    sourceType: sourceTypeSchema,
    stepId: z.string().min(1).max(240),
    nodeId: z.string().min(1).max(240),
    title: z.string().max(500).optional(),
    locator: z.string().min(1).max(2_048),
    aliasLocators: z.array(z.string().min(1).max(2_048)).max(500).optional(),
    retrievedAt: z.number().finite().nonnegative(),
    contentHash: z.string().min(1).max(256),
    publisherId: z.string().min(1).max(500).optional(),
    authority: z.enum(["primary", "secondary", "unknown"]).optional(),
    mirrorOfSourceId: z.string().min(1).max(240).optional(),
    toolCallId: z.string().min(1).max(240).optional(),
    agentRunId: z.string().min(1).max(240).optional(),
    claimIds: z.array(z.string().min(1).max(240)).max(500),
    stance: z.enum(["supports", "contradicts", "context"]).optional(),
    freshness: z.enum(["current", "stale", "unknown"]).optional(),
    availability: z.enum(["available", "unavailable"]).optional(),
    relations: z
      .array(
        z
          .object({
            researchRunId: z.string().min(1).max(240),
            stepId: z.string().min(1).max(240),
            nodeId: z.string().min(1).max(240),
            claimIds: z.array(z.string().min(1).max(240)).max(500),
            stance: z.enum(["supports", "contradicts", "context"]),
            boundAt: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict();

const stopReasonSchema = z
  .object({
    code: z.enum([
      "coverage_satisfied",
      "max_depth",
      "max_queries",
      "max_sources",
      "budget_exhausted",
      "no_new_sources",
      "invalid_model_output",
      "no_new_verified_claims",
      "frontier_exhausted",
      "user_paused",
      "user_cancelled",
      "dependency_unavailable",
      "scope_approval_required",
    ]),
    at: z.number().finite().nonnegative(),
    detail: z.string().min(1).max(4_000).optional(),
  })
  .strict();

const claimSchema = z
  .object({
    id: z.string().min(1).max(240),
    text: z.string().min(1).max(8_000),
    importance: z.enum(["major", "background"]),
    stepId: z.string().min(1).max(240),
    nodeIds: z.array(z.string().min(1).max(240)).max(1_000),
    supportingEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
    contradictingEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
    verificationStatus: z.enum([
      "pending",
      "verified",
      "unsupported",
      "unresolved",
    ]),
    independentPublisherCount: z.number().int().nonnegative().max(2_000),
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.updatedAt < claim.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Research claim timestamps are inconsistent.",
      });
    }
  });

const learningPacketSchema = z
  .object({
    id: z.string().min(1).max(240),
    nodeId: z.string().min(1).max(240),
    learnings: z
      .array(
        z
          .object({
            id: z.string().min(1).max(240),
            statement: z.string().min(1).max(8_000),
            sourceIds: z.array(z.string().min(1).max(240)).max(2_000),
            evidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
          })
          .strict(),
      )
      .max(1_000),
    sourceAssessments: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(240),
            authority: z.enum(["primary", "secondary", "unknown"]),
            publisherId: z.string().min(1).max(240).optional(),
            mirrorOfSourceId: z.string().min(1).max(240).optional(),
            rationale: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .max(20),
    followUps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(240),
            question: z.string().min(1).max(4_000),
            rationale: z.string().min(1).max(4_000),
            priority: prioritySchema,
            scopeImpact: z.enum([
              "within",
              "source_expansion",
              "scope_expansion",
            ]),
            requiredSourceTypes: z.array(sourceTypeSchema).max(6),
          })
          .strict(),
      )
      .max(1_000),
    createdAt: z.number().finite().nonnegative(),
  })
  .strict();

const runCheckpointSchema = z
  .object({
    createdAt: z.number().finite().nonnegative(),
    waveIndex: z.number().int().nonnegative(),
    frontierNodeIds: z.array(z.string().min(1).max(240)).max(2_000),
    committedEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
    committedToolExecutionIds: z.array(z.string().min(1).max(240)).max(2_000),
  })
  .strict();

const scopeExpansionEventSchema = z
  .object({
    id: z.string().min(1).max(240),
    at: z.number().finite().nonnegative(),
    sourceSnapshotCapturedAt: z.number().finite().nonnegative(),
    packetIds: z.array(z.string().min(1).max(240)).max(1_000),
    addedSourceTypes: z.array(sourceTypeSchema).max(6),
    scheduledFollowUpIds: z.array(z.string().min(1).max(240)).max(1_000),
    unavailableSourceFollowUpIds: z
      .array(z.string().min(1).max(240))
      .max(1_000),
    duplicateFollowUpIds: z.array(z.string().min(1).max(240)).max(1_000),
    breadthLimitedFollowUpIds: z.array(z.string().min(1).max(240)).max(1_000),
    depthLimitedFollowUpIds: z.array(z.string().min(1).max(240)).max(1_000),
  })
  .strict();

const reportRunSchema = z
  .object({
    id: z.string().min(1).max(240),
    taskId: z.string().min(1).max(240),
    planVersion: z.number().int().positive(),
    reportKind: z.enum(["initial", "continue", "update"]),
    phase: z.enum([
      "queued",
      "exploring",
      "verifying",
      "synthesizing",
      "awaiting_scope_approval",
      "paused",
      "completed",
      "partial_completed",
      "failed",
      "cancelled",
    ]),
    strategy: strategySchema,
    waves: z
      .array(
        z
          .object({
            id: z.string().min(1).max(240),
            index: z.number().int().positive(),
            depth: z.number().int().min(1).max(4),
            breadth: z.number().int().min(1).max(8),
            nodeIds: z.array(z.string().min(1).max(240)).max(2_000),
            status: z.enum([
              "queued",
              "running",
              "completed",
              "paused",
              "failed",
            ]),
            packetStatus: z.enum(["valid", "repaired", "degraded"]).optional(),
            degradedNodeIds: z
              .array(z.string().min(1).max(240))
              .max(2_000)
              .optional(),
            newEvidenceCount: z.number().int().nonnegative(),
            newVerifiedClaimCount: z.number().int().nonnegative(),
            startedAt: z.number().finite().nonnegative().optional(),
            completedAt: z.number().finite().nonnegative().optional(),
          })
          .strict(),
      )
      .max(1_000),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(240),
            parentNodeId: z.string().min(1).max(240).optional(),
            waveId: z.string().min(1).max(240).optional(),
            stepId: z.string().min(1).max(240),
            depth: z.number().int().min(1).max(4),
            objective: z.string().min(1).max(4_000),
            query: z.string().min(1).max(8_000),
            status: z.enum([
              "pending",
              "queued",
              "searching",
              "reading",
              "learning",
              "completed",
              "blocked",
              "failed",
              "skipped",
            ]),
            sourceIds: z.array(z.string().min(1).max(240)).max(2_000),
            evidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
            claimIds: z.array(z.string().min(1).max(240)).max(2_000),
            learningPacketId: z.string().min(1).max(240).optional(),
            stopReason: stopReasonSchema.optional(),
            createdAt: z.number().finite().nonnegative(),
            updatedAt: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(2_000),
    learningPackets: z.array(learningPacketSchema).max(2_000),
    claims: z.array(claimSchema).max(2_000),
    frontierNodeIds: z.array(z.string().min(1).max(240)).max(2_000),
    executedQueries: z.array(z.string().min(1).max(8_000)).max(48),
    coverage: z
      .object({
        requiredStepCount: z.number().int().nonnegative(),
        coveredStepCount: z.number().int().nonnegative(),
        majorClaimCount: z.number().int().nonnegative(),
        verifiedMajorClaimCount: z.number().int().nonnegative(),
        unresolvedMajorClaimCount: z.number().int().nonnegative(),
        stepRatio: z.number().finite().min(0).max(1),
        claimRatio: z.number().finite().min(0).max(1),
        overallRatio: z.number().finite().min(0).max(1),
        complete: z.boolean(),
      })
      .strict(),
    usage: z
      .object({
        queryCount: z.number().int().nonnegative().max(48),
        sourceBodyCount: z.number().int().nonnegative().max(64),
        toolRounds: z.number().int().nonnegative(),
        toolCalls: z.number().int().nonnegative(),
        wallTimeMs: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict(),
    startedAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    endedAt: z.number().finite().nonnegative().optional(),
    stopReason: stopReasonSchema.optional(),
    checkpoint: runCheckpointSchema.optional(),
    scopeExpansionEvents: z
      .array(scopeExpansionEventSchema)
      .max(1_000)
      .optional(),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.updatedAt < run.startedAt ||
      (run.endedAt !== undefined && run.endedAt < run.updatedAt) ||
      run.usage.queryCount > run.strategy.maxQueries ||
      run.executedQueries.length > run.strategy.maxQueries
    ) {
      context.addIssue({
        code: "custom",
        message: "Research report run metadata is inconsistent.",
      });
    }
  });

const reportSchema = z
  .object({
    id: z.string().min(1).max(240),
    version: z.number().int().positive(),
    artifactId: z.string().min(1).max(512),
    planVersion: z.number().int().positive(),
    researchRunId: z.string().min(1).max(240),
    createdAt: z.number().finite().nonnegative(),
    summary: z.string().min(1).max(8_000),
    keyFindings: z.array(z.string().min(1).max(4_000)).max(100),
    gaps: z.array(z.string().min(1).max(4_000)).max(100),
    coveredStepIds: z.array(z.string().min(1).max(240)).max(100).optional(),
    evidenceIds: z.array(z.string().min(1).max(240)).max(2_000).optional(),
    diff: z
      .object({
        addedEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
        changedSourceIds: z.array(z.string().min(1).max(240)).max(2_000),
        unchangedSourceIds: z.array(z.string().min(1).max(240)).max(2_000),
      })
      .strict()
      .optional(),
    agentRunId: z.string().min(1).max(240).optional(),
    kind: z.enum(["initial", "continue", "update"]),
  })
  .strict();

const checkpointSchema = z
  .object({
    createdAt: z.number().finite().nonnegative(),
    resumeStatus: statusSchema,
    committedEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
    committedToolExecutionIds: z.array(z.string().min(1).max(240)).max(2_000),
    researchRunId: z.string().min(1).max(240).optional(),
    historyPath: z.string().min(1).max(1_024).optional(),
  })
  .strict();

const errorSchema = z
  .object({
    code: z.string().max(160).optional(),
    message: z.string().min(1).max(MAX_ERROR_CHARS),
    recoverable: z.boolean().optional(),
  })
  .strict();

const researchTaskSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_TASK_SCHEMA_VERSION),
    providerId: z.literal(INTERNAL_AGENT_RESEARCH_PROVIDER_ID),
    id: z.string().min(1).max(240),
    sessionId: z.string().min(1).max(240),
    userMessageId: z.string().min(1).max(240).optional(),
    cardMessageId: z.string().min(1).max(240).optional(),
    goal: z.string().min(1).max(8_000),
    status: statusSchema,
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    endedAt: z.number().finite().nonnegative().optional(),
    budgetPreset: z.enum(["quick", "standard", "deep"]),
    budget: budgetSchema,
    requestedStrategy: strategySchema.optional(),
    usage: usageSchema,
    sourceSnapshot: sourceSnapshotSchema.optional(),
    planVersions: z.array(planSchema).max(100),
    activePlanVersion: z.number().int().positive().optional(),
    evidence: z.array(evidenceSchema).max(2_000),
    reportRuns: z.array(reportRunSchema).max(100),
    activeReportRunId: z.string().min(1).max(240).optional(),
    reportVersions: z.array(reportSchema).max(100),
    activeReportVersion: z.number().int().positive().optional(),
    pendingReportKind: z.enum(["initial", "continue", "update"]),
    agentRunIds: z.array(z.string().min(1).max(240)).max(1_000),
    executionRunIds: z.array(z.string().min(1).max(240)).max(1_000),
    checkpoint: checkpointSchema.optional(),
    error: errorSchema.optional(),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.updatedAt < task.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Task timestamps are inconsistent.",
      });
    }
    if (task.endedAt !== undefined && task.endedAt < task.updatedAt) {
      context.addIssue({
        code: "custom",
        message: "Task end time is inconsistent.",
      });
    }
    task.planVersions.forEach((plan, index) => {
      if (plan.version !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Plan versions are inconsistent.",
        });
      }
    });
    task.reportVersions.forEach((report, index) => {
      if (report.version !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Report versions are inconsistent.",
        });
      }
    });
    const planVersions = new Set(task.planVersions.map((plan) => plan.version));
    if (
      task.activePlanVersion !== undefined &&
      !planVersions.has(task.activePlanVersion)
    ) {
      context.addIssue({
        code: "custom",
        message: "The active research plan does not exist.",
      });
    }
    const runIds = new Set(task.reportRuns.map((run) => run.id));
    const stepIds = new Set(
      task.planVersions.flatMap((plan) => plan.steps.map((step) => step.id)),
    );
    const nodeIds = new Set(
      task.reportRuns.flatMap((run) => run.nodes.map((node) => node.id)),
    );
    for (const run of task.reportRuns) {
      if (run.taskId !== task.id || !planVersions.has(run.planVersion)) {
        context.addIssue({
          code: "custom",
          message: "Research report run references are inconsistent.",
        });
      }
    }
    if (task.activeReportRunId && !runIds.has(task.activeReportRunId)) {
      context.addIssue({
        code: "custom",
        message: "The active research report run does not exist.",
      });
    }
    for (const report of task.reportVersions) {
      if (
        !runIds.has(report.researchRunId) ||
        !planVersions.has(report.planVersion)
      ) {
        context.addIssue({
          code: "custom",
          message: "Research report references are inconsistent.",
        });
      }
    }
    if (
      task.activeReportVersion !== undefined &&
      !task.reportVersions.some(
        (report) => report.version === task.activeReportVersion,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The active research report does not exist.",
      });
    }
    for (const evidence of task.evidence) {
      if (!stepIds.has(evidence.stepId) || !nodeIds.has(evidence.nodeId)) {
        context.addIssue({
          code: "custom",
          message: "Research evidence mappings are inconsistent.",
        });
      }
    }
    if (
      task.checkpoint?.researchRunId &&
      !runIds.has(task.checkpoint.researchRunId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The research checkpoint run does not exist.",
      });
    }
  });

const storedRecordSchema = z
  .object({
    storageVersion: z.literal(RESEARCH_TASK_STORAGE_VERSION),
    taskId: z.string().min(1).max(240),
    sessionId: z.string().min(1).max(240),
    updatedAt: z.number().finite().nonnegative(),
    task: researchTaskSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.taskId !== record.task.id ||
      record.sessionId !== record.task.sessionId ||
      record.updatedAt !== record.task.updatedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored task metadata is inconsistent.",
      });
    }
  });

function redactText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|token|password|secret)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, MAX_ERROR_CHARS);
}

function sanitizeError(
  error: ResearchTaskError | undefined,
): ResearchTaskError | undefined {
  if (!error) return undefined;
  return {
    ...(error.code ? { code: redactText(error.code).slice(0, 160) } : {}),
    message: redactText(error.message),
    ...(error.recoverable !== undefined
      ? { recoverable: error.recoverable }
      : {}),
  };
}

function sanitizeLocator(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /(?:key|token|secret|password|signature|credential|auth)/i.test(key)
      ) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString().slice(0, 2_048);
  } catch {
    return value.slice(0, 2_048);
  }
}

function sanitizeStopReason(
  reason: ResearchStopReason | undefined,
): ResearchStopReason | undefined {
  if (!reason) return undefined;
  return {
    ...reason,
    ...(reason.detail
      ? { detail: redactText(reason.detail).slice(0, 4_000) }
      : {}),
  };
}

function clonePlan(plan: ResearchPlanVersion): ResearchPlanVersion {
  return {
    ...plan,
    scope: {
      ...plan.scope,
      ...(plan.scope.timeRange
        ? { timeRange: { ...plan.scope.timeRange } }
        : {}),
      includes: [...plan.scope.includes],
      excludes: [...plan.scope.excludes],
      allowedSourceTypes: [...plan.scope.allowedSourceTypes],
    },
    assumptions: [...plan.assumptions],
    deliverable: {
      ...plan.deliverable,
      requiredSections: [...plan.deliverable.requiredSections],
    },
    strategy: { ...plan.strategy },
    recon: {
      ...plan.recon,
      usage: { ...plan.recon.usage },
      queries: plan.recon.queries.map((query) => ({
        ...query,
        domains: [...query.domains],
        ...(query.error ? { error: redactText(query.error) } : {}),
      })),
    },
    steps: plan.steps.map((step) => ({
      ...step,
      questions: [...step.questions],
      queryTopics: [...step.queryTopics],
      sourcePriorities: step.sourcePriorities.map((priority) => ({
        ...priority,
      })),
      evidenceCriteria: [...step.evidenceCriteria],
    })),
    completionCriteria: [...plan.completionCriteria],
  };
}

function cloneReportRun(run: ResearchReportRun): ResearchReportRun {
  return {
    ...run,
    strategy: { ...run.strategy },
    waves: run.waves.map((wave) => ({
      ...wave,
      nodeIds: [...wave.nodeIds],
      ...(wave.degradedNodeIds
        ? { degradedNodeIds: [...wave.degradedNodeIds] }
        : {}),
    })),
    nodes: run.nodes.map((node) => ({
      ...node,
      sourceIds: [...node.sourceIds],
      evidenceIds: [...node.evidenceIds],
      claimIds: [...node.claimIds],
      stopReason: sanitizeStopReason(node.stopReason),
    })),
    learningPackets: run.learningPackets.map((packet) => ({
      ...packet,
      learnings: packet.learnings.map((learning) => ({
        ...learning,
        sourceIds: [...learning.sourceIds],
        evidenceIds: [...learning.evidenceIds],
      })),
      sourceAssessments: packet.sourceAssessments.map((assessment) => ({
        ...assessment,
      })),
      followUps: packet.followUps.map((followUp) => ({
        ...followUp,
        requiredSourceTypes: [...followUp.requiredSourceTypes],
      })),
    })),
    claims: run.claims.map((claim) => ({
      ...claim,
      nodeIds: [...claim.nodeIds],
      supportingEvidenceIds: [...claim.supportingEvidenceIds],
      contradictingEvidenceIds: [...claim.contradictingEvidenceIds],
    })),
    frontierNodeIds: [...run.frontierNodeIds],
    executedQueries: [...run.executedQueries],
    coverage: { ...run.coverage },
    usage: { ...run.usage },
    stopReason: sanitizeStopReason(run.stopReason),
    checkpoint: run.checkpoint
      ? {
          ...run.checkpoint,
          frontierNodeIds: [...run.checkpoint.frontierNodeIds],
          committedEvidenceIds: [...run.checkpoint.committedEvidenceIds],
          committedToolExecutionIds: [
            ...run.checkpoint.committedToolExecutionIds,
          ],
        }
      : undefined,
  };
}

export function toPersistedResearchTask(task: ResearchTask): ResearchTask {
  return {
    ...task,
    budget: { ...task.budget },
    usage: { ...task.usage },
    sourceSnapshot: task.sourceSnapshot
      ? {
          ...task.sourceSnapshot,
          toolIds: [...task.sourceSnapshot.toolIds],
          pluginIds: [...task.sourceSnapshot.pluginIds],
          skillIds: [...task.sourceSnapshot.skillIds],
          knowledgeCollectionIds: [
            ...task.sourceSnapshot.knowledgeCollectionIds,
          ],
          attachmentIds: [...task.sourceSnapshot.attachmentIds],
          workspaceFileIds: [...task.sourceSnapshot.workspaceFileIds],
          ...(task.sourceSnapshot.workspaceSources
            ? {
                workspaceSources: task.sourceSnapshot.workspaceSources.map(
                  (source) => ({ ...source }),
                ),
              }
            : {}),
          memoryScopes: [...task.sourceSnapshot.memoryScopes],
          memoryScopeIds: { ...task.sourceSnapshot.memoryScopeIds },
        }
      : undefined,
    planVersions: task.planVersions.map(clonePlan),
    evidence: task.evidence.map((item) => ({
      ...item,
      locator: sanitizeLocator(item.locator),
      ...(item.aliasSourceIds
        ? { aliasSourceIds: [...item.aliasSourceIds] }
        : {}),
      ...(item.aliasLocators
        ? { aliasLocators: item.aliasLocators.map(sanitizeLocator) }
        : {}),
      claimIds: [...item.claimIds],
      ...(item.relations
        ? {
            relations: item.relations.map((relation) => ({
              ...relation,
              claimIds: [...relation.claimIds],
            })),
          }
        : {}),
    })),
    reportRuns: task.reportRuns.map(cloneReportRun),
    reportVersions: task.reportVersions.map((report) => ({
      ...report,
      keyFindings: [...report.keyFindings],
      gaps: [...report.gaps],
      ...(report.coveredStepIds
        ? { coveredStepIds: [...report.coveredStepIds] }
        : {}),
      ...(report.evidenceIds ? { evidenceIds: [...report.evidenceIds] } : {}),
      ...(report.diff
        ? {
            diff: {
              addedEvidenceIds: [...report.diff.addedEvidenceIds],
              changedSourceIds: [...report.diff.changedSourceIds],
              unchangedSourceIds: [...report.diff.unchangedSourceIds],
            },
          }
        : {}),
    })),
    agentRunIds: [...task.agentRunIds],
    executionRunIds: [...task.executionRunIds],
    checkpoint: task.checkpoint
      ? {
          ...task.checkpoint,
          committedEvidenceIds: [...task.checkpoint.committedEvidenceIds],
          committedToolExecutionIds: [
            ...task.checkpoint.committedToolExecutionIds,
          ],
        }
      : undefined,
    error: sanitizeError(task.error),
  };
}

function createStoredRecord(task: ResearchTask): StoredResearchTaskRecord {
  const persistedTask = toPersistedResearchTask(task);
  const parsed = storedRecordSchema.safeParse({
    storageVersion: RESEARCH_TASK_STORAGE_VERSION,
    taskId: persistedTask.id,
    sessionId: persistedTask.sessionId,
    updatedAt: persistedTask.updatedAt,
    task: persistedTask,
  });
  if (!parsed.success)
    throw new Error("Research task is not valid for local persistence.");
  return parsed.data as StoredResearchTaskRecord;
}

export function parseStoredResearchTask(value: unknown): ResearchTask | null {
  const parsed = storedRecordSchema.safeParse(value);
  return parsed.success ? (parsed.data.task as ResearchTask) : null;
}

export function parseResearchTaskValue(value: unknown): ResearchTask | null {
  const parsed = researchTaskSchema.safeParse(value);
  return parsed.success ? (parsed.data as ResearchTask) : null;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

class IndexedDbResearchTaskBackend implements ResearchTaskBackend {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly dbName: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(
        this.dbName,
        RESEARCH_TASK_STORAGE_VERSION,
      );
      request.onupgradeneeded = (event) => {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "taskId" });
        const { oldVersion } = event as IDBVersionChangeEvent;
        if (oldVersion > 0 && oldVersion < RESEARCH_TASK_STORAGE_VERSION) {
          store.clear();
        }
        if (!store.indexNames.contains(SESSION_INDEX)) {
          store.createIndex(SESSION_INDEX, SESSION_INDEX, { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error("IndexedDB open failed."));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error("IndexedDB open was blocked."));
      };
    });
    return this.databasePromise;
  }

  async put(record: StoredResearchTaskRecord): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionToPromise(transaction);
  }

  async get(taskId: string): Promise<unknown> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).get(taskId));
  }

  async getAll(): Promise<unknown[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).getAll());
  }

  async remove(taskId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(taskId);
    await transactionToPromise(transaction);
  }

  async clearSession(sessionId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.index(SESSION_INDEX).openKeyCursor(sessionId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionToPromise(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionToPromise(transaction);
  }

  close(): void {
    void this.databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined);
    this.databasePromise = null;
  }
}

class MemoryResearchTaskBackend implements ResearchTaskBackend {
  private readonly records = new Map<string, StoredResearchTaskRecord>();

  async put(record: StoredResearchTaskRecord): Promise<void> {
    this.records.set(record.taskId, createStoredRecord(record.task));
  }
  async get(taskId: string): Promise<unknown> {
    return this.records.get(taskId) ?? null;
  }
  async getAll(): Promise<unknown[]> {
    return [...this.records.values()];
  }
  async remove(taskId: string): Promise<void> {
    this.records.delete(taskId);
  }
  async clearSession(sessionId: string): Promise<void> {
    for (const [taskId, record] of this.records) {
      if (record.sessionId === sessionId) this.records.delete(taskId);
    }
  }
  async clear(): Promise<void> {
    this.records.clear();
  }
  close(): void {}
}

class BrowserResearchTaskRepository implements ResearchTaskRepository {
  private readonly memory = new MemoryResearchTaskBackend();
  private persistent: ResearchTaskBackend | null;
  private status: ResearchTaskRepositoryStatus;

  constructor(factory: IDBFactory | null, dbName: string) {
    this.persistent = factory
      ? new IndexedDbResearchTaskBackend(factory, dbName)
      : null;
    this.status = factory
      ? { mode: "persistent", durable: true }
      : {
          mode: "memory",
          durable: false,
          fallbackReason: "indexeddb_unavailable",
        };
  }

  getStatus(): ResearchTaskRepositoryStatus {
    return { ...this.status };
  }

  private downgrade(reason: ResearchTaskRepositoryFallbackReason): void {
    this.persistent?.close();
    this.persistent = null;
    this.status = { mode: "memory", durable: false, fallbackReason: reason };
  }

  async save(task: ResearchTask): Promise<void> {
    const record = createStoredRecord(task);
    await this.memory.put(record);
    if (!this.persistent) return;
    try {
      await this.persistent.put(record);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  async get(taskId: string): Promise<ResearchTask | null> {
    if (this.persistent) {
      try {
        const stored = await this.persistent.get(taskId);
        const task = parseStoredResearchTask(stored);
        if (task) await this.memory.put(createStoredRecord(task));
        else if (stored !== undefined && stored !== null) {
          await this.persistent.remove(taskId);
        }
        return task;
      } catch {
        this.downgrade("indexeddb_operation_failed");
      }
    }
    return parseStoredResearchTask(await this.memory.get(taskId));
  }

  async list(sessionId?: string): Promise<ResearchTask[]> {
    let values: unknown[];
    if (this.persistent) {
      try {
        values = await this.persistent.getAll();
        const tasks = values
          .map(parseStoredResearchTask)
          .filter((task): task is ResearchTask => Boolean(task));
        const invalidTaskIds = values.flatMap((value) => {
          if (parseStoredResearchTask(value)) return [];
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return [];
          }
          const taskId = (value as { taskId?: unknown }).taskId;
          return typeof taskId === "string" && taskId ? [taskId] : [];
        });
        await Promise.all(
          invalidTaskIds.map((taskId) => this.persistent!.remove(taskId)),
        );
        await Promise.all(
          tasks.map((task) => this.memory.put(createStoredRecord(task))),
        );
      } catch {
        this.downgrade("indexeddb_operation_failed");
        values = await this.memory.getAll();
      }
    } else {
      values = await this.memory.getAll();
    }
    return values
      .map(parseStoredResearchTask)
      .filter((task): task is ResearchTask => Boolean(task))
      .filter((task) => !sessionId || task.sessionId === sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async remove(taskId: string): Promise<void> {
    await this.memory.remove(taskId);
    if (!this.persistent) return;
    try {
      await this.persistent.remove(taskId);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.memory.clearSession(sessionId);
    if (!this.persistent) return;
    try {
      await this.persistent.clearSession(sessionId);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  async clear(): Promise<void> {
    await this.memory.clear();
    if (!this.persistent) return;
    try {
      await this.persistent.clear();
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  close(): void {
    this.persistent?.close();
  }
}

function resolveIndexedDbFactory(
  options: CreateResearchTaskRepositoryOptions,
): IDBFactory | null {
  if (Object.prototype.hasOwnProperty.call(options, "indexedDb")) {
    return options.indexedDb ?? null;
  }
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

export function createResearchTaskRepository(
  options: CreateResearchTaskRepositoryOptions = {},
): ResearchTaskRepository {
  return new BrowserResearchTaskRepository(
    resolveIndexedDbFactory(options),
    options.dbName ?? DEFAULT_DB_NAME,
  );
}
