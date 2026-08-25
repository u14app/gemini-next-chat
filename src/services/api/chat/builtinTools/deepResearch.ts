import {
  DEEP_RESEARCH_INSTRUCTION_MAX_CHARS,
  DEEP_RESEARCH_QUERY_MAX_CHARS,
  RESEARCH_QUESTION_MAX_INDEX,
  RESEARCH_REPORT_MAX_VERSIONS,
  RESEARCH_SESSION_ID_MAX_CHARS,
  RESEARCH_TASK_ID_MAX_CHARS,
  RESEARCH_TASK_LIST_MAX_ITEMS,
  filterResearchEvidence,
  getResearchEvidenceQuestionIndexes,
  getResearchVerificationQueryReserve,
  parseAdjustResearchPlanArgs,
  parseGetResearchStatusArgs,
  parseListResearchEvidenceArgs,
  parseListResearchTasksArgs,
  parseReadResearchReportArgs,
  parseStartDeepResearchArgs,
  type ResearchTask,
} from "@/lib/research";
import {
  getResearchTaskRepository,
  readResearchReportArtifact,
} from "@/services/research";
import { useResearchStore } from "@/store/core/researchStore";

import type {
  BuiltinResearchHostContext,
  BuiltinToolBinding,
  BuiltinToolContext,
} from "./types";

interface ResearchEvidenceClaimVerification {
  researchRunId?: string;
  planVersion?: number;
  stepId?: string;
  nodeId?: string;
  stance?: "supports" | "contradicts" | "context";
  claimId: string;
  verificationStatus: string | null;
  importance: string | null;
  independentPublisherCount: number | null;
}

const READ_DESCRIPTOR: BuiltinToolBinding["descriptor"] = {
  version: 2,
  effects: ["local_read"],
  idempotency: "idempotent",
  sensitivity: "user_data",
  origin: "builtin",
};

const WRITE_DESCRIPTOR: BuiltinToolBinding["descriptor"] = {
  ...READ_DESCRIPTOR,
  effects: ["local_write", "network_read"],
  idempotency: "non_idempotent",
};

function errorResult(code: string, message: string) {
  return {
    ok: false as const,
    error: { code, message, recoverable: true },
  };
}

function argumentError(error: unknown) {
  return errorResult(
    "RESEARCH_ARGUMENTS_INVALID",
    error instanceof Error ? error.message : "Research arguments are invalid.",
  );
}

