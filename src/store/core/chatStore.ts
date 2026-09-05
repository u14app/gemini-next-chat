import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v7 as uuidv7 } from "uuid";
import {
  Session,
  Message,
  MessageOutputBlock,
  ChatConfig,
  Workspace,
  Attachment,
  SessionConfig,
  SessionMessageTree,
} from "@/types";
import {
  appDb,
  getAppDbStorage,
  STORAGE_KEYS,
  STORAGE_VERSION,
} from "../storage/storageConfig";
import {
  normalizeMessage,
  normalizeMessages,
  normalizeMessageTreeMessages,
} from "../storage/migrations";
import { normalizeChatConfig } from "@/lib/settings/appConfig";
import {
  normalizeSession,
  normalizeSessionConfig,
  normalizeSessionTitle,
  normalizeWorkspace,
} from "@/lib/chat/entities";
import { DEFAULT_CHAT_CONFIG } from "@/config/defaults";
import {
  endTemporarySession,
  isTemporarySession,
  isTemporarySessionId,
  registerTemporarySession,
  TEMPORARY_CHAT_CONFIG,
} from "@/lib/chat/sessionRetention";
import {
  isReasoningEnabled,
  normalizeReasoningMode,
} from "@/lib/chat/reasoning";
import { normalizeChatMode } from "@/lib/chat/mode";
import { deleteFromOPFS } from "@/utils/opfs";
import { logDevError } from "@/lib/utils/devLogger";
import { deleteSessionArchives } from "@/services/workspace/sessionArchive";
import {
  deleteSessionArtifacts,
  duplicateSessionArtifacts,
} from "@/services/workspace/sessionArtifact";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { useResearchStore } from "@/store/core/researchStore";
import {
  duplicateResearchTaskSnapshots,
  getReferencedResearchTaskIds,
  prepareResearchTaskSnapshots,
  remapResearchTaskBlocks,
  removeResearchTaskSnapshots,
} from "@/services/research";
import { deleteSessionWorkspace } from "@/services/workspace/sessionWorkspace";
import { reportAppRestoreHydration } from "@/lib/data/appRestoreJournal";
import {
  appendMessageToActivePath,
  cloneMessageTreeWithNewIds,
  createModelResponseBranch,
  createUserMessageBranch,
  getActiveMessagePath,
  getAllMessagesFromTree,
  isMessageInActivePath,
  isSessionMessageTree,
  normalizeSessionMessageTree,
  removeMessageFromTree,
  removeMessageSubtree,
  selectMessageBranch,
  switchMessageBranch,
  updateMessageInTree,
} from "@/lib/chat/messageTree";
import {
  getAttachmentUrls,
  getMessageAttachmentUrls,
  getReferencedWorkspaceFileUrls,
  getRemovedWorkspaceFileUrls,
} from "@/lib/chat/attachmentReferences";
import {
  enqueueSessionMessageWrite,
  waitForSessionMessageWrites,
} from "../sessionMessagePersistence";

let selectSessionRequestId = 0;

const createEmptyMessageTree = () => normalizeSessionMessageTree([]);

const getWorkspaceArtifactUrls = (
  messageTree: SessionMessageTree,
): string[] => {
  const urls = new Set<string>();
  for (const message of getAllMessagesFromTree(messageTree)) {
    for (const block of message.outputBlocks ?? []) {
      if (block.type === "workspace_file") urls.add(block.file.url);
    }
  }
  return Array.from(urls);
};

const getResearchTaskIds = (messages: Message[]): string[] =>
  Array.from(
    new Set(
      messages.flatMap((message) =>
        (message.outputBlocks || []).flatMap((block) =>
          block.type === "research_task" ? [block.taskId] : [],
        ),
      ),
    ),
  );

const remapWorkspaceArtifactUrls = (
  messageTree: SessionMessageTree,
  urls: ReadonlyMap<string, string>,
): SessionMessageTree => {
  if (urls.size === 0) return messageTree;

  return {
    ...messageTree,
    nodesById: Object.fromEntries(
      Object.entries(messageTree.nodesById).map(([id, node]) => {
        const outputBlocks = node.message.outputBlocks?.map((block) => {
          if (block.type !== "workspace_file") return block;
          const url = urls.get(block.file.url);
          return url ? { ...block, file: { ...block.file, url } } : block;
        });
        return [
          id,
          {
            ...node,
            message: outputBlocks
              ? { ...node.message, outputBlocks }
              : node.message,
          },
        ];
      }),
    ),
  };
};

const normalizeStoredMessageTree = (
  stored: Message[] | SessionMessageTree | null | undefined,
) => {
  if (isSessionMessageTree(stored)) {
    return normalizeMessageTreeMessages(normalizeSessionMessageTree(stored));
  }

  return normalizeSessionMessageTree(normalizeMessages(stored));
};

const replaceOutputBlockText = (
  outputBlocks: MessageOutputBlock[] | undefined,
  content: string,
): MessageOutputBlock[] | undefined => {
  if (!outputBlocks?.length) return outputBlocks;

  const textBlocks = outputBlocks.filter((block) => block.type === "text");

  if (textBlocks.length === 0) {
    return content
      ? [...outputBlocks, { id: uuidv7(), type: "text" as const, content }]
      : outputBlocks;
  }

  const totalOriginalLength = textBlocks.reduce(
    (total, block) => total + block.content.length,
    0,
  );
  let originalTextLength = 0;
  let nextTextOffset = 0;
  let textBlockIndex = 0;

  return outputBlocks.map((block) => {
    if (block.type !== "text") return block;

    textBlockIndex += 1;
    originalTextLength += block.content.length;
    const isLastTextBlock = textBlockIndex === textBlocks.length;
    const nextBoundary = isLastTextBlock
      ? content.length
      : totalOriginalLength > 0
        ? Math.round(
            (originalTextLength / totalOriginalLength) * content.length,
          )
        : nextTextOffset;
    const nextContent = content.slice(nextTextOffset, nextBoundary);
    nextTextOffset = nextBoundary;
    return { ...block, content: nextContent };
  });
};

