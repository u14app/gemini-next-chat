import type { Session } from "@/types";

// Retain only IDs and cancellation handles after disposal. A late callback must
// never interpret a removed temporary session as an ordinary persistent one.
const temporarySessions = new Map<string, AbortController>();
const temporaryDrafts = new Map<string, string>();

export function isTemporarySession(
  session?: Pick<Session, "retention"> | null,
) {
  return session?.retention === "temporary";
}

export function isTemporarySessionId(sessionId?: string | null): boolean {
  return Boolean(sessionId && temporarySessions.has(sessionId));
}

export function registerTemporarySession(sessionId: string): void {
  if (!temporarySessions.has(sessionId)) {
    temporarySessions.set(sessionId, new AbortController());
  }
}

export function getTemporarySessionSignal(sessionId?: string | null) {
  return sessionId ? temporarySessions.get(sessionId)?.signal : undefined;
}

export function endTemporarySession(sessionId: string): void {
  temporaryDrafts.delete(sessionId);
  temporarySessions.get(sessionId)?.abort();
}

export function readTemporaryDraft(sessionId: string): string {
  return temporaryDrafts.get(sessionId) || "";
}

export function writeTemporaryDraft(sessionId: string, text: string): void {
  const signal = getTemporarySessionSignal(sessionId);
  if (!signal || signal.aborted) return;
  if (text) temporaryDrafts.set(sessionId, text.slice(0, 50_000));
  else temporaryDrafts.delete(sessionId);
}

export const TEMPORARY_CHAT_CONFIG = {
  chatMode: "chat" as const,
  useAgentMode: false,
  useDeepResearch: false,
  useRAG: false,
};
