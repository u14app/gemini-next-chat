"use client";

import { useShallow } from "zustand/react/shallow";

import { useChatStore } from "@/store/core/chatStore";

export function useSidebarSessions() {
  return useChatStore(
    useShallow((state) => ({
      sessions: state.sessions,
      workspaces: state.workspaces,
      currentSessionId: state.currentSessionId,
      createSession: state.createSession,
      selectSession: state.selectSession,
      deleteSession: state.deleteSession,
      updateSessionTitle: state.updateSessionTitle,
      toggleSessionPin: state.toggleSessionPin,
      duplicateSession: state.duplicateSession,
      moveSessionToWorkspace: state.moveSessionToWorkspace,
    })),
  );
}
