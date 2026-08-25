import { describe, expect, it } from "vitest";
import { resolveEffectiveChatContext } from "../lib/chat/effectiveChatContext";

describe("effective chat context", () => {
  it("filters unavailable session plugins while surfacing missing authentication", () => {
    const context = resolveEffectiveChatContext({
      session: {
        id: "session-1",
        title: "New Chat",
        updatedAt: 1,
        model: "openai:gpt-test",
        messageCount: 0,
        systemInstruction: "Answer in project voice.",
        config: {
          activePlugins: ["needs-auth", "free-plugin"],
          activeSkills: ["session-skill", "missing-skill", "session-skill", ""],
        },
      },
      workspace: {
        id: "workspace-1",
        name: "Workspace",
        color: "blue",
        systemPrompt: "Workspace context.",
        knowledgeCollectionIds: ["kb-1"],
        createdAt: 1,
        files: [
          { id: "file-1", fileName: "brief.txt", mimeType: "text/plain" },
        ],
        activeSkills: ["workspace-skill"],
      },
      systemPrompt: "Global system prompt.",
      now: new Date("2026-07-01T02:03:04.000Z"),
      selectedModel: "openai:gpt-test",
      provider: { type: "OpenAI Compatible" },
      modelMetadata: {},
      customModelMetadata: {},
      chatConfig: {
        useSearch: true,
        useReasoning: true,
        reasoningMode: "high",
        temperature: 0.7,
        useRAG: true,
      },
      search: {
        provider: "google",
        configs: {},
      },
      rag: {
        enabled: true,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [
        {
          id: "needs-auth",
          title: "Needs Auth",
          description: "",
          logoUrl: "",
          manifestUrl: "",
          functions: [],
          auth: { type: "apiKey" },
        },
        {
          id: "free-plugin",
          title: "Free Plugin",
          description: "",
          logoUrl: "",
          manifestUrl: "",
          functions: [],
          auth: { type: "none" },
        },
      ],
      installedSkills: [
        { id: "session-skill" },
        { id: "workspace-skill" },
      ] as any,
      pluginConfigs: {},
      activePlugins: ["free-plugin"],
    });

    expect(context.workspaceFiles).toHaveLength(1);
    expect(context.workspaceKnowledgeCollectionIds).toEqual(["kb-1"]);
    expect(context.systemInstruction).toContain("Global system prompt.");
    expect(context.systemInstruction).toContain("Answer in project voice.");
    expect(context.systemInstruction).toContain("Workspace context.");
    expect(context.systemInstruction).toContain("<diagram-rendering>");
    expect(context.systemInstruction).toContain("Current date and time");
    expect(context.systemInstruction).toContain("2026-07-01T02:03:04.000Z");
    expect(context.activePluginIds).toEqual(["free-plugin"]);
    expect(context.activeSkillIds).toEqual(["session-skill"]);
    const statusCodes = context.capabilityStatuses.map((status) => status.code);
    expect(statusCodes).toEqual(
      expect.arrayContaining(["search_unavailable", "rag_unavailable"]),
    );
    expect(statusCodes).toContain("plugin_auth_missing");
  });

  it("uses workspace skills when the session does not override them", () => {
    const context = resolveEffectiveChatContext({
      session: {
        id: "session-1",
        title: "New Chat",
        updatedAt: 1,
        model: "openai:gpt-test",
        messageCount: 0,
      },
      workspace: {
        id: "workspace-1",
        name: "Workspace",
        color: "blue",
        knowledgeCollectionIds: [],
        createdAt: 1,
        files: [],
        activeSkills: ["workspace-skill", "workspace-skill"],
      },
      selectedModel: "openai:gpt-test",
      provider: { type: "OpenAI" },
      modelMetadata: {},
      customModelMetadata: {},
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off",
        temperature: 0.7,
        useRAG: false,
      },
      search: {
        provider: "google",
        configs: {},
      },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      pluginConfigs: {},
      activePlugins: [],
    });

    expect(context.activeSkillIds).toEqual(["workspace-skill"]);
  });

  it("keeps manual Profile Skills discoverable to people but unavailable to Agent auto-use", () => {
    const context = resolveEffectiveChatContext({
      session: {
        id: "session-1",
        title: "New Chat",
        updatedAt: 1,
        model: "openai:gpt-test",
        messageCount: 0,
        config: {
          activeSkills: ["manual-skill", "auto-skill"],
          skillPolicies: [
            { skillId: "manual-skill", mode: "manual" },
            { skillId: "auto-skill", mode: "auto" },
            { skillId: "disabled-skill", mode: "disabled" },
          ],
        },
      },
      selectedModel: "openai:gpt-test",
      provider: { type: "OpenAI" },
      modelMetadata: {},
      customModelMetadata: {},
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off",
        temperature: 0.7,
        useRAG: false,
      },
      search: { provider: "google", configs: {} },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      installedSkills: [
        { id: "manual-skill" },
        { id: "auto-skill" },
        { id: "disabled-skill" },
      ] as any,
      pluginConfigs: {},
      activePlugins: [],
    });

    expect(context.activeSkillIds).toEqual(["manual-skill", "auto-skill"]);
    expect(context.agentSkillIds).toEqual(["auto-skill"]);
  });

  it("appends safe inline HTML guidance when the visual prompt setting is enabled", () => {
    const context = resolveEffectiveChatContext({
      systemPrompt: "Global system prompt.",
      enableHtmlVisualPrompt: true,
      selectedModel: "openai:gpt-test",
      provider: { type: "OpenAI" },
      modelMetadata: {},
      customModelMetadata: {},
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off",
        temperature: 0.7,
        useRAG: false,
      },
      search: {
        provider: "google",
        configs: {},
      },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      pluginConfigs: {},
      activePlugins: [],
    });

    expect(context.systemInstruction).toContain("Global system prompt.");
    expect(context.systemInstruction).toContain("<format");
    expect(context.systemInstruction).toContain("<html-visual>");
    expect(context.systemInstruction).toContain(
      "actively use safe inline HTML",
    );
    expect(context.systemInstruction).toContain("raw HTML");
    expect(context.systemInstruction).toContain("<diagram-visual-polish>");
    expect(context.systemInstruction).toContain(
      "Do not wrap HTML visual fragments in code fences",
    );
    expect(context.systemInstruction).toContain("Do not use class attributes");
    expect(context.systemInstruction).toContain(
      "Do not output full HTML documents",
    );
    expect(context.systemInstruction).toContain(
      "Use light or pale backgrounds with dark, readable foreground text",
    );
    expect(context.systemInstruction).toContain(
      "Aim for at least a 4.5:1 foreground/background contrast ratio",
    );
    expect(context.systemInstruction).toContain(
      "Never use surface, border, pastel, or translucent color variables as text color",
    );
  });

  it("does not inject HTML visual guidance when the setting is disabled", () => {
    const context = resolveEffectiveChatContext({
      systemPrompt: "Global system prompt.",
      enableHtmlVisualPrompt: false,
      selectedModel: "openai:gpt-test",
      provider: { type: "OpenAI" },
      modelMetadata: {},
      customModelMetadata: {},
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off",
        temperature: 0.7,
        useRAG: false,
      },
      search: {
        provider: "google",
        configs: {},
      },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      pluginConfigs: {},
      activePlugins: [],
    });

    expect(context.systemInstruction).not.toContain("<html-visual>");
    expect(context.systemInstruction).toContain("<diagram-rendering>");
    expect(context.systemInstruction).not.toContain("<diagram-visual-polish>");
    expect(context.systemInstruction).not.toContain("<format_instructions");
  });

  it("keeps default personalization silent and appends selected personality instructions", () => {
    const baseOptions = {
      systemPrompt: "Global system prompt.",
      selectedModel: "openai:gpt-test",
      provider: { type: "OpenAI" as const },
      modelMetadata: {},
      customModelMetadata: {},
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off" as const,
        temperature: 0.7,
        useRAG: false,
      },
      search: {
        provider: "google" as const,
        configs: {},
      },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru" as const,
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      pluginConfigs: {},
      activePlugins: [],
    };

    const defaultContext = resolveEffectiveChatContext({
      ...baseOptions,
      personality: "default",
    });
    const personalizedContext = resolveEffectiveChatContext({
      ...baseOptions,
      personality: "efficient",
    });

    expect(defaultContext.systemInstruction).not.toContain(
      "<response-personalization>",
    );
    expect(personalizedContext.systemInstruction).toContain(
      "<response-personalization>",
    );
    expect(personalizedContext.systemInstruction).toContain(
      "Be concise, direct, and practical",
    );
    expect(personalizedContext.systemInstruction).toContain(
      "Global system prompt.",
    );
  });

  it("derives effective Agent mode from the model tool-call capability", () => {
    const baseOptions = {
      selectedModel: "openai:gpt-tools",
      provider: { type: "OpenAI" as const },
      modelMetadata: {
        "gpt-tools": {
          id: "gpt-tools",
          name: "GPT Tools",
          tool_call: true,
        },
      },
      customModelMetadata: {},
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        useAgentMode: true,
        reasoningMode: "off" as const,
        temperature: 0.7,
        useRAG: false,
      },
      search: {
        provider: "google" as const,
        configs: {},
      },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru" as const,
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      pluginConfigs: {},
      activePlugins: [],
    };

    const supported = resolveEffectiveChatContext(baseOptions);
    const unsupported = resolveEffectiveChatContext({
      ...baseOptions,
      modelMetadata: {
        "gpt-tools": {
          ...baseOptions.modelMetadata["gpt-tools"],
          tool_call: false,
        },
      },
    });

    expect(supported.modelCapabilities.toolCall).toBe(true);
    expect(supported.agentModeEnabled).toBe(true);
    expect(unsupported.modelCapabilities.toolCall).toBe(false);
    expect(unsupported.agentModeEnabled).toBe(false);
  });

  it("exposes Research and shared orchestration without enabling Agent", () => {
    const context = resolveEffectiveChatContext({
      selectedModel: "openai:gpt-tools",
      provider: { type: "OpenAI" },
      modelMetadata: {
        "gpt-tools": {
          id: "gpt-tools",
          name: "GPT Tools",
          tool_call: true,
        },
      },
      customModelMetadata: {},
      chatConfig: {
        chatMode: "research",
        useSearch: false,
        useReasoning: false,
        useAgentMode: true,
        useDeepResearch: true,
        reasoningMode: "off",
        temperature: 0.7,
        useRAG: false,
      },
      search: { provider: "google", configs: {} },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
      },
      installedPlugins: [],
      pluginConfigs: {},
      activePlugins: [],
    });

    expect(context).toMatchObject({
      agentModeEnabled: false,
      researchModeEnabled: true,
      orchestratedModeEnabled: true,
    });
  });
});
