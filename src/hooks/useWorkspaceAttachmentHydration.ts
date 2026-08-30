"use client";

import { RefObject, useEffect, useRef } from "react";

import type { Attachment, Workspace } from "@/types";

interface AttachmentInputHandle {
  setAttachments: (attachments: Attachment[]) => void;
}

interface UseWorkspaceAttachmentHydrationOptions {
  activeMessagesLength: number;
  currentSessionId: string | null | undefined;
  currentSessionWorkspaceId: string | null | undefined;
  inputRef: RefObject<AttachmentInputHandle | null>;
  workspaces: Workspace[];
}

export function useWorkspaceAttachmentHydration({
  activeMessagesLength,
  currentSessionId,
  currentSessionWorkspaceId,
  inputRef,
  workspaces,
}: UseWorkspaceAttachmentHydrationOptions) {
  const inputSessionRef = useRef(currentSessionId);
  const hydratedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const inputSessionChanged = inputSessionRef.current !== currentSessionId;
    if (inputSessionChanged) {
      inputSessionRef.current = currentSessionId;
      hydratedSessionRef.current = null;
    }

    const input = inputRef.current;
    if (!input) return;

    if (!currentSessionId || activeMessagesLength > 0) {
      hydratedSessionRef.current = null;
      if (inputSessionChanged) {
        input.setAttachments([]);
      }
      return;
    }

    if (hydratedSessionRef.current === currentSessionId) {
      return;
    }

    const workspaceFiles = currentSessionWorkspaceId
      ? workspaces.find(
          (workspace) => workspace.id === currentSessionWorkspaceId,
        )?.files || []
      : [];
    input.setAttachments(workspaceFiles);
    hydratedSessionRef.current = currentSessionId;
  }, [
    activeMessagesLength,
    currentSessionId,
    currentSessionWorkspaceId,
    inputRef,
    workspaces,
  ]);
}
