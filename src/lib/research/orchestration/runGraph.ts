import type {
  LearningPacket,
  ResearchFollowUp,
  ResearchNode,
  ResearchPlanVersion,
  ResearchPriority,
  ResearchReportKind,
  ResearchReportRun,
  ResearchSourceType,
} from "../types";
import { calculateResearchCoverage } from "./coverage";
import { getResearchBreadthAtDepth, normalizeResearchQuery } from "./strategy";

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
