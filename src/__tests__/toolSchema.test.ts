import { describe, expect, it } from "vitest";
import {
  validateToolArguments,
  validateToolOutput,
} from "../lib/agent/toolSchema";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string", minLength: 1 },
    mode: { type: "string", enum: ["create", "overwrite"] },
  },
  required: ["path"],
};

describe("validateToolArguments", () => {
  it("accepts arguments matching the canonical schema", () => {
    expect(
      validateToolArguments(schema, { path: "notes.md", mode: "create" }),
    ).toEqual({ ok: true });
  });

  it("rejects missing, unknown, and invalid values without coercion", () => {
    const result = validateToolArguments(schema, {
      mode: "append",
      unexpected: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TOOL_ARGUMENT_SCHEMA_INVALID");
    expect(result.error.issues.map((issue) => issue.keyword)).toEqual(
      expect.arrayContaining(["required", "additionalProperties", "enum"]),
    );
  });

  it("fails closed when a tool schema cannot be compiled", () => {
    const result = validateToolArguments(
      { type: "definitely-not-a-json-schema-type" },
      {},
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TOOL_SCHEMA_INVALID" },
    });
  });
});

describe("validateToolOutput", () => {
  it("rejects structured output that drifts from the registered schema", () => {
    expect(
      validateToolOutput(
        {
          type: "object",
          additionalProperties: false,
          properties: { count: { type: "integer" } },
          required: ["count"],
        },
        { count: "3" },
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_OUTPUT_SCHEMA_INVALID",
        message: expect.stringContaining("Tool output"),
      },
    });
  });
});
