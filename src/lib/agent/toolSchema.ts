import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type ToolSchemaValidationErrorCode =
  | "TOOL_ARGUMENT_SCHEMA_INVALID"
  | "TOOL_OUTPUT_SCHEMA_INVALID"
  | "TOOL_SCHEMA_INVALID";

export interface ToolSchemaValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export type ToolSchemaValidationResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: ToolSchemaValidationErrorCode;
        message: string;
        issues: ToolSchemaValidationIssue[];
      };
    };

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  validateFormats: false,
});

const validatorCache = new WeakMap<object, ValidateFunction>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatIssue(error: ErrorObject): ToolSchemaValidationIssue {
  return {
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message || "does not match the tool schema",
  };
}

function getValidator(schema: object): ValidateFunction {
  const cached = validatorCache.get(schema);
  if (cached) return cached;

  const validator = ajv.compile(schema);
  validatorCache.set(schema, validator);
  return validator;
}

/**
 * Validates model-produced arguments against the exact schema registered for
 * the tool. Validation never coerces values, applies defaults, or removes
 * unknown properties, so the model and executor see the same payload.
 */
export function validateToolArguments(
  schema: unknown,
  args: unknown,
): ToolSchemaValidationResult {
  if (!isRecord(schema)) {
    return {
      ok: false,
      error: {
        code: "TOOL_SCHEMA_INVALID",
        message: "The tool does not declare a valid argument schema.",
        issues: [],
      },
    };
  }

  let validator: ValidateFunction;
  try {
    validator = getValidator(schema);
  } catch {
    return {
      ok: false,
      error: {
        code: "TOOL_SCHEMA_INVALID",
        message: "The tool argument schema could not be compiled safely.",
        issues: [],
      },
    };
  }

  if (validator(args)) return { ok: true };

  const issues = (validator.errors || []).slice(0, 12).map(formatIssue);
  const first = issues[0];
  return {
    ok: false,
    error: {
      code: "TOOL_ARGUMENT_SCHEMA_INVALID",
      message: first
        ? `Tool arguments ${first.path} ${first.message}.`
        : "Tool arguments do not match the registered schema.",
      issues,
    },
  };
}

/** Validates structured Tool output without coercion before model ingestion. */
export function validateToolOutput(
  schema: unknown,
  value: unknown,
): ToolSchemaValidationResult {
  const result = validateToolArguments(schema, value);
  if (result.ok || result.error.code === "TOOL_SCHEMA_INVALID") return result;
  return {
    ok: false,
    error: {
      ...result.error,
      code: "TOOL_OUTPUT_SCHEMA_INVALID",
      message: result.error.message.replace(/^Tool arguments/, "Tool output"),
    },
  };
}
