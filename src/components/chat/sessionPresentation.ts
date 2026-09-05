import type { Message, Session, SessionMessageTree } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { appDb } from "@/store/storage/storageConfig";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { createSessionExportPayload } from "@/lib/chat/sessionExport";

export async function readSessionForPresentation(session: Session) {
  await waitForSessionMessageWrites(session.id);
  const state = useChatStore.getState();
  return createSessionExportPayload({
    session,
    currentSessionId: state.currentSessionId,
    activeMessages: state.activeMessages,
    activeMessageTree:
      state.currentSessionId === session.id
        ? state.activeMessageTree
        : undefined,
    loadMessages: (id) =>
      appDb.getItem<Message[] | SessionMessageTree>(`session_messages_${id}`),
  });
}
