import "server-only";

import type {
  ServiceHealthItem,
  ServiceHealthServiceKey,
  ServiceHealthState,
  ServiceHealthStatus,
} from "@/types";
import {
  getDefaultDocumentParseProvider,
  getDefaultElevenLabsSttModel,
  getDefaultElevenLabsTtsModel,
  getDefaultMimoSttModel,
  getDefaultMimoTtsModel,
  getDefaultVoiceProvider,
  isDefaultDocumentProcessingAvailable,
} from "../defaultConfig/server";
import { getDeploymentMode } from "../security/deployment";
import { isAccessPasswordEnabled } from "../security/accessControl";
import { getApiProofPublicStatus } from "../security/requestProof";
import { isLocalhostName, isPrivateIpAddress } from "../security/urlPolicy";

type StoreEnvName =
  "RATE_LIMIT_STORE" | "DOCUMENT_PARSE_JOB_STORE" | "PLUGIN_REGISTRY_STORE";

const sharedStoreNames = new Set(["upstash", "redis", "kv"]);

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

function envBool(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(env(name).toLowerCase());
}

function item(
  service: ServiceHealthServiceKey,
  status: ServiceHealthState,
  code: string,
  message?: string,
): ServiceHealthItem {
  return { service, status, code, ...(message ? { message } : {}) };
}

function hasSharedStoreCredentials(): boolean {
  return Boolean(
    env("UPSTASH_REDIS_REST_URL") && env("UPSTASH_REDIS_REST_TOKEN"),
  );
}

function storeHealth(
  service: Extract<
    ServiceHealthServiceKey,
    "rateLimitStore" | "documentParseJobStore" | "pluginRegistry"
  >,
  storeEnvName: StoreEnvName,
  hosted: boolean,
): ServiceHealthItem {
  const configuredStore = env(storeEnvName).toLowerCase();
  const wantsSharedStore = sharedStoreNames.has(configuredStore);

  if (wantsSharedStore && hasSharedStoreCredentials()) {
    return item(service, "available", "SHARED_STORE_CONFIGURED");
  }

  if (hosted || wantsSharedStore) {
    if (service === "rateLimitStore") {
      return item(service, "degraded", "MEMORY_STORE_FALLBACK");
    }
    return item(service, "policy_blocked", "SHARED_STORE_REQUIRED");
  }

  return item(service, "local_only", "MEMORY_STORE");
}

function byokHealth(): ServiceHealthItem {
  if (env("BYOK_PRIVATE_KEY_PEM")) {
    return item("byok", "available", "STABLE_KEY_CONFIGURED");
  }
  if (getDeploymentMode() === "hosted") {
    return item("byok", "degraded", "EPHEMERAL_KEY_ALLOWED");
  }
  if (envBool("BYOK_ALLOW_EPHEMERAL_KEY")) {
    return item("byok", "local_only", "EPHEMERAL_KEY_ALLOWED");
  }
  return item("byok", "missing_key", "STABLE_KEY_MISSING");
}

function apiProofHealth(): ServiceHealthItem {
  const status = getApiProofPublicStatus();
  if (!status.required) {
    return item("apiProof", "local_only", "API_PROOF_LOCAL_MODE");
  }
  if (!status.configured) {
    return item("apiProof", "missing_key", "API_PROOF_BYOK_MISSING");
  }
  if (status.ephemeral) {
    return item("apiProof", "degraded", "API_PROOF_EPHEMERAL");
  }
  return item("apiProof", "available", "API_PROOF_ENABLED");
}

function accessPasswordHealth(hosted: boolean): ServiceHealthItem {
  if (isAccessPasswordEnabled()) {
    return item("accessPassword", "available", "ACCESS_PASSWORD_CONFIGURED");
  }
  return item(
    "accessPassword",
    hosted ? "missing_key" : "local_only",
    hosted ? "ACCESS_PASSWORD_RECOMMENDED" : "ACCESS_PASSWORD_OPTIONAL",
  );
}

function hasPublicSiteUrl(): boolean {
  const value = env("NEXT_PUBLIC_SITE_URL");
  if (!value) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return !isLocalhostName(hostname) && !isPrivateIpAddress(hostname);
  } catch {
    return false;
  }
}

function hostedModeHealth(hosted: boolean): ServiceHealthItem {
  if (hosted) {
    return item("hostedMode", "available", "HOSTED_MODE_ENABLED");
  }

  if (hasPublicSiteUrl()) {
    return item(
      "hostedMode",
      "policy_blocked",
      "PUBLIC_LOCAL_MODE",
      "Public deployments should run with DEPLOYMENT_MODE=hosted.",
    );
  }

  return item("hostedMode", "local_only", "LOCAL_MODE");
}

