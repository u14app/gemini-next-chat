import type {
  PluginFunction,
  PluginFunctionRisk,
  ToolEffect,
  ToolInvocationPolicy,
  ToolOrigin,
  ToolSensitivity,
} from "./types";

const SENSITIVE_ARGUMENT_KEY_PATTERN =
  /(?:api[-_]?key|authorization|bearer|cookie|credential|password|secret|token)/i;
const IRREVERSIBLE_EXTERNAL_OPERATION_PATTERN =
  /(?:^|[^a-z0-9])(?:delete|destroy|purge|erase|publish|deploy|release|pay|payment|purchase|charge|transfer|refund|permission|permissions|role|roles|acl|ownership|grant|revoke|send|submit|notify|invite|ban)(?:$|[^a-z0-9])/i;
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

function normalizeKey(value: string): string {
  return value.replace(/[-_.]/g, "").toLowerCase();
}

function urlContainsCredentials(value: string): boolean {
  if (!/^(?:https?|wss?):\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    return [...url.searchParams.keys()].some((key) =>
      SENSITIVE_URL_PARAM_KEYS.has(normalizeKey(key)),
    );
  } catch {
    return false;
  }
}

function containsSensitiveArgument(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return urlContainsCredentials(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveArgument(item, seen));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) =>
      SENSITIVE_ARGUMENT_KEY_PATTERN.test(key) ||
      containsSensitiveArgument(item, seen),
  );
}

function hasArgumentData(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function getToolArgumentSensitivity(args: unknown): ToolSensitivity {
  if (containsSensitiveArgument(args)) return "credentials";
  return hasArgumentData(args) ? "user_data" : "none";
}

export function getPluginFunctionRisk(
  functionDef: Pick<PluginFunction, "method" | "risk">,
): PluginFunctionRisk {
  const method = functionDef.method?.toUpperCase();
  const methodFloor: PluginFunctionRisk = !method
    ? "external"
    : method === "GET" || method === "HEAD" || method === "OPTIONS"
      ? "read"
      : method === "DELETE"
        ? "destructive"
        : "write";
  if (!functionDef.risk) return methodFloor;

  const rank: Record<PluginFunctionRisk, number> = {
    read: 0,
    write: 1,
    external: 2,
    destructive: 3,
  };
  return rank[functionDef.risk] >= rank[methodFloor]
    ? functionDef.risk
    : methodFloor;
}

export interface PluginInvocationPolicyOptions {
  args?: unknown;
  origin?: Extract<ToolOrigin, "plugin" | "mcp">;
  /** Only set after independently verifying the MCP policy, never for hints. */
  useVerifiedMcpPolicyHint?: boolean;
}

/**
 * Resolve a conservative V2 policy without changing the legacy risk contract.
 * MCP tools without a verified descriptor remain unknown destructive external
 * calls and are never de-escalated by server-provided annotations alone.
 */
export function getPluginFunctionInvocationPolicy(
  functionDef: Pick<
    PluginFunction,
    "name" | "path" | "method" | "risk" | "mcpToolName" | "mcpPolicyHint"
  >,
  options: PluginInvocationPolicyOptions = {},
): ToolInvocationPolicy {
  const method = functionDef.method?.toUpperCase();
  const risk = getPluginFunctionRisk(functionDef);
  const origin = options.origin ?? (functionDef.mcpToolName ? "mcp" : "plugin");
  const argumentSensitivity = getToolArgumentSensitivity(options.args);
  const operationIdentity =
    `${functionDef.name || ""} ${functionDef.path || ""}`
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ");

  if (origin === "mcp") {
    const verifiedHint = options.useVerifiedMcpPolicyHint
      ? functionDef.mcpPolicyHint
      : undefined;
    return {
      effects: verifiedHint?.effects ?? ["external_destructive"],
      idempotency: verifiedHint?.idempotency ?? "unknown",
      sensitivity:
        argumentSensitivity === "none"
          ? (verifiedHint?.sensitivity ?? "unknown")
          : argumentSensitivity,
      origin,
    };
  }

  let effects: readonly ToolEffect[];
  if (
    risk === "destructive" ||
    IRREVERSIBLE_EXTERNAL_OPERATION_PATTERN.test(operationIdentity)
  ) {
    effects = ["external_destructive"];
  } else if (risk === "write" || risk === "external") {
    effects = ["external_write"];
  } else {
    effects = ["network_read"];
  }

  const idempotency =
    risk === "read" || method === "PUT" || method === "DELETE"
      ? "idempotent"
      : method === "POST" || method === "PATCH"
        ? "non_idempotent"
        : "unknown";

  return {
    effects,
    idempotency,
    sensitivity: argumentSensitivity,
    origin,
  };
}
