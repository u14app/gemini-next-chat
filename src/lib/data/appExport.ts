import {
  appDb,
  STORAGE_KEYS,
  STORAGE_VERSION,
} from "@/store/storage/storageConfig";
import { flushSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { getResearchTaskRepository } from "@/services/research";
import { SERVER_DEFAULT_PROVIDER_ID } from "@/lib/defaultConfig/shared";

export const APP_EXPORT_VERSION = 3;
export const LEGACY_APP_EXPORT_VERSION = 2;

export const APP_EXPORT_EXCLUSIONS = [
  "Provider, search, RAG, voice, and plugin credentials",
  "Browser-local credential encryption envelopes and master keys",
  "Server environment variables and deployment secrets",
  "External RAG vectors and in-flight processing jobs",
  "Remote market catalogs and model metadata caches",
  "Temporary Object URLs and regenerated display caches",
] as const;

const SESSION_MESSAGES_PREFIX = "session_messages_";

const APP_OPFS_PREFIXES = [
  "opfs://knowledge-base/",
  "opfs://workspaces/",
  "opfs://images/",
  "opfs://chat/",
];

const SECRET_FIELD_NAMES = new Set([
  "apiKey",
  "apiKeySecret",
  "accessToken",
  "refreshToken",
  "authToken",
  "bearerToken",
  "clientSecret",
  "token",
  "tokenSecret",
  "mineruApiToken",
  "mineruApiTokenSecret",
  "llamaParseApiKey",
  "llamaParseApiKeySecret",
  "elevenLabsApiKey",
  "elevenLabsApiKeySecret",
  "mimoApiKey",
  "mimoApiKeySecret",
  "localValueSecret",
  "password",
  "accessPassword",
  "privateKey",
  "privateKeyPem",
]);

const SENSITIVE_URL_PARAM_NAMES = new Set([
  "apikey",
  "apitoken",
  "key",
  "accesskey",
  "accesstoken",
  "authtoken",
  "bearertoken",
  "refreshtoken",
  "token",
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "authorization",
  "auth",
  "credential",
  "credentials",
  "signature",
  "sig",
  "xamzsignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "securitytoken",
  "awsaccesskeyid",
  "xapikey",
  "subscriptionkey",
  "xgoogcredential",
  "xgoogsignature",
]);

const CONFIG_URL_FIELD_NAMES = new Set([
  "url",
  "baseUrl",
  "endpoint",
  "serverUrl",
  "registryUrl",
  "manifestUrl",
  "logoUrl",
  "externalDocsUrl",
]);

const TRANSIENT_CACHE_FIELD_NAMES = new Set([
  "marketPlugins",
  "marketPluginsTimestamp",
  "marketMcpServers",
  "marketMcpServersTimestamp",
  "marketAgents",
  "marketAgentsTimestamp",
  "marketAgentsLocale",
  "skillCatalogs",
  "skillCatalogTimestamps",
  "skillDefinitions",
  "skillDefinitionTimestamps",
  "modelMetadata",
  "modelMetadataTimestamp",
  "serverConfig",
  "displayCache",
  "_hasHydrated",
]);

export interface AppExportInput {
  exportedAt?: string;
  coreSettings?: unknown;
  settings?: unknown;
  chat?: unknown;
  sessionMessages?: Record<string, unknown>;
  knowledge?: unknown;
  memory?: unknown;
  research?: unknown;
}

export interface AppExportPayload {
  exportVersion: typeof APP_EXPORT_VERSION;
  storageVersion: number;
  exportedAt: string;
  metadata: {
    opfs: {
      mode: "bundled";
      includesBlobs: true;
    };
    security: {
      credentialsIncluded: false;
      excluded: readonly string[];
    };
  };
  data: {
    coreSettings?: unknown;
    settings?: unknown;
    chat?: unknown;
    sessionMessages: Record<string, unknown>;
    knowledge?: unknown;
    memory?: unknown;
    research?: unknown;
  };
}

export interface LegacyAppExportPayload {
  exportVersion: typeof LEGACY_APP_EXPORT_VERSION;
  storageVersion: number;
  exportedAt: string;
  data: AppExportPayload["data"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function looksLikeEncryptedEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.ciphertext === "string" &&
    typeof value.iv === "string" &&
    typeof value.context === "string" &&
    (typeof value.keyId === "string" ||
      typeof value.kid === "string" ||
      typeof value.wrappedKey === "string")
  );
}

function isHeaderContainerKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "header" ||
    normalized === "headers" ||
    normalized.endsWith("requestheaders") ||
    normalized.endsWith("customheaders") ||
    normalized.endsWith("httpheaders") ||
    normalized.endsWith("mcpheaders")
  );
}

