import type {
  ResearchActivityView,
  ResearchEvidenceView,
  ResearchReportVersionView,
  ResearchTaskViewModel,
} from "@/components/research";
import type { AgentRun } from "@/lib/agent";
import {
  getCurrentResearchReportRunIds,
  getResearchExplorationToolCallLimit,
  getResearchSourceBodyLimit,
  type ClaimRecord,
  type ResearchEvidence,
  type ResearchPlanVersion,
  type ResearchReportRun,
  type ResearchSourceType,
  type ResearchStopReason,
  type ResearchTask,
} from "@/lib/research";
import { resolveOPFSBlob } from "@/utils/opfs";

export interface ResearchViewModelText {
  artifactUnavailable: string;
  fallbackReportTitle: (version: number) => string;
  continueChangeSummary: string;
  updateChangeSummary: string;
  taskCreatedTitle: string;
  taskCreatedDetail: string;
  planPreparedTitle: (version: number) => string;
  planAdjustedDetail: string;
  planApprovalDetail: string;
  reportPublishedTitle: (version: number) => string;
  toolRunningTitle: (tool: string) => string;
  toolCommittedTitle: (tool: string) => string;
  toolFailedTitle: (tool: string) => string;
  toolSourceDetail: (source: string) => string;
  internalToolResultSource: string;
  toolSafeDetail: string;
  degradedWaveTitle: (wave: number) => string;
  degradedWaveDetail: (count: number) => string;
  scopeExpansionTitle: string;
  scopeExpansionDetail: (scheduled: number) => string;
  scopeExpansionLimitedDetail: (count: number) => string;
  reportKind: Record<"initial" | "continue" | "update", string>;
  statusTitle: (status: ResearchTask["status"]) => string;
}

const DEFAULT_TEXT: ResearchViewModelText = {
  artifactUnavailable: "The local report artifact is unavailable.",
  fallbackReportTitle: (version) => `Research report v${version}`,
  continueChangeSummary:
    "This version continues the previous investigation with an approved follow-up plan.",
  updateChangeSummary:
    "This version refreshes mutable sources and records the latest available state.",
  taskCreatedTitle: "Research task created",
  taskCreatedDetail:
    "Before approval, only bounded public search summaries may be used for planning reconnaissance; source bodies cannot become report evidence.",
  planPreparedTitle: (version) => `Plan v${version} prepared`,
  planAdjustedDetail: "Prepared from a natural-language adjustment.",
  planApprovalDetail: "Prepared for explicit approval.",
  reportPublishedTitle: (version) => `Report v${version} published`,
  toolRunningTitle: (tool) => `Using ${tool}`,
  toolCommittedTitle: (tool) => `Completed ${tool}`,
  toolFailedTitle: (tool) => `${tool} did not complete`,
  toolSourceDetail: (source) => `Read-only source: ${source}`,
  internalToolResultSource: "Internal tool result",
  toolSafeDetail: "Read-only operation; raw arguments and results are hidden.",
  degradedWaveTitle: (wave) => `Wave ${wave} archived with evidence gaps`,
  degradedWaveDetail: (count) =>
    `${count} research nodes produced no valid learning packet. Preserved evidence remains available and the report will continue with explicit gaps.`,
  scopeExpansionTitle: "Research scope expanded automatically",
  scopeExpansionDetail: (scheduled) =>
    `${scheduled} additional research directions will continue from committed evidence in this run.`,
  scopeExpansionLimitedDetail: (count) =>
    `${count} directions require sources that are unavailable in this conversation and will remain explicit report gaps.`,
  reportKind: {
    initial: "Initial report",
    continue: "Continued research",
    update: "Latest-source update",
  },
  statusTitle: (status) => `Research status: ${status}`,
};

function getActivePlan(task: ResearchTask) {
  return task.planVersions.find(
    (plan) => plan.version === task.activePlanVersion,
  );
}

function getActiveReport(task: ResearchTask) {
  return (
    task.reportVersions.find(
      (report) => report.version === task.activeReportVersion,
    ) || task.reportVersions.at(-1)
  );
}

const LIVE_PROGRESS_STATUSES = new Set<ResearchTask["status"]>([
  "researching",
  "verifying",
  "synthesizing",
]);

function getSourceDomain(locator: string): string | undefined {
  try {
    const url = new URL(locator);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return;
  }
}

