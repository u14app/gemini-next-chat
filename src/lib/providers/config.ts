import type { ModelProvider, ProviderType } from "@/types";
import { PROVIDER_CONFIG_LIMITS, PROVIDER_MODEL_LIMITS } from "@/config/limits";
import { normalizeProviderModelId } from "./models";
import { isLocalEncryptedSecretEnvelope } from "../security/localSecrets";
import {
  OPENAI_COMPATIBLE_PROVIDER_TYPE,
  normalizeProviderType as normalizeProviderTypeValue,
  normalizeProviderTypeValue as parseProviderType,
} from "./providerTypes";
import { normalizeProviderBaseUrl } from "../security/urlPolicy";
import { SERVER_DEFAULT_PROVIDER_ID } from "../defaultConfig/shared";

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

function validateRestorableModelList(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`The backup contains an invalid ${label} list.`);
  }
  if (value.length > PROVIDER_MODEL_LIMITS.maxModels) {
    throw new Error(`The backup ${label} list exceeds the supported limit.`);
  }

  const seen = new Set<string>();
  for (const item of value) {
    const modelId = normalizeProviderModelId(item);
    const untruncatedId =
      typeof item === "string" ? item.trim().replace(/^models\//, "") : "";
    if (
      !modelId ||
      untruncatedId.length > PROVIDER_MODEL_LIMITS.maxModelIdChars
    ) {
      throw new Error(`The backup contains an invalid ${label} identifier.`);
    }
    if (seen.has(modelId)) {
      throw new Error(`The backup contains a duplicate ${label} identifier.`);
    }
    seen.add(modelId);
  }
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
    ...(typeof raw.directCall === "boolean"
      ? { directCall: raw.directCall }
      : {}),
  };
}

export function validateRestorableModelProviders(
  value: unknown,
): ModelProvider[] {
  if (!Array.isArray(value)) {
    throw new Error("The backup contains an invalid provider list.");
  }

  const portableProviders: unknown[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("The backup contains an invalid provider entry.");
    }
    const raw = item as Partial<ModelProvider>;
    if (
      raw.id?.trim() === SERVER_DEFAULT_PROVIDER_ID ||
      raw.isServerDefault === true
    ) {
      continue;
    }
    portableProviders.push(item);
  }
  if (portableProviders.length > PROVIDER_CONFIG_LIMITS.maxProviders) {
    throw new Error("The backup provider list exceeds the supported limit.");
  }

  const providers: ModelProvider[] = [];
  const seen = new Set<string>();
  for (const item of portableProviders) {
    const raw = item as Partial<ModelProvider>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || id.length > PROVIDER_CONFIG_LIMITS.maxProviderIdChars) {
      throw new Error("The backup contains an invalid provider identifier.");
    }
    if (seen.has(id)) {
      throw new Error("The backup contains a duplicate provider identifier.");
    }
    if (raw.type !== undefined && parseProviderType(raw.type) === null) {
      throw new Error("The backup contains an invalid provider type.");
    }
    if (raw.name !== undefined && typeof raw.name !== "string") {
      throw new Error("The backup contains an invalid provider name.");
    }
    if (
      typeof raw.name === "string" &&
      raw.name.trim().length > PROVIDER_CONFIG_LIMITS.maxProviderNameChars
    ) {
      throw new Error("The backup contains an invalid provider name.");
    }
    if (raw.baseUrl !== undefined && typeof raw.baseUrl !== "string") {
      throw new Error("The backup contains an invalid provider URL.");
    }
    if (
      typeof raw.baseUrl === "string" &&
      raw.baseUrl.trim().length > PROVIDER_CONFIG_LIMITS.maxBaseUrlChars
    ) {
      throw new Error("The backup contains an invalid provider URL.");
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
      throw new Error("The backup contains an invalid provider enabled flag.");
    }
    if (raw.directCall !== undefined && typeof raw.directCall !== "boolean") {
      throw new Error(
        "The backup contains an invalid provider direct-call flag.",
      );
    }
    if (
      raw.isServerDefault !== undefined &&
      typeof raw.isServerDefault !== "boolean"
    ) {
      throw new Error(
        "The backup contains an invalid server-default provider flag.",
      );
    }
    validateRestorableModelList(raw.models, "provider model");
    validateRestorableModelList(raw.modelsList, "available model");

    const provider = normalizeModelProvider(raw);
    if (!provider) {
      throw new Error("The backup contains an invalid provider entry.");
    }
    if (raw.baseUrl?.trim() && !provider.baseUrl) {
      throw new Error("The backup contains an invalid provider URL.");
    }
    const rawModels = normalizeModelList(raw.models);
    if (provider.models.length !== rawModels.length) {
      throw new Error(
        "The backup provider selection references an unavailable model.",
      );
    }

    providers.push(provider);
    seen.add(id);
  }

  return providers;
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
