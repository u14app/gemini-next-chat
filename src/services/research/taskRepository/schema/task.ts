import { z } from "zod";

import {
  INTERNAL_AGENT_RESEARCH_PROVIDER_ID,
  RESEARCH_TASK_SCHEMA_VERSION,
} from "@/lib/research/types";

import { MAX_ERROR_CHARS, RESEARCH_TASK_STORAGE_VERSION } from "../constants";
import { planSchema, sourceSnapshotSchema } from "./plan";
import {
  budgetSchema,
  statusSchema,
  strategySchema,
  usageSchema,
} from "./primitives";
import { evidenceSchema, reportRunSchema } from "./run";
import { researchImageSourceSchema } from "./images";

export const reportSchema = z
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
    evidenceSnapshotStatus: z.enum(["available", "unavailable"]).optional(),
    imageSources: z.array(researchImageSourceSchema).max(2_000).optional(),
    diff: z
      .object({
        addedEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
        changedSourceIds: z.array(z.string().min(1).max(240)).max(2_000),
        unchangedSourceIds: z.array(z.string().min(1).max(240)).max(2_000),
      })
      .strict()
      .optional(),
    audit: z
      .object({
        blocking: z.array(z.string().min(1).max(4_000)).max(100),
        advisory: z.array(z.string().min(1).max(4_000)).max(100),
        unknownCitationCount: z.number().int().nonnegative().max(2_000),
        unsupportedFindingCount: z.number().int().nonnegative().max(2_000),
        missingSectionCount: z.number().int().nonnegative().max(100),
      })
      .strict()
      .optional(),
    agentRunId: z.string().min(1).max(240).optional(),
    kind: z.enum(["initial", "continue", "update"]),
  })
  .strict();

export const checkpointSchema = z
  .object({
    createdAt: z.number().finite().nonnegative(),
    resumeStatus: statusSchema,
    committedEvidenceIds: z.array(z.string().min(1).max(240)).max(2_000),
    committedToolExecutionIds: z.array(z.string().min(1).max(240)).max(2_000),
    researchRunId: z.string().min(1).max(240).optional(),
    historyPath: z.string().min(1).max(1_024).optional(),
    committedImageSourceIds: z
      .array(z.string().min(1).max(240))
      .max(2_000)
      .optional(),
  })
  .strict();

export const errorSchema = z
  .object({
    code: z.string().max(160).optional(),
    message: z.string().min(1).max(MAX_ERROR_CHARS),
    recoverable: z.boolean().optional(),
  })
  .strict();

export const researchTaskSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_TASK_SCHEMA_VERSION),
    providerId: z.literal(INTERNAL_AGENT_RESEARCH_PROVIDER_ID),
    id: z.string().min(1).max(240),
    sessionId: z.string().min(1).max(240),
    userMessageId: z.string().min(1).max(240).optional(),
    cardMessageId: z.string().min(1).max(240).optional(),
    requestModel: z.string().min(1).max(240).optional(),
    goal: z.string().min(1).max(8_000),
    status: statusSchema,
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    endedAt: z.number().finite().nonnegative().optional(),
    budgetPreset: z.enum(["quick", "standard", "deep"]),
    budget: budgetSchema,
    requestedStrategy: strategySchema.optional(),
    usage: usageSchema,
    imageSources: z.array(researchImageSourceSchema).max(2_000).optional(),
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

export const storedRecordSchema = z
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
