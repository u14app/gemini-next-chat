import { resolveResearchStrategy } from "../orchestration";
import type { ResearchScope, ResearchStrategy, ResearchTask } from "../types";

const PLAN_JSON_SHAPE = `{
  "title": "short title",
  "summary": "scope, source strategy, deliverable, and completion criteria",
  "objective": "precise research objective",
  "scope": {
    "audience": "intended reader",
    "includes": ["included topic"],
    "excludes": ["excluded topic"],
    "allowedSourceTypes": ["web"]
  },
  "assumptions": ["explicit assumption"],
  "deliverable": {
    "kind": "research_report|comparison|decision_memo|exact_answer",
    "description": "what will be delivered",
    "requiredSections": ["section"]
  },
  "strategy": {
    "initialBreadth": 4,
    "maxDepth": 2,
    "maxQueries": 16,
    "resultsPerQuery": 5
  },
  "steps": [{
    "id": "step-1",
    "title": "step title",
    "objective": "what this step establishes",
    "questions": ["question"],
    "queryTopics": ["distinct search topic"],
    "sourcePriorities": [{ "sourceType": "web", "priority": "high", "rationale": "why" }],
    "evidenceCriteria": ["evidence threshold"],
    "priority": "high"
  }],
  "completionCriteria": ["observable completion criterion"]
}`;

const PLAN_TIME_RANGE_RULE =
  "`scope.timeRange` is optional. Include it only when the goal states or requires a meaningful time bound, using any non-empty subset of `start`, `end`, or `description`; otherwise omit `scope.timeRange` entirely. Never emit empty strings, null, or placeholder words for time-range fields.";

export function buildResearchPlanPrompt({
  task,
  adjustment,
  reconnaissanceAllowed = false,
  allowedSourceTypes,
  strategy: approvedStrategy,
}: {
  task: ResearchTask;
  adjustment?: string;
  reconnaissanceAllowed?: boolean;
  allowedSourceTypes?: readonly ResearchScope["allowedSourceTypes"][number][];
  strategy?: ResearchStrategy;
}): string {
  const currentPlan = task.planVersions.at(-1);
  const strategy =
    approvedStrategy ?? resolveResearchStrategy(task.budgetPreset);
  return [
    reconnaissanceAllowed
      ? "Prepare a Deep Research v2 plan. You may call web_search at most twice for public search summaries only (maximum five results per query). Do not fetch source bodies and do not treat reconnaissance as report evidence."
      : "Prepare a Deep Research v2 plan. Public reconnaissance is unavailable in this planning call; mark source feasibility as unverified and do not use any tool.",
    "Do not ask the user questions in this call. Where the request is genuinely ambiguous, choose the most useful reading and record it in `assumptions`; the user reviews and confirms the plan afterwards.",
    "Output exactly one JSON object and no prose or Markdown fence. The object must use the shape below:",
    PLAN_JSON_SHAPE,
    PLAN_TIME_RANGE_RULE,
    "Use 3-8 non-overlapping steps with stable unique IDs. Make query topics distinct, state the evidence threshold for each step, and never claim research has begun.",
    `Use this approved strategy exactly: ${JSON.stringify(strategy)}. Do not increase source permissions or budgets.`,
    `Allowed source types for this task: ${(allowedSourceTypes?.length ? allowedSourceTypes : ["web"]).join(", ")}. Include no other types.`,
    `Research goal:\n${task.goal}`,
    currentPlan
      ? `Current plan to revise:\n${JSON.stringify(currentPlan)}`
      : "",
    adjustment ? `Requested adjustment:\n${adjustment}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildResearchPlanRepairPrompt({
  task,
  invalidOutput,
  issues,
  allowedSourceTypes,
  strategy,
}: {
  task: ResearchTask;
  invalidOutput: string;
  issues: readonly string[];
  allowedSourceTypes?: readonly ResearchScope["allowedSourceTypes"][number][];
  strategy?: ResearchStrategy;
}): string {
  return [
    "Repair the invalid Deep Research v2 plan. Do not use tools.",
    "Return exactly one JSON object with no prose or Markdown fence.",
    PLAN_JSON_SHAPE,
    PLAN_TIME_RANGE_RULE,
    `Research goal:\n${task.goal}`,
    strategy ? `Use this strategy exactly: ${JSON.stringify(strategy)}.` : "",
    `Allowed source types: ${(allowedSourceTypes?.length ? allowedSourceTypes : ["web"]).join(", ")}.`,
    `Validation issues:\n${issues.slice(0, 40).join("\n")}`,
    `Invalid output:\n${invalidOutput.slice(0, 30_000)}`,
  ].join("\n\n");
}
