import type { LocalEncryptedSecretEnvelope } from "../security/localSecrets";

export type PluginFunctionRisk = "read" | "write" | "destructive" | "external";
export type PluginSource = "builtin" | "openapi" | "mcp";
export type McpTransport = "streamable-http" | "sse";

/**
 * V2 policy metadata describes what a tool invocation can affect. The legacy
 * `PluginFunctionRisk` remains available while callers migrate to this model.
 */
export type ToolEffect =
  | "local_read"
  | "local_write"
  | "local_destructive"
  | "network_read"
  | "external_write"
  | "external_destructive";

export type ToolIdempotency = "idempotent" | "non_idempotent" | "unknown";

export type ToolSensitivity = "none" | "user_data" | "credentials" | "unknown";

export type ToolOrigin = "builtin" | "plugin" | "mcp";

export interface ToolInvocationPolicy {
  effects: readonly ToolEffect[];
  idempotency: ToolIdempotency;
  sensitivity: ToolSensitivity;
  origin: ToolOrigin;
}

/** A JSON-safe static descriptor suitable for fingerprints and persistence. */
export interface ToolDescriptorV2 extends ToolInvocationPolicy {
  version: 2;
  /** Optional display hint; never sufficient to authorize an invocation. */
  openWorld?: boolean;
}

/** Dynamic classification stays on the runtime binding, not the descriptor. */
export type ToolInvocationPolicyResolver = (
  args: unknown,
  descriptor: ToolDescriptorV2,
) => ToolInvocationPolicy;

export type ToolApprovalProfile = "permissive" | "balanced" | "strict";

export type ToolApprovalReason =
  | "automatic"
  | "credential_exposure"
  | "destructive_effect"
  | "external_write"
  | "local_write"
  | "unknown_mcp";

export interface ToolApprovalEvaluation {
  requiresConfirmation: boolean;
  canPersist: boolean;
  reason: ToolApprovalReason;
}

/**
 * Plain-data identity for future session approvals. It intentionally carries
 * no raw arguments, credentials, callbacks, or provider objects.
 */
export interface ToolApprovalIdentityV2 {
  version: 2;
  origin: ToolOrigin;
  providerId: string;
  toolName: string;
  toolFingerprint: string;
  effects: readonly ToolEffect[];
  targetScope: string;
}

export interface McpToolIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

/** MCP annotations are untrusted display and classification hints only. */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface PluginFunction {
  name: string;
  description: string;
  parameters: any;
  title?: string;
  icons?: McpToolIcon[];
  annotations?: McpToolAnnotations;
  outputSchema?: Record<string, unknown>;
  /** Untrusted display hint derived from MCP metadata. */
  mcpPolicyHint?: ToolDescriptorV2;
  path?: string;
  method?: string;
  mcpToolName?: string;
  risk?: PluginFunctionRisk;
}

export interface PluginMcpMetadata {
  transport: McpTransport;
  source?: "registry" | "custom" | "bridge";
  serverUrl: string;
  serverName: string;
  serverVersion?: string;
  headers?: Record<string, string>;
  toolNameMap?: Record<string, string>;
}

export interface PluginAuth {
  type: "bearer" | "apiKey" | "basic" | "oauth2" | "none";
  name?: string;
  in?: "header" | "query";
  required?: boolean;
}

export interface Plugin {
  id: string;
  title: string;
  description: string;
  logoUrl: string;
  manifestUrl: string;
  externalDocsUrl?: string;
  baseUrl?: string;
  functions: PluginFunction[];
  source?: PluginSource;
  mcp?: PluginMcpMetadata;
  category?: string;
  categories?: string[];
  added?: string;
  builtIn?: boolean;
  auth?: PluginAuth;
}

export interface PluginConfig {
  enabledFunctions?: string[];
  disabledFunctions?: string[];
  baseUrl?: string;
  model?: string;
  auth?: {
    type: "bearer" | "apiKey" | "oauth2" | "none";
    value?: string;
    localValueSecret?: LocalEncryptedSecretEnvelope;
    key?: string;
    addTo?: "header" | "query";
  };
}
