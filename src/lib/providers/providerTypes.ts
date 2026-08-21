import type { ProviderType } from "@/types";

export const OPENAI_PROVIDER_TYPE = "OpenAI" as const;
export const OPENAI_COMPATIBLE_PROVIDER_TYPE = "OpenAI Compatible" as const;
export const ANTHROPIC_PROVIDER_TYPE = "Anthropic" as const;
export const GOOGLE_PROVIDER_TYPE = "Google" as const;
export const LEGACY_GEMINI_PROVIDER_TYPE = "Gemini" as const;
export const ORCAROUTER_PROVIDER_TYPE = "OrcaRouter" as const;

export function isProviderType(value: unknown): value is ProviderType {
  return (
    value === GOOGLE_PROVIDER_TYPE ||
    value === ANTHROPIC_PROVIDER_TYPE ||
    value === OPENAI_PROVIDER_TYPE ||
    value === OPENAI_COMPATIBLE_PROVIDER_TYPE ||
    value === ORCAROUTER_PROVIDER_TYPE
  );
}

export function normalizeProviderTypeValue(
  value: unknown,
): ProviderType | null {
  if (value === LEGACY_GEMINI_PROVIDER_TYPE) return GOOGLE_PROVIDER_TYPE;
  return isProviderType(value) ? value : null;
}

export function normalizeProviderType(
  value: unknown,
  fallback: ProviderType = OPENAI_COMPATIBLE_PROVIDER_TYPE,
): ProviderType {
  return normalizeProviderTypeValue(value) || fallback;
}

export function isOpenAIProviderType(
  value: unknown,
): value is
  | typeof OPENAI_PROVIDER_TYPE
  | typeof OPENAI_COMPATIBLE_PROVIDER_TYPE
  | typeof ORCAROUTER_PROVIDER_TYPE {
  return (
    value === OPENAI_PROVIDER_TYPE ||
    value === OPENAI_COMPATIBLE_PROVIDER_TYPE ||
    value === ORCAROUTER_PROVIDER_TYPE
  );
}

export function isOrcaRouterProviderType(
  value: unknown,
): value is typeof ORCAROUTER_PROVIDER_TYPE {
  return value === ORCAROUTER_PROVIDER_TYPE;
}

export function isAnthropicProviderType(
  value: unknown,
): value is typeof ANTHROPIC_PROVIDER_TYPE {
  return value === ANTHROPIC_PROVIDER_TYPE;
}

export function isGoogleProviderType(
  value: unknown,
): value is typeof GOOGLE_PROVIDER_TYPE {
  return (
    value === GOOGLE_PROVIDER_TYPE || value === LEGACY_GEMINI_PROVIDER_TYPE
  );
}
