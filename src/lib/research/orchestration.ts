import type {
  ClaimRecord,
  LearningPacket,
  ResearchBudgetPreset,
  ResearchClaimVerificationStatus,
  ResearchCoverage,
  ResearchEvidence,
  ResearchFollowUp,
  ResearchNode,
  ResearchPlanStepV2,
  ResearchPriority,
  ResearchPlanVersion,
  ResearchReportKind,
  ResearchReportRun,
  ResearchSourceType,
  ResolvedResearchBudget,
  ResearchStopReason,
  ResearchStrategy,
} from "./types";

export const RESEARCH_STRATEGY_LIMITS = {
  initialBreadth: { min: 1, max: 8 },
  maxDepth: { min: 1, max: 4 },
  maxQueries: { min: 2, max: 48 },
  resultsPerQuery: { min: 3, max: 10 },
} as const;

export const RESEARCH_RECON_LIMITS = {
  maxQueries: 2,
  resultsPerQuery: 5,
  timeoutMs: 30_000,
} as const;

export const RESEARCH_EXPLORATION_TOOL_CALL_RATIO = 0.8;
export const RESEARCH_SYNTHESIS_MODEL_ROUND_RESERVE = 2;

export const RESEARCH_STRATEGY_PRESETS: Readonly<
  Record<ResearchBudgetPreset, ResearchStrategy>
> = {
  quick: {
    initialBreadth: 2,
    maxDepth: 1,
    maxQueries: 6,
    resultsPerQuery: 5,
  },
  standard: {
    initialBreadth: 4,
    maxDepth: 2,
    maxQueries: 16,
    resultsPerQuery: 5,
  },
  deep: {
    initialBreadth: 6,
    maxDepth: 3,
    maxQueries: 32,
    resultsPerQuery: 5,
  },
};

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value!)));
}

export function resolveResearchStrategy(
  preset: ResearchBudgetPreset,
  overrides: Partial<ResearchStrategy> = {},
): ResearchStrategy {
  const defaults = RESEARCH_STRATEGY_PRESETS[preset];
  return {
    initialBreadth: clampInteger(
      overrides.initialBreadth,
      defaults.initialBreadth,
      RESEARCH_STRATEGY_LIMITS.initialBreadth.min,
      RESEARCH_STRATEGY_LIMITS.initialBreadth.max,
    ),
    maxDepth: clampInteger(
      overrides.maxDepth,
      defaults.maxDepth,
      RESEARCH_STRATEGY_LIMITS.maxDepth.min,
      RESEARCH_STRATEGY_LIMITS.maxDepth.max,
    ),
    maxQueries: clampInteger(
      overrides.maxQueries,
      defaults.maxQueries,
      RESEARCH_STRATEGY_LIMITS.maxQueries.min,
      RESEARCH_STRATEGY_LIMITS.maxQueries.max,
    ),
    resultsPerQuery: clampInteger(
      overrides.resultsPerQuery,
      defaults.resultsPerQuery,
      RESEARCH_STRATEGY_LIMITS.resultsPerQuery.min,
      RESEARCH_STRATEGY_LIMITS.resultsPerQuery.max,
    ),
  };
}

export function getResearchVerificationQueryReserve(
  strategy: Pick<ResearchStrategy, "maxQueries">,
): number {
  return Math.min(
    strategy.maxQueries,
    Math.max(2, Math.ceil(strategy.maxQueries * 0.15)),
  );
}

export function getResearchExplorationQueryLimit(
  strategy: Pick<ResearchStrategy, "maxQueries">,
): number {
  return Math.max(
    0,
    strategy.maxQueries - getResearchVerificationQueryReserve(strategy),
  );
}

export function getResearchVerificationQueryAllowance(
  strategy: Pick<ResearchStrategy, "maxQueries">,
  usedQueries: number,
): number {
  return Math.max(
    0,
    strategy.maxQueries - Math.max(0, Math.trunc(usedQueries)),
  );
}

export function getResearchSourceBodyLimit(
  strategy: Pick<ResearchStrategy, "maxQueries">,
  remainingExplorationToolCalls: number,
): number {
  return Math.max(
    0,
    Math.min(
      strategy.maxQueries * 2,
      64,
      Math.trunc(Math.max(0, remainingExplorationToolCalls)),
    ),
  );
}

