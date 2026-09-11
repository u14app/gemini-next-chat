import {
  dereference,
  Validator,
  type OutputUnit,
  type Schema,
} from "@cfworker/json-schema";
import draft7 from "./schemas/draft7.json";

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

// Retain the previous validator's Draft 7 dialect, including its $defs and
// nullable extensions. The bundled meta-schema is data, not generated code.
const metaSchema = structuredClone(draft7) as Schema;
metaSchema.properties!.$defs = metaSchema.properties!.definitions;
metaSchema.properties!.nullable = { type: "boolean" };
const metaValidator = new Validator(metaSchema, "7", false);
const validatorCache = new WeakMap<object, Validator>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatIssue(error: OutputUnit): ToolSchemaValidationIssue {
  return {
    path: error.instanceLocation.replace(/^#/, "") || "/",
    keyword: error.keyword,
    message: error.error || "does not match the tool schema",
  };
}

function getValidator(schema: Record<string, unknown>): Validator {
  const cached = validatorCache.get(schema);
  if (cached) return cached;

  // Tool schemas arrive at runtime (including MCP and plugins), so build-time
  // code generation cannot cover them. Interpret them without weakening CSP.
  const copy = structuredClone(schema);
  if (
    (copy.$schema !== undefined &&
      copy.$schema !== draft7.$id &&
      copy.$schema !== draft7.$id.replace(/#$/, "")) ||
    !metaValidator.validate(copy).valid
  ) {
    throw new Error("Invalid tool schema");
  }
  const lookup = dereference(copy);
  for (const node of new Set(Object.values(lookup))) {
    if (typeof node === "boolean") continue;
    if (Object.keys(node).some((key) => key.startsWith("__absolute_"))) {
      throw new Error("Reserved tool schema keyword");
    }
    if (node.nullable !== undefined) {
      if (node.type === undefined) throw new Error("nullable requires type");
      const types = Array.isArray(node.type) ? [...node.type] : [node.type];
      if (node.nullable && !types.includes("null")) types.push("null");
      if (!node.nullable && types.includes("null")) {
        throw new Error("nullable conflicts with type");
      }
      node.type = types;
      delete node.nullable;
    }
    // Match the previous validateFormats:false policy. Only visit schema
    // nodes, never literal objects in const, enum, or default values.
    delete node.format;
    if (node.pattern !== undefined) new RegExp(node.pattern, "u");
    for (const pattern of Object.keys(node.patternProperties || {})) {
      new RegExp(pattern, "u");
    }
    if (node.$ref !== undefined) {
      const ref = node.__absolute_ref__ || node.$ref;
      if (lookup[ref] === undefined) {
        throw new Error("Unresolved tool schema reference");
      }
      // The previous validator enforced $ref siblings. Draft 7 interpreters
      // ignore them, so make the conjunction explicit without moving any
      // existing schema nodes (and thus changing their JSON Pointer paths).
      node.allOf = [...(node.allOf || []), { $ref: ref }];
      delete node.$ref;
    }
  }
  const validator = new Validator(copy, "7", false);
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

  let errors: OutputUnit[];
  try {
    const result = getValidator(schema).validate(args);
    if (result.valid) return { ok: true };
    errors = result.errors;
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

  const issues = errors.slice(0, 12).map(formatIssue);
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
