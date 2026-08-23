import { MARKET_LIMITS, PLUGIN_EXECUTION_LIMITS } from "@/config/limits";
import type { Plugin, PluginFunction } from "@/types";
import type {
  McpToolAnnotations,
  McpToolIcon,
  McpTransport,
  ToolDescriptorV2,
} from "../plugin/types";
import { DEFAULT_MCP_SERVER_LOGO_URL } from "./defaults";

export const MCP_REGISTRY_BASE_URL =
  "https://registry.modelcontextprotocol.io/v0.1";
const MAX_MCP_TOOL_FUNCTIONS = 20;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export interface McpRegistryListOptions {
  maxServers?: number;
}

export interface McpRegistryTool {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  icons?: unknown;
  annotations?: unknown;
}

interface NormalizedMcpRemote {
  transport: McpTransport;
  serverUrl: string;
  auth?: Plugin["auth"];
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function trimString(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function sanitizeToolNameSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/-+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  );
}

export function buildMcpToolFunctionName(
  serverName: string,
  toolName: string,
): string {
  const serverSegment = sanitizeToolNameSegment(serverName);
  const toolSegment = sanitizeToolNameSegment(toolName);
  const candidate = `mcp_${serverSegment}__${toolSegment}`;
  if (candidate.length <= PLUGIN_EXECUTION_LIMITS.maxFunctionNameChars) {
    return candidate;
  }

  const suffix = `_${shortHash(`${serverName}:${toolName}`)}`;
  const maxBodyChars =
    PLUGIN_EXECUTION_LIMITS.maxFunctionNameChars -
    "mcp_".length -
    "__".length -
    suffix.length;
  const serverChars = Math.min(
    serverSegment.length,
    Math.max(20, Math.floor(maxBodyChars * 0.48)),
  );
  const toolChars = Math.max(1, maxBodyChars - serverChars);

  return `mcp_${serverSegment
    .slice(0, serverChars)
    .replace(/_+$/g, "")}__${toolSegment
    .slice(0, toolChars)
    .replace(/_+$/g, "")}${suffix}`;
}

function buildUniqueFunctionName(
  serverName: string,
  toolName: string,
  index: number,
  seen: Set<string>,
): string {
  const baseName = buildMcpToolFunctionName(serverName, toolName);
  if (!seen.has(baseName)) {
    seen.add(baseName);
    return baseName;
  }

  const hash = shortHash(`${serverName}:${toolName}:${index}`);
  const maxChars = PLUGIN_EXECUTION_LIMITS.maxFunctionNameChars;
  const prefix = baseName
    .slice(0, maxChars - hash.length - 1)
    .replace(/_+$/g, "");
  const uniqueName = `${prefix}_${hash}`;
  seen.add(uniqueName);
  return uniqueName;
}

function normalizeToolInputSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: "object", properties: {} };
  return { ...value };
}

