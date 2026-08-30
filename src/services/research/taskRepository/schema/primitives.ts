import { z } from "zod";

import { MAX_ERROR_CHARS } from "../constants";

export const statusSchema = z.enum([
  "draft",
  "clarifying",
  "plan_ready",
  "researching",
  "verifying",
  "synthesizing",
  "paused",
  "completed",
  "partial_completed",
  "failed",
  "cancelled",
]);

export const budgetSchema = z
  .object({
    maxToolRounds: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
    maxDurationMs: z.number().int().positive(),
    maxTotalTokens: z.number().int().positive().optional(),
  })
  .strict();

export const usageSchema = z
  .object({
    toolRounds: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export const sourceTypeSchema = z.enum([
  "web",
  "knowledge",
  "attachment",
  "workspace",
  "plugin",
  "mcp",
]);

export const prioritySchema = z.enum(["high", "medium", "low"]);

export const strategySchema = z
  .object({
    initialBreadth: z.number().int().min(1).max(8),
    maxDepth: z.number().int().min(1).max(4),
    maxQueries: z.number().int().min(2).max(48),
    resultsPerQuery: z.number().int().min(3).max(10),
  })
  .strict();

export const reconSchema = z
  .object({
    status: z.enum(["completed", "partial", "unavailable"]),
    sourceFeasibility: z.enum(["verified", "unverified"]),
    startedAt: z.number().finite().nonnegative(),
    completedAt: z.number().finite().nonnegative(),
    timeoutMs: z.number().int().positive().max(30_000),
    queryLimit: z.number().int().min(1).max(2),
    resultsPerQuery: z.number().int().min(1).max(5),
    usage: z
      .object({
        queryCount: z.number().int().nonnegative().max(2),
        resultCount: z.number().int().nonnegative().max(10),
        wallTimeMs: z.number().int().nonnegative(),
      })
      .strict(),
    queries: z
      .array(
        z
          .object({
            query: z.string().min(1).max(8_000),
            status: z.enum(["completed", "failed", "timed_out"]),
            resultCount: z.number().int().nonnegative().max(5),
            domains: z.array(z.string().min(1).max(255)).max(5),
            error: z.string().min(1).max(MAX_ERROR_CHARS).optional(),
          })
          .strict(),
      )
      .max(2),
    providerId: z.string().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((recon, context) => {
    if (
      recon.completedAt < recon.startedAt ||
      recon.queries.length > recon.queryLimit ||
      recon.usage.queryCount > recon.queryLimit
    ) {
      context.addIssue({
        code: "custom",
        message: "Research reconnaissance metadata is inconsistent.",
      });
    }
  });
