# Refactor Architecture Boundaries

This project uses incremental refactors. Each step must keep the public route
URLs, persisted storage keys, message tree shape, BYOK envelopes, and request
schemas compatible unless a separate migration plan says otherwise.

## Directory Roles

- `src/components` contains rendering, local interaction, and feature-local UI
  composition. Components should receive explicit props and avoid hidden store
  writes when a feature hook can own the workflow.
- `src/hooks` contains the shared React hooks the chat shell and composer are
  built from. A hook here can subscribe to stores and own a UI workflow. A
  domain with many hooks gets a subdirectory, such as `src/hooks/research`.
- `src/lib/<domain>` contains domain logic and helpers that are independent of
  React rendering. Server-only modules can live here when they are clearly
  named and not imported by client components. Modules directly under a domain
  are pure; a domain that also owns a store-aware orchestration layer keeps it
  in a clearly named subdirectory, such as `src/lib/research/runtime`.
- `src/services/api` is the browser-facing API client layer. It should call API
  routes and return typed results, not hide store mutations.
- `src/app/api/**/route.ts` should parse requests, call server feature modules,
  and return responses. Provider-specific branches belong in adapters.

## Deep Research Layout

Deep Research is the largest domain, so it splits across those roles instead of
living in one directory. Keep new research code in the matching one:

- `src/lib/research/` — pure domain logic with no React and no store reads.
  `prompts/`, `orchestration/`, `reportAudit/`, and `types/` are directories
  with an `index.ts` barrel, so `@/lib/research/<name>` stays a valid import.
  `templates.ts` owns the serializable Research template contract and default
  application; `steering.ts` owns the pure command and frontier projection;
  `evidenceConversations.ts` owns frozen-snapshot and citation rules. These
  modules do not open storage or dispatch providers.
  `searchPolicy.ts` compiles only the explicitly approved plan scope into
  normalized web constraints; Tool bindings may narrow that policy but cannot
  widen it.
- `src/lib/research/runtime/` — the store-aware execution runtime, and the one
  part of `src/lib/research` that reads stores and workspace IO.
  `prepareExecution.ts` builds the `ResearchExecutionContext` that replaces the
  former `executeResearch` closure; `stages/` holds exploration, verification,
  synthesis, and failure handling; `wave/` holds one wave's prepare → stream →
  archive → integrate pipeline. It is not exported from the
  `src/lib/research/index.ts` barrel, so pure consumers never pull it in.
- `src/services/research/` — persistence and artifact IO. `taskRepository/`
  holds the persisted schema (`schema/`), sanitization, and the backends.
  `extensionRepository.ts` is a separate IndexedDB v1 sidecar named
  `neo-chat-research-extensions`; it stores template records, task snapshots,
  source definition contracts, steering queues, evidence snapshots, and Q&A
  threads without changing the core Research database schema. `templates.ts`
  and `evidenceConversations.ts` are the typed persistence seams. Lifecycle
  code clones ID-bearing extension records during session copies and prunes
  them with task deletion and cleanup.
  `taskExecutionLock.ts` grants explicit task leases; lifecycle actions reload
  durable state under a lease and pass it through execution without reacquiring
  the lock. Hydration never recovers another tab's active task. Automatic global
  OPFS orphan sweeping is suspended until it can share a maintenance lock with
  file publishers; explicit task deletion still checks Artifact references.
  `src/lib/plugin/researchSources/` contains the fixed-endpoint source catalog,
  server adapters, bounded parsers, transport throttling, and client result
  normalization. `src/app/api/plugins/execute/route.ts` dispatches these
  registered built-ins through the existing plugin security boundary; source
  credentials never cross into pure Research types.
- `src/lib/research/runtime/` also contains `steering.ts` and
  `evidenceConversation.ts`: the former consumes durable commands at a safe
  wave boundary under a task Web Lock, while the latter owns one-request-per-
  topic streaming, cancellation, retry, and exact report-version routing.
- `src/hooks/research/` — the React layer over that runtime. Each hook owns one
  action group, and `ResearchRuntimeProvider.tsx` only composes them.
- `src/components/research/` — rendering. `ui/`, `workbench/`, and `topology/`
  are directories with an `index.ts` barrel. `viewModel/` builds the
  canonical presentation model for plans, runs, evidence, claims, historical
  report trust metadata, and version diffs, so it lives beside the `types.ts`
  that owns those view types. `ResearchRuntimeProvider.tsx` and
  `ConnectedResearchViews.tsx` are imported by path rather than through
  `index.ts`, so importing a research card does not pull in the runtime.

## Naming

- React component files use `PascalCase.tsx`.
- Hooks use `useX.ts`.
- Non-component helpers, server modules, and domain utilities use
  `camelCase.ts`.
- Next route convention files keep their framework names.
- Rename files only when they are already being moved or split.

## Type Ownership

- Domain-local type files live next to their domain, such as
  `src/lib/chat/types.ts` and `src/lib/plugin/types.ts`.
- `src/types.ts` remains the compatibility export for existing imports.
- New code should prefer domain-local type imports when the owning domain is
  obvious.

## Client And Server Boundaries

- Client components and hooks must not import server-only modules.
- API routes should pass external dependencies, such as fetch and secret
  decryption, into extracted executors when that keeps tests explicit.
- Server adapters should normalize provider behavior but leave route schemas and
  response contracts intact.
- Research source adapters accept only fixed official HTTPS hosts and expose
  `local_read`/`network_read` operations. Search results remain discovery data;
  the client normalization seam creates formal evidence only from a committed
  read. Provider credentials and coordination state stay in server-side or
  encrypted local-secret seams.

## Verification

Every independently mergeable phase should pass:

```bash
pnpm typecheck
pnpm lint
pnpm test
```
