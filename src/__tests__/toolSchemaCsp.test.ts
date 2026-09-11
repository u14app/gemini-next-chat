import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLongTextOutputBinding } from "@/services/api/chat/builtinTools/longText";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Function", function () {
    throw new EvalError("Refused to evaluate a string as JavaScript");
  });
});

afterEach(() => vi.unstubAllGlobals());

it("validates the registered long-text tool when CSP blocks code generation", async () => {
  const { validateToolArguments } = await import("@/lib/agent/toolSchema");
  const binding = createLongTextOutputBinding();
  const args = { format: "markdown", title: "v2.5.0 版本更新总结" };
  expect(
    validateToolArguments(binding.definition.function.parameters, args),
  ).toEqual({ ok: true });
  const longText = vi.fn(() => ({ ok: true as const }));
  await expect(
    binding.execute(args, {
      sessionId: "schema-csp-test",
      model: "test-model",
      emit: { longText },
    }),
  ).resolves.toEqual({ ok: true, capture: "next_model_text" });
  expect(longText).toHaveBeenCalledWith(args);
});

it("still rejects invalid long-text parameters under CSP without changing inputs", async () => {
  const { validateToolArguments } = await import("@/lib/agent/toolSchema");
  const schema = createLongTextOutputBinding().definition.function.parameters;
  const originalSchema = structuredClone(schema);
  for (const args of [
    {},
    { title: "" },
    { title: "x".repeat(181) },
    { title: 42 },
    { title: "Report", format: "html" },
    { title: "Report", extra: true },
  ]) {
    const originalArgs = structuredClone(args);
    expect(validateToolArguments(schema, args)).toMatchObject({
      ok: false,
      error: { code: "TOOL_ARGUMENT_SCHEMA_INVALID" },
    });
    expect(args).toEqual(originalArgs);
  }
  const args = { title: "Report" };
  expect(validateToolArguments(schema, args)).toEqual({ ok: true });
  expect(args).toEqual({ title: "Report" });
  expect(schema).toEqual(originalSchema);
});

it("validates plugin arguments and structured output with nested references", async () => {
  const { validateToolArguments, validateToolOutput } =
    await import("@/lib/agent/toolSchema");
  const schema = {
    type: "object",
    properties: {
      records: { type: "array", items: { $ref: "#/$defs/record" } },
    },
    required: ["records"],
    additionalProperties: false,
    $defs: {
      record: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1 } },
        required: ["count"],
        additionalProperties: false,
      },
    },
  };
  const original = structuredClone(schema);
  expect(validateToolArguments(schema, { records: [{ count: 1 }] })).toEqual({
    ok: true,
  });
  const result = validateToolOutput(schema, { records: [{ count: "1" }] });
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "TOOL_OUTPUT_SCHEMA_INVALID",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "/records/0/count", keyword: "type" }),
      ]),
    },
  });
  expect(schema).toEqual(original);
});

it("keeps formats as annotations and preserves literal format keys", async () => {
  const { validateToolArguments } = await import("@/lib/agent/toolSchema");
  const schema = {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      literal: { const: { format: "email" } },
      choice: { enum: [{ format: "markdown" }] },
    },
    required: ["email", "literal", "choice"],
  };
  expect(
    validateToolArguments(schema, {
      email: "not-an-email",
      literal: { format: "email" },
      choice: { format: "markdown" },
    }),
  ).toEqual({ ok: true });
  expect(
    validateToolArguments(schema, {
      email: "not-an-email",
      literal: {},
      choice: {},
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "TOOL_ARGUMENT_SCHEMA_INVALID" },
  });
});

it.each([
  { type: "invalid-type" },
  { type: "string", pattern: "[" },
  { type: "object", required: "name" },
  { $defs: { value: { required: "name" } }, $ref: "#/$defs/value" },
  { $defs: { value: { type: "invalid-type" } }, $ref: "#/$defs/value" },
  { type: "object", properties: { unused: { $ref: "#/missing" } } },
  { $ref: "https://unavailable.example/schema" },
  { $schema: "https://unavailable.example/meta-schema" },
  {
    $ref: "#/$defs/strict",
    __absolute_ref__: "https://unavailable.example/schema",
    $defs: { strict: { type: "string" } },
  },
])("fails closed for malformed or unresolved schemas: %j", async (schema) => {
  const { validateToolArguments } = await import("@/lib/agent/toolSchema");
  expect(validateToolArguments(schema, {})).toMatchObject({
    ok: false,
    error: { code: "TOOL_SCHEMA_INVALID" },
  });
});

it("enforces $ref sibling constraints instead of silently dropping them", async () => {
  const { validateToolArguments } = await import("@/lib/agent/toolSchema");
  const schema = {
    definitions: { value: { type: "string" } },
    $ref: "#/definitions/value",
    minLength: 3,
  };
  expect(validateToolArguments(schema, "report")).toEqual({ ok: true });
  expect(validateToolArguments(schema, "x")).toMatchObject({
    ok: false,
    error: { code: "TOOL_ARGUMENT_SCHEMA_INVALID" },
  });
});

it("retains nullable type semantics without widening enum constraints", async () => {
  const { validateToolArguments } = await import("@/lib/agent/toolSchema");
  const schema = { type: "string", nullable: true };
  expect(validateToolArguments(schema, null)).toEqual({ ok: true });
  expect(validateToolArguments(schema, "text")).toEqual({ ok: true });
  expect(validateToolArguments(schema, 42)).toMatchObject({
    ok: false,
    error: { code: "TOOL_ARGUMENT_SCHEMA_INVALID" },
  });
  expect(
    validateToolArguments({ ...schema, enum: ["text"] }, null),
  ).toMatchObject({
    ok: false,
    error: { code: "TOOL_ARGUMENT_SCHEMA_INVALID" },
  });
});