function normalizeToolOutputSchema(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

function normalizeMcpToolIcons(value: unknown): McpToolIcon[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const icons: McpToolIcon[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const src = trimString(candidate.src, 2_048);
    if (!src) continue;

    const mimeType = trimString(candidate.mimeType, 160);
    const sizes = Array.isArray(candidate.sizes)
      ? candidate.sizes
          .map((size) => trimString(size, 80))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const theme =
      candidate.theme === "light" || candidate.theme === "dark"
        ? candidate.theme
        : undefined;
    icons.push({
      src,
      ...(mimeType ? { mimeType } : {}),
      ...(sizes.length > 0 ? { sizes } : {}),
      ...(theme ? { theme } : {}),
    });
    if (icons.length >= 8) break;
  }

  return icons.length > 0 ? icons : undefined;
}

function normalizeMcpToolAnnotations(
  value: unknown,
): McpToolAnnotations | undefined {
  if (!isRecord(value)) return undefined;

  const title = trimString(value.title, 300);
  const annotations: McpToolAnnotations = {
    ...(title ? { title } : {}),
    ...(typeof value.readOnlyHint === "boolean"
      ? { readOnlyHint: value.readOnlyHint }
      : {}),
    ...(typeof value.destructiveHint === "boolean"
      ? { destructiveHint: value.destructiveHint }
      : {}),
    ...(typeof value.idempotentHint === "boolean"
      ? { idempotentHint: value.idempotentHint }
      : {}),
    ...(typeof value.openWorldHint === "boolean"
      ? { openWorldHint: value.openWorldHint }
      : {}),
  };
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

/**
 * MCP annotations are server-provided hints. This descriptor is therefore
 * display-only until a separate trust decision verifies both server and tool.
 */
export function createMcpToolDescriptorV2(
  annotations?: McpToolAnnotations,
): ToolDescriptorV2 {
  const readOnly = annotations?.readOnlyHint === true;
  const explicitlyNonDestructive =
    annotations?.readOnlyHint === false &&
    annotations.destructiveHint === false;

  return {
    version: 2,
    effects: readOnly
      ? ["network_read"]
      : explicitlyNonDestructive
        ? ["external_write"]
        : ["external_destructive"],
    idempotency:
      readOnly || annotations?.idempotentHint === true
        ? "idempotent"
        : annotations?.idempotentHint === false
          ? "non_idempotent"
          : "unknown",
    sensitivity: "unknown",
    origin: "mcp",
    ...(typeof annotations?.openWorldHint === "boolean"
      ? { openWorld: annotations.openWorldHint }
      : {}),
  };
}

export function normalizeMcpToolFunctions(
  serverName: string,
  tools: McpRegistryTool[] | unknown,
): PluginFunction[] {
  if (!Array.isArray(tools)) return [];

  const functions: PluginFunction[] = [];
  const seen = new Set<string>();

  for (const [index, tool] of tools.entries()) {
    if (functions.length >= MAX_MCP_TOOL_FUNCTIONS) break;
    if (!isRecord(tool)) continue;

    const mcpToolName = trimString(tool.name, 256);
    if (!mcpToolName) continue;

    const name = buildUniqueFunctionName(serverName, mcpToolName, index, seen);
    const description =
      trimString(tool.description, 2_048) ||
      `Call the MCP tool ${mcpToolName}.`;
    const title = trimString(tool.title, 300);
    const icons = normalizeMcpToolIcons(tool.icons);
    const annotations = normalizeMcpToolAnnotations(tool.annotations);
    const outputSchema = normalizeToolOutputSchema(tool.outputSchema);

    functions.push({
      name,
      mcpToolName,
      description,
      parameters: normalizeToolInputSchema(tool.inputSchema),
      ...(title ? { title } : {}),
      ...(icons ? { icons } : {}),
      ...(annotations ? { annotations } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      mcpPolicyHint: createMcpToolDescriptorV2(annotations),
      risk: "external",
    });
  }

  return functions;
}

function getServerEntry(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value.server;
  return isRecord(nested) ? nested : value;
}

function normalizeHttpUrl(value: unknown): string {
  const raw = trimString(value, MARKET_LIMITS.maxPluginManifestUrlChars);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function hasUnresolvedUrlVariables(
  rawUrl: string,
  remote: Record<string, unknown>,
): boolean {
  if (/\{[^}]+\}/.test(rawUrl)) return true;
  return isRecord(remote.variables) && Object.keys(remote.variables).length > 0;
}

function normalizeWebUrl(value: unknown): string {
  const raw = trimString(value, MARKET_LIMITS.maxPluginDocsUrlChars);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function normalizeHeaderName(value: unknown): string {
  const name = trimString(value, 120);
  return name && HEADER_NAME_RE.test(name) ? name : "";
}

function normalizeStaticHeaderValue(value: unknown): string {
  const headerValue = trimString(value, 4_096);
  if (!headerValue || /\{[^}]+\}/.test(headerValue)) return "";
  return headerValue;
}

function buildHeaderAuth(
  headerName: string,
  required: boolean,
): Plugin["auth"] {
  if (headerName.toLowerCase() === "authorization") {
    return {
      type: "bearer",
      name: headerName,
      in: "header",
      required,
    };
  }

  return {
    type: "apiKey",
    name: headerName,
    in: "header",
    required,
  };
}

function normalizeRemoteHeaders(
  remote: Record<string, unknown>,
): Pick<NormalizedMcpRemote, "auth" | "headers"> | null {
  const rawHeaders = Array.isArray(remote.headers) ? remote.headers : [];
  const headers: Record<string, string> = {};
  let auth: Plugin["auth"] | undefined;

  for (const rawHeader of rawHeaders) {
    if (!isRecord(rawHeader)) continue;

    const name = normalizeHeaderName(rawHeader.name);
    if (!name) continue;

    const staticValue = normalizeStaticHeaderValue(rawHeader.value);
    const required = rawHeader.isRequired === true;
    const dynamicOrSecret =
      rawHeader.isSecret === true ||
      (!staticValue && required) ||
      (typeof rawHeader.value === "string" &&
        /\{[^}]+\}/.test(rawHeader.value));

    if (staticValue && !rawHeader.isSecret) {
      headers[name] = staticValue;
      continue;
    }

    if (!dynamicOrSecret) continue;

    if (auth) {
      return null;
    }

    auth = buildHeaderAuth(name, required);
  }

  return {
    ...(auth ? { auth } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function getRemoteEndpoint(
  server: Record<string, unknown>,
): NormalizedMcpRemote | null {
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];

  for (const preferredTransport of [
    "streamable-http",
    "sse",
  ] as const satisfies readonly McpTransport[]) {
    for (const remote of remotes) {
      if (!isRecord(remote)) continue;

      const transport =
        trimString(remote.type, 80) || trimString(remote.transport, 80);
      if (transport !== preferredTransport) continue;

      const rawUrl = trimString(
        remote.url,
        MARKET_LIMITS.maxPluginManifestUrlChars,
      );
      if (!rawUrl || hasUnresolvedUrlVariables(rawUrl, remote)) continue;

      const serverUrl = normalizeHttpUrl(rawUrl);
      if (!serverUrl) continue;

      const headerMetadata = normalizeRemoteHeaders(remote);
      if (!headerMetadata) continue;

      return {
        transport: preferredTransport,
        serverUrl,
        ...headerMetadata,
      };
    }
  }

  return null;
}

function getExternalDocsUrl(server: Record<string, unknown>): string {
  const repository = isRecord(server.repository) ? server.repository : null;
  return (
    normalizeWebUrl(server.homepage) ||
    normalizeWebUrl(server.websiteUrl) ||
    normalizeWebUrl(repository?.url) ||
    normalizeWebUrl(server.repositoryUrl)
  );
}

export function normalizeMcpRegistryServers(
  value: unknown,
  options: McpRegistryListOptions = {},
): Plugin[] {
  const maxServers = Math.max(
    1,
    Math.min(
      options.maxServers || MARKET_LIMITS.maxPlugins,
      MARKET_LIMITS.maxPlugins,
    ),
  );
  const rawServers =
    isRecord(value) && Array.isArray(value.servers)
      ? value.servers
      : Array.isArray(value)
        ? value
        : [];

  const plugins: Plugin[] = [];
  const seen = new Set<string>();

  for (const rawServer of rawServers) {
    const server = getServerEntry(rawServer);
    if (!server) continue;

    const serverName = trimString(
      server.name,
      MARKET_LIMITS.maxPluginTitleChars,
    );
    if (!serverName) continue;

    const remote = getRemoteEndpoint(server);
    if (!remote) continue;

    const serverVersion =
      trimString(server.version, MARKET_LIMITS.maxAgentCreatedAtChars) ||
      trimString(server.latestVersion, MARKET_LIMITS.maxAgentCreatedAtChars) ||
      "latest";
    const id = `mcp:${serverName}:${serverVersion}`;
    if (seen.has(id)) continue;

    const encodedName = encodeURIComponent(serverName);
    const encodedVersion = encodeURIComponent(serverVersion);

    plugins.push({
      id,
      source: "mcp",
      title: serverName,
      description:
        trimString(
          server.description,
          MARKET_LIMITS.maxPluginDescriptionChars,
        ) || "No description provided",
      logoUrl:
        normalizeWebUrl(server.iconUrl) ||
        normalizeWebUrl(server.logoUrl) ||
        DEFAULT_MCP_SERVER_LOGO_URL,
      manifestUrl: `${MCP_REGISTRY_BASE_URL}/servers/${encodedName}/versions/${encodedVersion}`,
      externalDocsUrl: getExternalDocsUrl(server) || undefined,
      functions: [],
      category: "MCP",
      categories: ["MCP"],
      auth: remote.auth || { type: "none", required: false },
      mcp: {
        transport: remote.transport,
        serverUrl: remote.serverUrl,
        serverName,
        serverVersion,
        ...(remote.headers ? { headers: remote.headers } : {}),
        toolNameMap: {},
      },
    });
    seen.add(id);

    if (plugins.length >= maxServers) break;
  }

  return plugins;
}

export function normalizeMcpRegistryServer(value: unknown): Plugin | null {
  return normalizeMcpRegistryServers([value], { maxServers: 1 })[0] || null;
}