function inferLiveEvidenceSourceType(
  retrievalKind: AgentRun["evidence"][number]["retrievalKind"],
): ResearchSourceType {
  if (retrievalKind === "attachment") return "attachment";
  if (retrievalKind === "mcp") return "mcp";
  return "web";
}

function getEvidenceVerificationStatus(
  evidence: Pick<ResearchEvidence, "claimIds">,
  claimsById: ReadonlyMap<string, ClaimRecord>,
): ResearchEvidenceView["verificationStatus"] {
  const statuses = evidence.claimIds.flatMap((claimId) => {
    const claim = claimsById.get(claimId);
    return claim ? [claim.verificationStatus] : [];
  });
  if (statuses.includes("unresolved")) return "unresolved";
  if (statuses.includes("unsupported")) return "unsupported";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("verified")) return "verified";
  return;
}

function getLinkedEvidenceClaims(
  claimIds: readonly string[],
  claimsById: ReadonlyMap<string, ClaimRecord>,
): ResearchEvidenceView["linkedClaims"] {
  const seen = new Set<string>();
  return claimIds.flatMap((claimId) => {
    const claim = claimsById.get(claimId);
    if (!claim || seen.has(claim.id)) return [];
    seen.add(claim.id);
    return [
      {
        id: claim.id,
        text: claim.text,
        importance: claim.importance,
        verificationStatus: claim.verificationStatus,
      },
    ];
  });
}

function buildEvidenceViews(
  task: ResearchTask,
  journalRuns: AgentRun[],
  plan: ResearchPlanVersion | undefined,
  activeRun: ResearchReportRun | undefined,
): ResearchEvidenceView[] {
  const stepIndexById = new Map(
    (plan?.steps ?? []).map((step, index) => [step.id, index] as const),
  );
  const claimsById = new Map(
    (activeRun?.claims ?? []).map((claim) => [claim.id, claim] as const),
  );

  const viewsByIdentity = new Map<string, ResearchEvidenceView>();
  const evidenceOrder: string[] = [];
  const addEvidence = (identity: string, evidence: ResearchEvidenceView) => {
    const current = viewsByIdentity.get(identity);
    if (!current) {
      viewsByIdentity.set(identity, evidence);
      evidenceOrder.push(identity);
      return;
    }
    const questionIndexes = Array.from(
      new Set([
        ...(current.questionIndexes ?? []),
        ...(evidence.questionIndexes ?? []),
      ]),
    ).sort((left, right) => left - right);
    const linkedClaims = new Map(
      [...current.linkedClaims, ...evidence.linkedClaims].map((claim) => [
        claim.id,
        claim,
      ]),
    );
    viewsByIdentity.set(identity, {
      ...current,
      claimIds: Array.from(
        new Set([...(current.claimIds ?? []), ...(evidence.claimIds ?? [])]),
      ),
      linkedClaims: [...linkedClaims.values()],
      ...(questionIndexes.length ? { questionIndexes } : {}),
    });
  };

  for (const item of task.evidence) {
    const activeRelations = activeRun
      ? (item.relations || []).filter(
          (relation) => relation.researchRunId === activeRun.id,
        )
      : [];
    const activeRelation = activeRelations.at(-1);
    const stepId = activeRelation?.stepId || item.stepId;
    const nodeId = activeRelation?.nodeId || item.nodeId;
    const stance = activeRelation?.stance || item.stance;
    const claimIds =
      activeRun && item.relations
        ? Array.from(
            new Set(activeRelations.flatMap((relation) => relation.claimIds)),
          )
        : item.claimIds;
    const explicitStepIndex = stepIndexById.get(stepId);
    const questionIndexes =
      explicitStepIndex === undefined ? [] : [explicitStepIndex];
    const domain = getSourceDomain(item.locator);
    const verificationStatus = getEvidenceVerificationStatus(
      { ...item, claimIds },
      claimsById,
    );
    addEvidence(
      `${item.sourceId}\u0000${item.locator}\u0000${item.contentHash}`,
      {
        id: item.id,
        title: item.title || item.sourceId || item.locator,
        sourceType: item.sourceType,
        locator: item.locator,
        ...(item.locator.startsWith("http://") ||
        item.locator.startsWith("https://")
          ? { url: item.locator }
          : {}),
        retrievedAt: item.retrievedAt,
        stance,
        freshness: item.freshness,
        claimIds: [...claimIds],
        linkedClaims: getLinkedEvidenceClaims(claimIds, claimsById),
        stepId,
        nodeId,
        authority: item.authority,
        ...(verificationStatus ? { verificationStatus } : {}),
        ...(questionIndexes.length ? { questionIndexes } : {}),
        ...(domain ? { domain } : {}),
      },
    );
  }

  for (const run of journalRuns) {
    for (const record of run.evidence) {
      if (record.retrievalKind === "search") continue;
      const domain = getSourceDomain(record.url);
      addEvidence(
        `${record.sourceId}\u0000${record.url}\u0000${record.contentHash}`,
        {
          id: `live:${run.id}:${record.toolCallId}:${record.sourceId}`,
          title: record.title || record.sourceId || record.url,
          sourceType: inferLiveEvidenceSourceType(record.retrievalKind),
          locator: record.url,
          ...(record.url.startsWith("http://") ||
          record.url.startsWith("https://")
            ? { url: record.url }
            : {}),
          retrievedAt: record.retrievedAt,
          stance: "context",
          freshness: record.url.startsWith("http") ? "current" : "unknown",
          claimIds: [],
          linkedClaims: [],
          ...(domain ? { domain } : {}),
        },
      );
    }
  }

  return evidenceOrder.map((identity) => viewsByIdentity.get(identity)!);
}

