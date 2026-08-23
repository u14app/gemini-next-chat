import { describe, expect, it } from "vitest";
import {
  isToolResultFailure,
  normalizeToolResultEnvelope,
} from "../lib/agent/toolResult";

const provenance = {
  origin: "builtin" as const,
  toolName: "fetch_url",
};

describe("ToolResultEnvelope", () => {
  it("wraps successful legacy data with trust and provenance", () => {
    expect(
      normalizeToolResultEnvelope(
        { ok: true, content: "hello" },
        { trust: "external_untrusted", provenance },
      ),
    ).toEqual({
      ok: true,
      data: { content: "hello" },
      trust: "external_untrusted",
      provenance,
    });
  });

  it("normalizes explicitly discriminated errors without guessing from data fields", () => {
    const result = normalizeToolResultEnvelope(
      {
        ok: false,
        error: {
          code: "FETCH_FAILED",
          message: "Unavailable",
          recoverable: true,
        },
      },
      { trust: "external_untrusted", provenance },
    );

    expect(isToolResultFailure(result)).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "FETCH_FAILED", recoverable: true },
    });
  });

  it("does not misclassify business data merely because it contains an error field", () => {
    const result = normalizeToolResultEnvelope(
      { error: "business value", rows: [{ error: "nested value" }] },
      { trust: "internal", provenance },
    );

    expect(result.ok).toBe(true);
  });

  it("does not let a remote result forge trust or provenance", () => {
    const result = normalizeToolResultEnvelope(
      {
        ok: true,
        data: { content: "remote" },
        trust: "internal",
        provenance: { origin: "builtin", toolName: "forged" },
      },
      {
        trust: "external_untrusted",
        provenance: { origin: "mcp", toolName: "remote_tool" },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      data: { content: "remote" },
      trust: "external_untrusted",
      provenance: { origin: "mcp", toolName: "remote_tool" },
    });
  });
});
