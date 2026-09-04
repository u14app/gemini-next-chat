import { z } from "zod";

import { prioritySchema, sourceTypeSchema, strategySchema } from "./primitives";

export const evidenceSchema = z
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

export const stopReasonSchema = z
  .object({
    code: z.enum([
      "coverage_satisfied",
      "coverage_sufficient",
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

export const claimSchema = z
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

export const learningPacketSchema = z
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

export const runCheckpointSchema = z
  .object({
    createdAt: z.number().finite().nonnegative(),
    waveIndex: z.number().int().nonnegative(),
    frontierNodeIds: z.array(z.string().min(1).max(240)).max(2_000),
    committedEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
    committedToolExecutionIds: z.array(z.string().min(1).max(240)).max(2_000),
  })
  .strict();

export const scopeExpansionEventSchema = z
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

export const reportRunSchema = z
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
