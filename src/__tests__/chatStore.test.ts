import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Message, Session, Workspace } from "../types";
import {
  getActiveMessagePath,
  isSessionMessageTree,
  normalizeSessionMessageTree,
} from "../lib/chat/messageTree";
import { getMessageOutputBlocks } from "../lib/chat/messageOutputBlocks";

const { appDbMock, deleteFromOPFSMock, storedItems } = vi.hoisted(() => {
  const storedItems = new Map<string, unknown>();
  const appDbMock = {
    getItem: vi.fn((key: string) => Promise.resolve(storedItems.get(key))),
    setItem: vi.fn((key: string, value: unknown) => {
      storedItems.set(key, value);
      return Promise.resolve(value);
    }),
    removeItem: vi.fn((key: string) => {
      storedItems.delete(key);
      return Promise.resolve();
    }),
  };
  const deleteFromOPFSMock = vi.fn(() => Promise.resolve());

  return { appDbMock, deleteFromOPFSMock, storedItems };
});

vi.mock("@/utils/opfs", () => ({
  deleteFromOPFS: deleteFromOPFSMock,
}));

vi.mock("../store/storage/storageConfig", () => ({
  appDb: appDbMock,
  getAppDbStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  STORAGE_KEYS: {
    CHAT: "neo-chat-storage",
  },
  STORAGE_VERSION: 2,
}));

const { useChatStore } = await import("../store/core/chatStore");

const makeSession = (id: string): Session => ({
  id,
  title: id,
  updatedAt: 1,
  model: "model",
  pinned: false,
  messageCount: 1,
});

const makeMessage = (id: string, content: string): Message => ({
  id,
  role: "user",
  content,
  timestamp: 1,
});

const makeModelMessage = (id: string, content: string): Message => ({
  id,
  role: "model",
  content,
  timestamp: 1,
  model: "model",
});

const makeAttachment = (id: string, url: string): Attachment => ({
  id,
  fileName: `${id}.txt`,
  mimeType: "text/plain",
  url,
});

const expectStoredActivePath = (sessionId: string, messages: Message[]) => {
  const stored = storedItems.get(`session_messages_${sessionId}`);
  expect(isSessionMessageTree(stored)).toBe(true);
  expect(getActiveMessagePath(stored as any)).toEqual(messages);
};

const makeWorkspace = (id: string, files: Attachment[] = []): Workspace => ({
  id,
  name: id,
  knowledgeCollectionIds: [],
  files,
  createdAt: 1,
});

