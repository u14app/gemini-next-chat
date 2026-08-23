import type {
  Plugin,
  PluginFunction,
  PluginFunctionRisk,
  ToolConfirmationDecision,
  ToolSessionApproval,
} from "@/types";
import type {
  ToolApprovalEvaluation,
  ToolApprovalIdentityV2,
  ToolApprovalProfile,
  ToolEffect,
  ToolInvocationPolicy,
} from "./types";
import { getPluginFunctionRisk } from "./risk";

const SENSITIVE_KEY_PATTERN =
  /(?:api[-_]?key|authorization|bearer|cookie|credential|password|secret|token)/i;
const SENSITIVE_CONTAINER_KEYS = new Set([
  "auth",
  "authentication",
  "header",
  "headers",
  "cookie",
  "cookies",
]);
const SENSITIVE_URL_PARAM_KEYS = new Set([
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
  "authorization",
  "auth",
  "credential",
  "signature",
  "sig",
  "xamzsignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "awsaccesskeyid",
  "xapikey",
  "subscriptionkey",
]);

function normalizeSensitiveKey(value: string): string {
  return value.replace(/[-_.]/g, "").toLowerCase();
}

function shouldRedactToolArgKey(key: string): boolean {
  return (
    SENSITIVE_CONTAINER_KEYS.has(normalizeSensitiveKey(key)) ||
    SENSITIVE_KEY_PATTERN.test(key)
  );
}

function redactSensitiveUrl(value: string): string {
  if (!/^(?:https?|wss?):\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAM_KEYS.has(normalizeSensitiveKey(key))) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    if (url.hash) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      if (
        [...fragment.keys()].some((key) =>
          SENSITIVE_URL_PARAM_KEYS.has(normalizeSensitiveKey(key)),
        )
      ) {
        url.hash = "";
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function createFallbackFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first, second]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

export async function createPluginFunctionFingerprint(
  plugin: Plugin,
  functionDef: PluginFunction,
): Promise<string> {
  const definition = JSON.stringify(
    canonicalize({
      version: 1,
      pluginId: plugin.id,
      manifestUrl: plugin.manifestUrl,
      baseUrl: plugin.baseUrl,
      source: plugin.source,
      mcpServerUrl: plugin.mcp?.serverUrl,
      mcpServerVersion: plugin.mcp?.serverVersion,
      name: functionDef.name,
      method: functionDef.method?.toUpperCase(),
      path: functionDef.path,
      mcpToolName: functionDef.mcpToolName,
      risk: getPluginFunctionRisk(functionDef),
      parameters: functionDef.parameters,
      outputSchema: functionDef.outputSchema,
      mcpPolicyHint: functionDef.mcpPolicyHint,
    }),
  );
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `v1:fallback:${createFallbackFingerprint(definition)}`;

  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(definition),
  );
  return `v1:${toHex(digest)}`;
}

export function requiresToolConfirmation(
  risk: PluginFunctionRisk,
  enableDestructiveToolConfirmation = false,
): boolean {
  return enableDestructiveToolConfirmation && risk === "destructive";
}

export function canPersistToolApproval(risk: PluginFunctionRisk): boolean {
  return risk === "write" || risk === "external";
}

export function normalizeToolConfirmationDecision(
  decision: ToolConfirmationDecision,
  risk: PluginFunctionRisk,
): ToolConfirmationDecision {
  if (decision === "allow_session" && !canPersistToolApproval(risk)) {
    return "allow_once";
  }
  return decision;
}

export function matchesToolSessionApproval(
  approval: ToolSessionApproval,
  candidate: Omit<ToolSessionApproval, "approvedAt">,
): boolean {
  if (candidate.identity) {
    if (!approval.identity) return false;
    if (!matchesToolApprovalIdentity(approval.identity, candidate.identity)) {
      return false;
    }
  }
  return (
    approval.pluginId === candidate.pluginId &&
    approval.functionName === candidate.functionName &&
    approval.risk === candidate.risk &&
    approval.functionFingerprint === candidate.functionFingerprint
  );
}

export interface ToolApprovalPolicyOptions {
  profile?: ToolApprovalProfile;
  /** The user has explicitly trusted the plugin or MCP server origin. */
  originTrusted?: boolean;
  /** The V2 policy came from a locally verified contract, not MCP hints. */
  policyVerified?: boolean;
}

function hasEffect(
  policy: ToolInvocationPolicy,
  ...effects: ToolEffect[]
): boolean {
  return policy.effects.some((effect) => effects.includes(effect));
}

