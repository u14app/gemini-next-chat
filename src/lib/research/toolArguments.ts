import type { ResearchBudgetPreset, ResearchEvidence } from "./types";

export const DEEP_RESEARCH_QUERY_MAX_CHARS = 8_000;
export const DEEP_RESEARCH_INSTRUCTION_MAX_CHARS = 8_000;
export const RESEARCH_TASK_ID_MAX_CHARS = 240;
export const RESEARCH_SESSION_ID_MAX_CHARS = 240;
export const RESEARCH_TASK_LIST_MAX_ITEMS = 100;
export const RESEARCH_REPORT_MAX_VERSIONS = 100;
export const RESEARCH_QUESTION_MAX_INDEX = 99;

export const DEEP_RESEARCH_TOOL_NAMES = [
  "start_deep_research",
  "get_research_status",
  "list_research_tasks",
  "read_research_report",
  "list_research_evidence",
  "adjust_research_plan",
] as const;

export type DeepResearchBudgetPreset = ResearchBudgetPreset;

export interface StartDeepResearchArgs {
  query: string;
  budgetPreset: DeepResearchBudgetPreset;
}

export interface GetResearchStatusArgs {
  taskId?: string;
}

export interface ListResearchTasksArgs {
  sessionId?: string;
  limit: number;
}

export interface ReadResearchReportArgs {
  taskId: string;
  version?: number;
}

export interface ListResearchEvidenceArgs {
  taskId: string;
  questionIndex?: number;
  stance?: NonNullable<ResearchEvidence["stance"]>;
}

export interface AdjustResearchPlanArgs {
  taskId: string;
  instruction: string;
}

export interface ConfirmResearchPlanArgs {
  taskId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseObject(
  value: unknown,
  label: string,
  options: { optional?: boolean } = {},
): Record<string, unknown> {
  if (options.optional && value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${label} arguments must be a JSON object.`);
  }
  return value;
}

function assertSupportedFields(
  value: Record<string, unknown>,
  supported: readonly string[],
  label: string,
): void {
  const allowed = new Set(supported);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label} arguments contain unsupported fields.`);
  }
}

function parseRequiredText(
  value: unknown,
  field: string,
  maxChars: number,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > maxChars) throw new Error(`${field} is too long.`);
  return text;
}

function parseOptionalText(
  value: unknown,
  field: string,
  maxChars: number,
): string | undefined {
  if (value === undefined) return undefined;
  return parseRequiredText(value, field, maxChars);
}

export function parseStartDeepResearchArgs(
  value: unknown,
): StartDeepResearchArgs {
  const input = parseObject(value, "Deep Research");
  assertSupportedFields(input, ["query", "budgetPreset"], "Deep Research");

  const query = parseRequiredText(
    input.query,
    "Deep Research query",
    DEEP_RESEARCH_QUERY_MAX_CHARS,
  );
  const budgetPreset = input.budgetPreset;
  if (
    budgetPreset !== "quick" &&
    budgetPreset !== "standard" &&
    budgetPreset !== "deep"
  ) {
    throw new Error("Deep Research budget preset is invalid.");
  }

  return { query, budgetPreset };
}

export function parseGetResearchStatusArgs(
  value: unknown,
): GetResearchStatusArgs {
  const input = parseObject(value, "Research status", { optional: true });
  assertSupportedFields(input, ["taskId"], "Research status");
  const taskId = parseOptionalText(
    input.taskId,
    "Research task ID",
    RESEARCH_TASK_ID_MAX_CHARS,
  );
  return taskId ? { taskId } : {};
}

export function parseListResearchTasksArgs(
  value: unknown,
): ListResearchTasksArgs {
  const input = parseObject(value, "Research task list", { optional: true });
  assertSupportedFields(input, ["sessionId", "limit"], "Research task list");
  const sessionId = parseOptionalText(
    input.sessionId,
    "Research session ID",
    RESEARCH_SESSION_ID_MAX_CHARS,
  );
  const limit = input.limit === undefined ? 20 : input.limit;
  if (
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > RESEARCH_TASK_LIST_MAX_ITEMS
  ) {
    throw new Error(
      `Research task limit must be an integer from 1 to ${RESEARCH_TASK_LIST_MAX_ITEMS}.`,
    );
  }
  return { ...(sessionId ? { sessionId } : {}), limit: Number(limit) };
}

export function parseReadResearchReportArgs(
  value: unknown,
): ReadResearchReportArgs {
  const input = parseObject(value, "Research report");
  assertSupportedFields(input, ["taskId", "version"], "Research report");
  const taskId = parseRequiredText(
    input.taskId,
    "Research task ID",
    RESEARCH_TASK_ID_MAX_CHARS,
  );
  if (
    input.version !== undefined &&
    (!Number.isInteger(input.version) ||
      Number(input.version) < 1 ||
      Number(input.version) > RESEARCH_REPORT_MAX_VERSIONS)
  ) {
    throw new Error(
      `Research report version must be an integer from 1 to ${RESEARCH_REPORT_MAX_VERSIONS}.`,
    );
  }
  return {
    taskId,
    ...(input.version !== undefined ? { version: Number(input.version) } : {}),
  };
}

export function parseListResearchEvidenceArgs(
  value: unknown,
): ListResearchEvidenceArgs {
  const input = parseObject(value, "Research evidence");
  assertSupportedFields(
    input,
    ["taskId", "questionIndex", "stance"],
    "Research evidence",
  );
  const taskId = parseRequiredText(
    input.taskId,
    "Research task ID",
    RESEARCH_TASK_ID_MAX_CHARS,
  );
  if (
    input.questionIndex !== undefined &&
    (!Number.isInteger(input.questionIndex) ||
      Number(input.questionIndex) < 0 ||
      Number(input.questionIndex) > RESEARCH_QUESTION_MAX_INDEX)
  ) {
    throw new Error(
      `Research question index must be an integer from 0 to ${RESEARCH_QUESTION_MAX_INDEX}.`,
    );
  }
  const stance = input.stance;
  if (
    stance !== undefined &&
    stance !== "supports" &&
    stance !== "contradicts" &&
    stance !== "context"
  ) {
    throw new Error("Research evidence stance is invalid.");
  }
  return {
    taskId,
    ...(input.questionIndex !== undefined
      ? { questionIndex: Number(input.questionIndex) }
      : {}),
    ...(stance ? { stance } : {}),
  };
}

export function parseConfirmResearchPlanArgs(
  value: unknown,
): ConfirmResearchPlanArgs {
  const input = parseObject(value, "Research plan confirmation");
  assertSupportedFields(input, ["taskId"], "Research plan confirmation");
  return {
    taskId: parseRequiredText(
      input.taskId,
      "Research task ID",
      RESEARCH_TASK_ID_MAX_CHARS,
    ),
  };
}

export function parseAdjustResearchPlanArgs(
  value: unknown,
): AdjustResearchPlanArgs {
  const input = parseObject(value, "Research plan adjustment");
  assertSupportedFields(
    input,
    ["taskId", "instruction"],
    "Research plan adjustment",
  );
  return {
    taskId: parseRequiredText(
      input.taskId,
      "Research task ID",
      RESEARCH_TASK_ID_MAX_CHARS,
    ),
    instruction: parseRequiredText(
      input.instruction,
      "Research plan adjustment instruction",
      DEEP_RESEARCH_INSTRUCTION_MAX_CHARS,
    ),
  };
}
