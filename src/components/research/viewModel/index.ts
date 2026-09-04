import type { ResearchTaskViewModel } from "../types";
import type { AgentRun } from "@/lib/agent";
import {
  getCurrentResearchReportRunIds,
  getResearchExplorationToolCallLimit,
  getResearchSourceBodyLimit,
  type ResearchPlanVersion,
  type ResearchReportRun,
  type ResearchTask,
} from "@/lib/research";

import { buildActivities } from "./activityViews";
import {
  buildEvidenceViews,
  getActivePlan,
  getActiveReport,
  LIVE_PROGRESS_STATUSES,
} from "./evidenceViews";
import { buildClaimViews, loadReports } from "./reports";
import {
  ACTIVE_NODE_STATUSES,
  createRunView,
  getActiveResearchRun,
} from "./runView";
import { DEFAULT_TEXT, type ResearchViewModelText } from "./text";

export type { ResearchViewModelText };

function getCompletedStepIndexes({
  task,
  plan,
  report,
  run,
}: {
  task: ResearchTask;
  plan: ResearchPlanVersion | undefined;
  report: ReturnType<typeof getActiveReport>;
  run: ResearchReportRun | undefined;
}): Set<number> {
  const completed = new Set<number>();
  if (!plan) return completed;
  const coveredStepIds = new Set(
    report?.planVersion === plan.version ? (report.coveredStepIds ?? []) : [],
  );
  const nodesByStepId = new Map<string, ResearchReportRun["nodes"]>();
  for (const node of run?.nodes ?? []) {
    const stepNodes = nodesByStepId.get(node.stepId) ?? [];
    stepNodes.push(node);
    nodesByStepId.set(node.stepId, stepNodes);
  }
  plan.steps.forEach((step, index) => {
    const nodes = nodesByStepId.get(step.id) ?? [];
    if (
      coveredStepIds.has(step.id) ||
      (nodes.length > 0 &&
        nodes.every(
          (node) => node.status === "completed" || node.status === "skipped",
        ))
    ) {
      completed.add(index);
    }
  });
  if (task.status === "completed") {
    plan.steps.forEach((_, index) => completed.add(index));
  }
  return completed;
}

