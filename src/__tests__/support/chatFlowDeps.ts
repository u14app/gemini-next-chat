import { vi } from "vitest";
import type { ChatFlowDeps } from "@/hooks/chatFlowTypes";

/**
 * A fully stubbed `ChatFlowDeps`. Every function is a spy, so a test can
 * assert on what a flow hook did without standing up the real stores.
 * Pass `overrides` for the few fields the test actually cares about.
 */
export function createChatFlowDeps(
  overrides: Partial<ChatFlowDeps> = {},
): ChatFlowDeps {
  const deps = {
    t: ((key: string) => key) as unknown as ChatFlowDeps["t"],
    locale: "en",
    showActionError: vi.fn(),
    syncActiveSessionWithNotice: vi.fn(async () => undefined),

    sessions: [],
    currentSessionId: "session-1",
    activeMessages: [],
    selectedModel: "test-provider/test-model",
    chatConfig: {} as ChatFlowDeps["chatConfig"],
    getCurrentSession: vi.fn(() => undefined),
    createSession: vi.fn(() => "session-1"),
    addMessage: vi.fn(async () => undefined),
    updateMessage: vi.fn(),
    updateMessageContent: vi.fn(),
    addMessageVersion: vi.fn(() => "branch-1"),
    createEditedUserMessageBranch: vi.fn(() => ({
      userMessageId: "user-1",
      modelMessageId: "model-1",
    })),
    switchMessageVersion: vi.fn(),
    selectMessageVersion: vi.fn(),
    deleteMessage: vi.fn(async () => undefined),
    deleteMessageAndSubsequent: vi.fn(async () => undefined),
    setSuggestedQuestions: vi.fn(),
    updateSessionTitle: vi.fn(),
    updateSessionCompression: vi.fn(),
    syncActiveSession: vi.fn(async () => undefined),

    system: {} as ChatFlowDeps["system"],
    modelMetadata: {},
    customModelMetadata: {},
    installedSkills: [],
    skillBundles: [],
    activeSkillBundleIds: [],
    skillAutoSelect: false,
    availableModels: [
      { name: "test-provider/test-model", displayName: "Test Model" },
    ],

    isGenerating: false,
    beginActiveGeneration: vi.fn(() => ({
      runId: 1,
      controller: new AbortController(),
    })),
    isGenerationRunActive: vi.fn(() => true),
    finishActiveGeneration: vi.fn(),
    abortBackgroundPostProcessing: vi.fn(),
    beginBackgroundPostProcessing: vi.fn(() => new AbortController().signal),
    queueMemoryExtraction: vi.fn(),

    createMessageStreamRenderer: vi.fn(() => ({
      schedule: vi.fn(),
      flush: vi.fn(),
      cancel: vi.fn(),
    })),
    activeStreamRenderRef: { current: null },
    activeStreamCheckpointRef: { current: null },
    persistLongTextFilesForMessage: vi.fn(async () => undefined),
    toolConfirmationController: {
      requestConfirmation: vi.fn(),
    },
    messageInputRef: { current: null },

    getEffectiveContextForSession: vi.fn(() => createEffectiveContext()),
    prepareComposerSkillParameters: vi.fn(async () => ({
      skillParameterValues: {},
      skillBundleParameterValues: {},
    })),
    processPromptForModel: vi.fn(async () => ({
      finalText: "prompt",
      finalAttachments: [],
      ragSources: [],
      ragError: undefined,
      knowledgeScope: [],
      userMessage: {
        id: "user-1",
        role: "user",
        content: "prompt",
        timestamp: 0,
      },
      effectiveContext: createEffectiveContext(),
      injectedMemoryIds: [],
    })),
    createAgentToolStreamOptions: vi.fn(() => ({})),
    commitInjectedMemoryContext: vi.fn(),
    skillParameterValuesRef: { current: {} },
    skillBundleParameterValuesRef: { current: {} },
  } as unknown as ChatFlowDeps;

  return { ...deps, ...overrides };
}

function createEffectiveContext() {
  return {
    sessionId: "session-1",
    systemInstruction: "instruction",
    workspaceFiles: [],
    workspaceKnowledgeCollectionIds: [],
    activePluginIds: [],
    activeSkillIds: [],
    modelCapabilities: {
      vision: false,
      attachment: false,
      audio: false,
      reasoning: false,
      toolCall: true,
    },
    agentModeEnabled: false,
    searchCompatibility: { enabled: false, mode: "none" },
    capabilityStatuses: [],
  };
}