const getReferencedChatMessageFileUrls = async ({
  candidateUrls,
  sessions,
  currentSessionId,
  activeMessageTree,
  includeCurrentPersistedMessages = false,
}: {
  candidateUrls: string[];
  sessions: Session[];
  currentSessionId: string | null;
  activeMessageTree: SessionMessageTree;
  includeCurrentPersistedMessages?: boolean;
}) => {
  const urls = getMessageAttachmentUrls(
    getAllMessagesFromTree(activeMessageTree),
  );

  for (const session of sessions) {
    if (!includeCurrentPersistedMessages && session.id === currentSessionId) {
      continue;
    }

    try {
      const messageTree = normalizeStoredMessageTree(
        await appDb.getItem<Message[] | SessionMessageTree>(
          `session_messages_${session.id}`,
        ),
      );
      for (const url of getMessageAttachmentUrls(
        getAllMessagesFromTree(messageTree),
      )) {
        urls.add(url);
      }
    } catch (error) {
      logDevError(
        "Failed to scan session messages before workspace file cleanup",
        error,
      );
      candidateUrls.forEach((url) => urls.add(url));
      return urls;
    }
  }

  return urls;
};

const getReferencedWorkspaceAndMessageFileUrls = async ({
  candidateUrls,
  workspaces,
  sessions,
  currentSessionId,
  activeMessageTree,
  includeCurrentPersistedMessages,
}: {
  candidateUrls: string[];
  workspaces: Workspace[];
  sessions: Session[];
  currentSessionId: string | null;
  activeMessageTree: SessionMessageTree;
  includeCurrentPersistedMessages?: boolean;
}) => {
  const urls = getReferencedWorkspaceFileUrls(workspaces);
  const messageUrls = await getReferencedChatMessageFileUrls({
    candidateUrls,
    sessions,
    currentSessionId,
    activeMessageTree,
    includeCurrentPersistedMessages,
  });

  messageUrls.forEach((url) => urls.add(url));
  return urls;
};

const DEPRECATED_DEFAULT_SELECTED_MODEL = "GEMINI:gemini-flash-latest";

const cleanupUnreferencedAttachmentUrls = async (
  urls: string[],
  getReferencedUrls: () => Promise<Set<string>>,
) => {
  const referencedUrls = await getReferencedUrls();
  const urlsToCleanup = Array.from(new Set(urls)).filter(
    (url) => !referencedUrls.has(url),
  );

  const results = await Promise.allSettled(
    urlsToCleanup.map((url) => deleteFromOPFS(url)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logDevError(
        "Failed to clean up OPFS attachment file",
        urlsToCleanup[index],
        result.reason,
      );
    }
  });
};

interface ChatState {
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  sessions: Session[]; // Metadata Only
  workspaces: Workspace[]; // New: Workspaces
  currentSessionId: string | null;
  activeMessages: Message[]; // Currently loaded messages
  activeMessageTree: SessionMessageTree;
  isActiveSessionLoading: boolean;
  pendingSessionId: string | null;
  activeSessionLoadError: "session_load_failed" | null;

  selectedModel: string;
  chatConfig: ChatConfig;

  // Actions
  createTemporarySession: () => string;
  discardTemporarySession: () => void;
  createSession: (
    systemInstruction?: string,
    title?: string,
    workspaceId?: string,
    initialAttachments?: Attachment[],
    config?: SessionConfig,
  ) => string;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateSessionTitle: (id: string, newTitle: string) => void;
  updateSessionInstruction: (id: string, instruction: string) => void;
  updateSessionConfig: (id: string, config: Partial<SessionConfig>) => void;
  updateSessionCompression: (
    id: string,
    compression: Session["compression"],
  ) => void;
  updateSessionMemoryContext: (
    id: string,
    memoryContext: Session["memoryContext"],
  ) => void;
  moveSessionToWorkspace: (
    sessionId: string,
    workspaceId: string | null,
  ) => void;

  toggleSessionPin: (id: string) => void;
  duplicateSession: (id: string, duplicateTitle?: string) => Promise<void>;

  addMessage: (sessionId: string, message: Message) => Promise<void>;
  updateMessageContent: (
    sessionId: string,
    messageId: string,
    content: string,
    reasoning?: string,
    outputBlocks?: MessageOutputBlock[],
  ) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updates: Partial<Message>,
  ) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;

  // Workspace Actions
  createWorkspace: (workspace: Omit<Workspace, "createdAt">) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;

  // Persistence Helper
  syncActiveSession: (
    sessionId?: string,
    messages?: Message[] | SessionMessageTree,
  ) => Promise<void>;

  // Versioning Actions
  addMessageVersion: (
    sessionId: string,
    messageId: string,
    model: string,
  ) => string | null;
  createEditedUserMessageBranch: (
    sessionId: string,
    messageId: string,
    userBranch: Message,
    modelBranch: Message,
  ) => { userMessageId: string; modelMessageId: string } | null;
  switchMessageVersion: (
    sessionId: string,
    messageId: string,
    direction: "prev" | "next",
  ) => void;
  selectMessageVersion: (
    sessionId: string,
    messageId: string,
    targetMessageId: string,
  ) => void;

  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;
  deleteMessageAndSubsequent: (
    sessionId: string,
    messageId: string,
  ) => Promise<void>;

  // Suggestions
  setSuggestedQuestions: (
    sessionId: string,
    messageId: string,
    questions: string[],
  ) => void;

  setModel: (model: string) => void;
  setChatConfig: (config: Partial<ChatConfig>) => void;

  // Helper to get current session metadata
  getCurrentSession: () => Session | undefined;
}

const getMessageTreeFromState = (state: {
  activeMessages: Message[];
  activeMessageTree: SessionMessageTree;
}) => {
  if (
    getAllMessagesFromTree(state.activeMessageTree).length === 0 &&
    state.activeMessages.length > 0
  ) {
    return normalizeSessionMessageTree(state.activeMessages);
  }

  return state.activeMessageTree;
};

const DEFAULT_SESSION_TITLE = "New Chat";

const normalizedConfigKey = (config?: SessionConfig) =>
  JSON.stringify(normalizeSessionConfig(config) ?? {});