function getMarkdownTitle(markdown: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || fallback;
}

async function loadReports(
  task: ResearchTask,
  text: ResearchViewModelText,
): Promise<ResearchReportVersionView[]> {
  return Promise.all(
    task.reportVersions.map(async (report) => {
      const blob = await resolveOPFSBlob(report.artifactId);
      const markdown = blob
        ? await blob.text()
        : `_${text.artifactUnavailable}_`;
      const changeSummary =
        report.kind === "continue"
          ? text.continueChangeSummary
          : report.kind === "update"
            ? text.updateChangeSummary
            : undefined;
      return {
        id: report.id,
        version: report.version,
        planVersion: report.planVersion,
        researchRunId: report.researchRunId,
        createdAt: report.createdAt,
        title: getMarkdownTitle(
          markdown,
          text.fallbackReportTitle(report.version),
        ),
        markdown,
        ...(changeSummary ? { changeSummary } : {}),
        ...(report.diff
          ? {
              diff: {
                added: report.diff.addedEvidenceIds.length,
                changed: report.diff.changedSourceIds.length,
                unchanged: report.diff.unchangedSourceIds.length,
              },
            }
          : {}),
      };
    }),
  );
}

function buildActivities(
  task: ResearchTask,
  text: ResearchViewModelText,
  runsById: Record<string, AgentRun>,
): ResearchActivityView[] {
  const toolActivities = task.executionRunIds.flatMap((runId) => {
    const run = runsById[runId];
    if (!run) return [];
    return run.toolExecutions.map((execution): ResearchActivityView => {
      const source = run.evidence.find(
        (item) => item.toolCallId === execution.callId,
      );
      const failed =
        execution.status === "failed" || execution.status === "effect_unknown";
      const committed = execution.status === "committed";
      return {
        id: execution.id,
        createdAt:
          execution.endedAt || execution.startedAt || execution.preparedAt,
        phase: "researching",
        title: failed
          ? text.toolFailedTitle(execution.toolName)
          : committed
            ? text.toolCommittedTitle(execution.toolName)
            : text.toolRunningTitle(execution.toolName),
        detail: source
          ? text.toolSourceDetail(
              source.url.startsWith("workspace:///tool-results/")
                ? text.internalToolResultSource
                : source.title || source.sourceId,
            )
          : text.toolSafeDetail,
      };
    });
  });
  const degradedWaveActivities = (task.reportRuns ?? []).flatMap((run) =>
    run.waves.flatMap((wave): ResearchActivityView[] => {
      const degradedNodeIds = wave.degradedNodeIds ?? [];
      if (wave.packetStatus !== "degraded" && degradedNodeIds.length === 0) {
        return [];
      }
      return [
        {
          id: `${wave.id}-degraded-packets`,
          createdAt:
            wave.completedAt ?? wave.startedAt ?? run.endedAt ?? run.startedAt,
          phase: "researching",
          title: text.degradedWaveTitle(wave.index),
          detail: text.degradedWaveDetail(degradedNodeIds.length),
          tone: "warning",
        },
      ];
    }),
  );
  const scopeExpansionActivities = (task.reportRuns ?? []).flatMap((run) =>
    (run.scopeExpansionEvents ?? []).map((event): ResearchActivityView => ({
      id: event.id,
      createdAt: event.at,
      phase: "researching",
      title: text.scopeExpansionTitle,
      detail: [
        event.scheduledFollowUpIds.length > 0
          ? text.scopeExpansionDetail(event.scheduledFollowUpIds.length)
          : null,
        event.unavailableSourceFollowUpIds.length > 0
          ? text.scopeExpansionLimitedDetail(
              event.unavailableSourceFollowUpIds.length,
            )
          : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
      ...(event.unavailableSourceFollowUpIds.length > 0
        ? { tone: "warning" as const }
        : {}),
    })),
  );
  const activities: ResearchActivityView[] = [
    {
      id: `${task.id}-created`,
      createdAt: task.createdAt,
      phase: "draft",
      title: text.taskCreatedTitle,
      detail: text.taskCreatedDetail,
    },
    ...task.planVersions.map((plan) => ({
      id: plan.id,
      createdAt: plan.createdAt,
      phase: "plan_ready" as const,
      title: text.planPreparedTitle(plan.version),
      detail: plan.adjustment
        ? text.planAdjustedDetail
        : text.planApprovalDetail,
    })),
    ...toolActivities,
    ...degradedWaveActivities,
    ...scopeExpansionActivities,
    ...task.reportVersions.map((report) => ({
      id: report.id,
      createdAt: report.createdAt,
      phase: task.status,
      title: text.reportPublishedTitle(report.version),
      detail: text.reportKind[report.kind],
    })),
  ];
  const latest = activities.at(-1);
  if (
    !latest ||
    latest.phase !== task.status ||
    latest.createdAt !== task.updatedAt
  ) {
    activities.push({
      id: `${task.id}-${task.status}-${task.updatedAt}`,
      createdAt: task.updatedAt,
      phase: task.status,
      title: task.error?.message || text.statusTitle(task.status),
    });
  }
  return activities.sort((left, right) => left.createdAt - right.createdAt);
}

function getActiveResearchRun(
  task: ResearchTask,
  plan: ResearchPlanVersion | undefined,
): ResearchReportRun | undefined {
  const runs = task.reportRuns ?? [];
  return (
    runs.find((run) => run.id === task.activeReportRunId) ??
    [...runs]
      .reverse()
      .find((run) => !plan || run.planVersion === plan.version) ??
    runs.at(-1)
  );
}

function toStopReasonView(reason: ResearchStopReason | undefined) {
  if (!reason) return;
  return {
    code: reason.code,
    ...(reason.detail ? { detail: reason.detail } : {}),
  };
}

const ACTIVE_NODE_STATUSES = new Set<string>([
  "searching",
  "reading",
  "learning",
]);

function toRunItemStatus(
  status:
    | ResearchReportRun["nodes"][number]["status"]
    | ResearchReportRun["waves"][number]["status"],
): NonNullable<ResearchTaskViewModel["run"]>["nodes"][number]["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "blocked" || status === "paused") return "blocked";
  if (status === "skipped") return "skipped";
  if (
    status === "running" ||
    status === "searching" ||
    status === "reading" ||
    status === "learning"
  ) {
    return "in_progress";
  }
  return "pending";
}

function createRunView(
  run: ResearchReportRun | undefined,
  plan: ResearchPlanVersion | undefined,
): ResearchTaskViewModel["run"] {
  if (!run) return;
  const packetByNodeId = new Map(
    run.learningPackets.map((packet) => [packet.nodeId, packet] as const),
  );
  const claimById = new Map(
    run.claims.map((claim) => [claim.id, claim] as const),
  );
  const waveIdByNodeId = new Map<string, string>();
  for (const wave of run.waves) {
    wave.nodeIds.forEach((nodeId) => waveIdByNodeId.set(nodeId, wave.id));
  }
  const nodes = run.nodes.map((node) => {
    const packet = packetByNodeId.get(node.id);
    const claims = node.claimIds.flatMap((claimId) => {
      const claim = claimById.get(claimId);
      return claim ? [claim] : [];
    });
    const scopeImpact = packet?.followUps.some(
      (followUp) => followUp.scopeImpact === "scope_expansion",
    )
      ? ("scope_expansion" as const)
      : packet?.followUps.some(
            (followUp) => followUp.scopeImpact === "source_expansion",
          )
        ? ("source_expansion" as const)
        : packet?.followUps.length
          ? ("within" as const)
          : undefined;
    return {
      id: node.id,
      ...(node.parentNodeId ? { parentId: node.parentNodeId } : {}),
      waveId: node.waveId ?? waveIdByNodeId.get(node.id) ?? "unassigned",
      stepId: node.stepId,
      depth: node.depth,
      objective: node.objective,
      ...(node.query ? { query: node.query } : {}),
      status: toRunItemStatus(node.status),
      evidenceIds: [...node.evidenceIds],
      claimIds: [...node.claimIds],
      verifiedClaimCount: claims.filter(
        (claim) => claim.verificationStatus === "verified",
      ).length,
      conflictingClaimCount: claims.filter(
        (claim) => claim.contradictingEvidenceIds.length > 0,
      ).length,
      learnings: packet?.learnings.map((learning) => learning.statement) ?? [],
      followUps: packet?.followUps.map((followUp) => followUp.question) ?? [],
      ...(node.stopReason
        ? { stopReason: toStopReasonView(node.stopReason) }
        : {}),
      ...(scopeImpact ? { scopeImpact } : {}),
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const sortedWaves = [...run.waves].sort(
    (left, right) => left.index - right.index,
  );
  const waves = sortedWaves.map((wave, index) => {
    return {
      id: wave.id,
      index: index + 1,
      depth: wave.depth,
      status: toRunItemStatus(wave.status),
      nodeIds: [...wave.nodeIds],
      queryCount: wave.nodeIds.filter((nodeId) =>
        Boolean(nodeById.get(nodeId)?.query),
      ).length,
      sourceCount: wave.newEvidenceCount,
      verifiedClaimCount: wave.newVerifiedClaimCount,
      ...(wave.packetStatus ? { packetStatus: wave.packetStatus } : {}),
      ...(wave.degradedNodeIds
        ? { degradedNodeIds: [...wave.degradedNodeIds] }
        : {}),
    };
  });
  const activeWaveIndex = sortedWaves.findIndex(
    (wave) => wave.status === "running",
  );
  const activeDepths = run.nodes
    .filter((node) => ACTIVE_NODE_STATUSES.has(node.status))
    .map((node) => node.depth);
  const currentDepth =
    activeDepths.length > 0
      ? Math.max(...activeDepths)
      : (sortedWaves.at(-1)?.depth ?? 0);
  const verifiedClaims = run.claims.filter(
    (claim) => claim.verificationStatus === "verified",
  ).length;
  const conflictingClaims = run.claims.filter(
    (claim) => claim.contradictingEvidenceIds.length > 0,
  ).length;

  return {
    id: run.id,
    phase: run.phase,
    startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(waves.length
      ? {
          currentWave:
            activeWaveIndex >= 0 ? activeWaveIndex + 1 : waves.length,
        }
      : {}),
    currentDepth,
    maxDepth: run.strategy.maxDepth,
    queryUsage: {
      used: run.usage.queryCount,
      limit: run.strategy.maxQueries,
      reservedForValidation: Math.max(
        2,
        Math.ceil(run.strategy.maxQueries * 0.15),
      ),
      planningUsed: plan?.recon.usage.queryCount ?? 0,
    },
    claimCounts: {
      total: run.claims.length,
      verified: verifiedClaims,
      conflicting: conflictingClaims,
      unresolved: run.claims.filter(
        (claim) => claim.verificationStatus === "unresolved",
      ).length,
    },
    coverage: {
      coveredStepCount: run.coverage.coveredStepCount,
      requiredStepCount: run.coverage.requiredStepCount,
      ratio: run.coverage.stepRatio,
    },
    waves,
    nodes,
    ...(run.stopReason ? { stopReason: toStopReasonView(run.stopReason) } : {}),
  };
}

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
  const runView = createRunView(activeResearchRun, plan);
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
                        .join(" – "),
                  }
                : {}),
              includes: [...plan.scope.includes],
              excludes: [...plan.scope.excludes],
            },
            assumptions: [...plan.assumptions],
            deliverable: {
              kind: plan.deliverable.kind,
              description: plan.deliverable.description,
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
                status:
                  query.status === "completed"
                    ? ("completed" as const)
                    : ("failed" as const),
                resultCount: query.resultCount,
                domains: [...query.domains],
              })),
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
                  `${source.sourceType}:${source.priority}${source.rationale ? ` — ${source.rationale}` : ""}`,
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
