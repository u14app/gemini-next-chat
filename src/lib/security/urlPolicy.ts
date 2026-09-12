import type { EncryptedSecretEnvelope } from "../byok/shared";
import type { ServerDefaultProviderSource } from "../defaultConfig/shared";
import type { ProviderType } from "@/types";
import {
  getOutboundPolicyProfile,
  type OutboundPolicyProfile,
} from "./deployment";
import {
  ANTHROPIC_PROVIDER_TYPE,
  GOOGLE_PROVIDER_TYPE,
  OPENAI_COMPATIBLE_PROVIDER_TYPE,
  OPENAI_PROVIDER_TYPE,
  normalizeProviderType,
} from "../providers/providerTypes";

export type OutboundContext =
  | "provider"
  | "search"
  | "rag"
  | "plugin"
  | "pluginManifest"
  | "mcp"
  | "docs"
  | "voice"
  | "agent"
  | "webFetch"
  | "metadata"
  | "image"
  | "sync"
  | "sharedStore";

export interface SafeUrlPolicy {
  context: OutboundContext;
  allowedProtocols?: Array<"https:" | "http:">;
  allowedHosts?: string[];
  maxRedirects?: number;
  requireDnsResolution?: boolean;
  requirePublicAddress?: boolean;
  profile?: OutboundPolicyProfile;
}

export interface ValidatedOutboundRequest {
  url: URL;
  policy: SafeUrlPolicy;
  hostname: string;
  protocol: string;
}

export interface ProviderRuntimeConfig {
  type: ProviderType;
  source?: ServerDefaultProviderSource;
  apiKey?: string;
  apiKeySecret?: EncryptedSecretEnvelope;
  baseUrl?: string;
  name?: string;
}

export const ANTHROPIC_API_VERSION_HEADER = "2023-06-01";

const API_VERSION_SEGMENT_PATTERN = /^v\d+[a-z]*$/i;
const DEFAULT_PROVIDER_API = {
  [OPENAI_COMPATIBLE_PROVIDER_TYPE]: {
    baseUrl: "https://api.openai.com",
    version: "v1",
    chatPath: "chat/completions",
  },
  [OPENAI_PROVIDER_TYPE]: {
    baseUrl: "https://api.openai.com",
    version: "v1",
    chatPath: "responses",
  },
  [ANTHROPIC_PROVIDER_TYPE]: {
    baseUrl: "https://api.anthropic.com",
    version: "v1",
    chatPath: "messages",
  },
  [GOOGLE_PROVIDER_TYPE]: {
    baseUrl: "https://generativelanguage.googleapis.com",
    version: "v1beta",
    chatPath: "models",
  },
} as const satisfies Record<
  ProviderType,
  {
    baseUrl: string;
    version: string;
    chatPath: string;
  }
>;

function trimBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();
  if (normalized.endsWith("#")) normalized = normalized.slice(0, -1);
  return normalized.replace(/\/+$/, "");
}

function getVersionedProviderBase(
  baseUrl: string | undefined,
  providerType: ProviderRuntimeConfig["type"] | string,
) {
  const type = normalizeProviderType(providerType);
  const defaults = DEFAULT_PROVIDER_API[type];
  const rawBaseUrl =
    !baseUrl || baseUrl === "default" ? defaults.baseUrl : trimBaseUrl(baseUrl);
  const parsed = new URL(rawBaseUrl);
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const versionIndex = pathSegments.findIndex((segment) =>
    API_VERSION_SEGMENT_PATTERN.test(segment),
  );

  if (versionIndex !== -1) {
    const apiVersion = pathSegments[versionIndex];
    const rootSegments = pathSegments.slice(0, versionIndex);
    const root = new URL(parsed.toString());
    root.pathname = rootSegments.length ? `/${rootSegments.join("/")}` : "";
    root.search = "";
    root.hash = "";

    return {
      type,
      apiVersion,
      baseUrl: trimBaseUrl(root.toString()),
      versionedBaseUrl: trimBaseUrl(parsed.toString()),
    };
  }

  const root = trimBaseUrl(parsed.toString());
  return {
    type,
    apiVersion: defaults.version,
    baseUrl: root,
    versionedBaseUrl: `${root}/${defaults.version}`,
  };
}