function normalizeCredentialName(value: string): string {
  return value.replace(/[-_.]/g, "").toLowerCase();
}

function isSecretFieldName(key: string): boolean {
  const normalized = normalizeCredentialName(key);
  return [...SECRET_FIELD_NAMES].some(
    (fieldName) => normalizeCredentialName(fieldName) === normalized,
  );
}

function scrubUrlCredentials(value: string): string {
  if (!/^(?:https?|wss?):\/\//i.test(value)) return value;

  try {
    const url = new URL(value);
    let changed = false;
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (!SENSITIVE_URL_PARAM_NAMES.has(normalizeCredentialName(key))) {
        continue;
      }
      url.searchParams.delete(key);
      changed = true;
    }
    if (url.hash) {
      const fragmentParams = new URLSearchParams(
        url.hash.slice(1).replace(/^\?/, ""),
      );
      if (
        [...fragmentParams.keys()].some((key) =>
          SENSITIVE_URL_PARAM_NAMES.has(normalizeCredentialName(key)),
        )
      ) {
        url.hash = "";
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

type AppExportScrubContext =
  "settings" | "credential" | "plugin_definition" | "content";

const CREDENTIAL_CONTAINER_KEYS = new Set([
  "providers",
  "search",
  "rag",
  "voice",
  "pluginConfigs",
]);

function resolveChildScrubContext(
  context: AppExportScrubContext,
  parentKey: string,
  key: string,
): AppExportScrubContext {
  if (parentKey === "") {
    if (
      key === "chat" ||
      key === "sessionMessages" ||
      key === "knowledge" ||
      key === "memory" ||
      key === "research"
    ) {
      return "content";
    }
    if (key === "coreSettings" || key === "settings") return "settings";
  }
  if (context === "settings") {
    if (CREDENTIAL_CONTAINER_KEYS.has(key)) return "credential";
    if (key === "installedPlugins") return "plugin_definition";
  }
  if (context === "plugin_definition" && key === "mcp") {
    return "credential";
  }
  return context;
}

/** Removes configured credentials and re-fetchable caches without mutating input. */
export function scrubAppExportValue(
  value: unknown,
  parentKey = "",
  context: AppExportScrubContext = "settings",
): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => scrubAppExportValue(item, parentKey, context))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return value;
  if (context === "credential" && looksLikeEncryptedEnvelope(value)) {
    return undefined;
  }

  const isAttachment = isAttachmentRecord(value);
  const isInstalledPlugin =
    context === "plugin_definition" &&
    typeof value.id === "string" &&
    Array.isArray(value.functions);
  let omittedAttachmentUrlError: string | undefined;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const childContext = resolveChildScrubContext(context, parentKey, key);
    if (
      key === "displayCache" ||
      (context === "credential" && isSecretFieldName(key)) ||
      (context === "settings" && TRANSIENT_CACHE_FIELD_NAMES.has(key)) ||
      (context === "credential" && isHeaderContainerKey(key)) ||
      (parentKey === "auth" && key === "value") ||
      (context === "credential" &&
        parentKey === "query" &&
        SENSITIVE_URL_PARAM_NAMES.has(normalizeCredentialName(key)))
    ) {
      continue;
    }

    if (isAttachment && key === "url" && typeof nested === "string") {
      if (nested.startsWith("blob:")) {
        omittedAttachmentUrlError =
          "The temporary browser file URL was not included in this backup.";
        continue;
      }
      const scrubbedUrl = scrubUrlCredentials(nested);
      if (scrubbedUrl !== nested) {
        omittedAttachmentUrlError =
          "The credential-bearing file URL was not included in this backup.";
        continue;
      }
      output[key] = nested;
      continue;
    }

    if (
      (context === "credential" || isInstalledPlugin) &&
      CONFIG_URL_FIELD_NAMES.has(key) &&
      typeof nested === "string"
    ) {
      output[key] = scrubUrlCredentials(nested);
      continue;
    }

    const scrubbed = scrubAppExportValue(nested, key, childContext);
    if (scrubbed !== undefined) output[key] = scrubbed;
  }
  if (
    isAttachment &&
    omittedAttachmentUrlError &&
    typeof output.data !== "string"
  ) {
    output.localFileMissing = true;
    output.localFileError = omittedAttachmentUrlError;
  }
  return output;
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function preparePortableCoreSettings(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const container = isRecord(value.state) ? value.state : value;
  if (!Array.isArray(container.providers)) return value;

  const providers = container.providers.filter(
    (provider) =>
      !isRecord(provider) ||
      ((typeof provider.id !== "string" ||
        provider.id.trim() !== SERVER_DEFAULT_PROVIDER_ID) &&
        provider.isServerDefault !== true),
  );
  const availableModels = new Set(
    providers.flatMap((provider) => {
      if (
        !isRecord(provider) ||
        provider.enabled === false ||
        typeof provider.id !== "string" ||
        !Array.isArray(provider.models)
      ) {
        return [];
      }
      return provider.models
        .filter((model): model is string => typeof model === "string")
        .map((model) => `${provider.id}:${model}`);
    }),
  );
  const defaultModels = isRecord(container.defaultModels)
    ? Object.fromEntries(
        Object.entries(container.defaultModels).map(([task, model]) => [
          task,
          typeof model === "string" && availableModels.has(model) ? model : "",
        ]),
      )
    : container.defaultModels;
  const portableContainer: Record<string, unknown> = {
    ...container,
    providers,
    ...(defaultModels === undefined ? {} : { defaultModels }),
  };
  delete portableContainer.serverDefaultProviderEnabled;

  return container === value
    ? portableContainer
    : { ...value, state: portableContainer };
}

export function createAppExportPayload(
  input: AppExportInput,
): AppExportPayload {
  const data = scrubAppExportValue({
    coreSettings: input.coreSettings,
    settings: input.settings,
    chat: input.chat,
    sessionMessages: input.sessionMessages ?? {},
    knowledge: input.knowledge,
    memory: input.memory,
    research: input.research,
  }) as AppExportPayload["data"];
  data.coreSettings = preparePortableCoreSettings(data.coreSettings);

  return {
    exportVersion: APP_EXPORT_VERSION,
    storageVersion: STORAGE_VERSION,
    exportedAt: input.exportedAt || new Date().toISOString(),
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: {
        credentialsIncluded: false,
        excluded: APP_EXPORT_EXCLUSIONS,
      },
    },
    data,
  };
}

export interface BrowserAppExportPayloadOptions {
  flushMessageWrites?: boolean;
}

export async function createBrowserAppExportPayload(
  options: BrowserAppExportPayloadOptions = {},
): Promise<AppExportPayload> {
  if (options.flushMessageWrites !== false) {
    await flushSessionMessageWrites();
  }
  const [settings, chat, knowledge, memory, research, keys] = await Promise.all(
    [
      appDb.getItem<unknown>(STORAGE_KEYS.SETTINGS),
      appDb.getItem<unknown>(STORAGE_KEYS.CHAT),
      appDb.getItem<unknown>(STORAGE_KEYS.KNOWLEDGE),
      appDb.getItem<unknown>(STORAGE_KEYS.MEMORY),
      getResearchTaskRepository().list(),
      appDb.keys(),
    ],
  );
  const sessionMessageKeys = keys.filter((key) =>
    key.startsWith(SESSION_MESSAGES_PREFIX),
  );
  const sessionMessages = Object.fromEntries(
    await Promise.all(
      sessionMessageKeys.map(async (key) => [
        key.slice(SESSION_MESSAGES_PREFIX.length),
        await appDb.getItem<unknown>(key),
      ]),
    ),
  );
  const coreSettings =
    typeof window === "undefined"
      ? undefined
      : window.localStorage.getItem(STORAGE_KEYS.CORE_SETTINGS);

  return createAppExportPayload({
    coreSettings: parseStoredValue(coreSettings),
    settings: parseStoredValue(settings),
    chat: parseStoredValue(chat),
    sessionMessages,
    knowledge: parseStoredValue(knowledge),
    memory: parseStoredValue(memory),
    research,
  });
}

function isAttachmentRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.fileName === "string" && typeof value.mimeType === "string"
  );
}

function isWorkspaceArchiveRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.fileName === "string" &&
    typeof value.entryCount === "number" &&
    typeof value.bytes === "number"
  );
}

function isKnowledgeFileRecord(value: Record<string, unknown>): boolean {
  if (typeof value.name !== "string") return false;
  if ("sourcePath" in value || "contentPath" in value) return true;
  return (
    "path" in value &&
    ("status" in value || "uploadedAt" in value || "contentKind" in value)
  );
}

function addOpfsUrl(value: unknown, output: Set<string>): void {
  if (typeof value === "string" && value.startsWith("opfs://")) {
    output.add(value);
  }
}

function collectOpfsUrls(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOpfsUrls(item, output));
    return;
  }
  if (!isRecord(value)) return;

  if (isAttachmentRecord(value)) addOpfsUrl(value.url, output);
  if (isWorkspaceArchiveRecord(value)) addOpfsUrl(value.url, output);
  if (isKnowledgeFileRecord(value)) {
    addOpfsUrl(value.sourcePath, output);
    addOpfsUrl(value.contentPath, output);
    addOpfsUrl(value.path, output);
  }
  if (typeof value.artifactId === "string") {
    addOpfsUrl(value.artifactId, output);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === "displayCache") continue;
    collectOpfsUrls(nested, output);
  }
}

