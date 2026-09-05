import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerTemporarySession,
  endTemporarySession,
} from "@/lib/chat/sessionRetention";
import {
  COMPOSER_DRAFTS_STORAGE_KEY,
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "@/lib/chat/composerDrafts";

const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => {
    values.delete(key);
  },
  setItem: (key, value) => {
    values.set(key, value);
  },
};

describe("composer drafts", () => {
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", { localStorage: storage });
  });

  it("keeps a temporary draft only in memory and rejects late writes after ending", () => {
    registerTemporarySession("temporary-draft-test");
    writeComposerDraft("session-a", "ordinary");
    const before = storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
    writeComposerDraft("temporary-draft-test", "private draft");
    expect(readComposerDraft("temporary-draft-test")).toBe("private draft");
    expect(storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY)).toBe(before);
    endTemporarySession("temporary-draft-test");
    writeComposerDraft("temporary-draft-test", "late unmount draft");
    expect(readComposerDraft("temporary-draft-test")).toBe("");
    expect(storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY)).toBe(before);
  });

  it("keeps independent drafts for each session", () => {
    writeComposerDraft("session-a", "alpha", 1);
    writeComposerDraft("session-b", "beta", 2);

    expect(readComposerDraft("session-a")).toBe("alpha");
    expect(readComposerDraft("session-b")).toBe("beta");
  });

  it("clears only the selected session draft", () => {
    writeComposerDraft("session-a", "alpha", 1);
    writeComposerDraft("session-b", "beta", 2);

    clearComposerDraft("session-a");

    expect(readComposerDraft("session-a")).toBe("");
    expect(readComposerDraft("session-b")).toBe("beta");
  });

  it("recovers from malformed persisted data", () => {
    storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, "{broken");

    expect(readComposerDraft("session-a")).toBe("");
    expect(() => writeComposerDraft("session-a", "safe")).not.toThrow();
    expect(readComposerDraft("session-a")).toBe("safe");
  });

  it("bounds retained drafts to the most recently updated 100 sessions", () => {
    for (let index = 0; index < 101; index += 1) {
      writeComposerDraft(`session-${index}`, `draft-${index}`, index);
    }

    expect(readComposerDraft("session-0")).toBe("");
    expect(readComposerDraft("session-100")).toBe("draft-100");
  });
});