export function normalizeProviderBaseUrl(
  baseUrl: string | undefined,
  providerType: ProviderRuntimeConfig["type"] | string,
): string {
  return getVersionedProviderBase(baseUrl, providerType).versionedBaseUrl;
}

export function getProviderGoogleSdkOptions(baseUrl: string | undefined): {
  baseUrl: string;
  apiVersion: string;
} {
  const resolved = getVersionedProviderBase(baseUrl, GOOGLE_PROVIDER_TYPE);
  return {
    baseUrl: resolved.baseUrl,
    apiVersion: resolved.apiVersion,
  };
}

export function getProviderAnthropicSdkBaseUrl(
  baseUrl: string | undefined,
): string {
  return getVersionedProviderBase(baseUrl, ANTHROPIC_PROVIDER_TYPE).baseUrl;
}

export function getProviderChatUrl(
  baseUrl: string | undefined,
  providerType: ProviderRuntimeConfig["type"],
): string {
  const type = normalizeProviderType(providerType);
  const normalized = normalizeProviderBaseUrl(baseUrl, type);
  return `${normalized}/${DEFAULT_PROVIDER_API[type].chatPath}`;
}

export function getProviderModelsUrl(
  baseUrl: string | undefined,
  providerType: ProviderRuntimeConfig["type"],
): string {
  const type = normalizeProviderType(providerType);
  const normalized = normalizeProviderBaseUrl(baseUrl, type);
  return `${normalized}/models`;
}