export function getResearchExplorationToolCallLimit(
  budget: Pick<ResolvedResearchBudget, "maxToolCalls">,
): number {
  return Math.max(
    0,
    Math.floor(budget.maxToolCalls * RESEARCH_EXPLORATION_TOOL_CALL_RATIO),
  );
}

export function getResearchReservedModelRounds(
  budget: Pick<ResolvedResearchBudget, "maxToolRounds">,
): number {
  return Math.min(
    Math.max(0, Math.trunc(budget.maxToolRounds)),
    RESEARCH_SYNTHESIS_MODEL_ROUND_RESERVE,
  );
}

export function normalizeResearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function dedupeResearchQueries(
  queries: readonly string[],
  existingQueries: readonly string[] = [],
): string[] {
  const seen = new Set(
    existingQueries.map(normalizeResearchQuery).filter(Boolean),
  );
  const unique: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    const normalized = normalizeResearchQuery(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(trimmed);
  }
  return unique;
}

export function getNextResearchBreadth(currentBreadth: number): number {
  const safeBreadth = Number.isFinite(currentBreadth)
    ? Math.max(1, currentBreadth)
    : 1;
  return Math.max(1, Math.ceil(safeBreadth / 2));
}

export function getResearchBreadthAtDepth(
  initialBreadth: number,
  depth: number,
): number {
  let breadth = Number.isFinite(initialBreadth)
    ? Math.max(1, Math.trunc(initialBreadth))
    : 1;
  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    breadth = getNextResearchBreadth(breadth);
  }
  return breadth;
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return `${prefix}-${randomUuid()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export interface CreateResearchReportRunInput {
  id?: string;
  taskId: string;
  plan: ResearchPlanVersion;
  reportKind?: ResearchReportKind;
  now?: number;
}

export function createResearchReportRun(
  input: CreateResearchReportRunInput,
): ResearchReportRun {
  const now = input.now ?? Date.now();
  const nodes: ResearchNode[] = input.plan.steps.map((step) => ({
    id: createId("research-node"),
    stepId: step.id,
    depth: 1,
    objective: step.objective,
    query: step.queryTopics[0] || step.questions[0] || step.objective,
    status: "pending",
    sourceIds: [],
    evidenceIds: [],
    claimIds: [],
    createdAt: now,
    updatedAt: now,
  }));
  const coverage = calculateResearchCoverage(input.plan.steps, nodes, []);
  return {
    id: input.id ?? createId("research-run"),
    taskId: input.taskId,
    planVersion: input.plan.version,
    reportKind: input.reportKind ?? "initial",
    phase: "queued",
    strategy: { ...input.plan.strategy },
    waves: [],
    nodes,
    learningPackets: [],
    claims: [],
    executedQueries: [],
    frontierNodeIds: nodes.map((node) => node.id),
    coverage,
    usage: {
      queryCount: 0,
      sourceBodyCount: 0,
      toolRounds: 0,
      toolCalls: 0,
      wallTimeMs: 0,
      totalTokens: 0,
    },
    startedAt: now,
    updatedAt: now,
  };
}

export function getResearchFrontier(run: ResearchReportRun): ResearchNode[] {
  const nodesById = new Map(run.nodes.map((node) => [node.id, node]));
  return run.frontierNodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId);
    return node?.status === "pending" ? [node] : [];
  });
}

export interface NextResearchWaveResult {
  run: ResearchReportRun;
  wave: ResearchReportRun["waves"][number];
}

export function createNextResearchWave(
  run: ResearchReportRun,
  now: number = Date.now(),
): NextResearchWaveResult | null {
  const frontier = getResearchFrontier(run);
  if (frontier.length === 0) return null;
  const depth = Math.min(...frontier.map((node) => node.depth));
  if (depth > run.strategy.maxDepth) return null;
  const breadth = getResearchBreadthAtDepth(run.strategy.initialBreadth, depth);
  const selected = frontier
    .filter((node) => node.depth === depth)
    .slice(0, breadth);
  if (selected.length === 0) return null;
  const waveId = createId("research-wave");
  const selectedIds = new Set(selected.map((node) => node.id));
  const wave: ResearchReportRun["waves"][number] = {
    id: waveId,
    index: run.waves.length + 1,
    depth,
    breadth,
    nodeIds: [...selectedIds],
    status: "queued",
    newEvidenceCount: 0,
    newVerifiedClaimCount: 0,
  };
  return {
    wave,
    run: {
      ...run,
      phase: "exploring",
      waves: [...run.waves, wave],
      nodes: run.nodes.map((node) =>
        selectedIds.has(node.id)
          ? { ...node, waveId, status: "queued", updatedAt: now }
          : node,
      ),
      frontierNodeIds: run.frontierNodeIds.filter(
        (nodeId) => !selectedIds.has(nodeId),
      ),
      updatedAt: now,
    },
  };
}

export interface ExpandResearchFrontierResult {
  run: ResearchReportRun;
  addedNodeIds: string[];
  scheduledFollowUpIds: string[];
  duplicateFollowUpIds: string[];
  breadthLimitedFollowUpIds: string[];
  depthLimitedFollowUpIds: string[];
  unavailableSourceFollowUpIds: string[];
}

export interface ExpandResearchFrontierOptions {
  autoExpandScope?: boolean;
  allowedSourceTypes?: readonly ResearchSourceType[];
  recordPacket?: boolean;
}

function findFollowUpDuplicates(
  followUps: readonly ResearchFollowUp[],
  existingQueries: readonly string[],
): { accepted: ResearchFollowUp[]; duplicateIds: string[] } {
  const seen = new Set(
    existingQueries.map(normalizeResearchQuery).filter(Boolean),
  );
  const accepted: ResearchFollowUp[] = [];
  const duplicateIds: string[] = [];
  for (const followUp of followUps) {
    const normalized = normalizeResearchQuery(followUp.question);
    if (!normalized || seen.has(normalized)) {
      duplicateIds.push(followUp.id);
      continue;
    }
    seen.add(normalized);
    accepted.push(followUp);
  }
  return { accepted, duplicateIds };
}

export function expandResearchFrontier(
  run: ResearchReportRun,
  packet: LearningPacket,
  now: number = Date.now(),
  options: ExpandResearchFrontierOptions = {},
): ExpandResearchFrontierResult {
  const parent = run.nodes.find((node) => node.id === packet.nodeId);
  if (!parent) {
    throw new Error(`Research node ${packet.nodeId} does not exist.`);
  }
  const allowedSourceTypes = new Set(options.allowedSourceTypes ?? []);
  const requiresUnavailableSource = (followUp: ResearchFollowUp) =>
    followUp.requiredSourceTypes.some(
      (sourceType) => !allowedSourceTypes.has(sourceType),
    );
  const unavailableSourceFollowUpIds = options.autoExpandScope
    ? packet.followUps
        .filter(
          (followUp) =>
            followUp.scopeImpact !== "within" &&
            requiresUnavailableSource(followUp),
        )
        .map((followUp) => followUp.id)
    : packet.followUps
        .filter((followUp) => followUp.scopeImpact !== "within")
        .map((followUp) => followUp.id);
  const unavailableSourceFollowUpIdSet = new Set(unavailableSourceFollowUpIds);
  const eligibleFollowUps = packet.followUps.filter(
    (followUp) => !unavailableSourceFollowUpIdSet.has(followUp.id),
  );
  const deduped = findFollowUpDuplicates(
    eligibleFollowUps,
    run.nodes.map((node) => node.query),
  );
  const nextDepth = parent.depth + 1;
  const nextBreadth = getResearchBreadthAtDepth(
    run.strategy.initialBreadth,
    nextDepth,
  );
  const priorityRank: Record<ResearchPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const rankedFollowUps = [...deduped.accepted].sort(
    (left, right) => priorityRank[left.priority] - priorityRank[right.priority],
  );
  const accepted =
    nextDepth <= run.strategy.maxDepth
      ? rankedFollowUps.slice(0, nextBreadth)
      : [];
  const breadthLimitedFollowUpIds =
    nextDepth <= run.strategy.maxDepth
      ? rankedFollowUps.slice(nextBreadth).map((followUp) => followUp.id)
      : [];
  const depthLimitedFollowUpIds =
    nextDepth <= run.strategy.maxDepth
      ? []
      : rankedFollowUps.map((followUp) => followUp.id);
  const nodes = accepted.map<ResearchNode>((followUp) => ({
    id: createId("research-node"),
    parentNodeId: parent.id,
    stepId: parent.stepId,
    depth: nextDepth,
    objective: followUp.rationale,
    query: followUp.question.trim(),
    status: "pending",
    sourceIds: [],
    evidenceIds: [],
    claimIds: [],
    createdAt: now,
    updatedAt: now,
  }));
  const updatedNodes = run.nodes.map((node) =>
    node.id === parent.id
      ? {
          ...node,
          status: "completed" as const,
          learningPacketId: packet.id,
          updatedAt: now,
        }
      : node,
  );
  return {
    addedNodeIds: nodes.map((node) => node.id),
    scheduledFollowUpIds: accepted.map((followUp) => followUp.id),
    duplicateFollowUpIds: deduped.duplicateIds,
    breadthLimitedFollowUpIds,
    depthLimitedFollowUpIds,
    unavailableSourceFollowUpIds,
    run: {
      ...run,
      phase:
        !options.autoExpandScope && unavailableSourceFollowUpIds.length > 0
          ? "awaiting_scope_approval"
          : run.phase,
      nodes: [...updatedNodes, ...nodes],
      learningPackets:
        options.recordPacket === false
          ? run.learningPackets
          : [...run.learningPackets, packet],
      frontierNodeIds: [
        ...run.frontierNodeIds.filter((nodeId) => nodeId !== parent.id),
        ...nodes.map((node) => node.id),
      ],
      updatedAt: now,
    },
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export function calculateResearchCoverage(
  steps: readonly ResearchPlanStepV2[],
  nodes: readonly ResearchNode[],
  claims: readonly ClaimRecord[],
): ResearchCoverage {
  const highPrioritySteps = steps.filter((step) => step.priority === "high");
  const requiredSteps =
    highPrioritySteps.length > 0 ? highPrioritySteps : [...steps];
  const majorClaims = claims.filter((claim) => claim.importance === "major");
  const verifiedMajorClaims = majorClaims.filter(
    (claim) => claim.verificationStatus === "verified",
  );
  const unresolvedMajorClaims = majorClaims.filter(
    (claim) => claim.verificationStatus === "unresolved",
  );
  const coveredStepCount = requiredSteps.filter((step) => {
    const hasCompletedNode = nodes.some(
      (node) => node.stepId === step.id && node.status === "completed",
    );
    const hasVerifiedClaim = claims.some(
      (claim) =>
        claim.stepId === step.id &&
        claim.importance === "major" &&
        claim.verificationStatus === "verified",
    );
    return hasCompletedNode && hasVerifiedClaim;
  }).length;
  const stepRatio = ratio(coveredStepCount, requiredSteps.length);
  const claimRatio = ratio(verifiedMajorClaims.length, majorClaims.length);
  const complete =
    requiredSteps.length > 0 &&
    majorClaims.length > 0 &&
    stepRatio === 1 &&
    claimRatio === 1 &&
    unresolvedMajorClaims.length === 0;
  return {
    requiredStepCount: requiredSteps.length,
    coveredStepCount,
    majorClaimCount: majorClaims.length,
    verifiedMajorClaimCount: verifiedMajorClaims.length,
    unresolvedMajorClaimCount: unresolvedMajorClaims.length,
    stepRatio,
    claimRatio,
    overallRatio: Math.min(stepRatio, claimRatio),
    complete,
  };
}

function evidencePublisherIdentity(
  evidence: ResearchEvidence,
  evidenceBySourceId: ReadonlyMap<string, ResearchEvidence>,
  visitedSourceIds: ReadonlySet<string> = new Set(),
): string {
  if (visitedSourceIds.has(evidence.sourceId)) {
    return `mirror-cycle:${Array.from(
      new Set([...visitedSourceIds, evidence.sourceId]),
    )
      .sort()
      .join(",")}`;
  }
  if (evidence.mirrorOfSourceId) {
    const original = evidenceBySourceId.get(evidence.mirrorOfSourceId);
    if (original && original !== evidence) {
      return evidencePublisherIdentity(
        original,
        evidenceBySourceId,
        new Set([...visitedSourceIds, evidence.sourceId]),
      );
    }
    return `mirror:${evidence.mirrorOfSourceId}`;
  }
  if (evidence.publisherId?.trim()) {
    return `publisher:${evidence.publisherId.trim().toLowerCase()}`;
  }
  if (
    evidence.sourceType === "knowledge" ||
    evidence.sourceType === "attachment" ||
    evidence.sourceType === "workspace"
  ) {
    return `local:${evidence.sourceType}`;
  }
  try {
    return `host:${new URL(evidence.locator).hostname.toLowerCase()}`;
  } catch {
    return `source:${evidence.sourceId}`;
  }
}

export interface ResearchClaimVerification {
  status: ResearchClaimVerificationStatus;
  independentPublisherCount: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}

export function evaluateResearchClaimVerification(
  claim: Pick<
    ClaimRecord,
    "importance" | "supportingEvidenceIds" | "contradictingEvidenceIds"
  >,
  evidence: readonly ResearchEvidence[],
): ResearchClaimVerification {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceBySourceId = new Map(
    evidence.map((item) => [item.sourceId, item]),
  );
  const available = (ids: readonly string[]) =>
    Array.from(new Set(ids)).flatMap((id) => {
      const item = evidenceById.get(id);
      return item &&
        item.availability !== "unavailable" &&
        item.freshness !== "stale"
        ? [item]
        : [];
    });
  const supporting = available(claim.supportingEvidenceIds);
  const contradicting = available(claim.contradictingEvidenceIds);
  const uniqueSupporting = [
    ...new Map(
      supporting.map((item) => [item.contentHash, item] as const),
    ).values(),
  ];
  const publishers = new Set(
    uniqueSupporting.map((item) =>
      evidencePublisherIdentity(item, evidenceBySourceId),
    ),
  ).size;
  let status: ResearchClaimVerificationStatus;
  if (contradicting.length > 0) {
    status = "unresolved";
  } else if (supporting.length === 0) {
    status = "unsupported";
  } else if (
    claim.importance === "background" ||
    supporting.some((item) => item.authority === "primary") ||
    publishers >= 2
  ) {
    status = "verified";
  } else {
    status = "pending";
  }
  return {
    status,
    independentPublisherCount: publishers,
    supportingEvidenceIds: supporting.map((item) => item.id),
    contradictingEvidenceIds: contradicting.map((item) => item.id),
  };
}

export function applyResearchSourceAssessments(
  evidence: readonly ResearchEvidence[],
  packets: readonly LearningPacket[],
): ResearchEvidence[] {
  const assessments = new Map(
    packets.flatMap((packet) =>
      packet.sourceAssessments.map(
        (assessment) => [assessment.sourceId, assessment] as const,
      ),
    ),
  );
  return evidence.map((item) => {
    const assessment = assessments.get(item.sourceId);
    if (!assessment) return item;
    let publisherId = assessment.publisherId;
    if (item.sourceType === "web") {
      try {
        publisherId = new URL(item.locator).hostname.toLowerCase();
      } catch {
        // Non-URL web locators keep the bounded assessment fallback.
      }
    }
    return {
      ...item,
      authority: assessment.authority,
      ...(publisherId ? { publisherId } : {}),
      ...(assessment.mirrorOfSourceId
        ? { mirrorOfSourceId: assessment.mirrorOfSourceId }
        : {}),
    };
  });
}

export function createClaimRecordsFromLearningPackets(
  packets: readonly LearningPacket[],
  evidence: readonly ResearchEvidence[],
  now: number = Date.now(),
): ClaimRecord[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceBySourceId = new Map(
    evidence.map((item) => [item.sourceId, item]),
  );
  const candidates = new Map<
    string,
    Omit<ClaimRecord, "verificationStatus" | "independentPublisherCount">
  >();
  for (const packet of packets) {
    for (const learning of packet.learnings) {
      const linkedEvidence = Array.from(
        new Set([
          ...learning.evidenceIds,
          ...learning.sourceIds.flatMap((sourceId) => {
            const item = evidenceBySourceId.get(sourceId);
            return item ? [item.id] : [];
          }),
        ]),
      ).filter((evidenceId) => evidenceById.has(evidenceId));
      const existing = candidates.get(learning.claimId);
      const supportingEvidenceIds = new Set(
        existing?.supportingEvidenceIds || [],
      );
      const contradictingEvidenceIds = new Set(
        existing?.contradictingEvidenceIds || [],
      );
      if (learning.stance === "supports") {
        linkedEvidence.forEach((evidenceId) =>
          supportingEvidenceIds.add(evidenceId),
        );
      } else if (learning.stance === "contradicts") {
        linkedEvidence.forEach((evidenceId) =>
          contradictingEvidenceIds.add(evidenceId),
        );
      }
      candidates.set(learning.claimId, {
        id: learning.claimId,
        text: existing?.text || learning.claimText,
        importance:
          existing?.importance === "major" || learning.importance === "major"
            ? "major"
            : "background",
        stepId: existing?.stepId || learning.stepId,
        nodeIds: Array.from(
          new Set([...(existing?.nodeIds || []), packet.nodeId]),
        ),
        supportingEvidenceIds: [...supportingEvidenceIds],
        contradictingEvidenceIds: [...contradictingEvidenceIds],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }
  return [...candidates.values()].map((candidate) => {
    const verification = evaluateResearchClaimVerification(candidate, evidence);
    return {
      ...candidate,
      supportingEvidenceIds: verification.supportingEvidenceIds,
      contradictingEvidenceIds: verification.contradictingEvidenceIds,
      verificationStatus: verification.status,
      independentPublisherCount: verification.independentPublisherCount,
    };
  });
}

export interface ResearchStopEvaluation {
  now?: number;
  coverage: ResearchCoverage;
  frontierCount: number;
  currentDepth: number;
  queryCount: number;
  sourceBodyCount: number;
  sourceBodyLimit: number;
  remainingToolCalls: number;
  wavesWithoutNewSources: number;
  wavesWithoutNewVerifiedClaims: number;
  pendingScopeApproval?: boolean;
  dependencyAvailable?: boolean;
  userAction?: "pause" | "cancel";
}

export function getResearchStopReason(
  strategy: ResearchStrategy,
  evaluation: ResearchStopEvaluation,
): ResearchStopReason | undefined {
  const at = evaluation.now ?? Date.now();
  const reason = (code: ResearchStopReason["code"]): ResearchStopReason => ({
    code,
    at,
  });
  if (evaluation.userAction === "cancel") return reason("user_cancelled");
  if (evaluation.userAction === "pause") return reason("user_paused");
  if (evaluation.pendingScopeApproval) {
    return reason("scope_approval_required");
  }
  if (evaluation.dependencyAvailable === false) {
    return reason("dependency_unavailable");
  }
  if (evaluation.coverage.complete) return reason("coverage_satisfied");
  if (evaluation.remainingToolCalls <= 0) return reason("budget_exhausted");
  if (evaluation.queryCount >= strategy.maxQueries) {
    return reason("max_queries");
  }
  if (
    evaluation.sourceBodyLimit >= 0 &&
    evaluation.sourceBodyCount >= evaluation.sourceBodyLimit
  ) {
    return reason("max_sources");
  }
  if (
    evaluation.wavesWithoutNewSources >= 2 &&
    evaluation.wavesWithoutNewVerifiedClaims >= 2
  ) {
    return reason("no_new_sources");
  }
  if (evaluation.wavesWithoutNewVerifiedClaims >= 2) {
    return reason("no_new_verified_claims");
  }
  if (
    evaluation.frontierCount === 0 &&
    evaluation.currentDepth >= strategy.maxDepth
  ) {
    return reason("max_depth");
  }
  if (evaluation.frontierCount === 0) return reason("frontier_exhausted");
  return undefined;
}

export function applyResearchRunUserStop(
  run: ResearchReportRun,
  action: "pause" | "cancel",
  now: number = Date.now(),
): ResearchReportRun {
  const cancelled = action === "cancel";
  const stopReason: ResearchStopReason = {
    code: cancelled ? "user_cancelled" : "user_paused",
    at: now,
  };
  const activeNodeStatuses = new Set<ResearchNode["status"]>([
    "queued",
    "searching",
    "reading",
    "learning",
  ]);
  return {
    ...run,
    phase: cancelled ? "cancelled" : "paused",
    waves: run.waves.map((wave) =>
      ["queued", "running", "paused"].includes(wave.status)
        ? { ...wave, status: cancelled ? "failed" : "paused" }
        : wave,
    ),
    nodes: run.nodes.map((node) =>
      activeNodeStatuses.has(node.status) ||
      (cancelled && node.status === "pending")
        ? {
            ...node,
            status: cancelled ? "skipped" : node.status,
            stopReason,
            updatedAt: now,
          }
        : node,
    ),
    stopReason,
    updatedAt: now,
    ...(cancelled ? { endedAt: now, checkpoint: undefined } : {}),
  };
}

export function findInvalidResearchWorkspaceSource(
  frozenSources: readonly {
    path: string;
    contentHash: string;
    revision: string;
  }[],
  currentSources: readonly {
    path: string;
    contentHash: string;
    revision: string;
  }[],
): string | undefined {
  const currentByPath = new Map(
    currentSources.map((source) => [source.path, source] as const),
  );
  return frozenSources.find((source) => {
    const current = currentByPath.get(source.path);
    return (
      !current ||
      current.contentHash !== source.contentHash ||
      current.revision !== source.revision
    );
  })?.path;
}