function proxyHeadersHealth(hosted: boolean): ServiceHealthItem {
  if (!hosted) {
    return item("proxyHeaders", "local_only", "PROXY_HEADERS_LOCAL_MODE");
  }
  if (envBool("TRUST_PROXY_HEADERS")) {
    return item("proxyHeaders", "available", "PROXY_HEADERS_TRUSTED");
  }
  return item(
    "proxyHeaders",
    "degraded",
    "PROXY_HEADERS_UNTRUSTED",
    "Protected APIs use request-proof sessions for rate limits; public bootstrap routes share a deployment bucket.",
  );
}

function defaultModelHealth(): ServiceHealthItem {
  if (env("DEFAULT_PROVIDER_API_KEY")) {
    return item("defaultModel", "available", "DEFAULT_MODEL_CONFIGURED");
  }
  return item("defaultModel", "missing_key", "DEFAULT_PROVIDER_KEY_MISSING");
}

function searchHealth(): ServiceHealthItem {
  const provider = env("DEFAULT_SEARCH_PROVIDER").toLowerCase() || "firecrawl";
  if (provider === "searxng") {
    return env("DEFAULT_SEARCH_BASE_URL")
      ? item("search", "available", "SEARCH_CONFIGURED")
      : item("search", "missing_key", "SEARCH_BASE_URL_MISSING");
  }
  if (provider === "firecrawl") {
    return item("search", "available", "SEARCH_CONFIGURED");
  }
  return env("DEFAULT_SEARCH_API_KEY")
    ? item("search", "available", "SEARCH_CONFIGURED")
    : item("search", "missing_key", "SEARCH_API_KEY_MISSING");
}

function ragHealth(): ServiceHealthItem {
  const vectorStoreReady = Boolean(
    env("DEFAULT_RAG_BASE_URL") && env("DEFAULT_RAG_TOKEN"),
  );
  const parserReady = isDefaultDocumentProcessingAvailable(
    getDefaultDocumentParseProvider(),
  );

  if (vectorStoreReady || parserReady) {
    return item("rag", "available", "RAG_CONFIGURED");
  }
  return item("rag", "unconfigured", "RAG_UNCONFIGURED");
}

function voiceHealth(): ServiceHealthItem {
  const configuredProvider = env("DEFAULT_VOICE_PROVIDER").toLowerCase();
  if (!configuredProvider) {
    return item("voice", "unconfigured", "VOICE_UNCONFIGURED");
  }
  if (configuredProvider !== "elevenlabs" && configuredProvider !== "mimo") {
    return item("voice", "unconfigured", "VOICE_UNCONFIGURED");
  }

  const defaultProvider = getDefaultVoiceProvider();
  if (!defaultProvider) {
    return item("voice", "missing_key", "VOICE_API_KEY_MISSING");
  }

  const hasDefaultCapability =
    defaultProvider === "mimo"
      ? Boolean(getDefaultMimoSttModel() || getDefaultMimoTtsModel())
      : Boolean(
          getDefaultElevenLabsSttModel() || getDefaultElevenLabsTtsModel(),
        );

  if (hasDefaultCapability) {
    return item("voice", "available", "VOICE_CONFIGURED");
  }

  return item("voice", "unconfigured", "VOICE_UNCONFIGURED");
}

export function getServiceHealthStatus(
  options: { now?: number } = {},
): ServiceHealthStatus {
  const deploymentMode = getDeploymentMode();
  const hosted = deploymentMode === "hosted";

  return {
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    deploymentMode,
    services: {
      byok: byokHealth(),
      apiProof: apiProofHealth(),
      accessPassword: accessPasswordHealth(hosted),
      hostedMode: hostedModeHealth(hosted),
      proxyHeaders: proxyHeadersHealth(hosted),
      rateLimitStore: storeHealth("rateLimitStore", "RATE_LIMIT_STORE", hosted),
      documentParseJobStore: storeHealth(
        "documentParseJobStore",
        "DOCUMENT_PARSE_JOB_STORE",
        hosted,
      ),
      pluginRegistry: storeHealth(
        "pluginRegistry",
        "PLUGIN_REGISTRY_STORE",
        hosted,
      ),
      defaultModel: defaultModelHealth(),
      search: searchHealth(),
      rag: ragHealth(),
      voice: voiceHealth(),
    },
  };
}
