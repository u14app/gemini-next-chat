import { z } from "zod";

import {
  prioritySchema,
  reconSchema,
  sourceTypeSchema,
  strategySchema,
} from "./primitives";

export const planSchema = z
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

export const sourceSnapshotSchema = z
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