export function getProviderApiKey(provider: ProviderRuntimeConfig): string {
  return provider.apiKey?.trim() || "";
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const key of parsed.searchParams.keys()) {
      if (/key|token|secret|auth|password/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function isLocalhostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost");
}

function normalizeIpAddress(address: string): string {
  return address.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function parseIpv4Parts(input: string): number[] | null {
  const parts = input.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
}

function ipv4ToNumber(parts: number[]): number {
  return parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
}

function isIpv4InCidr(parts: number[], base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(parts) & mask) === (base & mask);
}

function parseIpv4MappedIpv6(value: string): number[] | null {
  const dottedMatch = value.match(
    /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/,
  );
  if (dottedMatch) return parseIpv4Parts(dottedMatch[1]);

  const hexadecimalMatch = value.match(
    /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (!hexadecimalMatch) return null;

  const high = Number.parseInt(hexadecimalMatch[1], 16);
  const low = Number.parseInt(hexadecimalMatch[2], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

/**
 * Literal IP ranges that are safe targets for an explicit browser-to-LAN
 * direct call. Hostnames are intentionally excluded to prevent DNS aliases
 * from widening the HTTP allowlist.
 */
export function isLocalNetworkIpAddress(address: string): boolean {
  const value = normalizeIpAddress(address);
  const mappedIpv4 = parseIpv4MappedIpv6(value);
  const ipv4 = mappedIpv4 || parseIpv4Parts(value);
  if (ipv4) {
    const cidrs: Array<[number, number]> = [
      [0x0a000000, 8],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0a80000, 16],
    ];
    return cidrs.some(([base, prefix]) => isIpv4InCidr(ipv4, base, prefix));
  }

  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (!value.includes(":")) return false;

  const firstSegment = Number.parseInt(value.split(":", 1)[0], 16);
  if (!Number.isFinite(firstSegment)) return false;
  return (
    (firstSegment & 0xfe00) === 0xfc00 || (firstSegment & 0xffc0) === 0xfe80
  );
}

/** RFC 2544 benchmarking range commonly used by local Fake-IP DNS proxies. */
export function isBenchmarkingIpAddress(address: string): boolean {
  const value = normalizeIpAddress(address);
  const ipv4 = parseIpv4MappedIpv6(value) || parseIpv4Parts(value);
  return Boolean(ipv4 && isIpv4InCidr(ipv4, 0xc6120000, 15));
}

export function isPrivateIpAddress(address: string): boolean {
  const value = normalizeIpAddress(address);

  const isNonPublicIpv4 = (input: string) => {
    const parts = parseIpv4Parts(input);
    if (!parts) return false;

    const cidrs: Array<[number, number]> = [
      [0x00000000, 8],
      [0x0a000000, 8],
      [0x64400000, 10],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0000000, 24],
      [0xc0000200, 24],
      [0xc0586300, 24],
      [0xc0a80000, 16],
      [0xc6120000, 15],
      [0xc6336400, 24],
      [0xcb007100, 24],
      [0xe0000000, 4],
      [0xf0000000, 4],
    ];

    return cidrs.some(([base, prefix]) => isIpv4InCidr(parts, base, prefix));
  };

  if (value === "::1" || value === "0:0:0:0:0:0:0:1" || value === "0.0.0.0") {
    return true;
  }

  if (value.includes(":")) {
    const ipv4Mapped = parseIpv4MappedIpv6(value);
    if (ipv4Mapped) return isNonPublicIpv4(ipv4Mapped.join("."));

    return (
      value === "::" ||
      value.startsWith("0:") ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb") ||
      value.startsWith("fe80:") ||
      value.startsWith("ff") ||
      value.startsWith("2001:db8") ||
      value.startsWith("2001:0:") ||
      value.startsWith("2002:")
    );
  }

  return isNonPublicIpv4(value);
}

export function getSafeUrlPolicy(context: OutboundContext): SafeUrlPolicy {
  const profile = getOutboundPolicyProfile();

  switch (context) {
    case "provider":
    case "rag":
    case "search":
    case "sync":
      return {
        context,
        allowedProtocols: ["https:", "http:"],
        profile,
      };
    case "mcp":
    case "pluginManifest":
    case "plugin":
      return {
        context,
        allowedProtocols: ["https:", "http:"],
        profile,
      };
    case "docs":
      return {
        context,
        allowedProtocols: ["https:"],
        allowedHosts: [
          "api.cloud.llamaindex.ai",
          "mineru.net",
          "oss-mineru.openxlab.org.cn",
          "mineru.oss-cn-shanghai.aliyuncs.com",
          "cdn-mineru.openxlab.org.cn",
        ],
        profile,
      };
    case "voice":
      return {
        context,
        allowedProtocols: ["https:"],
        allowedHosts: ["api.elevenlabs.io", "api.xiaomimimo.com"],
        profile,
      };
    case "agent":
      return {
        context,
        allowedProtocols: ["https:"],
        allowedHosts: ["registry.npmmirror.com"],
        profile,
      };
    case "webFetch":
      // Arbitrary model-chosen URLs. No host allowlist is possible, so the
      // private-range and DNS checks are the whole defence here.
      return {
        context,
        allowedProtocols: ["https:", "http:"],
        requireDnsResolution: true,
        requirePublicAddress: true,
        maxRedirects: 3,
        profile,
      };
    case "metadata":
      return {
        context,
        allowedProtocols: ["https:"],
        allowedHosts: ["basellm.github.io"],
        profile,
      };
    case "image":
      return {
        context,
        allowedProtocols: profile.allowLocalNetworkProxy
          ? ["https:", "http:"]
          : ["https:"],
        requireDnsResolution:
          profile.mode === "hosted" && !profile.allowLocalNetworkProxy,
        profile,
      };
    case "sharedStore":
    default:
      return {
        context,
        allowedProtocols: ["https:"],
        profile,
      };
  }
}

export function validateOutboundUrl(
  value: string | URL,
  policy: SafeUrlPolicy,
): ValidatedOutboundRequest {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new Error(`Invalid outbound URL for ${policy.context}`);
  }

  if (url.username || url.password) {
    throw new Error("Outbound URLs must not include embedded credentials");
  }

  const allowedProtocols = policy.allowedProtocols || ["https:"];
  if (!allowedProtocols.includes(url.protocol as "https:" | "http:")) {
    throw new Error(`Protocol ${url.protocol} is not allowed`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    policy.requirePublicAddress &&
    (isLocalhostName(hostname) || isPrivateIpAddress(hostname))
  ) {
    throw new Error("Outbound requests must target public network addresses");
  }

  if (policy.allowedHosts?.length) {
    const isAllowedHost = policy.allowedHosts.some((host) => {
      const expected = host.toLowerCase();
      return hostname === expected || hostname.endsWith(`.${expected}`);
    });
    if (!isAllowedHost) {
      throw new Error(`Host ${hostname} is not trusted for ${policy.context}`);
    }
  }

  return {
    url,
    policy,
    hostname,
    protocol: url.protocol,
  };
}
