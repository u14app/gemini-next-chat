import { describe, expect, it } from "vitest";
import { ProviderRuntimeConfigSchema } from "../lib/api/schemas";

describe("provider runtime schema", () => {
  it("accepts current provider types and normalizes legacy Gemini to Google", () => {
    expect(ProviderRuntimeConfigSchema.parse({ type: "Gemini" }).type).toBe(
      "Google",
    );
    expect(ProviderRuntimeConfigSchema.parse({ type: "Google" }).type).toBe(
      "Google",
    );
    expect(ProviderRuntimeConfigSchema.parse({ type: "Anthropic" }).type).toBe(
      "Anthropic",
    );
    expect(ProviderRuntimeConfigSchema.parse({ type: "OpenAI" }).type).toBe(
      "OpenAI",
    );
    expect(
      ProviderRuntimeConfigSchema.parse({ type: "OpenAI Compatible" }).type,
    ).toBe("OpenAI Compatible");
    expect(ProviderRuntimeConfigSchema.parse({ type: "OrcaRouter" }).type).toBe(
      "OrcaRouter",
    );
  });
});