export async function createResearchTaskViewModel(
  task: ResearchTask,
  runsById: Record<string, AgentRun> = {},
  text: ResearchViewModelText = DEFAULT_TEXT,
): Promise<ResearchTaskViewModel> {
  const plan = getActivePlan(task);
  const report = getActiveReport(task);
  const activeResearchRun = getActiveResearchRun(task, plan);
  const reportVersions = await loadReports(task, text);
  const reportRunIds = getCurrentResearchReportRunIds(task);
  const journalRuns = reportRunIds.flatMap((runId) => {
    const run = runsById[runId];
    return run ? [run] : [];
  });
  const evidence = buildEvidenceViews(
    task,
    journalRuns,
    plan,
    activeResearchRun,
  );
  const completedQuestionIndexes = getCompletedStepIndexes({
    task,
    plan,
    report,
    run: activeResearchRun,
  });
  const activeNodeStepId = activeResearchRun?.nodes.find((node) =>
    ACTIVE_NODE_STATUSES.has(node.status),
  )?.stepId;
  const activeNodeStepIndex =
    plan && activeNodeStepId
      ? plan.steps.findIndex((step) => step.id === activeNodeStepId)
      : -1;
  const activeQuestionIndex =
    activeNodeStepIndex >= 0
      ? activeNodeStepIndex
      : plan && LIVE_PROGRESS_STATUSES.has(task.status)
        ? plan.steps.findIndex(
            (_, index) => !completedQuestionIndexes.has(index),
          )
        : -1;
  const evidenceIdsByStepId = new Map<string, string[]>();
  for (const item of evidence) {
    if (!item.stepId) continue;
    const stepEvidenceIds = evidenceIdsByStepId.get(item.stepId) ?? [];
    stepEvidenceIds.push(item.id);
    evidenceIdsByStepId.set(item.stepId, stepEvidenceIds);
  }
  const nodeIdsByStepId = new Map<string, string[]>();
  for (const node of activeResearchRun?.nodes ?? []) {
    const stepNodeIds = nodeIdsByStepId.get(node.stepId) ?? [];
    stepNodeIds.push(node.id);
    nodeIdsByStepId.set(node.stepId, stepNodeIds);
  }
  const runView = createRunView(activeResearchRun, plan, task.endedAt);
  const reportUsage =
    activeResearchRun?.usage ??
    (journalRuns.length > 0
      ? journalRuns.reduce(
          (usage, run) => ({
            toolRounds: usage.toolRounds + run.usage.toolRounds,
            toolCalls: usage.toolCalls + run.usage.toolCalls,
            wallTimeMs: usage.wallTimeMs + run.usage.wallTimeMs,
            totalTokens: usage.totalTokens + run.usage.totalTokens,
          }),
          { toolRounds: 0, toolCalls: 0, wallTimeMs: 0, totalTokens: 0 },
        )
      : task.usage);
  return {
    id: task.id,
    title: plan?.title || task.goal,
    status: task.status,
    budgetPreset: task.budgetPreset,
    ...(runView ? { run: runView } : {}),
    ...(plan
      ? {
          plan: {
            id: plan.id,
            version: plan.version,
            summary: plan.summary,
            objective: plan.objective,
            scope: {
              audience: plan.scope.audience,
              allowedSourceTypes: [...plan.scope.allowedSourceTypes],
              ...(plan.scope.timeRange
                ? {
                    timeRange:
                      plan.scope.timeRange.description ||
                      [plan.scope.timeRange.start, plan.scope.timeRange.end]
                        .filter(Boolean)
                        .join(" - "),
                  }
                : {}),
              includes: [...plan.scope.includes],
              excludes: [...plan.scope.excludes],
              ...(plan.scope.preferredDomains
                ? { preferredDomains: [...plan.scope.preferredDomains] }
                : {}),
              ...(plan.scope.excludedDomains
                ? { excludedDomains: [...plan.scope.excludedDomains] }
                : {}),
            },
            assumptions: [...plan.assumptions],
            deliverable: {
              kind: plan.deliverable.kind,
              description: plan.deliverable.description,
              requiredSections: [...plan.deliverable.requiredSections],
            },
            strategy: {
              initialBreadth: plan.strategy.initialBreadth,
              maxDepth: plan.strategy.maxDepth,
              queryLimit: plan.strategy.maxQueries,
              resultsPerQuery: plan.strategy.resultsPerQuery,
              reservedValidationQueries: Math.max(
                2,
                Math.ceil(plan.strategy.maxQueries * 0.15),
              ),
              sourceContentLimit: getResearchSourceBodyLimit(
                plan.strategy,
                getResearchExplorationToolCallLimit(task.budget),
              ),
            },
            recon: {
              status: plan.recon.status,
              queryCount: plan.recon.usage.queryCount,
              maxQueries: plan.recon.queryLimit,
              resultsPerQuery: plan.recon.resultsPerQuery,
              durationMs: plan.recon.usage.wallTimeMs,
              queries: plan.recon.queries.map((query, index) => ({
                id: `${plan.id}-recon-${index}`,
                query: query.query,
                status: query.status,
                resultCount: query.resultCount,
                domains: [...query.domains],
              })),
              ...(plan.recon.knowledgeQueries?.length
                ? {
                    knowledgeQueries: plan.recon.knowledgeQueries.map(
                      (query, index) => ({
                        id: `${plan.id}-knowledge-recon-${index}`,
                        query: query.query,
                        status: query.status,
                        resultCount: query.resultCount,
                      }),
                    ),
                  }
                : {}),
            },
            completionCriteria: [...plan.completionCriteria],
            steps: plan.steps.map((step, index) => ({
              id: step.id,
              title: step.title,
              objective: step.objective,
              status: completedQuestionIndexes.has(index)
                ? ("completed" as const)
                : activeQuestionIndex === index
                  ? ("in_progress" as const)
                  : ("pending" as const),
              evidenceIds: evidenceIdsByStepId.get(step.id) ?? [],
              queryTopics: [...step.queryTopics],
              sourcePriorities: step.sourcePriorities.map(
                (source) =>
                  `${source.sourceType}:${source.priority}${source.rationale ? ` - ${source.rationale}` : ""}`,
              ),
              evidenceStandard: step.evidenceCriteria.join(" "),
              nodeIds: nodeIdsByStepId.get(step.id) ?? [],
            })),
          },
        }
      : {}),
    summary: report?.summary || task.goal,
    ...(task.error ? { error: { ...task.error } } : {}),
    findings: report?.keyFindings.slice(0, 3),
    gapSummary: report?.gaps.slice(0, 3).join(" "),
    completedQuestions: completedQuestionIndexes.size,
    totalQuestions: plan?.steps.length ?? 0,
    evidence,
    claims: buildClaimViews(activeResearchRun?.claims ?? []),
    activities: buildActivities(task, text, runsById),
    reportVersions,
    activeReportVersionId:
      reportVersions.find(
        (version) => version.version === task.activeReportVersion,
      )?.id || reportVersions.at(-1)?.id,
    ...(task.sourceSnapshot
      ? {
          sourceScope: {
            searchEnabled: task.sourceSnapshot.searchEnabled,
            toolIds: [...task.sourceSnapshot.toolIds],
            knowledgeCount: task.sourceSnapshot.knowledgeCollectionIds.length,
            attachmentCount: task.sourceSnapshot.attachmentIds.length,
            workspaceCount:
              task.sourceSnapshot.workspaceFileIds.length +
              (task.sourceSnapshot.workspaceSources?.length || 0),
            pluginCount: task.sourceSnapshot.pluginIds.length,
          },
        }
      : {}),
    usage: {
      toolRounds: reportUsage.toolRounds,
      maxToolRounds: task.budget.maxToolRounds,
      toolCalls: reportUsage.toolCalls,
      maxToolCalls: task.budget.maxToolCalls,
      elapsedMs: reportUsage.wallTimeMs,
      maxWallTimeMs: task.budget.maxDurationMs,
      totalTokens: reportUsage.totalTokens,
      ...(task.budget.maxTotalTokens
        ? { maxTotalTokens: task.budget.maxTotalTokens }
        : {}),
    },
  };
}
