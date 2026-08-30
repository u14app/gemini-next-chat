"use client";

import { useCallback, useState } from "react";

import type { Attachment } from "@/types";

interface UseMessageComposerOptions {
  initialText?: string;
  initialAttachments?: Attachment[];
}

export function useMessageComposer({
  initialText = "",
  initialAttachments = [],
}: UseMessageComposerOptions = {}) {
  const [text, setText] = useState(initialText);
  const [attachments, setAttachments] =
    useState<Attachment[]>(initialAttachments);

  const reset = useCallback(() => {
    setText(initialText);
    setAttachments(initialAttachments);
  }, [initialAttachments, initialText]);

  return {
    text,
    setText,
    attachments,
    setAttachments,
    reset,
  };
}