export function isAppOwnedOpfsUrl(value: string): boolean {
  return APP_OPFS_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function collectReferencedOpfsUrls(input: {
  data?: unknown;
  coreSettings?: unknown;
  settings?: unknown;
  chat?: unknown;
  sessionMessages?: unknown;
  knowledge?: unknown;
  memory?: unknown;
  research?: unknown;
}): Set<string> {
  const urls = new Set<string>();
  collectOpfsUrls(input, urls);
  return urls;
}

export function collectOrphanOpfsUrls(input: {
  existingUrls: Iterable<string>;
  referencedUrls: Iterable<string>;
}): string[] {
  const referencedUrls = new Set(input.referencedUrls);
  return [...input.existingUrls]
    .filter((url) => isAppOwnedOpfsUrl(url) && !referencedUrls.has(url))
    .sort();
}

export function isAppExportPayload(value: unknown): value is AppExportPayload {
  if (!isRecord(value) || value.exportVersion !== APP_EXPORT_VERSION) {
    return false;
  }
  return (
    typeof value.storageVersion === "number" &&
    typeof value.exportedAt === "string" &&
    isRecord(value.data) &&
    isRecord(value.data.sessionMessages)
  );
}

export function isLegacyAppExportPayload(
  value: unknown,
): value is LegacyAppExportPayload {
  if (!isRecord(value) || value.exportVersion !== LEGACY_APP_EXPORT_VERSION) {
    return false;
  }
  return (
    typeof value.storageVersion === "number" &&
    typeof value.exportedAt === "string" &&
    isRecord(value.data) &&
    isRecord(value.data.sessionMessages)
  );
}