function isUnknownMcpInvocation(
  policy: ToolInvocationPolicy,
  options: ToolApprovalPolicyOptions,
): boolean {
  return (
    policy.origin === "mcp" &&
    (!options.originTrusted || !options.policyVerified)
  );
}

export function canPersistInvocationApproval(
  policy: ToolInvocationPolicy,
  options: ToolApprovalPolicyOptions = {},
): boolean {
  if (
    hasEffect(policy, "local_destructive", "external_destructive") ||
    isUnknownMcpInvocation(policy, options)
  ) {
    return false;
  }

  const sendsDataOutside = hasEffect(
    policy,
    "network_read",
    "external_write",
    "external_destructive",
  );
  if (sendsDataOutside && policy.sensitivity === "credentials") return false;

  return hasEffect(policy, "local_write", "external_write");
}

/**
 * Evaluate the three approval profiles without executing or mutating anything.
 * Unknown MCP tools always require a one-time confirmation, even in permissive
 * mode, until both the origin and its policy have been verified locally.
 */
export function evaluateToolInvocationApproval(
  policy: ToolInvocationPolicy,
  options: ToolApprovalPolicyOptions = {},
): ToolApprovalEvaluation {
  const profile = options.profile ?? "permissive";
  const persistable = canPersistInvocationApproval(policy, options);

  if (hasEffect(policy, "local_destructive", "external_destructive")) {
    return {
      requiresConfirmation: true,
      canPersist: false,
      reason: "destructive_effect",
    };
  }

  if (
    policy.sensitivity === "credentials" &&
    hasEffect(policy, "network_read", "external_write")
  ) {
    return {
      requiresConfirmation: true,
      canPersist: false,
      reason: "credential_exposure",
    };
  }

  if (isUnknownMcpInvocation(policy, options)) {
    return {
      requiresConfirmation: true,
      canPersist: false,
      reason: "unknown_mcp",
    };
  }

  if (profile === "strict" && hasEffect(policy, "local_write")) {
    return {
      requiresConfirmation: true,
      canPersist: persistable,
      reason: "local_write",
    };
  }

  if (
    hasEffect(policy, "external_write") &&
    (profile !== "permissive" ||
      !options.originTrusted ||
      !options.policyVerified)
  ) {
    return {
      requiresConfirmation: true,
      canPersist: persistable,
      reason: "external_write",
    };
  }

  return {
    requiresConfirmation: false,
    canPersist: false,
    reason: "automatic",
  };
}

const TOOL_EFFECT_ORDER: readonly ToolEffect[] = [
  "local_read",
  "local_write",
  "local_destructive",
  "network_read",
  "external_write",
  "external_destructive",
];

export interface CreateToolApprovalIdentityInput {
  origin: ToolApprovalIdentityV2["origin"];
  providerId: string;
  toolName: string;
  toolFingerprint: string;
  effects: readonly ToolEffect[];
  targetScope?: string;
}

function requireIdentityPart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be empty.`);
  return normalized;
}

export function createToolApprovalIdentity(
  input: CreateToolApprovalIdentityInput,
): ToolApprovalIdentityV2 {
  const effectSet = new Set(input.effects);
  const effects = TOOL_EFFECT_ORDER.filter((effect) => effectSet.has(effect));
  if (effects.length === 0) {
    throw new TypeError("effects must include at least one known tool effect.");
  }

  return {
    version: 2,
    origin: input.origin,
    providerId: requireIdentityPart(input.providerId, "providerId"),
    toolName: requireIdentityPart(input.toolName, "toolName"),
    toolFingerprint: requireIdentityPart(
      input.toolFingerprint,
      "toolFingerprint",
    ),
    effects,
    targetScope: redactSensitiveUrl(input.targetScope?.trim() || "*") || "*",
  };
}

export function getToolApprovalIdentityKey(
  identity: ToolApprovalIdentityV2,
): string {
  return JSON.stringify({
    version: identity.version,
    origin: identity.origin,
    providerId: identity.providerId,
    toolName: identity.toolName,
    toolFingerprint: identity.toolFingerprint,
    effects: identity.effects,
    targetScope: identity.targetScope,
  });
}

export function matchesToolApprovalIdentity(
  approval: ToolApprovalIdentityV2,
  candidate: ToolApprovalIdentityV2,
): boolean {
  return (
    getToolApprovalIdentityKey(approval) ===
    getToolApprovalIdentityKey(candidate)
  );
}

export function redactSensitiveToolArgs(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactSensitiveToolArgs(item, seen));
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      shouldRedactToolArgKey(key)
        ? "[REDACTED]"
        : typeof item === "string"
          ? redactSensitiveUrl(item)
          : redactSensitiveToolArgs(item, seen),
    ]),
  );
}
