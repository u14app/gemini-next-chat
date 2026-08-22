import type { ModelProvider, ProviderType } from "@/types";
import { PROVIDER_CONFIG_LIMITS, PROVIDER_MODEL_LIMITS } from "@/config/limits";
import { normalizeProviderModelId } from "./models";
import { isLocalEncryptedSecretEnvelope } from "../security/localSecrets";
import {
  OPENAI_COMPATIBLE_PROVIDER_TYPE,
  normalizeProviderType as normalizeProviderTypeValue,
} from "./providerTypes";
import { normalizeProviderBaseUrl } from "../security/urlPolicy";

function trimString(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function normalizeProviderType(value: unknown): ProviderType {
  return normalizeProviderTypeValue(value, OPENAI_COMPATIBLE_PROVIDER_TYPE);
}

function normalizeBaseUrl(value: unknown, type: ProviderType): string {
  const baseUrl = trimString(value, PROVIDER_CONFIG_LIMITS.maxBaseUrlChars);
  if (!baseUrl || baseUrl === "default") return baseUrl;

  try {
    normalizeProviderBaseUrl(baseUrl, type);
    return baseUrl;
  } catch {
    return "";
  }
}

export function migrateCoreSettingsState<T extends { providers?: unknown }>(
  state: T,
): T & { providers?: ModelProvider[] } {
  const rawProviders = Array.isArray(state.providers) ? state.providers : [];
  const providers = normalizeModelProviders(rawProviders);

  return {
    ...state,
    providers,
  };
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const modelId = normalizeProviderModelId(item);
    if (!modelId || seen.has(modelId)) continue;

    result.push(modelId);
    seen.add(modelId);
    if (result.length >= PROVIDER_MODEL_LIMITS.maxModels) break;
  }

  return result;
}

export function normalizeModelProvider(
  value: unknown,
  fallback?: Partial<ModelProvider>,
): ModelProvider | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ModelProvider>;
  const fallbackId = fallback?.id || "";

  const id =
    trimString(raw.id, PROVIDER_CONFIG_LIMITS.maxProviderIdChars) ||
    trimString(fallbackId, PROVIDER_CONFIG_LIMITS.maxProviderIdChars);
  if (!id) return null;

  const type = normalizeProviderType(raw.type || fallback?.type);
  const models = normalizeModelList(raw.models);
  const modelsList = normalizeModelList(raw.modelsList || raw.models);

  return {
    id,
    name:
      trimString(raw.name, PROVIDER_CONFIG_LIMITS.maxProviderNameChars) ||
      fallback?.name ||
      "Provider",
    type,
    baseUrl: normalizeBaseUrl(raw.baseUrl, type),
    apiKey: trimString(raw.apiKey, PROVIDER_CONFIG_LIMITS.maxApiKeyChars),
    ...(isLocalEncryptedSecretEnvelope(raw.apiKeySecret)
      ? { apiKeySecret: raw.apiKeySecret }
      : {}),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    models: models.filter(
      (model) => modelsList.length === 0 || modelsList.includes(model),
    ),
    modelsList,
    ...(raw.isServerDefault ? { isServerDefault: true } : {}),
    ...(raw.directCall === true ? { directCall: true } : {}),
  };
}

export function normalizeModelProviders(value: unknown): ModelProvider[] {
  if (!Array.isArray(value)) return [];

  const providers: ModelProvider[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const provider = normalizeModelProvider(item);
    if (!provider || seen.has(provider.id)) continue;

    providers.push(provider);
    seen.add(provider.id);
    if (providers.length >= PROVIDER_CONFIG_LIMITS.maxProviders) break;
  }

  return providers;
}
