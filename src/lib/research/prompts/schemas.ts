import { z } from "zod";

import { RESEARCH_STRATEGY_LIMITS } from "../orchestration";
import {
  RESEARCH_WAVE_SOURCE_KEY_PATTERN,
  RESEARCH_WAVE_SOURCE_LIMIT,
} from "./waveAliases";

const sourceTypeSchema = z.enum([
  "web",
  "knowledge",
  "attachment",
  "workspace",
  "plugin",
  "mcp",
]);
const prioritySchema = z.enum(["high", "medium", "low"]);
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedTextList = (maxItems: number, maxChars: number) =>
  z.array(boundedText(maxChars)).max(maxItems);
const optionalBoundedText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    boundedText(max).optional(),
  );
const optionalIsoDate = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z
    .string()
    .trim()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
    .optional(),
);

// These plan schemas deliberately allow unknown keys: a stray field from the
// model is stripped instead of failing the whole plan. Host-owned values
// (strategy, source scope) are coerced by the runtime before validation.
const timeRangeSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const candidate = value as Record<string, unknown>;
    const hasMeaningfulValue = ["start", "end", "description"].some((field) => {
      const fieldValue = candidate[field];
      return (
        fieldValue !== undefined &&
        (typeof fieldValue !== "string" || fieldValue.trim().length > 0)
      );
    });
    return hasMeaningfulValue ? value : undefined;
  },
  z
    .object({
      start: optionalIsoDate,
      end: optionalIsoDate,
      description: optionalBoundedText(500),
    })
    .optional(),
);

const scopeSchema = z.object({
  audience: boundedText(500),
  timeRange: timeRangeSchema,
  includes: boundedTextList(20, 1_000),
  excludes: boundedTextList(20, 1_000),
  preferredDomains: boundedTextList(8, 253).optional(),
  excludedDomains: boundedTextList(8, 253).optional(),
  allowedSourceTypes: z.array(sourceTypeSchema).min(1).max(6),
});

const deliverableSchema = z.object({
  kind: z.enum([
    "research_report",
    "comparison",
    "decision_memo",
    "exact_answer",
  ]),
  description: boundedText(2_000),
  requiredSections: boundedTextList(12, 500).min(1),
});

const strategySchema = z.object({
  initialBreadth: z
    .number()
    .int()
    .min(RESEARCH_STRATEGY_LIMITS.initialBreadth.min)
    .max(RESEARCH_STRATEGY_LIMITS.initialBreadth.max),
  maxDepth: z
    .number()
    .int()
    .min(RESEARCH_STRATEGY_LIMITS.maxDepth.min)
    .max(RESEARCH_STRATEGY_LIMITS.maxDepth.max),
  maxQueries: z
    .number()
    .int()
    .min(RESEARCH_STRATEGY_LIMITS.maxQueries.min)
    .max(RESEARCH_STRATEGY_LIMITS.maxQueries.max),
  resultsPerQuery: z
    .number()
    .int()
    .min(RESEARCH_STRATEGY_LIMITS.resultsPerQuery.min)
    .max(RESEARCH_STRATEGY_LIMITS.resultsPerQuery.max),
});

const stableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const committedReferenceSchema = boundedText(240);

const planStepSchema = z.object({
  id: stableIdSchema,
  title: boundedText(500),
  objective: boundedText(2_000),
  questions: boundedTextList(8, 2_000).min(1),
  queryTopics: boundedTextList(8, 1_000).min(1),
  sourcePriorities: z
    .array(
      z.object({
        sourceType: sourceTypeSchema,
        priority: prioritySchema,
        rationale: boundedText(1_000).optional(),
      }),
    )
    .min(1)
    .max(6),
  evidenceCriteria: boundedTextList(8, 1_000).min(1),
  priority: prioritySchema,
});

export const planDraftSchema = z
  .object({
    title: boundedText(500),
    summary: boundedText(8_000),
    objective: boundedText(4_000),
    scope: scopeSchema,
    assumptions: boundedTextList(20, 1_000),
    deliverable: deliverableSchema,
    strategy: strategySchema,
    steps: z.array(planStepSchema).min(2).max(8),
    completionCriteria: boundedTextList(12, 1_000).min(1),
  })
  .superRefine((plan, context) => {
    const start = plan.scope.timeRange?.start;
    const end = plan.scope.timeRange?.end;
    if (start && end && start > end) {
      context.addIssue({
        code: "custom",
        path: ["scope", "timeRange", "end"],
        message: "The time range end must not precede its start.",
      });
    }
    // Duplicate step IDs break evidence attribution, so they stay fatal.
    // Overlapping query topics and out-of-scope source types are repaired
    // deterministically by the runtime instead of failing the plan.
    const stepIds = new Set<string>();
    for (const [index, step] of plan.steps.entries()) {
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "Step IDs must be unique.",
        });
      }
      stepIds.add(step.id);
    }
  });

export const wavePacketSchema = z
  .object({
    nodeKey: z
      .string()
      .trim()
      .regex(/^N[1-8]$/),
    learnings: z
      .array(
        z
          .object({
            claim: boundedText(4_000),
            importance: z.enum(["major", "background"]),
            stance: z.enum(["supports", "contradicts", "context"]),
            finding: boundedText(4_000),
            sourceKeys: z
              .array(z.string().trim().regex(RESEARCH_WAVE_SOURCE_KEY_PATTERN))
              .min(1)
              .max(20),
          })
          .strict(),
      )
      .max(40),
    sourceAssessments: z
      .array(
        z
          .object({
            sourceKey: z
              .string()
              .trim()
              .regex(RESEARCH_WAVE_SOURCE_KEY_PATTERN),
            authority: z.enum(["primary", "secondary", "unknown"]),
            publisherId: committedReferenceSchema.nullish(),
            mirrorOfSourceKey: z
              .string()
              .trim()
              .regex(RESEARCH_WAVE_SOURCE_KEY_PATTERN)
              .nullish(),
            rationale: boundedText(1_000),
          })
          .strict(),
      )
      .max(RESEARCH_WAVE_SOURCE_LIMIT),
    followUps: z
      .array(
        z
          .object({
            question: boundedText(2_000),
            rationale: boundedText(2_000),
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
      .max(12),
  })
  .strict();

export const waveEnvelopeSchema = z
  .object({
    // Keep parsing bounded but tolerate extra packets so one stray alias does
    // not hide the valid packets for this wave.
    packets: z.array(z.unknown()).min(1).max(16),
  })
  .strict();
