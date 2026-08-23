import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("assistant Agent profile composition", () => {
  const source = read("src/components/assistant/AssistantHub.tsx");

  it("keeps legacy assistants chat-only and sanitizes opt-in profiles", () => {
    expect(source).toContain("DEFAULT_AGENT_PROFILE");
    expect(source).toContain("normalizeAgentProfile(agent?.profile)");
    expect(source).toContain("normalizeAgentProfile(agentProfile)");
    expect(source).toContain(
      "sanitizedProfile ? { profile: sanitizedProfile }",
    );
    expect(source).toContain("checked={isAgentEnabled}");
  });

  it("exposes the requested runtime and capability controls", () => {
    for (const value of ["permissive", "balanced", "strict"]) {
      expect(source).toContain(`<option value="${value}">`);
    }

    for (const value of ["auto", "manual", "disabled"]) {
      expect(source).toContain(`<option value="${value}">`);
    }

    expect(source).toContain("assistant-agent-preferred-model");
    expect(source).toContain("assistant-agent-search");
    expect(source).toContain("assistant-agent-max-rounds");
    expect(source).toContain("assistant-agent-max-calls");
    expect(source).toContain("agentPluginAllowlist");
    expect(source).toContain("agentSkillPolicy");
  });

  it("shows Agent state and verifiable missing dependencies on cards", () => {
    expect(source).toContain("getMissingAgentProfileDependencies");
    expect(source).toContain("agent.profile?.runtime.agentEnabled");
    expect(source).toContain('t("agentBadge")');
    expect(source).toContain('t("agentMissingDependencies"');
  });

  it("keeps native selects inside the editor focus trap", () => {
    expect(source).toContain("select:not([disabled])");
  });

  it.each(["en", "zh", "ja"])(
    "ships complete %s Assistant translations",
    (locale) => {
      const messages = JSON.parse(
        read(`src/i18n/locales/${locale}/Assistant.json`),
      ) as Record<string, string>;

      for (const key of [
        "agentConfiguration",
        "enableAgent",
        "agentApprovalMode",
        "agentPreferredModel",
        "agentSearch",
        "agentRunLimits",
        "agentPluginAllowlist",
        "agentSkillPolicy",
        "agentBadge",
        "agentMissingDependencies",
        "selectAgentAssistantAria",
        "selectAgentAssistantMissingAria",
      ]) {
        expect(messages[key], `${locale}.${key}`).toBeTruthy();
      }
    },
  );
});
