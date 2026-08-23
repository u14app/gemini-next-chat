import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PROFILE,
  getMissingAgentProfileDependencies,
  normalizeAgentProfile,
  resolveAgentProfile,
} from "../lib/assistant/profile";
import { normalizeMarketAgent } from "../lib/market/agents";

describe("AgentProfileV2", () => {
  it("keeps legacy assistants chat-only", () => {
    expect(resolveAgentProfile()).toEqual(DEFAULT_AGENT_PROFILE);
  });

  it("applies global to turn precedence and merges skill policies by id", () => {
    const resolved = resolveAgentProfile(
      {
        runtime: { agentEnabled: true, approvalMode: "balanced" },
        capabilities: {
          pluginIds: ["global"],
          skillPolicies: [{ skillId: "research", mode: "auto" }],
        },
      },
      {
        capabilities: {
          pluginIds: ["profile"],
          skillPolicies: [{ skillId: "research", mode: "manual" }],
        },
      },
      { runtime: { approvalMode: "strict" } },
    );

    expect(resolved.runtime).toMatchObject({
      agentEnabled: true,
      approvalMode: "strict",
    });
    expect(resolved.capabilities.pluginIds).toEqual(["profile"]);
    expect(resolved.capabilities.skillPolicies).toEqual([
      { skillId: "research", mode: "manual" },
    ]);
  });

  it("sanitizes untrusted profiles and drops secret-shaped unknown fields", () => {
    const profile = normalizeAgentProfile({
      schemaVersion: 2,
      runtime: {
        agentEnabled: true,
        approvalMode: "permissive",
        apiKey: "must-not-survive",
      },
      capabilities: {
        pluginIds: ["calendar", "calendar", 42],
        memoryScopes: ["agent", "invalid"],
        toolApprovals: [{ functionName: "danger" }],
      },
      runHistory: [{ content: "private" }],
    });

    expect(profile).toEqual({
      schemaVersion: 2,
      runtime: { agentEnabled: true, approvalMode: "permissive" },
      capabilities: {
        skillPolicies: [],
        pluginIds: ["calendar"],
        toolIds: [],
        knowledgeCollectionIds: [],
        memoryScopes: ["agent"],
      },
    });
    expect(JSON.stringify(profile)).not.toContain("must-not-survive");
  });

  it("normalizes a market profile without importing undeclared state", () => {
    const agent = normalizeMarketAgent({
      identifier: "research-agent",
      meta: { title: "Research", description: "", tags: [] },
      profile: {
        schemaVersion: 2,
        runtime: { agentEnabled: true, approvalMode: "balanced" },
        capabilities: { pluginIds: ["web"] },
        approvals: [{ id: "hidden" }],
      },
    });

    expect(agent?.profile?.runtime.agentEnabled).toBe(true);
    expect(JSON.stringify(agent?.profile)).not.toContain("hidden");
  });

  it("preserves an explicit empty Memory scope list", () => {
    expect(
      normalizeAgentProfile({
        schemaVersion: 2,
        runtime: { agentEnabled: true, approvalMode: "permissive" },
        capabilities: { memoryScopes: [] },
      })?.capabilities.memoryScopes,
    ).toEqual([]);
  });

  it("reports missing declared dependencies", () => {
    const profile = resolveAgentProfile({
      capabilities: {
        pluginIds: ["web", "calendar"],
        toolIds: ["fetch_url"],
        knowledgeCollectionIds: ["kb-1"],
        skillPolicies: [
          { skillId: "research", mode: "auto" },
          { skillId: "disabled", mode: "disabled" },
        ],
      },
    });

    expect(
      getMissingAgentProfileDependencies(profile, {
        pluginIds: ["web"],
        toolIds: [],
        skillIds: [],
        knowledgeCollectionIds: ["kb-1"],
      }),
    ).toEqual({
      skillIds: ["research"],
      pluginIds: ["calendar"],
      toolIds: ["fetch_url"],
      knowledgeCollectionIds: [],
    });
  });
});
