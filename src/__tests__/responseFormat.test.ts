import { describe, expect, it } from "vitest";
import {
  isStructuredOutputCapabilityError,
  normalizeStructuredOutputCapabilityError,
  STRUCTURED_OUTPUT_CAPABILITY_ERROR_CODE,
} from "../lib/chat/responseFormat";
import { toPublicErrorPayload } from "../lib/errors";
import { createChatStreamEventError } from "../services/api/chat/streamErrors";

describe("structured output capability errors", () => {
  it.each([
    Object.assign(new Error("Unknown parameter: response_format.json_schema"), {
      status: 400,
    }),
    {
      response: { status: 422 },
      error: {
        message: "output_config.format is not supported by this model",
      },
    },
    {
      statusCode: 400,
      message:
        "Invalid value at generation_config.responseJsonSchema: schema must have a root object",
    },
  ])("recognizes explicit 400/422 schema capability failures", (error) => {
    expect(isStructuredOutputCapabilityError(error)).toBe(true);
  });

  it.each([
    { status: 401, message: "response_format is not authorized" },
    { status: 403, message: "response_format permission denied" },
    { status: 429, message: "response_format rate limit exceeded" },
    { status: 500, message: "response_format is unsupported" },
    { status: 400, message: "Invalid API key for response_format request" },
    { status: 422, message: "Invalid temperature" },
    new TypeError("fetch failed for response_format"),
  ])("does not swallow non-capability failures", (error) => {
    expect(isStructuredOutputCapabilityError(error)).toBe(false);
  });

  it("preserves an explicit capability status across the server stream", () => {
    const normalized = normalizeStructuredOutputCapabilityError({
      status: 422,
      message: "Structured outputs are not supported for this model",
    });
    const payload = toPublicErrorPayload(normalized);
    const streamed = createChatStreamEventError({
      ...payload,
    });

    expect(payload).toMatchObject({
      code: STRUCTURED_OUTPUT_CAPABILITY_ERROR_CODE,
      statusCode: 422,
    });
    expect(streamed).toMatchObject({
      code: STRUCTURED_OUTPUT_CAPABILITY_ERROR_CODE,
      statusCode: 422,
    });
    expect(isStructuredOutputCapabilityError(streamed)).toBe(true);
  });
});
