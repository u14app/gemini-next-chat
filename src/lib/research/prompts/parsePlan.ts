import type { ResearchScope, ResearchStrategy } from "../types";
import { formatZodIssues, parseJsonObjects } from "./json";
import { planDraftSchema } from "./schemas";
import type { ParsedResearchPlan, ResearchPlanDraftV2 } from "./types";

export function parseResearchPlan(
  text: string,
  goal?: string,
): ParsedResearchPlan {
  const objects = parseJsonObjects(text);
  const parsedCandidates = objects.map((object) =>
    planDraftSchema.safeParse(object),
  );
  const validCandidate = [...parsedCandidates]
    .reverse()
    .find((candidate) => candidate.success);
  if (validCandidate?.success) {
    return { valid: true, data: validCandidate.data };
  }
  if (objects.length === 0) {
    const goalContext = goal?.trim() ? " for the requested goal" : "";
    return {
      valid: false,
      error: {
        code: "RESEARCH_PLAN_INVALID",
        message: `The model did not return a JSON research plan${goalContext}.`,
        issues: ["root: Expected one JSON object."],
      },
    };
  }
  const parsed = parsedCandidates.at(-1);
  if (parsed && !parsed.success) {
    return {
      valid: false,
      error: {
        code: "RESEARCH_PLAN_INVALID",
        message: "The model returned an invalid v2 research plan.",
        issues: formatZodIssues(parsed.error),
      },
    };
  }
  return {
    valid: false,
    error: {
      code: "RESEARCH_PLAN_INVALID",
      message: "The model returned an invalid v2 research plan.",
      issues: ["root: Expected one valid JSON research plan."],
    },
  };
}

function normalizeQueryTopic(topic: string): string {
  return topic.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Repairs the plan properties the host owns outright, so a model that drifts on
 * them costs a deterministic rewrite instead of a failed research task. The
 * strategy is host-approved and overwritten when the plan version is stored,
 * and source permissions can only ever narrow to what the task actually has.
 */
export function normalizeResearchPlanDraft({
  plan,
  strategy,
  allowedSourceTypes,
}: {
  plan: ResearchPlanDraftV2;
  strategy: ResearchStrategy;
  allowedSourceTypes: readonly ResearchScope["allowedSourceTypes"][number][];
}): ResearchPlanDraftV2 {
  const allowed: readonly ResearchScope["allowedSourceTypes"][number][] =
    allowedSourceTypes.length > 0 ? allowedSourceTypes : ["web"];
  const allowedSet = new Set(allowed);
  const scopedSourceTypes = plan.scope.allowedSourceTypes.filter((sourceType) =>
    allowedSet.has(sourceType),
  );
  const seenTopics = new Set<string>();
  return {
    ...plan,
    strategy,
    scope: {
      ...plan.scope,
      allowedSourceTypes:
        scopedSourceTypes.length > 0 ? scopedSourceTypes : [...allowed],
    },
    steps: plan.steps.map((step) => {
      const sourcePriorities = step.sourcePriorities.filter((source) =>
        allowedSet.has(source.sourceType),
      );
      // Overlapping topics waste the query budget on duplicate searches, but a
      // step must keep at least one topic to remain executable.
      const distinctTopics = step.queryTopics.filter((topic) => {
        const normalized = normalizeQueryTopic(topic);
        if (seenTopics.has(normalized)) return false;
        seenTopics.add(normalized);
        return true;
      });
      return {
        ...step,
        queryTopics:
          distinctTopics.length > 0 ? distinctTopics : [step.queryTopics[0]],
        sourcePriorities:
          sourcePriorities.length > 0
            ? sourcePriorities
            : [{ sourceType: allowed[0], priority: "high" as const }],
      };
    }),
  };
}
