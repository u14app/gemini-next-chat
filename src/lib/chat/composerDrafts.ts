import {
  isTemporarySessionId,
  readTemporaryDraft,
  writeTemporaryDraft,
} from "./sessionRetention";

const COMPOSER_DRAFTS_STORAGE_KEY = "neo-chat-composer-drafts-v1";
const MAX_COMPOSER_DRAFTS = 100;
const MAX_DRAFT_LENGTH = 50_000;

interface ComposerDraft {
  text: string;
  updatedAt: number;
}

type ComposerDraftMap = Record<string, ComposerDraft>;

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readDraftMap = (storage: Storage): ComposerDraftMap => {
  try {
    const parsed = JSON.parse(
      storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) || "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([sessionId, draft]) =>
          Boolean(sessionId) &&
          Boolean(draft) &&
          typeof draft === "object" &&
          typeof (draft as ComposerDraft).text === "string" &&
          Number.isFinite((draft as ComposerDraft).updatedAt),
      ),
    ) as ComposerDraftMap;
  } catch {
    return {};
  }
};

export const readComposerDraft = (sessionId: string): string => {
  if (isTemporarySessionId(sessionId)) return readTemporaryDraft(sessionId);
  const storage = getStorage();
  if (!storage || !sessionId) return "";
  return readDraftMap(storage)[sessionId]?.text || "";
};

export const writeComposerDraft = (
  sessionId: string,
  text: string,
  now = Date.now(),
): void => {
  if (isTemporarySessionId(sessionId)) {
    writeTemporaryDraft(sessionId, text);
    return;
  }
  const storage = getStorage();
  if (!storage || !sessionId) return;

  try {
    const drafts = readDraftMap(storage);
    const normalizedText = text.slice(0, MAX_DRAFT_LENGTH);

    if (normalizedText) {
      drafts[sessionId] = { text: normalizedText, updatedAt: now };
    } else {
      delete drafts[sessionId];
    }

    const boundedDrafts = Object.fromEntries(
      Object.entries(drafts)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_COMPOSER_DRAFTS),
    );

    if (Object.keys(boundedDrafts).length === 0) {
      storage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      return;
    }
    storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(boundedDrafts));
  } catch {
    // Draft persistence is best-effort and must never block the composer.
  }
};

export const clearComposerDraft = (sessionId: string): void => {
  writeComposerDraft(sessionId, "");
};

export { COMPOSER_DRAFTS_STORAGE_KEY };