const isReusableEmptySession = (
  session: Session,
  state: Pick<
    ChatState,
    "currentSessionId" | "activeMessages" | "activeMessageTree"
  >,
  {
    title,
    systemInstruction,
    workspaceId,
    config,
  }: {
    title: string;
    systemInstruction?: string;
    workspaceId?: string;
    config?: SessionConfig;
  },
) => {
  if (isTemporarySession(session)) return false;
  if (title !== DEFAULT_SESSION_TITLE) return false;
  if (session.title !== DEFAULT_SESSION_TITLE) return false;
  if (session.messageCount !== 0) return false;
  if ((session.workspaceId ?? "") !== (workspaceId ?? "")) return false;
  if ((session.systemInstruction ?? "") !== (systemInstruction ?? "")) {
    return false;
  }
  if (normalizedConfigKey(session.config) !== normalizedConfigKey(config)) {
    return false;
  }

  if (state.currentSessionId !== session.id) return true;

  return (
    state.activeMessages.length === 0 &&
    getAllMessagesFromTree(state.activeMessageTree).length === 0
  );
};

const applySessionConfig = (
  currentConfig: ChatConfig,
  sessionConfig?: SessionConfig,
): ChatConfig => {
  const hasReasoningConfig =
    sessionConfig?.reasoningMode !== undefined ||
    sessionConfig?.useReasoning !== undefined;
  const reasoningMode = hasReasoningConfig
    ? normalizeReasoningMode(
        sessionConfig?.reasoningMode,
        sessionConfig?.useReasoning,
      )
    : currentConfig.reasoningMode;
  const chatMode = normalizeChatMode(
    sessionConfig?.chatMode,
    sessionConfig?.useAgentMode,
    sessionConfig?.useDeepResearch,
  );

  return normalizeChatConfig({
    ...currentConfig,
    chatMode,
    useSearch: sessionConfig?.useSearch ?? currentConfig.useSearch,
    useAgentMode: chatMode === "agent",
    useDeepResearch: chatMode === "research",
    useReasoning: isReasoningEnabled(reasoningMode),
    reasoningMode,
  });
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },
      sessions: [],
      workspaces: [],
      currentSessionId: null,
      activeMessages: [],
      activeMessageTree: createEmptyMessageTree(),
      isActiveSessionLoading: false,
      pendingSessionId: null,
      activeSessionLoadError: null,
      selectedModel: "",
      chatConfig: { ...DEFAULT_CHAT_CONFIG },

      discardTemporarySession: () => {
        const state = get();
        const temporary = state.sessions.filter(isTemporarySession);
        if (temporary.length === 0) return;
        temporary.forEach((session) => endTemporarySession(session.id));
        selectSessionRequestId += 1;
        const wasTemporary = temporary.some(
          (s) => s.id === state.currentSessionId,
        );
        set({
          sessions: state.sessions.filter((s) => !isTemporarySession(s)),
          ...(wasTemporary
            ? {
                currentSessionId: null,
                activeMessages: [],
                activeMessageTree: createEmptyMessageTree(),
                isActiveSessionLoading: false,
                pendingSessionId: null,
                activeSessionLoadError: null,
              }
            : {}),
        });
      },

      createTemporarySession: () => {
        get().discardTemporarySession();
        const id = uuidv7();
        registerTemporarySession(id);
        selectSessionRequestId += 1;
        const session: Session = {
          id,
          retention: "temporary",
          title: "New Chat",
          messageCount: 0,
          updatedAt: Date.now(),
          model: get().selectedModel,
          config: { ...TEMPORARY_CHAT_CONFIG },
        };
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: id,
          activeMessages: [],
          activeMessageTree: createEmptyMessageTree(),
          isActiveSessionLoading: false,
          pendingSessionId: null,
          activeSessionLoadError: null,
          chatConfig: { ...state.chatConfig, ...TEMPORARY_CHAT_CONFIG },
        }));
        return id;
      },

      createSession: (
        systemInstruction,
        title = "New Chat",
        workspaceId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _initialAttachments = [],
        config,
      ) => {
        get().discardTemporarySession();
        const normalizedTitle = normalizeSessionTitle(title);
        const normalizedConfig = normalizeSessionConfig(config);
        const reusableSession = get().sessions.find((session) =>
          isReusableEmptySession(session, get(), {
            title: normalizedTitle,
            systemInstruction,
            workspaceId,
            config: normalizedConfig,
          }),
        );

        if (reusableSession) {
          selectSessionRequestId += 1;
          set((state) => ({
            currentSessionId: reusableSession.id,
            activeMessages: [],
            activeMessageTree: createEmptyMessageTree(),
            isActiveSessionLoading: false,
            pendingSessionId: null,
            activeSessionLoadError: null,
            chatConfig: applySessionConfig(
              state.chatConfig,
              reusableSession.config,
            ),
          }));
          return reusableSession.id;
        }

        selectSessionRequestId += 1;
        const newSession = normalizeSession({
          id: uuidv7(),
          title: normalizedTitle,
          updatedAt: Date.now(),
          model: get().selectedModel,
          systemInstruction: systemInstruction,
          pinned: false,
          messageCount: 0,
          workspaceId: workspaceId,
          config: normalizedConfig,
        });

        const initialMessageTree = createEmptyMessageTree();

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: newSession.id,
          activeMessages: [],
          activeMessageTree: initialMessageTree,
          isActiveSessionLoading: false,
          pendingSessionId: null,
          activeSessionLoadError: null,
          chatConfig: applySessionConfig(state.chatConfig, newSession.config),
        }));

        return newSession.id;
      },

      selectSession: async (id) => {
        if (id === get().currentSessionId && isTemporarySessionId(id)) return;
        const session = get().sessions.find((candidate) => candidate.id === id);
        if (!session) return;
        get().discardTemporarySession();

        const requestId = selectSessionRequestId + 1;
        selectSessionRequestId = requestId;
        set({
          isActiveSessionLoading: true,
          pendingSessionId: id,
          activeSessionLoadError: null,
        });

        // Fetch data first
        let messageTree: SessionMessageTree;
        try {
          const pendingWrite = waitForSessionMessageWrites(id);
          if (pendingWrite) {
            await pendingWrite;
            if (requestId !== selectSessionRequestId) return;
          }
          messageTree = normalizeStoredMessageTree(
            await appDb.getItem<Message[] | SessionMessageTree>(
              `session_messages_${id}`,
            ),
          );
        } catch (e) {
          logDevError("Failed to load session messages", e);
          if (requestId === selectSessionRequestId) {
            set({
              isActiveSessionLoading: false,
              pendingSessionId: null,
              activeSessionLoadError: "session_load_failed",
            });
          }
          return;
        }

        if (requestId !== selectSessionRequestId) return;

        const activeMessages = getActiveMessagePath(messageTree);

        set((state) => ({
          currentSessionId: id,
          activeMessages,
          activeMessageTree: messageTree,
          isActiveSessionLoading: false,
          pendingSessionId: null,
          activeSessionLoadError: null,
          chatConfig: applySessionConfig(state.chatConfig, session.config),
          sessions: state.sessions.map((candidate) =>
            candidate.id === id
              ? { ...candidate, messageCount: activeMessages.length }
              : candidate,
          ),
        }));
      },

      deleteSession: async (id) => {
        if (isTemporarySessionId(id)) {
          if (get().sessions.some((session) => session.id === id)) {
            get().discardTemporarySession();
          }
          return;
        }
        const { revokeSessionShareBeforeDelete, cancelSessionShareDeletion } =
          await import("@/services/sharing/client");
        await revokeSessionShareBeforeDelete(id);
        selectSessionRequestId += 1;
        const deleteRequestId = selectSessionRequestId;
        const stateBeforeDelete = get();
        const wasActiveSession = stateBeforeDelete.currentSessionId === id;
        const deletedSession = stateBeforeDelete.sessions.find(
          (session) => session.id === id,
        );
        // Remove metadata from state
        set((state) => {
          const filtered = state.sessions.filter((s) => s.id !== id);
          let nextId = state.currentSessionId;
          let nextActiveMessages = state.activeMessages;
          let nextMessageTree = state.activeMessageTree;

          if (state.currentSessionId === id) {
            nextId = filtered.length > 0 ? filtered[0].id : null;
            nextActiveMessages = [];
            nextMessageTree = createEmptyMessageTree();
          }

          return {
            sessions: filtered,
            currentSessionId: nextId,
            activeMessages: nextActiveMessages,
            activeMessageTree: nextMessageTree,
            isActiveSessionLoading: false,
            pendingSessionId: null,
            activeSessionLoadError: null,
          };
        });

        let deletedMessages: Message[] | null = wasActiveSession
          ? getAllMessagesFromTree(stateBeforeDelete.activeMessageTree)
          : null;
        const removeMessagesPromise = enqueueSessionMessageWrite(
          id,
          async () => {
            if (!wasActiveSession) {
              try {
                deletedMessages = getAllMessagesFromTree(
                  normalizeStoredMessageTree(
                    await appDb.getItem<Message[] | SessionMessageTree>(
                      `session_messages_${id}`,
                    ),
                  ),
                );
              } catch (error) {
                logDevError(
                  "Failed to load deleted session messages for attachment cleanup",
                  error,
                );
              }
            }
            await appDb.removeItem(`session_messages_${id}`);
          },
        );

        // Trigger load for next session if auto-selected
        const currentId = get().currentSessionId;
        if (wasActiveSession && currentId && currentId !== id) {
          void get().selectSession(currentId);
        }

        try {
          await removeMessagesPromise;
        } catch (error) {
          if (deletedSession) {
            set((state) => {
              if (state.sessions.some((session) => session.id === id)) {
                return {};
              }

              const restoredSessions = [...state.sessions];
              const originalIndex = stateBeforeDelete.sessions.findIndex(
                (session) => session.id === id,
              );
              restoredSessions.splice(
                Math.min(Math.max(originalIndex, 0), restoredSessions.length),
                0,
                deletedSession,
              );

              const shouldRestoreActiveSession =
                stateBeforeDelete.currentSessionId === id &&
                state.currentSessionId === null &&
                state.activeMessages.length === 0 &&
                getAllMessagesFromTree(state.activeMessageTree).length === 0 &&
                selectSessionRequestId === deleteRequestId;

              return {
                sessions: restoredSessions,
                ...(shouldRestoreActiveSession
                  ? {
                      currentSessionId: id,
                      activeMessages: stateBeforeDelete.activeMessages,
                      activeMessageTree: stateBeforeDelete.activeMessageTree,
                    }
                  : {}),
              };
            });
            await cancelSessionShareDeletion(id).catch((cleanupError) => {
              logDevError(
                "Failed to restore session sharing availability",
                cleanupError,
              );
            });
          }

          throw error;
        }

        // Scratch data and ordinary published copies are session-scoped.
        // Content-addressed Research Artifacts are released separately after
        // the last copied ResearchTask reference is removed.
        const cleanupResults = await Promise.allSettled([
          deleteSessionWorkspace(id),
          deleteSessionArchives(id),
          deleteSessionArtifacts(id),
          useAgentRunStore.getState().clearSessionRuns(id),
          useResearchStore.getState().clearSessionTasks(id),
        ]);
        cleanupResults.forEach((result) => {
          if (result.status === "rejected") {
            logDevError(
              "Failed to delete session workspace data",
              result.reason,
            );
          }
        });

        const removedFileUrls = deletedMessages
          ? Array.from(getMessageAttachmentUrls(deletedMessages))
          : [];
        if (removedFileUrls.length > 0) {
          await cleanupUnreferencedAttachmentUrls(removedFileUrls, async () => {
            const state = get();
            return getReferencedWorkspaceAndMessageFileUrls({
              candidateUrls: removedFileUrls,
              workspaces: state.workspaces,
              sessions: state.sessions,
              currentSessionId: state.currentSessionId,
              activeMessageTree: getMessageTreeFromState(state),
              includeCurrentPersistedMessages: true,
            });
          });
        }
      },

      updateSessionTitle: (id, newTitle) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? normalizeSession({
                  ...s,
                  title: newTitle,
                  updatedAt: Date.now(),
                })
              : s,
          ),
        }));
      },

      updateSessionInstruction: (id, instruction) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? normalizeSession({
                  ...s,
                  systemInstruction: instruction,
                  updatedAt: Date.now(),
                })
              : s,
          ),
        }));
      },

      updateSessionConfig: (id, config) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? normalizeSession({
                  ...s,
                  config: normalizeSessionConfig({
                    ...s.config,
                    ...config,
                    ...(isTemporarySession(s) ? TEMPORARY_CHAT_CONFIG : {}),
                  }),
                  updatedAt: Date.now(),
                })
              : s,
          ),
        }));
      },

      updateSessionCompression: (id, compression) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? normalizeSession({
                  ...s,
                  compression: compression,
                  updatedAt: Date.now(),
                })
              : s,
          ),
        }));
      },

      updateSessionMemoryContext: (id, memoryContext) => {
        if (isTemporarySessionId(id)) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? normalizeSession({
                  ...s,
                  memoryContext,
                  updatedAt: Date.now(),
                })
              : s,
          ),
        }));
      },

      moveSessionToWorkspace: (sessionId, workspaceId) => {
        if (isTemporarySessionId(sessionId)) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  workspaceId: workspaceId || undefined,
                  updatedAt: Date.now(),
                }
              : s,
          ),
        }));
      },

      toggleSessionPin: (id) => {
        if (isTemporarySessionId(id)) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, pinned: !s.pinned } : s,
          ),
        }));
      },

      duplicateSession: async (id, duplicateTitle) => {
        if (isTemporarySessionId(id)) return;
        get().discardTemporarySession();
        const requestId = selectSessionRequestId + 1;
        selectSessionRequestId = requestId;
        const state = get();
        const original = state.sessions.find((s) => s.id === id);
        if (!original) return;

        const newId = uuidv7();

        // Load original messages after any queued persistence has settled.
        // The active tree is already the newest atomic snapshot.
        let originalMessageTree: SessionMessageTree;
        if (state.currentSessionId === id) {
          originalMessageTree = getMessageTreeFromState(state);
        } else {
          const pendingWrite = waitForSessionMessageWrites(id);
          if (pendingWrite) await pendingWrite;
          originalMessageTree = normalizeStoredMessageTree(
            await appDb.getItem<Message[] | SessionMessageTree>(
              `session_messages_${id}`,
            ),
          );
        }

        const latestState = get();
        if (!latestState.sessions.some((s) => s.id === id)) {
          return;
        }

        let newMessageTree = cloneMessageTreeWithNewIds(
          originalMessageTree,
          uuidv7,
        );
        const referencedResearchTaskIds =
          getReferencedResearchTaskIds(originalMessageTree);
        const preparedResearch = referencedResearchTaskIds.length
          ? await prepareResearchTaskSnapshots(id, originalMessageTree)
          : {
              tasks: [],
              artifactUrls: [],
              referencedTaskIds: [],
            };
        let createdResearchTaskIds: string[] = [];

        try {
          const artifactUrls = Array.from(
            new Set([
              ...getWorkspaceArtifactUrls(originalMessageTree),
              ...preparedResearch.artifactUrls,
            ]),
          );
          let copiedArtifacts = new Map<string, string>();
          if (artifactUrls.length > 0) {
            copiedArtifacts = await duplicateSessionArtifacts(
              id,
              newId,
              artifactUrls,
            );
            newMessageTree = remapWorkspaceArtifactUrls(
              newMessageTree,
              copiedArtifacts,
            );
          }
          const duplicatedResearch = preparedResearch.tasks.length
            ? await duplicateResearchTaskSnapshots({
                targetSessionId: newId,
                tasks: preparedResearch.tasks,
                artifactUrls: copiedArtifacts,
              })
            : { taskIdMap: new Map<string, string>(), createdTaskIds: [] };
          createdResearchTaskIds = duplicatedResearch.createdTaskIds;
          newMessageTree = remapResearchTaskBlocks(
            newMessageTree,
            duplicatedResearch.taskIdMap,
          );
        } catch (error) {
          await removeResearchTaskSnapshots(createdResearchTaskIds);
          await deleteSessionArtifacts(newId).catch((cleanupError) => {
            logDevError(
              "Failed to clean up an incomplete duplicated session artifact store",
              cleanupError,
            );
          });
          throw error;
        }
        const newMessages = getActiveMessagePath(newMessageTree);

        const newSession = normalizeSession({
          ...normalizeSession(original),
          id: newId,
          title: duplicateTitle ?? `${original.title} (Copy)`,
          updatedAt: Date.now(),
          pinned: false,
          compression: undefined,
          messageCount: newMessages.length,
        });

        // Save new messages
        try {
          await enqueueSessionMessageWrite(newId, async () => {
            await appDb.setItem(`session_messages_${newId}`, newMessageTree);
          });
        } catch (error) {
          await removeResearchTaskSnapshots(createdResearchTaskIds);
          await deleteSessionArtifacts(newId).catch((cleanupError) => {
            logDevError(
              "Failed to clean up an incomplete duplicated session artifact store",
              cleanupError,
            );
          });
          throw error;
        }

        const shouldActivateDuplicate = requestId === selectSessionRequestId;

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: shouldActivateDuplicate
            ? newId
            : state.currentSessionId,
          activeMessages: shouldActivateDuplicate
            ? newMessages
            : state.activeMessages,
          activeMessageTree: shouldActivateDuplicate
            ? newMessageTree
            : state.activeMessageTree,
        }));
      },

      addMessage: async (sessionId, message) => {
        const normalizedMessage = normalizeMessage({ ...message });

        let sessionExists = false;
        let activeTreeToPersist: SessionMessageTree | null = null;

        // Update State Memory
        set((state) => {
          const targetSession = state.sessions.find((s) => s.id === sessionId);
          if (!targetSession) return {};

          sessionExists = true;
          const isActiveSession = state.currentSessionId === sessionId;
          const currentMessageTree = getMessageTreeFromState(state);
          const newActiveMessageTree = isActiveSession
            ? appendMessageToActivePath(currentMessageTree, normalizedMessage)
            : currentMessageTree;
          const newActiveMessages = isActiveSession
            ? getActiveMessagePath(newActiveMessageTree)
            : state.activeMessages;

          if (isActiveSession) {
            activeTreeToPersist = newActiveMessageTree;
          }

          return {
            activeMessages: newActiveMessages,
            activeMessageTree: newActiveMessageTree,
            sessions: state.sessions.map((s) => {
              if (s.id === sessionId) {
                return {
                  ...s,
                  messageCount: isActiveSession
                    ? newActiveMessages.length
                    : s.messageCount + 1,
                  updatedAt: Date.now(),
                };
              }
              return s;
            }),
          };
        });

        if (!sessionExists || isTemporarySessionId(sessionId)) return;

        // Save to DB
        // We need to fetch current messages if not active, or use the mutation snapshot if active.
        if (activeTreeToPersist) {
          await enqueueSessionMessageWrite(sessionId, async () => {
            await appDb.setItem(
              `session_messages_${sessionId}`,
              activeTreeToPersist,
            );
          });
          return;
        }

        await enqueueSessionMessageWrite(sessionId, async () => {
          if (!get().sessions.some((s) => s.id === sessionId)) return;
          const existing = normalizeStoredMessageTree(
            await appDb.getItem<Message[] | SessionMessageTree>(
              `session_messages_${sessionId}`,
            ),
          );
          if (!get().sessions.some((s) => s.id === sessionId)) return;

          const messageTreeToSave = appendMessageToActivePath(
            existing,
            normalizedMessage,
          );
          await appDb.setItem(
            `session_messages_${sessionId}`,
            messageTreeToSave,
          );
        });
      },

      updateMessageContent: (
        sessionId,
        messageId,
        content,
        reasoning,
        outputBlocks,
      ) => {
        // Memory Update Only (Fast for streaming)
        set((state) => {
          if (state.currentSessionId !== sessionId) return {}; // Ignore updates for non-active sessions

          const newMessageTree = updateMessageInTree(
            getMessageTreeFromState(state),
            messageId,
            (message) => {
              const newMessage = {
                ...message,
                content: content,
              };
              const nextOutputBlocks =
                outputBlocks ??
                replaceOutputBlockText(message.outputBlocks, content);
              if (reasoning !== undefined) {
                newMessage.reasoning = reasoning;
              }
              if (nextOutputBlocks !== undefined) {
                newMessage.outputBlocks = nextOutputBlocks;
              }
              return newMessage;
            },
          );

          return {
            activeMessageTree: newMessageTree,
            activeMessages: getActiveMessagePath(newMessageTree),
          };
        });
      },

      updateMessage: (sessionId, messageId, updates) => {
        let treeToPersist: SessionMessageTree | null = null;

        // Memory Update
        set((state) => {
          if (state.currentSessionId !== sessionId) return {};

          const newMessageTree = updateMessageInTree(
            getMessageTreeFromState(state),
            messageId,
            (message) => ({ ...message, ...updates }),
          );

          treeToPersist = newMessageTree;
          return {
            activeMessageTree: newMessageTree,
            activeMessages: getActiveMessagePath(newMessageTree),
          };
        });

        // Persist Update
        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
      },

      setMessages: (sessionId, messages) => {
        const normalizedMessages = normalizeMessages(messages);
        const messageTree = normalizeSessionMessageTree(normalizedMessages);
        let treeToPersist: SessionMessageTree | null = null;
        const activeMessages = getActiveMessagePath(messageTree);

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};
          treeToPersist = messageTree;
          return {
            activeMessages,
            activeMessageTree: messageTree,
            sessions: state.sessions.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    messageCount: activeMessages.length,
                    updatedAt: Date.now(),
                  }
                : s,
            ),
          };
        });
        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
      },

      // Helper to explicitly save active messages to DB
      syncActiveSession: async (sessionId, messages) => {
        const { currentSessionId, activeMessageTree } = get();
        const targetSessionId = sessionId ?? currentSessionId;
        if (!targetSessionId) return;
        if (isTemporarySessionId(targetSessionId)) return;
        if (!get().sessions.some((session) => session.id === targetSessionId)) {
          return;
        }

        const treeToSave = Array.isArray(messages)
          ? normalizeSessionMessageTree(normalizeMessages(messages))
          : (messages ??
            (currentSessionId === targetSessionId ? activeMessageTree : null));

        if (!treeToSave) return;

        await enqueueSessionMessageWrite(targetSessionId, async () => {
          await appDb.setItem(
            `session_messages_${targetSessionId}`,
            treeToSave,
          );
        });
      },

      addMessageVersion: (sessionId, messageId, modelName) => {
        let treeToPersist: SessionMessageTree | null = null;
        let branchMessageId: string | null = null;

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};

          const currentMessageTree = getMessageTreeFromState(state);
          const sourceMessage =
            currentMessageTree.nodesById[messageId]?.message;
          if (!sourceMessage || sourceMessage.role !== "model") return {};

          branchMessageId = uuidv7();
          const branchMessage: Message = {
            id: branchMessageId,
            role: "model",
            content: "",
            reasoning: "",
            timestamp: Date.now(),
            model: modelName,
          };
          const newMessageTree = createModelResponseBranch(
            currentMessageTree,
            messageId,
            branchMessage,
          );
          const newMessages = getActiveMessagePath(newMessageTree);

          treeToPersist = newMessageTree;
          return {
            activeMessageTree: newMessageTree,
            activeMessages: newMessages,
            sessions: state.sessions.map((s) => {
              if (s.id !== sessionId) return s;

              const shouldClearCompression =
                !!s.compression?.lastCompressedMessageId &&
                !isMessageInActivePath(
                  newMessageTree,
                  s.compression.lastCompressedMessageId,
                );

              return {
                ...s,
                messageCount: newMessages.length,
                updatedAt: Date.now(),
                compression: shouldClearCompression ? undefined : s.compression,
              };
            }),
          };
        });
        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
        return branchMessageId;
      },

      createEditedUserMessageBranch: (
        sessionId,
        messageId,
        userBranch,
        modelBranch,
      ) => {
        let treeToPersist: SessionMessageTree | null = null;
        let result: { userMessageId: string; modelMessageId: string } | null =
          null;

        const normalizedUserBranch = normalizeMessage({ ...userBranch });
        const normalizedModelBranch = normalizeMessage({ ...modelBranch });

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};

          const currentMessageTree = getMessageTreeFromState(state);
          const sourceMessage =
            currentMessageTree.nodesById[messageId]?.message;
          if (!sourceMessage || sourceMessage.role !== "user") return {};

          const userBranchTree = createUserMessageBranch(
            currentMessageTree,
            messageId,
            normalizedUserBranch,
          );
          const newMessageTree = appendMessageToActivePath(
            userBranchTree,
            normalizedModelBranch,
          );
          const newMessages = getActiveMessagePath(newMessageTree);

          result = {
            userMessageId: normalizedUserBranch.id,
            modelMessageId: normalizedModelBranch.id,
          };
          treeToPersist = newMessageTree;

          return {
            activeMessageTree: newMessageTree,
            activeMessages: newMessages,
            sessions: state.sessions.map((s) => {
              if (s.id !== sessionId) return s;

              const shouldClearCompression =
                !!s.compression?.lastCompressedMessageId &&
                !isMessageInActivePath(
                  newMessageTree,
                  s.compression.lastCompressedMessageId,
                );

              return {
                ...s,
                messageCount: newMessages.length,
                updatedAt: Date.now(),
                compression: shouldClearCompression ? undefined : s.compression,
              };
            }),
          };
        });

        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
        return result;
      },

      switchMessageVersion: (sessionId, messageId, direction) => {
        let treeToPersist: SessionMessageTree | null = null;

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};

          const newMessageTree = switchMessageBranch(
            getMessageTreeFromState(state),
            messageId,
            direction,
          );
          const newMessages = getActiveMessagePath(newMessageTree);

          treeToPersist = newMessageTree;
          return {
            activeMessageTree: newMessageTree,
            activeMessages: newMessages,
            sessions: state.sessions.map((s) => {
              if (s.id !== sessionId) return s;

              const shouldClearCompression =
                !!s.compression?.lastCompressedMessageId &&
                !isMessageInActivePath(
                  newMessageTree,
                  s.compression.lastCompressedMessageId,
                );

              return {
                ...s,
                messageCount: newMessages.length,
                updatedAt: Date.now(),
                compression: shouldClearCompression ? undefined : s.compression,
              };
            }),
          };
        });
        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
      },

      selectMessageVersion: (sessionId, messageId, targetMessageId) => {
        let treeToPersist: SessionMessageTree | null = null;

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};

          const newMessageTree = selectMessageBranch(
            getMessageTreeFromState(state),
            messageId,
            targetMessageId,
          );
          const newMessages = getActiveMessagePath(newMessageTree);
          treeToPersist = newMessageTree;
          return {
            activeMessageTree: newMessageTree,
            activeMessages: newMessages,
            sessions: state.sessions.map((session) => {
              if (session.id !== sessionId) return session;
              const shouldClearCompression =
                !!session.compression?.lastCompressedMessageId &&
                !isMessageInActivePath(
                  newMessageTree,
                  session.compression.lastCompressedMessageId,
                );
              return {
                ...session,
                messageCount: newMessages.length,
                updatedAt: Date.now(),
                compression: shouldClearCompression
                  ? undefined
                  : session.compression,
              };
            }),
          };
        });

        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
      },

      setSuggestedQuestions: (sessionId, messageId, questions) => {
        let treeToPersist: SessionMessageTree | null = null;

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};
          const newMessageTree = updateMessageInTree(
            getMessageTreeFromState(state),
            messageId,
            (message) => ({ ...message, suggestedQuestions: questions }),
          );
          treeToPersist = newMessageTree;
          return {
            activeMessageTree: newMessageTree,
            activeMessages: getActiveMessagePath(newMessageTree),
          };
        });
        if (treeToPersist) {
          get().syncActiveSession(sessionId, treeToPersist);
        }
      },

      deleteMessage: async (sessionId, messageId) => {
        let treeToPersist: SessionMessageTree | null = null;
        let previousMessages: Message[] | null = null;
        let previousMessageTree: SessionMessageTree | null = null;
        let previousSession: Session | undefined;
        let removedMessages: Message[] = [];

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};
          previousMessages = state.activeMessages;
          const currentMessageTree = getMessageTreeFromState(state);
          previousMessageTree = currentMessageTree;
          previousSession = state.sessions.find((s) => s.id === sessionId);
          const result = removeMessageFromTree(currentMessageTree, messageId);
          const newMessages = getActiveMessagePath(result.tree);
          removedMessages = result.removedMessages;
          treeToPersist = result.tree;
          return {
            activeMessages: newMessages,
            activeMessageTree: result.tree,
            sessions: state.sessions.map((s) =>
              s.id === sessionId
                ? { ...s, messageCount: newMessages.length }
                : s,
            ),
          };
        });
        if (treeToPersist) {
          try {
            await get().syncActiveSession(sessionId, treeToPersist);
          } catch (error) {
            logDevError(
              "Failed to persist deleted message before attachment cleanup",
              error,
            );
            set((state) => {
              if (
                state.currentSessionId !== sessionId ||
                state.activeMessageTree !== treeToPersist ||
                !previousMessages ||
                !previousMessageTree
              ) {
                return {};
              }

              return {
                activeMessages: previousMessages,
                activeMessageTree: previousMessageTree,
                sessions: state.sessions.map((s) =>
                  s.id === sessionId && previousSession
                    ? {
                        ...s,
                        messageCount: previousSession.messageCount,
                        updatedAt: previousSession.updatedAt,
                      }
                    : s,
                ),
              };
            });
            throw error;
          }

          const removedFileUrls = Array.from(
            getMessageAttachmentUrls(removedMessages),
          );
          if (removedFileUrls.length > 0) {
            await cleanupUnreferencedAttachmentUrls(
              removedFileUrls,
              async () => {
                const state = get();
                return getReferencedWorkspaceAndMessageFileUrls({
                  candidateUrls: removedFileUrls,
                  workspaces: state.workspaces,
                  sessions: state.sessions,
                  currentSessionId: state.currentSessionId,
                  activeMessageTree: getMessageTreeFromState(state),
                });
              },
            );
          }
          await removeResearchTaskSnapshots(
            getResearchTaskIds(removedMessages),
          );
        }
      },

      deleteMessageAndSubsequent: async (sessionId, messageId) => {
        let treeToPersist: SessionMessageTree | null = null;
        let previousMessages: Message[] | null = null;
        let previousMessageTree: SessionMessageTree | null = null;
        let previousSession: Session | undefined;
        let removedMessages: Message[] = [];

        set((state) => {
          if (state.currentSessionId !== sessionId) return {};
          previousMessages = state.activeMessages;
          const currentMessageTree = getMessageTreeFromState(state);
          previousMessageTree = currentMessageTree;
          previousSession = state.sessions.find((s) => s.id === sessionId);
          const result = removeMessageSubtree(currentMessageTree, messageId);
          if (result.removedMessages.length === 0) return {};

          const newMessages = getActiveMessagePath(result.tree);
          removedMessages = result.removedMessages;
          treeToPersist = result.tree;
          return {
            activeMessages: newMessages,
            activeMessageTree: result.tree,
            sessions: state.sessions.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    messageCount: newMessages.length,
                    updatedAt: Date.now(),
                  }
                : s,
            ),
          };
        });
        if (treeToPersist) {
          try {
            await get().syncActiveSession(sessionId, treeToPersist);
          } catch (error) {
            logDevError(
              "Failed to persist deleted message range before attachment cleanup",
              error,
            );
            set((state) => {
              if (
                state.currentSessionId !== sessionId ||
                state.activeMessageTree !== treeToPersist ||
                !previousMessages ||
                !previousMessageTree
              ) {
                return {};
              }

              return {
                activeMessages: previousMessages,
                activeMessageTree: previousMessageTree,
                sessions: state.sessions.map((s) =>
                  s.id === sessionId && previousSession
                    ? {
                        ...s,
                        messageCount: previousSession.messageCount,
                        updatedAt: previousSession.updatedAt,
                      }
                    : s,
                ),
              };
            });
            throw error;
          }

          const removedFileUrls = Array.from(
            getMessageAttachmentUrls(removedMessages),
          );
          if (removedFileUrls.length > 0) {
            await cleanupUnreferencedAttachmentUrls(
              removedFileUrls,
              async () => {
                const state = get();
                return getReferencedWorkspaceAndMessageFileUrls({
                  candidateUrls: removedFileUrls,
                  workspaces: state.workspaces,
                  sessions: state.sessions,
                  currentSessionId: state.currentSessionId,
                  activeMessageTree: getMessageTreeFromState(state),
                });
              },
            );
          }
          await removeResearchTaskSnapshots(
            getResearchTaskIds(removedMessages),
          );
        }
      },

      // --- Workspace Actions ---
      createWorkspace: (workspaceData) => {
        const newWorkspace: Workspace = {
          ...normalizeWorkspace(workspaceData as Workspace),
          id: workspaceData.id || uuidv7(),
          createdAt: Date.now(),
        };
        set((state) => ({ workspaces: [...state.workspaces, newWorkspace] }));
      },

      updateWorkspace: async (id, updates) => {
        let removedFileUrls: string[] = [];

        set((state) => ({
          workspaces: state.workspaces.map((w) => {
            if (w.id !== id) return w;

            const updatedWorkspace = normalizeWorkspace({ ...w, ...updates });
            if ("files" in updates) {
              removedFileUrls = getRemovedWorkspaceFileUrls(
                w.files,
                updatedWorkspace.files,
              );
            }

            return updatedWorkspace;
          }),
        }));

        if (removedFileUrls.length > 0) {
          await cleanupUnreferencedAttachmentUrls(removedFileUrls, async () => {
            const state = get();
            return getReferencedWorkspaceAndMessageFileUrls({
              candidateUrls: removedFileUrls,
              workspaces: state.workspaces,
              sessions: state.sessions,
              currentSessionId: state.currentSessionId,
              activeMessageTree: getMessageTreeFromState(state),
            });
          });
        }
      },

      deleteWorkspace: async (id) => {
        const workspace = get().workspaces.find((w) => w.id === id);
        const fileUrlsToCleanup = getAttachmentUrls(workspace?.files);

        // Move sessions in this workspace back to root (workspaceId = undefined)
        set((state) => {
          const updatedSessions = state.sessions.map((s) =>
            s.workspaceId === id ? { ...s, workspaceId: undefined } : s,
          );
          return {
            workspaces: state.workspaces.filter((w) => w.id !== id),
            sessions: updatedSessions,
          };
        });

        if (fileUrlsToCleanup.length > 0) {
          await cleanupUnreferencedAttachmentUrls(
            fileUrlsToCleanup,
            async () => {
              const state = get();
              return getReferencedWorkspaceAndMessageFileUrls({
                candidateUrls: fileUrlsToCleanup,
                workspaces: state.workspaces,
                sessions: state.sessions,
                currentSessionId: state.currentSessionId,
                activeMessageTree: getMessageTreeFromState(state),
              });
            },
          );
        }
      },

      setModel: (model) => set({ selectedModel: model }),

      setChatConfig: (config) =>
        set((state) => ({
          chatConfig: normalizeChatConfig({
            ...state.chatConfig,
            ...config,
            ...(isTemporarySessionId(state.currentSessionId)
              ? TEMPORARY_CHAT_CONFIG
              : {}),
          }),
        })),

      getCurrentSession: () => {
        const state = get();
        return state.sessions.find((s) => s.id === state.currentSessionId);
      },
    }),
    {
      name: STORAGE_KEYS.CHAT,
      storage: createJSONStorage(getAppDbStorage),
      version: STORAGE_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<ChatState>;
        return {
          ...state,
          sessions: (state.sessions || []).map((session) =>
            normalizeSession(session),
          ),
          workspaces: (state.workspaces || []).map((workspace) =>
            normalizeWorkspace(workspace),
          ),
          activeMessages: normalizeMessages(state.activeMessages),
          activeMessageTree: normalizeSessionMessageTree(state.activeMessages),
          selectedModel:
            state.selectedModel === DEPRECATED_DEFAULT_SELECTED_MODEL
              ? ""
              : state.selectedModel || "",
          chatConfig: normalizeChatConfig(state.chatConfig),
        } as ChatState;
      },
      skipHydration: false,
      // Only persist metadata and config, do NOT persist activeMessages in main key
      partialize: (state) => ({
        sessions: state.sessions.filter(
          (session) => !isTemporarySession(session),
        ),
        workspaces: state.workspaces, // Persist workspaces
        currentSessionId: isTemporarySessionId(state.currentSessionId)
          ? null
          : state.currentSessionId,
        selectedModel: state.selectedModel,
        chatConfig: state.chatConfig,
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (typeof window === "undefined") return;
          if (error) logDevError("Chat store hydration failed:", error);
          void (async () => {
            let completionError = error;
            if (!completionError && state?.currentSessionId) {
              try {
                await state.selectSession(state.currentSessionId);
                if (useChatStore.getState().activeSessionLoadError) {
                  completionError = new Error(
                    "The restored current session message tree could not be loaded.",
                  );
                }
              } catch (loadError) {
                completionError = loadError;
              }
            }

            await reportAppRestoreHydration("chat", completionError);
            state?.setHasHydrated(true);
          })().catch((restoreError) => {
            logDevError(
              "Restored chat data failed startup validation:",
              restoreError,
            );
            window.location.reload();
          });
        };
      },
    },
  ),
);
