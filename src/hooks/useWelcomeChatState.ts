"use client";

import { useEffect, useRef, useState } from "react";

type WelcomeState = "visible" | "exiting" | "hidden";
type MessageInputVariant = "default" | "hero";

interface UseWelcomeChatStateOptions {
  currentSessionId: string | null | undefined;
  isChatEmpty: boolean;
}

interface UseWelcomeChatStateResult {
  welcomeState: WelcomeState;
  messageInputVariant: MessageInputVariant;
  shouldShowChatTitleBar: boolean;
}

export function useWelcomeChatState({
  currentSessionId,
  isChatEmpty,
}: UseWelcomeChatStateOptions): UseWelcomeChatStateResult {
  const [welcomeState, setWelcomeState] = useState<WelcomeState>("hidden");
  const prevSessionIdRef = useRef(currentSessionId);

  useEffect(() => {
    if (prevSessionIdRef.current !== currentSessionId) {
      setWelcomeState(isChatEmpty ? "visible" : "hidden");
      prevSessionIdRef.current = currentSessionId;
      return;
    }

    if (!isChatEmpty && welcomeState === "visible") {
      setWelcomeState("exiting");
    } else if (isChatEmpty && welcomeState !== "visible") {
      setWelcomeState("visible");
    }
  }, [currentSessionId, isChatEmpty, welcomeState]);

  useEffect(() => {
    if (welcomeState !== "exiting") return;

    const timer = setTimeout(() => {
      setWelcomeState("hidden");
    }, 300);
    return () => clearTimeout(timer);
  }, [welcomeState]);

  return {
    welcomeState,
    messageInputVariant: welcomeState === "visible" ? "hero" : "default",
    shouldShowChatTitleBar: welcomeState === "hidden",
  };
}
