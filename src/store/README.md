# Store Architecture

Neo Chat uses Zustand for client state. Stores are split by domain and persisted with a hybrid local-first strategy: small synchronous settings live in `localStorage`, larger app data lives in IndexedDB through `localforage`, and transient UI state stays in memory.

## Directory Map

```text
src/store/
├── core/
│   ├── chatStore.ts
│   ├── coreSettingsStore.ts
│   ├── knowledgeStore.ts
│   ├── memoryStore.ts
│   ├── settingsStore.ts
│   └── uiStore.ts
├── hooks/
│   ├── useHydration.ts
│   ├── useShallowStore.ts
│   ├── useStoreSync.ts
│   └── useStoreWithSSR.ts
├── storage/
│   ├── legacyGeminiMigration.ts
│   ├── migrations.ts
│   └── storageConfig.ts
├── index.ts
└── README.md
```

## Store Responsibilities

### `coreSettingsStore`

Stores frequently needed core settings such as theme, language, keyboard
shortcut bindings, provider records, provider API keys, and default model
selections. These values are kept in `localStorage` for fast synchronous access.
The non-secret shortcut bindings are part of the core-settings backup and
end-to-end encrypted sync document.

### `settingsStore`

Stores broader app configuration, including system behavior, model metadata, search, RAG, voice, plugins, installed/custom skills, skill catalog and definition caches, custom assistants, and other settings that are better suited to IndexedDB.

### `chatStore`

Owns chat sessions, messages, workspaces, message branching, session export/import state, and session-level configuration. Session and workspace config can include active plugin and skill presets. Message-heavy data is stored separately from session metadata where practical.

### `knowledgeStore`

Owns knowledge collections, file metadata, upload and indexing status, OPFS-backed file records, and RAG chunk metadata.

### `memoryStore`

Owns local long-term memories, memory automation settings, and dream
consolidation status. Memories are stored in IndexedDB and may be supplied to
model requests when the built-in memory search tool is used.

### `uiStore`

Owns temporary UI state such as previews, modal state, loading flags, and other non-persistent interaction state.

## Hooks

Use selectors that read the smallest state slice needed by a component:

```typescript
const title = useChatStore((state) => state.sessions[0]?.title);
const createSession = useChatStore((state) => state.createSession);
```

Use prebuilt shallow hooks when a component needs a small group of related values:

```typescript
import { useChatActions, useChatSession } from "@/store";

function SessionList() {
  const { sessions, currentSessionId } = useChatSession();
  const { createSession, deleteSession } = useChatActions();
}
```

Use SSR-safe helpers when a persisted value can differ between server render and client hydration:

```typescript
import { useCoreSettingsStore, useStoreWithSSR } from "@/store";

const theme = useStoreWithSSR(
  useCoreSettingsStore,
  (state) => state.theme,
  "system",
);
```

## Persistence Strategy

- Use `localStorage` for small core settings that must be available immediately.
- Use IndexedDB for larger or structured data such as sessions, messages, plugins, skills, assistants, knowledge metadata, and memories.
- Use OPFS for uploaded file bytes and local file handles.
- Do not persist transient UI state.
- Keep the active conversation selection in runtime state so a page reload opens the welcome view; conversations and their messages remain durable, and explicit session navigation still selects them normally.
- Use `partialize` to persist only fields that need to survive reloads.

## Performance Guidelines

- Select the smallest possible state slice.
- Avoid selecting entire objects when a component only needs one field.
- Prefer action selectors over destructuring a whole store.
- Use shallow selectors for small grouped values.
- Keep cross-store coordination inside actions or service helpers rather than spreading it across components.

## Migration Notes

Storage migrations live under `src/store/storage`. They normalize old persisted shapes, fill missing tool-call status fields, and preserve compatibility with older local-first data.

When changing persisted state:

1. Keep old data readable.
2. Add a migration or normalizer when fields are renamed or reshaped.
3. Keep defaults explicit.
4. Add tests for migrated data when the shape is user-visible or difficult to recreate.

## Debugging

Useful browser panels and tools:

- Chrome DevTools > Application > Local Storage
- Chrome DevTools > Application > IndexedDB
- Chrome DevTools > Application > OPFS
- React DevTools Profiler for render churn
- Zustand DevTools when enabled locally
