import { z } from "zod";

import { parseJsonObjects } from "./json";
import { parseResearchPlan } from "./parsePlan";
import type { ResearchPlanDraftV2 } from "./types";

const contextRequestSchema = z
  .object({
    kind: z.literal("needs_context"),
    reason: z.string().trim().min(1).max(2_000),
    queries: z.array(z.string().trim().min(1).max(1_000)).min(1).max(2),
  })
  .strict();

export type ResearchPlanningContextRequest = z.infer<
  typeof contextRequestSchema
>;

export type ResearchPlanningResponse =
  { kind: "plan"; plan: ResearchPlanDraftV2 } | ResearchPlanningContextRequest;

/** Only a validated context request may open the next source surface. */
export function parseResearchPlanningResponse(
  content: string,
): ResearchPlanningResponse | null {
  for (const object of parseJsonObjects(content).reverse()) {
    const request = contextRequestSchema.safeParse(object);
    if (request.success) {
      return {
        ...request.data,
        queries: [...new Set(request.data.queries)],
      };
    }
    const candidate = object as Record<string, unknown>;
    if (candidate.kind === "needs_context") continue;
    if (
      candidate.kind === "plan" &&
      (!candidate.plan ||
        typeof candidate.plan !== "object" ||
        Array.isArray(candidate.plan))
    )
      continue;
    const plan = parseResearchPlan(
      JSON.stringify(candidate.kind === "plan" ? candidate.plan : object),
    );
    if (plan.valid) return { kind: "plan", plan: plan.data };
  }
  return null;
}
