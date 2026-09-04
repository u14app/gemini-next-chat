import type {
  ResearchPlanVersion,
  ResearchReportRun,
  ResearchStopReason,
  ResearchTaskError,
} from "@/lib/research/types";

import { MAX_ERROR_CHARS } from "./constants";

export function redactText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|token|password|secret)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, MAX_ERROR_CHARS);
}

export function sanitizeError(
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

export function sanitizeLocator(value: string): string {
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

export function clonePlan(plan: ResearchPlanVersion): ResearchPlanVersion {
  return {
    ...plan,
    scope: {
      ...plan.scope,
      ...(plan.scope.timeRange
        ? { timeRange: { ...plan.scope.timeRange } }
        : {}),
      includes: [...plan.scope.includes],
      excludes: [...plan.scope.excludes],
      ...(plan.scope.preferredDomains
        ? { preferredDomains: [...plan.scope.preferredDomains] }
        : {}),
      ...(plan.scope.excludedDomains
        ? { excludedDomains: [...plan.scope.excludedDomains] }
        : {}),
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
      ...(plan.recon.knowledgeQueries
        ? {
            knowledgeQueries: plan.recon.knowledgeQueries.map((query) => ({
              ...query,
              ...(query.error ? { error: redactText(query.error) } : {}),
            })),
          }
        : {}),
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

export function cloneReportRun(run: ResearchReportRun): ResearchReportRun {
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