function toHostContext(
  context: BuiltinToolContext,
): BuiltinResearchHostContext {
  return {
    sessionId: context.sessionId,
    ...(context.userMessageId ? { userMessageId: context.userMessageId } : {}),
    ...(context.modelMessageId
      ? { modelMessageId: context.modelMessageId }
      : {}),
    ...(context.agentRunId ? { agentRunId: context.agentRunId } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  };
}

async function getResearchTask(taskId: string): Promise<ResearchTask | null> {
  const storeTask = useResearchStore.getState().tasksById[taskId];
  return storeTask || getResearchTaskRepository().get(taskId);
}

async function resolveStatusTask(
  taskId: string | undefined,
  sessionId: string,
): Promise<ResearchTask | null> {
  if (taskId) return getResearchTask(taskId);

  const store = useResearchStore.getState();
  if (store.activeTaskId) {
    const active = await getResearchTask(store.activeTaskId);
    if (active?.sessionId === sessionId) return active;
  }

  const sessionTask = Object.values(store.tasksById)
    .filter((task) => task.sessionId === sessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (sessionTask) return sessionTask;
  return (await getResearchTaskRepository().list(sessionId))[0] || null;
}

function getActivePlan(task: ResearchTask) {
  return (
    task.planVersions.find((plan) => plan.version === task.activePlanVersion) ||
    task.planVersions.at(-1)
  );
}

function getActiveReport(task: ResearchTask) {
  return (
    task.reportVersions.find(
      (report) => report.version === task.activeReportVersion,
    ) || task.reportVersions.at(-1)
  );
}

function getActiveReportRun(task: ResearchTask) {
  return (
    task.reportRuns.find((run) => run.id === task.activeReportRunId) ||
    task.reportRuns.at(-1)
  );
}

function getCurrentWave(task: ResearchTask) {
  const run = getActiveReportRun(task);
  if (!run) return undefined;
  return (
    run.waves.find((wave) => wave.status === "running") ||
    run.waves.find((wave) => wave.status === "paused") ||
    run.waves.at(-1)
  );
}

function toTaskStatus(task: ResearchTask) {
  const plan = getActivePlan(task);
  const report = getActiveReport(task);
  const run = getActiveReportRun(task);
  const wave = getCurrentWave(task);
  const currentDepth =
    wave?.depth ??
    (run
      ? run.nodes.reduce((depth, node) => Math.max(depth, node.depth), 0)
      : undefined);
  const queryLimit = run?.strategy.maxQueries ?? plan?.strategy.maxQueries;
  const usedQueries = run?.executedQueries.length ?? 0;
  return {
    taskId: task.id,
    sessionId: task.sessionId,
    query: task.goal,
    status: task.status,
    approvalRequired: task.status === "plan_ready",
    budgetPreset: task.budgetPreset,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    usage: { ...task.usage },
    ...(run ? { phase: run.phase, researchRunId: run.id } : {}),
    ...(wave
      ? {
          wave: {
            id: wave.id,
            index: wave.index,
            depth: wave.depth,
            breadth: wave.breadth,
            status: wave.status,
          },
        }
      : {}),
    ...(currentDepth !== undefined ? { depth: currentDepth } : {}),
    frontier: {
      nodeIds: [...(run?.frontierNodeIds ?? [])],
      count: run?.frontierNodeIds.length ?? 0,
    },
    ...(queryLimit !== undefined
      ? {
          queryUsage: {
            used: usedQueries,
            limit: queryLimit,
            remaining: Math.max(0, queryLimit - usedQueries),
            reservedForVerification: getResearchVerificationQueryReserve({
              maxQueries: queryLimit,
            }),
          },
        }
      : {}),
    ...(run ? { coverage: { ...run.coverage } } : {}),
    ...(plan
      ? {
          planningUsage: {
            ...plan.recon.usage,
            queryLimit: plan.recon.queryLimit,
            resultsPerQuery: plan.recon.resultsPerQuery,
            sourceFeasibility: plan.recon.sourceFeasibility,
          },
        }
      : {}),
    ...(run?.stopReason ? { stopReason: { ...run.stopReason } } : {}),
    ...(plan
      ? {
          plan: {
            version: plan.version,
            title: plan.title,
            summary: plan.summary,
            questions: plan.steps.flatMap((step) => step.questions),
            objective: plan.objective,
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
          },
        }
      : {}),
    ...(report
      ? {
          report: {
            version: report.version,
            researchRunId: report.researchRunId,
            createdAt: report.createdAt,
            summary: report.summary,
          },
        }
      : {}),
    ...(task.error ? { error: { ...task.error } } : {}),
  };
}

function toTaskListItem(task: ResearchTask) {
  return {
    taskId: task.id,
    sessionId: task.sessionId,
    query: task.goal,
    status: task.status,
    approvalRequired: task.status === "plan_ready",
    budgetPreset: task.budgetPreset,
    planVersion: getActivePlan(task)?.version,
    reportVersion: getActiveReport(task)?.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.error ? { error: { ...task.error } } : {}),
  };
}

export function createDeepResearchBindings(): BuiltinToolBinding[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "start_deep_research",
          description:
            "Create a local Deep Research task and prepare a plan for explicit user approval. Planning may perform bounded public search-summary reconnaissance, but it does not fetch source bodies or start approved research. After calling it, stop source work and direct the user to review the plan.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: {
                type: "string",
                minLength: 1,
                maxLength: DEEP_RESEARCH_QUERY_MAX_CHARS,
              },
              budgetPreset: {
                type: "string",
                enum: ["quick", "standard", "deep"],
              },
            },
            required: ["query", "budgetPreset"],
          },
        },
      },
      risk: "read",
      descriptor: WRITE_DESCRIPTOR,
      displayKey: "startDeepResearch",
      executionGroup: "interaction",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        let input;
        try {
          input = parseStartDeepResearchArgs(args);
        } catch (error) {
          return argumentError(error);
        }
        if (!context.sessionId.trim()) {
          return errorResult(
            "RESEARCH_SESSION_UNAVAILABLE",
            "Deep Research requires a host chat session.",
          );
        }
        if (!context.emit.research?.start) {
          return errorResult(
            "DEEP_RESEARCH_UNAVAILABLE",
            "Deep Research is unavailable for this request.",
          );
        }

        const result = await context.emit.research.start(
          input,
          toHostContext(context),
        );
        context.signal?.throwIfAborted();
        return { taskId: result.taskId, status: result.status };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "get_research_status",
          description:
            "Read the current status, active plan, progress, and latest report summary for a local Deep Research task. Omit taskId to inspect the active or latest task for this chat.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              taskId: {
                type: "string",
                minLength: 1,
                maxLength: RESEARCH_TASK_ID_MAX_CHARS,
              },
            },
          },
        },
      },
      risk: "read",
      descriptor: READ_DESCRIPTOR,
      displayKey: "getResearchStatus",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        let input;
        try {
          input = parseGetResearchStatusArgs(args);
        } catch (error) {
          return argumentError(error);
        }
        const task = await resolveStatusTask(input.taskId, context.sessionId);
        context.signal?.throwIfAborted();
        return task
          ? toTaskStatus(task)
          : errorResult(
              "RESEARCH_TASK_NOT_FOUND",
              "No matching Deep Research task was found.",
            );
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "list_research_tasks",
          description:
            "List recent local Deep Research tasks, optionally restricted to one chat session.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              sessionId: {
                type: "string",
                minLength: 1,
                maxLength: RESEARCH_SESSION_ID_MAX_CHARS,
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: RESEARCH_TASK_LIST_MAX_ITEMS,
                default: 20,
              },
            },
          },
        },
      },
      risk: "read",
      descriptor: READ_DESCRIPTOR,
      displayKey: "listResearchTasks",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        let input;
        try {
          input = parseListResearchTasksArgs(args);
        } catch (error) {
          return argumentError(error);
        }
        const tasks = await getResearchTaskRepository().list(input.sessionId);
        context.signal?.throwIfAborted();
        return {
          tasks: tasks.slice(0, input.limit).map(toTaskListItem),
          total: tasks.length,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "read_research_report",
          description:
            "Read one immutable local Deep Research report Artifact. Omit version to read the active or latest report.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              taskId: {
                type: "string",
                minLength: 1,
                maxLength: RESEARCH_TASK_ID_MAX_CHARS,
              },
              version: {
                type: "integer",
                minimum: 1,
                maximum: RESEARCH_REPORT_MAX_VERSIONS,
              },
            },
            required: ["taskId"],
          },
        },
      },
      risk: "read",
      descriptor: READ_DESCRIPTOR,
      displayKey: "readResearchReport",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        let input;
        try {
          input = parseReadResearchReportArgs(args);
        } catch (error) {
          return argumentError(error);
        }
        const task = await getResearchTask(input.taskId);
        if (!task) {
          return errorResult(
            "RESEARCH_TASK_NOT_FOUND",
            "The Deep Research task was not found.",
          );
        }
        const report = input.version
          ? task.reportVersions.find(
              (candidate) => candidate.version === input.version,
            )
          : getActiveReport(task);
        if (!report) {
          return errorResult(
            "RESEARCH_REPORT_NOT_FOUND",
            "The requested Deep Research report was not found.",
          );
        }
        const artifact = await readResearchReportArtifact(report.artifactId);
        context.signal?.throwIfAborted();
        if (!artifact) {
          return errorResult(
            "RESEARCH_REPORT_ARTIFACT_UNAVAILABLE",
            "The local Deep Research report Artifact is unavailable.",
          );
        }
        return {
          taskId: task.id,
          status: task.status,
          report: {
            version: report.version,
            planVersion: report.planVersion,
            createdAt: report.createdAt,
            kind: report.kind,
            researchRunId: report.researchRunId,
            summary: report.summary,
            keyFindings: [...report.keyFindings],
            gaps: [...report.gaps],
            ...(report.coveredStepIds
              ? { coveredStepIds: [...report.coveredStepIds] }
              : {}),
            markdown: artifact.markdown,
            artifactId: artifact.artifactId,
            bytes: artifact.bytes,
            mimeType: artifact.mimeType,
          },
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "list_research_evidence",
          description:
            "List the stored evidence index for a local Deep Research task. questionIndex is zero-based and returns only evidence explicitly linked to that plan question.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              taskId: {
                type: "string",
                minLength: 1,
                maxLength: RESEARCH_TASK_ID_MAX_CHARS,
              },
              questionIndex: {
                type: "integer",
                minimum: 0,
                maximum: RESEARCH_QUESTION_MAX_INDEX,
              },
              stance: {
                type: "string",
                enum: ["supports", "contradicts", "context"],
              },
            },
            required: ["taskId"],
          },
        },
      },
      risk: "read",
      descriptor: READ_DESCRIPTOR,
      displayKey: "listResearchEvidence",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        let input;
        try {
          input = parseListResearchEvidenceArgs(args);
        } catch (error) {
          return argumentError(error);
        }
        const task = await getResearchTask(input.taskId);
        context.signal?.throwIfAborted();
        if (!task) {
          return errorResult(
            "RESEARCH_TASK_NOT_FOUND",
            "The Deep Research task was not found.",
          );
        }
        const runById = new Map(
          task.reportRuns.map((run) => [run.id, run] as const),
        );
        const claimsById = new Map<
          string,
          Array<{
            researchRunId: string;
            planVersion: number;
            claim: (typeof task.reportRuns)[number]["claims"][number];
          }>
        >();
        for (const run of task.reportRuns) {
          for (const claim of run.claims) {
            const entries = claimsById.get(claim.id) || [];
            entries.push({
              researchRunId: run.id,
              planVersion: run.planVersion,
              claim,
            });
            claimsById.set(claim.id, entries);
          }
        }
        const evidence = filterResearchEvidence(task.evidence, input).map(
          (item) => {
            const relations = (item.relations || []).map((relation) => ({
              ...relation,
              claimIds: [...relation.claimIds],
            }));
            const claimVerification: ResearchEvidenceClaimVerification[] =
              relations.length > 0
                ? relations.flatMap<ResearchEvidenceClaimVerification>(
                    (relation) => {
                      const run = runById.get(relation.researchRunId);
                      if (!run) return [];
                      const claims = new Map(
                        run.claims.map((claim) => [claim.id, claim] as const),
                      );
                      return relation.claimIds.map((claimId) => {
                        const claim = claims.get(claimId);
                        return {
                          researchRunId: relation.researchRunId,
                          planVersion: run.planVersion,
                          stepId: relation.stepId,
                          nodeId: relation.nodeId,
                          stance: relation.stance,
                          claimId,
                          verificationStatus: claim?.verificationStatus ?? null,
                          importance: claim?.importance ?? null,
                          independentPublisherCount:
                            claim?.independentPublisherCount ?? null,
                        };
                      });
                    },
                  )
                : item.claimIds.flatMap<ResearchEvidenceClaimVerification>(
                    (claimId) => {
                      const entries = claimsById.get(claimId) || [];
                      if (entries.length === 0) {
                        return [
                          {
                            claimId,
                            verificationStatus: null,
                            importance: null,
                            independentPublisherCount: null,
                          },
                        ];
                      }
                      return entries.map((entry) => ({
                        researchRunId: entry.researchRunId,
                        planVersion: entry.planVersion,
                        claimId,
                        verificationStatus: entry.claim.verificationStatus,
                        importance: entry.claim.importance,
                        independentPublisherCount:
                          entry.claim.independentPublisherCount,
                      }));
                    },
                  );
            return {
              ...item,
              claimIds: [...item.claimIds],
              relations,
              questionIndexes: getResearchEvidenceQuestionIndexes(item),
              claimVerification,
            };
          },
        );
        return {
          taskId: task.id,
          ...(input.questionIndex !== undefined
            ? { questionIndex: input.questionIndex }
            : {}),
          ...(input.stance ? { stance: input.stance } : {}),
          evidence,
          total: evidence.length,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "adjust_research_plan",
          description:
            "Prepare a new version of a Deep Research plan from a natural-language instruction. Planning may perform bounded public search-summary reconnaissance, but approved research remains blocked until the user explicitly approves the new plan.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              taskId: {
                type: "string",
                minLength: 1,
                maxLength: RESEARCH_TASK_ID_MAX_CHARS,
              },
              instruction: {
                type: "string",
                minLength: 1,
                maxLength: DEEP_RESEARCH_INSTRUCTION_MAX_CHARS,
              },
            },
            required: ["taskId", "instruction"],
          },
        },
      },
      risk: "read",
      descriptor: WRITE_DESCRIPTOR,
      displayKey: "adjustResearchPlan",
      executionGroup: "interaction",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        let input;
        try {
          input = parseAdjustResearchPlanArgs(args);
        } catch (error) {
          return argumentError(error);
        }
        const before = await getResearchTask(input.taskId);
        if (!before) {
          return errorResult(
            "RESEARCH_TASK_NOT_FOUND",
            "The Deep Research task was not found.",
          );
        }
        if (!context.emit.research?.adjustPlan) {
          return errorResult(
            "DEEP_RESEARCH_UNAVAILABLE",
            "Deep Research plan adjustment is unavailable for this request.",
          );
        }

        await context.emit.research.adjustPlan(input, toHostContext(context));
        context.signal?.throwIfAborted();
        const task = await getResearchTask(input.taskId);
        const previousVersion = getActivePlan(before)?.version || 0;
        const planVersion = task ? getActivePlan(task)?.version : undefined;
        if (
          !task ||
          task.status !== "plan_ready" ||
          !planVersion ||
          planVersion <= previousVersion
        ) {
          return errorResult(
            "RESEARCH_PLAN_ADJUSTMENT_FAILED",
            "Deep Research did not produce a new plan version for approval.",
          );
        }
        return {
          taskId: task.id,
          status: task.status,
          planVersion,
          approvalRequired: true,
        };
      },
    },
  ];
}
