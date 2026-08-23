import type { LobeAgent } from "@/types";
import { MARKET_LIMITS } from "@/config/limits";
import { normalizeAgentProfile } from "@/lib/assistant/profile";

const AGENT_IDENTIFIER_RE = /^[A-Za-z0-9._-]+$/;

type NormalizedAgentDetail = LobeAgent & {
  config?: {
    systemRole?: string;
  };
};

function trimString(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function normalizeAgentTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const tag = trimString(item, MARKET_LIMITS.maxAgentTagChars);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;

    tags.push(tag);
    seen.add(key);
    if (tags.length >= MARKET_LIMITS.maxAgentTags) break;
  }

  return tags;
}

export function normalizeMarketAgent(value: unknown): LobeAgent | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const meta =
    raw.meta && typeof raw.meta === "object"
      ? (raw.meta as Record<string, unknown>)
      : {};

  const identifier = trimString(
    raw.identifier,
    MARKET_LIMITS.maxAgentIdentifierChars,
  );
  if (!identifier || !AGENT_IDENTIFIER_RE.test(identifier)) return null;

  const title =
    trimString(meta.title, MARKET_LIMITS.maxAgentTitleChars) || identifier;
  const profile = normalizeAgentProfile(raw.profile);

  return {
    identifier,
    meta: {
      avatar:
        trimString(meta.avatar, MARKET_LIMITS.maxAgentAvatarChars) ||
        "\u{1F916}",
      description: trimString(
        meta.description,
        MARKET_LIMITS.maxAgentDescriptionChars,
      ),
      tags: normalizeAgentTags(meta.tags),
      title,
      category:
        trimString(meta.category, MARKET_LIMITS.maxAgentCategoryChars) ||
        "General",
    },
    createdAt: trimString(raw.createdAt, MARKET_LIMITS.maxAgentCreatedAtChars),
    homepage: trimString(raw.homepage, MARKET_LIMITS.maxAgentHomepageChars),
    author: trimString(raw.author, MARKET_LIMITS.maxAgentAuthorChars),
    ...(profile ? { profile } : {}),
  };
}

export function normalizeLocalAgent(value: unknown): LobeAgent | null {
  const agent = normalizeMarketAgent(value);
  if (!agent || !value || typeof value !== "object") return agent;

  const raw = value as Record<string, unknown>;
  const meta =
    raw.meta && typeof raw.meta === "object"
      ? (raw.meta as Record<string, unknown>)
      : {};

  const profile = normalizeAgentProfile(raw.profile) || agent.profile;

  return {
    ...agent,
    meta: {
      ...agent.meta,
      systemRole: trimString(
        meta.systemRole,
        MARKET_LIMITS.maxAgentSystemRoleChars,
      ),
    },
    isCustom: raw.isCustom === true ? true : undefined,
    ...(profile ? { profile } : {}),
  };
}

export function normalizeAgentDetail(
  value: unknown,
  identifier: string,
): NormalizedAgentDetail | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const meta =
    raw.meta && typeof raw.meta === "object"
      ? (raw.meta as Record<string, unknown>)
      : {};
  const config =
    raw.config && typeof raw.config === "object"
      ? (raw.config as Record<string, unknown>)
      : {};
  const systemRole =
    typeof config.systemRole === "string" ? config.systemRole : meta.systemRole;
  const agent = normalizeLocalAgent({
    ...raw,
    identifier,
    meta: {
      ...meta,
      systemRole,
    },
  });

  if (!agent) return null;

  return {
    ...agent,
    config: agent.meta.systemRole
      ? { systemRole: agent.meta.systemRole }
      : undefined,
  };
}

export function normalizeMarketAgents(value: unknown): LobeAgent[] {
  if (!Array.isArray(value)) return [];

  const agents: LobeAgent[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const agent = normalizeMarketAgent(item);
    if (!agent || seen.has(agent.identifier)) continue;

    agents.push(agent);
    seen.add(agent.identifier);
    if (agents.length >= MARKET_LIMITS.maxAgents) break;
  }

  return agents;
}

export function normalizeLocalAgents(
  value: unknown,
  maxCount: number,
): LobeAgent[] {
  if (!Array.isArray(value)) return [];

  const agents: LobeAgent[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const agent = normalizeLocalAgent(item);
    if (!agent || seen.has(agent.identifier)) continue;

    agents.push(agent);
    seen.add(agent.identifier);
    if (agents.length >= maxCount) break;
  }

  return agents;
}

export function normalizeAgentOverrides(
  value: unknown,
): Record<string, Partial<LobeAgent>> {
  if (!value || typeof value !== "object") return {};

  const normalized: Record<string, Partial<LobeAgent>> = {};

  for (const [identifier, override] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const raw =
      override && typeof override === "object"
        ? (override as Record<string, unknown>)
        : {};
    const agent = normalizeLocalAgent({
      ...raw,
      identifier,
      meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
    });

    if (!agent) continue;

    normalized[agent.identifier] = agent;
    if (Object.keys(normalized).length >= MARKET_LIMITS.maxUsedAgents) break;
  }

  return normalized;
}