describe("chat store persistence", () => {
  beforeEach(() => {
    storedItems.clear();
    vi.clearAllMocks();
    appDbMock.getItem.mockImplementation((key: string) =>
      Promise.resolve(storedItems.get(key)),
    );
    appDbMock.setItem.mockImplementation((key: string, value: unknown) => {
      storedItems.set(key, value);
      return Promise.resolve(value);
    });
    appDbMock.removeItem.mockImplementation((key: string) => {
      storedItems.delete(key);
      return Promise.resolve();
    });
    useChatStore.setState({
      _hasHydrated: true,
      sessions: [],
      workspaces: [],
      currentSessionId: null,
      activeMessages: [],
      activeMessageTree: normalizeSessionMessageTree([]),
      isActiveSessionLoading: false,
      pendingSessionId: null,
      activeSessionLoadError: null,
      selectedModel: "model",
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off",
        temperature: 0.7,
      },
    });
  });

  it("starts without a hard-coded selected model", () => {
    expect(useChatStore.getInitialState().selectedModel).toBe("");
  });

  it("clears the deprecated Gemini selected model during migration", async () => {
    const migrate = (useChatStore as any).persist.getOptions().migrate;

    const migrated = await migrate(
      {
        sessions: [],
        workspaces: [],
        currentSessionId: null,
        activeMessages: [],
        selectedModel: "GEMINI:gemini-flash-latest",
        chatConfig: {
          useSearch: false,
          useReasoning: false,
          reasoningMode: "off",
          temperature: 0.7,
        },
      },
      3,
    );

    expect(migrated.selectedModel).toBe("");
  });

  it("reuses an existing default empty chat instead of creating another one", () => {
    const existing = {
      ...makeSession("empty"),
      title: "New Chat",
      messageCount: 0,
    };
    useChatStore.setState({
      sessions: [existing, makeSession("other")],
      currentSessionId: "other",
      activeMessages: [makeMessage("m1", "active")],
      activeMessageTree: normalizeSessionMessageTree([
        makeMessage("m1", "active"),
      ]),
    });

    const sessionId = useChatStore.getState().createSession();

    expect(sessionId).toBe("empty");
    expect(useChatStore.getState().currentSessionId).toBe("empty");
    expect(useChatStore.getState().activeMessages).toEqual([]);
    expect(
      useChatStore.getState().sessions.map((session) => session.id),
    ).toEqual(["empty", "other"]);
    expect(appDbMock.setItem).not.toHaveBeenCalled();
  });

  it("resets Agent mode when reusing a legacy empty chat", () => {
    const existing = {
      ...makeSession("empty"),
      title: "New Chat",
      messageCount: 0,
    };
    useChatStore.setState((state) => ({
      sessions: [existing],
      chatConfig: {
        ...state.chatConfig,
        useAgentMode: true,
      },
    }));

    expect(useChatStore.getState().createSession()).toBe("empty");
    expect(useChatStore.getState().chatConfig.useAgentMode).toBe(false);
  });

  it("resets Agent mode when creating a chat without session config", () => {
    useChatStore.setState((state) => ({
      sessions: [],
      chatConfig: {
        ...state.chatConfig,
        useAgentMode: true,
      },
    }));

    const sessionId = useChatStore.getState().createSession();

    expect(useChatStore.getState().currentSessionId).toBe(sessionId);
    expect(useChatStore.getState().chatConfig.useAgentMode).toBe(false);
  });

  it("resolves Agent mode only from the selected session", async () => {
    useChatStore.setState({
      sessions: [
        {
          ...makeSession("agent"),
          config: { useAgentMode: true },
        },
        makeSession("legacy"),
      ],
    });

    await useChatStore.getState().selectSession("agent");
    expect(useChatStore.getState().chatConfig.useAgentMode).toBe(true);

    await useChatStore.getState().selectSession("legacy");
    expect(useChatStore.getState().chatConfig.useAgentMode).toBe(false);
  });

  it("does not reuse titled or non-empty chats when creating a default chat", () => {
    useChatStore.setState({
      sessions: [
        { ...makeSession("titled"), title: "Manual title", messageCount: 0 },
        { ...makeSession("non-empty"), title: "New Chat", messageCount: 1 },
      ],
    });

    const sessionId = useChatStore.getState().createSession();

    expect(sessionId).not.toBe("titled");
    expect(sessionId).not.toBe("non-empty");
    expect(useChatStore.getState().sessions).toHaveLength(3);
  });

  it("does not write an empty message tree when creating a fresh session", () => {
    const sessionId = useChatStore.getState().createSession();

    expect(sessionId).toEqual(expect.any(String));
    expect(appDbMock.setItem).not.toHaveBeenCalledWith(
      `session_messages_${sessionId}`,
      expect.anything(),
    );
  });

  it("keeps the active session unchanged when the target message tree fails to load", async () => {
    const activeMessage = makeMessage("a1", "session a");
    const activeTree = normalizeSessionMessageTree([activeMessage]);
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "a",
      activeMessages: [activeMessage],
      activeMessageTree: activeTree,
    });
    appDbMock.getItem.mockRejectedValueOnce(new Error("indexeddb failed"));

    await useChatStore.getState().selectSession("b");

    expect(useChatStore.getState()).toMatchObject({
      currentSessionId: "a",
      activeMessages: [activeMessage],
      activeMessageTree: activeTree,
      isActiveSessionLoading: false,
      pendingSessionId: null,
      activeSessionLoadError: "session_load_failed",
    });
  });

  it("commits only the newest session load and keeps the previous session visible while loading", async () => {
    const activeMessage = makeMessage("a1", "session a");
    const bMessage = makeMessage("b1", "session b");
    const cMessage = makeMessage("c1", "session c");
    let resolveB: ((value: Message[]) => void) | undefined;
    let resolveC: ((value: Message[]) => void) | undefined;
    appDbMock.getItem.mockImplementation((key: string) => {
      if (key === "session_messages_b") {
        return new Promise((resolve) => {
          resolveB = resolve;
        });
      }
      if (key === "session_messages_c") {
        return new Promise((resolve) => {
          resolveC = resolve;
        });
      }
      return Promise.resolve(storedItems.get(key));
    });
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b"), makeSession("c")],
      currentSessionId: "a",
      activeMessages: [activeMessage],
      activeMessageTree: normalizeSessionMessageTree([activeMessage]),
    });

    const loadB = useChatStore.getState().selectSession("b");
    expect(useChatStore.getState()).toMatchObject({
      currentSessionId: "a",
      activeMessages: [activeMessage],
      isActiveSessionLoading: true,
      pendingSessionId: "b",
    });

    const loadC = useChatStore.getState().selectSession("c");
    resolveC?.([cMessage]);
    await loadC;
    resolveB?.([bMessage]);
    await loadB;

    expect(useChatStore.getState()).toMatchObject({
      currentSessionId: "c",
      activeMessages: [cMessage],
      isActiveSessionLoading: false,
      pendingSessionId: null,
      activeSessionLoadError: null,
    });
  });

  it("waits for a pending session write before loading that session", async () => {
    const freshMessage = makeMessage("fresh", "freshly persisted");
    const freshTree = normalizeSessionMessageTree([freshMessage]);
    let resolveWrite: (() => void) | undefined;
    appDbMock.setItem.mockImplementationOnce(
      (key: string, value: unknown) =>
        new Promise((resolve) => {
          resolveWrite = () => {
            storedItems.set(key, value);
            resolve(value);
          };
        }),
    );
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [],
      activeMessageTree: normalizeSessionMessageTree([]),
    });

    const write = useChatStore.getState().syncActiveSession("a", freshTree);
    const load = useChatStore.getState().selectSession("a");
    await Promise.resolve();

    expect(appDbMock.getItem).not.toHaveBeenCalledWith("session_messages_a");

    resolveWrite?.();
    await write;
    await load;

    expect(useChatStore.getState().activeMessages).toEqual([freshMessage]);
  });

  it("keeps the current session when the target pending write fails", async () => {
    const activeMessage = makeMessage("b1", "current session");
    let rejectWrite: ((error: Error) => void) | undefined;
    appDbMock.setItem.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [activeMessage],
      activeMessageTree: normalizeSessionMessageTree([activeMessage]),
    });

    const write = useChatStore
      .getState()
      .syncActiveSession("a", [makeMessage("a1", "new")]);
    const load = useChatStore.getState().selectSession("a");
    rejectWrite?.(new Error("write failed"));
    const [writeResult, loadResult] = await Promise.allSettled([write, load]);

    expect(writeResult.status).toBe("rejected");
    expect(loadResult.status).toBe("fulfilled");
    expect(useChatStore.getState()).toMatchObject({
      currentSessionId: "b",
      activeMessages: [activeMessage],
      activeSessionLoadError: "session_load_failed",
    });
  });

  it("clears a cancelled session load when a new chat is created", async () => {
    let resolveLoad: ((value: Message[]) => void) | undefined;
    appDbMock.getItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "a",
      activeMessages: [makeMessage("a1", "session a")],
    });

    const pendingLoad = useChatStore.getState().selectSession("b");
    const createdId = useChatStore.getState().createSession();

    expect(useChatStore.getState()).toMatchObject({
      currentSessionId: createdId,
      isActiveSessionLoading: false,
      pendingSessionId: null,
      activeSessionLoadError: null,
    });

    resolveLoad?.([makeMessage("b1", "session b")]);
    await pendingLoad;
    expect(useChatStore.getState().currentSessionId).toBe(createdId);
  });

  it("reuses only empty chats with matching workspace and session config", () => {
    const matching = {
      ...makeSession("matching"),
      title: "New Chat",
      messageCount: 0,
      workspaceId: "w1",
      systemInstruction: "workspace prompt",
      config: {
        useSearch: true,
        useReasoning: false,
        activePlugins: ["search"],
        activeSkills: ["clarity-rewrite"],
      },
    };
    useChatStore.setState({
      sessions: [
        { ...matching, id: "wrong-workspace", workspaceId: "w2" },
        { ...matching, id: "wrong-config", config: { useSearch: false } },
        matching,
      ],
    });

    const sessionId = useChatStore
      .getState()
      .createSession("workspace prompt", "New Chat", "w1", [], {
        useSearch: true,
        useReasoning: false,
        activePlugins: ["search"],
        activeSkills: ["clarity-rewrite"],
      });

    expect(sessionId).toBe("matching");
    expect(useChatStore.getState().currentSessionId).toBe("matching");
    expect(useChatStore.getState().sessions).toHaveLength(3);
  });

  it("migrates legacy chat config reasoning booleans during hydration", async () => {
    const migrate = (useChatStore as any).persist.getOptions().migrate;

    const migrated = await migrate(
      {
        sessions: [],
        workspaces: [],
        currentSessionId: null,
        activeMessages: [],
        selectedModel: "model",
        chatConfig: {
          useSearch: false,
          useReasoning: true,
          temperature: 0.7,
        },
      },
      3,
    );

    expect(migrated.chatConfig).toMatchObject({
      useReasoning: true,
      reasoningMode: "high",
    });
  });

  it("does not reuse empty chats with different active skill presets", () => {
    const existing = {
      ...makeSession("skill-a"),
      title: "New Chat",
      messageCount: 0,
      workspaceId: "w1",
      config: {
        activeSkills: ["clarity-rewrite"],
      },
    };
    useChatStore.setState({
      sessions: [existing],
    });

    const sessionId = useChatStore
      .getState()
      .createSession(undefined, "New Chat", "w1", [], {
        activeSkills: ["meeting-minutes"],
      });

    expect(sessionId).not.toBe("skill-a");
    expect(useChatStore.getState().sessions).toHaveLength(2);
  });

  it("updates the active session config with normalized skill ids", () => {
    const existing = {
      ...makeSession("active"),
      title: "New Chat",
      messageCount: 0,
    };
    useChatStore.setState({
      sessions: [existing],
      currentSessionId: "active",
    });

    useChatStore.getState().updateSessionConfig("active", {
      activeSkills: ["clarity-rewrite", "clarity-rewrite", "", "summary"],
    });

    expect(useChatStore.getState().sessions[0].config?.activeSkills).toEqual([
      "clarity-rewrite",
      "summary",
    ]);
  });

  it("serializes active session message writes so stale snapshots cannot overwrite newer ones", async () => {
    const session = makeSession("active");
    const firstTree = normalizeSessionMessageTree([makeMessage("m1", "older")]);
    const secondTree = normalizeSessionMessageTree([
      makeMessage("m1", "newer"),
    ]);
    const pendingWrites: Array<{
      key: string;
      value: unknown;
      resolve: () => void;
    }> = [];
    appDbMock.setItem.mockImplementation((key: string, value: unknown) => {
      return new Promise((resolve) => {
        pendingWrites.push({
          key,
          value,
          resolve: () => {
            storedItems.set(key, value);
            resolve(value);
          },
        });
      });
    });
    useChatStore.setState({
      sessions: [session],
      currentSessionId: session.id,
      activeMessageTree: secondTree,
      activeMessages: getActiveMessagePath(secondTree),
    });

    const firstSave = useChatStore
      .getState()
      .syncActiveSession(session.id, firstTree);
    const secondSave = useChatStore
      .getState()
      .syncActiveSession(session.id, secondTree);

    expect(pendingWrites).toHaveLength(1);
    expect(pendingWrites[0].value).toBe(firstTree);

    pendingWrites[0].resolve();
    await firstSave;
    expect(pendingWrites).toHaveLength(2);
    expect(pendingWrites[1].value).toBe(secondTree);

    pendingWrites[1].resolve();
    await secondSave;

    expectStoredActivePath(session.id, [makeMessage("m1", "newer")]);
  });

  it("does not infer messages for a target session that is no longer active", async () => {
    const activeMessage = makeMessage("b1", "session b");
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [activeMessage],
    });

    await useChatStore.getState().syncActiveSession("a");

    expect(appDbMock.setItem).not.toHaveBeenCalled();
    expect(storedItems.has("session_messages_a")).toBe(false);
  });

  it("persists an explicit message snapshot for its target session", async () => {
    const activeMessage = makeMessage("b1", "session b");
    const snapshotMessage = makeMessage("a1", "session a snapshot");
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [activeMessage],
    });

    await useChatStore.getState().syncActiveSession("a", [snapshotMessage]);

    expectStoredActivePath("a", [snapshotMessage]);
  });

  it("persists message mutations with the snapshot produced by the mutation", async () => {
    const message = makeMessage("m1", "before");
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [message],
    });

    useChatStore.getState().updateMessage("a", "m1", { content: "after" });

    expectStoredActivePath("a", [{ ...message, content: "after" }]);
  });

  it("keeps structured model output in sync when editing message content", async () => {
    const message: Message = {
      ...makeModelMessage("m1", "before"),
      outputBlocks: [
        {
          id: "reasoning-1",
          type: "reasoning",
          content: "reasoning",
        },
        {
          id: "text-1",
          type: "text",
          content: "before",
          presentation: {
            kind: "long_text",
            title: "Draft",
            format: "plain_text",
            document: {
              fileName: "Draft.txt",
              mimeType: "text/plain",
              url: "opfs://chat/long-text/draft.txt",
            },
          },
        },
      ],
    };
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [message],
      activeMessageTree: normalizeSessionMessageTree([message]),
    });

    useChatStore.getState().updateMessageContent("a", "m1", "after");
    await useChatStore.getState().syncActiveSession("a");

    const activeMessage = useChatStore.getState().activeMessages[0]!;
    expect(activeMessage.content).toBe("after");
    expect(getMessageOutputBlocks(activeMessage)).toEqual([
      {
        id: "reasoning-1",
        type: "reasoning",
        content: "reasoning",
      },
      {
        id: "text-1",
        type: "text",
        content: "after",
        presentation: {
          kind: "long_text",
          title: "Draft",
          format: "plain_text",
          document: {
            fileName: "Draft.txt",
            mimeType: "text/plain",
            url: "opfs://chat/long-text/draft.txt",
          },
        },
      },
    ]);
    expectStoredActivePath("a", [activeMessage]);
  });

  it("preserves interleaved output block order when editing model text", async () => {
    const message: Message = {
      ...makeModelMessage("m1", "Before After"),
      outputBlocks: [
        {
          id: "text-1",
          type: "text",
          content: "Before ",
        },
        {
          id: "image-1",
          type: "image",
          image: {
            id: "generated-1",
            mimeType: "image/png",
            data: "image-data",
            fileName: "generated.png",
          },
        },
        {
          id: "text-2",
          type: "text",
          content: "After",
        },
      ],
    };
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [message],
      activeMessageTree: normalizeSessionMessageTree([message]),
    });

    useChatStore.getState().updateMessageContent("a", "m1", "Updated response");

    const activeMessage = useChatStore.getState().activeMessages[0]!;
    const blocks = getMessageOutputBlocks(activeMessage);
    expect(blocks.map((block) => [block.id, block.type])).toEqual([
      ["text-1", "text"],
      ["image-1", "image"],
      ["text-2", "text"],
    ]);
    expect(
      blocks
        .filter((block) => block.type === "text")
        .map((block) => block.content)
        .join(""),
    ).toBe("Updated response");
  });

  it("does not activate a slow duplicate after a newer session selection", async () => {
    const originalMessage = makeMessage("a1", "session a");
    const selectedMessage = makeMessage("b1", "session b");
    storedItems.set("session_messages_b", [selectedMessage]);

    let resolveDuplicateWrite: (() => void) | undefined;
    appDbMock.setItem.mockImplementationOnce(
      (key: string, value: unknown) =>
        new Promise((resolve) => {
          resolveDuplicateWrite = () => {
            storedItems.set(key, value);
            resolve(value);
          };
        }),
    );

    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "a",
      activeMessages: [originalMessage],
    });

    const duplicatePromise = useChatStore.getState().duplicateSession("a");
    const selectPromise = useChatStore.getState().selectSession("b");
    resolveDuplicateWrite?.();

    await Promise.all([duplicatePromise, selectPromise]);

    const state = useChatStore.getState();
    expect(state.currentSessionId).toBe("b");
    expect(state.activeMessages).toEqual([selectedMessage]);
    expect(state.sessions).toHaveLength(3);
    expect(state.sessions[0]?.title).toBe("a (Copy)");
  });

  it("uses a requested localized duplicate title without changing the source", async () => {
    const original = { ...makeSession("a"), title: "计划" };
    useChatStore.setState({
      sessions: [original],
      currentSessionId: "a",
      activeMessages: [makeMessage("a1", "content")],
      activeMessageTree: normalizeSessionMessageTree([
        makeMessage("a1", "content"),
      ]),
    });

    await useChatStore.getState().duplicateSession("a", "计划（副本）");

    const state = useChatStore.getState();
    expect(state.sessions[0]?.title).toBe("计划（副本）");
    expect(state.sessions.find((session) => session.id === "a")?.title).toBe(
      "计划",
    );
  });

  it("does not duplicate stale data when the source pending write fails", async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    appDbMock.setItem.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [],
      activeMessageTree: normalizeSessionMessageTree([]),
    });

    const write = useChatStore
      .getState()
      .syncActiveSession("a", [makeMessage("a1", "new")]);
    const duplicate = useChatStore.getState().duplicateSession("a");
    rejectWrite?.(new Error("write failed"));
    const [writeResult, duplicateResult] = await Promise.allSettled([
      write,
      duplicate,
    ]);

    expect(writeResult.status).toBe("rejected");
    expect(duplicateResult.status).toBe("rejected");
    expect(
      useChatStore.getState().sessions.map((session) => session.id),
    ).toEqual(["a", "b"]);
  });

  it("keeps session state unchanged when duplicated messages cannot be saved", async () => {
    const originalMessage = makeMessage("a1", "session a");
    storedItems.set("session_messages_a", [originalMessage]);
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [originalMessage],
    });
    appDbMock.setItem.mockRejectedValueOnce(new Error("copy failed"));

    await expect(useChatStore.getState().duplicateSession("a")).rejects.toThrow(
      "copy failed",
    );

    const state = useChatStore.getState();
    expect(state.sessions.map((session) => session.id)).toEqual(["a"]);
    expect(state.currentSessionId).toBe("a");
    expect(state.activeMessages).toEqual([originalMessage]);
  });

  it("ignores message appends for missing sessions", async () => {
    await useChatStore
      .getState()
      .addMessage("missing", makeMessage("m1", "orphan"));

    expect(appDbMock.setItem).not.toHaveBeenCalled();
    expect(storedItems.has("session_messages_missing")).toBe(false);
  });

  it("serializes background message appends for the same session", async () => {
    const firstMessage = makeMessage("a1", "first");
    const secondMessage = makeMessage("a2", "second");
    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 0 }, makeSession("b")],
      currentSessionId: "b",
      activeMessages: [makeMessage("b1", "active")],
    });

    await Promise.all([
      useChatStore.getState().addMessage("a", firstMessage),
      useChatStore.getState().addMessage("a", secondMessage),
    ]);

    expectStoredActivePath("a", [firstMessage, secondMessage]);
    expect(
      useChatStore.getState().sessions.find((s) => s.id === "a"),
    ).toMatchObject({ messageCount: 2 });
  });

  it("cleans unreferenced workspace preset files when deleting a workspace", async () => {
    const removedUrl = "opfs://workspaces/w1/removed.txt";
    const sharedUrl = "opfs://workspaces/shared.txt";
    useChatStore.setState({
      workspaces: [
        makeWorkspace("w1", [
          makeAttachment("removed", removedUrl),
          makeAttachment("shared-1", sharedUrl),
        ]),
        makeWorkspace("w2", [makeAttachment("shared-2", sharedUrl)]),
      ],
      sessions: [
        { ...makeSession("a"), workspaceId: "w1" },
        { ...makeSession("b"), workspaceId: "w2" },
      ],
    });

    await useChatStore.getState().deleteWorkspace("w1");

    expect(useChatStore.getState().workspaces.map((w) => w.id)).toEqual(["w2"]);
    expect(useChatStore.getState().sessions).toEqual([
      expect.objectContaining({ id: "a", workspaceId: undefined }),
      expect.objectContaining({ id: "b", workspaceId: "w2" }),
    ]);
    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(removedUrl);
  });

  it("preserves workspace preset files referenced by persisted chat messages", async () => {
    const historicalUrl = "opfs://workspaces/w1/historical.txt";
    const orphanUrl = "opfs://workspaces/w1/orphan.txt";
    storedItems.set("session_messages_a", [
      {
        ...makeMessage("m1", "sent with preset"),
        attachments: [makeAttachment("historical", historicalUrl)],
      },
    ]);
    useChatStore.setState({
      workspaces: [
        makeWorkspace("w1", [
          makeAttachment("historical", historicalUrl),
          makeAttachment("orphan", orphanUrl),
        ]),
      ],
      sessions: [{ ...makeSession("a"), workspaceId: "w1" }],
    });

    await useChatStore.getState().deleteWorkspace("w1");

    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(orphanUrl);
  });

  it("cleans only removed workspace preset files after a saved edit", async () => {
    const keptUrl = "opfs://workspaces/w1/kept.txt";
    const removedUrl = "opfs://workspaces/w1/removed.txt";
    const sharedUrl = "opfs://workspaces/shared.txt";
    const newUrl = "opfs://workspaces/w1/new.txt";
    useChatStore.setState({
      workspaces: [
        makeWorkspace("w1", [
          makeAttachment("kept", keptUrl),
          makeAttachment("removed", removedUrl),
          makeAttachment("shared-1", sharedUrl),
        ]),
        makeWorkspace("w2", [makeAttachment("shared-2", sharedUrl)]),
      ],
    });

    await useChatStore.getState().updateWorkspace("w1", {
      files: [makeAttachment("kept", keptUrl), makeAttachment("new", newUrl)],
    });

    expect(
      useChatStore
        .getState()
        .workspaces.find((workspace) => workspace.id === "w1")?.files,
    ).toEqual([makeAttachment("kept", keptUrl), makeAttachment("new", newUrl)]);
    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(removedUrl);
  });

  it("preserves removed preset files referenced by active messages after a saved edit", async () => {
    const historicalUrl = "opfs://workspaces/w1/active-history.txt";
    useChatStore.setState({
      workspaces: [
        makeWorkspace("w1", [makeAttachment("historical", historicalUrl)]),
      ],
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [
        {
          ...makeMessage("m1", "active history"),
          attachments: [makeAttachment("historical", historicalUrl)],
        },
      ],
    });

    await useChatStore.getState().updateWorkspace("w1", { files: [] });

    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("skips workspace preset cleanup when message reference scanning fails", async () => {
    const candidateUrl = "opfs://workspaces/w1/candidate.txt";
    appDbMock.getItem.mockRejectedValueOnce(new Error("read failed"));
    useChatStore.setState({
      workspaces: [
        makeWorkspace("w1", [makeAttachment("candidate", candidateUrl)]),
      ],
      sessions: [{ ...makeSession("a"), workspaceId: "w1" }],
    });

    await useChatStore.getState().deleteWorkspace("w1");

    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("cleans OPFS attachments whose last message reference is deleted", async () => {
    const orphanUrl = "opfs://workspaces/w1/orphan.txt";
    const workspaceUrl = "opfs://workspaces/w1/still-preset.txt";
    useChatStore.setState({
      workspaces: [
        makeWorkspace("w1", [makeAttachment("workspace", workspaceUrl)]),
      ],
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [
        {
          ...makeMessage("m1", "delete me"),
          attachments: [
            makeAttachment("orphan", orphanUrl),
            makeAttachment("workspace", workspaceUrl),
          ],
        },
      ],
    });

    await useChatStore.getState().deleteMessage("a", "m1");

    expect(useChatStore.getState().activeMessages).toEqual([]);
    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(orphanUrl);
  });

  it("cleans generated image display cache files from deleted tool results", async () => {
    const cachedImageUrl = "opfs://images/generated/output-cache.png";
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [
        {
          ...makeModelMessage("m1", "generated"),
          outputBlocks: [
            {
              id: "block_1",
              type: "tool_group",
              toolCalls: [
                {
                  id: "call_1",
                  name: "generate_image",
                  args: {},
                  status: "success",
                  result: { imageBase64: "[image omitted]", imageCount: 1 },
                  resultImages: [
                    {
                      id: "img_1",
                      mimeType: "image/png",
                      data: "aW1hZ2U=",
                      fileName: "generated.png",
                      displayCache: {
                        opfsUrl: cachedImageUrl,
                        sourceKind: "data",
                        sourceFingerprint: "fingerprint",
                        createdAt: 1,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    await useChatStore.getState().deleteMessage("a", "m1");

    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(cachedImageUrl);
  });

  it("cleans a long text document after its final message reference is deleted", async () => {
    const documentUrl = "opfs://chat/long-text/document.md";
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [
        {
          ...makeModelMessage("m1", "Document body"),
          outputBlocks: [
            {
              id: "long-text",
              type: "text",
              content: "Document body",
              presentation: {
                kind: "long_text",
                title: "Document",
                format: "markdown",
                document: {
                  fileName: "Document.md",
                  mimeType: "text/markdown",
                  url: documentUrl,
                },
              },
            },
          ],
        },
      ],
    });

    await useChatStore.getState().deleteMessage("a", "m1");

    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(documentUrl);
  });

  it("preserves deleted message attachments still referenced by other messages", async () => {
    const sharedUrl = "opfs://workspaces/w1/shared.txt";
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [
        {
          ...makeMessage("m1", "delete me"),
          attachments: [makeAttachment("shared-1", sharedUrl)],
        },
        {
          ...makeMessage("m2", "keep me"),
          attachments: [makeAttachment("shared-2", sharedUrl)],
        },
      ],
    });

    await useChatStore.getState().deleteMessage("a", "m1");

    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("rolls back active message deletion when persistence fails", async () => {
    const firstMessage = {
      ...makeMessage("m1", "delete me"),
      attachments: [makeAttachment("orphan", "opfs://messages/orphan.txt")],
    };
    const secondMessage = makeMessage("m2", "keep me");
    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 2 }],
      currentSessionId: "a",
      activeMessages: [firstMessage, secondMessage],
    });
    appDbMock.setItem.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      useChatStore.getState().deleteMessage("a", "m1"),
    ).rejects.toThrow("write failed");

    expect(useChatStore.getState().activeMessages).toEqual([
      firstMessage,
      secondMessage,
    ]);
    expect(
      useChatStore.getState().sessions.find((session) => session.id === "a"),
    ).toMatchObject({ messageCount: 2 });
    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("rolls back message retraction when persistence fails", async () => {
    const firstMessage = makeMessage("m1", "keep me");
    const secondMessage = {
      ...makeMessage("m2", "retract me"),
      attachments: [makeAttachment("orphan", "opfs://messages/orphan.txt")],
    };
    const thirdMessage = makeMessage("m3", "also removed");
    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 3, updatedAt: 123 }],
      currentSessionId: "a",
      activeMessages: [firstMessage, secondMessage, thirdMessage],
    });
    appDbMock.setItem.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      useChatStore.getState().deleteMessageAndSubsequent("a", "m2"),
    ).rejects.toThrow("write failed");

    expect(useChatStore.getState().activeMessages).toEqual([
      firstMessage,
      secondMessage,
      thirdMessage,
    ]);
    expect(
      useChatStore.getState().sessions.find((session) => session.id === "a"),
    ).toMatchObject({ messageCount: 3, updatedAt: 123 });
    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("can remove messages after a regeneration target while preserving the target", async () => {
    const userMessage = makeMessage("m1", "prompt");
    const targetMessage = {
      ...makeMessage("m2", "answer to regenerate"),
      role: "model" as const,
    };
    const nextMessage = makeMessage("m3", "follow up");
    const laterMessage = makeMessage("m4", "stale answer");
    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 4 }],
      currentSessionId: "a",
      activeMessages: [userMessage, targetMessage, nextMessage, laterMessage],
    });

    await useChatStore.getState().deleteMessageAndSubsequent("a", "m3");

    expect(useChatStore.getState().activeMessages).toEqual([
      userMessage,
      targetMessage,
    ]);
    expectStoredActivePath("a", [userMessage, targetMessage]);
    expect(
      useChatStore.getState().sessions.find((session) => session.id === "a"),
    ).toMatchObject({ messageCount: 2 });
  });

  it("branches model messages as sibling paths and restores the old continuation", async () => {
    const userMessage = makeMessage("u1", "prompt");
    const firstAnswer = makeModelMessage("m1", "old answer");
    const followUp = makeMessage("u2", "follow up");
    const followUpAnswer = makeModelMessage("m2", "old continuation");
    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 4 }],
      currentSessionId: "a",
      activeMessages: [userMessage, firstAnswer, followUp, followUpAnswer],
    });

    const branchId = useChatStore
      .getState()
      .addMessageVersion("a", "m1", "model-b") as unknown as string;

    expect(typeof branchId).toBe("string");
    expect(branchId).not.toBe("m1");
    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      branchId,
    ]);
    expect(
      useChatStore.getState().sessions.find((session) => session.id === "a"),
    ).toMatchObject({ messageCount: 2 });

    useChatStore.getState().updateMessageContent("a", branchId, "new answer");
    await useChatStore.getState().syncActiveSession("a");

    const storedTree = storedItems.get("session_messages_a");
    expect(isSessionMessageTree(storedTree)).toBe(true);
    expect(
      getActiveMessagePath(storedTree as any).map((message) => message.id),
    ).toEqual(["u1", branchId]);

    useChatStore.getState().switchMessageVersion("a", branchId, "prev");

    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      "m1",
      "u2",
      "m2",
    ]);
    expect(
      useChatStore.getState().sessions.find((session) => session.id === "a"),
    ).toMatchObject({ messageCount: 4 });

    useChatStore.getState().selectMessageVersion("a", "m1", branchId);
    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      branchId,
    ]);
  });

  it("creates an edited user branch with a fresh model placeholder atomically", async () => {
    const userMessage = makeMessage("u1", "prompt");
    const firstAnswer = makeModelMessage("m1", "old answer");
    const followUp = makeMessage("u2", "follow up");
    const followUpAnswer = makeModelMessage("m2", "old continuation");
    const editedUser = makeMessage("u2b", "edited follow up");
    const modelPlaceholder = makeModelMessage("m2b", "");

    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 4 }],
      currentSessionId: "a",
      activeMessages: [userMessage, firstAnswer, followUp, followUpAnswer],
    });

    const createEditedUserMessageBranch = (useChatStore.getState() as any)
      .createEditedUserMessageBranch as
      | ((
          sessionId: string,
          sourceMessageId: string,
          userBranch: Message,
          modelBranch: Message,
        ) => { userMessageId: string; modelMessageId: string } | null)
      | undefined;

    expect(typeof createEditedUserMessageBranch).toBe("function");
    expect(
      createEditedUserMessageBranch?.("a", "u2", editedUser, modelPlaceholder),
    ).toEqual({ userMessageId: "u2b", modelMessageId: "m2b" });

    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      "m1",
      "u2b",
      "m2b",
    ]);
    expectStoredActivePath("a", [
      userMessage,
      firstAnswer,
      editedUser,
      modelPlaceholder,
    ]);

    useChatStore.getState().switchMessageVersion("a", "u2b", "prev");

    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      "m1",
      "u2",
      "m2",
    ]);
  });

  it("keeps nested downstream branch choices attached to their upstream branch", async () => {
    useChatStore.setState({
      sessions: [{ ...makeSession("a"), messageCount: 4 }],
      currentSessionId: "a",
      activeMessages: [
        makeMessage("u1", "root"),
        makeModelMessage("m1", "root answer"),
        makeMessage("u2", "follow"),
        makeModelMessage("m2", "follow answer"),
      ],
    });

    const nestedBranchId = useChatStore
      .getState()
      .addMessageVersion("a", "m2", "model-b") as unknown as string;
    useChatStore
      .getState()
      .updateMessageContent("a", nestedBranchId, "alternate follow answer");
    const rootBranchId = useChatStore
      .getState()
      .addMessageVersion("a", "m1", "model-c") as unknown as string;

    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      rootBranchId,
    ]);

    useChatStore.getState().switchMessageVersion("a", rootBranchId, "prev");

    expect(useChatStore.getState().activeMessages.map((m) => m.id)).toEqual([
      "u1",
      "m1",
      "u2",
      nestedBranchId,
    ]);
  });

  it("restores inactive session metadata when session deletion storage fails", async () => {
    const deletedMessage = makeMessage("a1", "still stored");
    storedItems.set("session_messages_a", [deletedMessage]);
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [makeMessage("b1", "active")],
    });
    appDbMock.removeItem.mockRejectedValueOnce(new Error("delete failed"));

    await expect(useChatStore.getState().deleteSession("a")).rejects.toThrow(
      "delete failed",
    );

    expect(
      useChatStore.getState().sessions.map((session) => session.id),
    ).toEqual(["a", "b"]);
    expect(useChatStore.getState().currentSessionId).toBe("b");
    expect(storedItems.get("session_messages_a")).toEqual([deletedMessage]);
    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("queues deletion after pending writes so a deleted tree cannot reappear", async () => {
    const pendingTree = normalizeSessionMessageTree([
      makeMessage("late", "pending write"),
    ]);
    let resolveWrite: (() => void) | undefined;
    appDbMock.setItem.mockImplementationOnce(
      (key: string, value: unknown) =>
        new Promise((resolve) => {
          resolveWrite = () => {
            storedItems.set(key, value);
            resolve(value);
          };
        }),
    );
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [],
      activeMessageTree: normalizeSessionMessageTree([]),
    });

    const write = useChatStore.getState().syncActiveSession("a", pendingTree);
    const deletion = useChatStore.getState().deleteSession("a");
    await Promise.resolve();

    expect(appDbMock.removeItem).not.toHaveBeenCalledWith("session_messages_a");

    resolveWrite?.();
    await write;
    await deletion;

    expect(storedItems.has("session_messages_a")).toBe(false);
    expect(appDbMock.removeItem).toHaveBeenCalledWith("session_messages_a");
  });

  it("restores the active session when deleting the only session fails", async () => {
    const activeMessage = makeMessage("a1", "active");
    useChatStore.setState({
      sessions: [makeSession("a")],
      currentSessionId: "a",
      activeMessages: [activeMessage],
    });
    appDbMock.removeItem.mockRejectedValueOnce(new Error("delete failed"));

    await expect(useChatStore.getState().deleteSession("a")).rejects.toThrow(
      "delete failed",
    );

    expect(
      useChatStore.getState().sessions.map((session) => session.id),
    ).toEqual(["a"]);
    expect(useChatStore.getState().currentSessionId).toBe("a");
    expect(useChatStore.getState().activeMessages).toEqual([activeMessage]);
    expect(deleteFromOPFSMock).not.toHaveBeenCalled();
  });

  it("cleans OPFS attachments from deleted sessions when no references remain", async () => {
    const orphanUrl = "opfs://workspaces/w1/session-orphan.txt";
    const sharedUrl = "opfs://workspaces/w1/session-shared.txt";
    storedItems.set("session_messages_a", [
      {
        ...makeMessage("a1", "deleted session"),
        attachments: [
          makeAttachment("orphan", orphanUrl),
          makeAttachment("shared-a", sharedUrl),
        ],
      },
    ]);
    storedItems.set("session_messages_b", [
      {
        ...makeMessage("b1", "kept session"),
        attachments: [makeAttachment("shared-b", sharedUrl)],
      },
    ]);
    useChatStore.setState({
      sessions: [makeSession("a"), makeSession("b")],
      currentSessionId: "b",
      activeMessages: [],
    });

    await useChatStore.getState().deleteSession("a");

    expect(storedItems.has("session_messages_a")).toBe(false);
    expect(deleteFromOPFSMock).toHaveBeenCalledTimes(1);
    expect(deleteFromOPFSMock).toHaveBeenCalledWith(orphanUrl);
  });
});
