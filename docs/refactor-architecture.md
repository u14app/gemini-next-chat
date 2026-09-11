# Refactor Architecture Boundaries

Refactors in Neo Chat are incremental. Preserve public route URLs, persisted
storage keys, message-tree shape, BYOK envelopes, and request/response schemas
unless a separate migration plan changes the contract. Prefer a small seam
with a focused test over a cross-layer rewrite.

## Route code to the owning layer

| Layer                     | Owns                                                 | Boundary                                                                                              |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/components/`         | Rendering, local interaction, feature UI composition | Receive explicit props; keep store writes in hooks or services                                        |
| `src/hooks/`              | Shared React hooks and UI workflows                  | May subscribe to stores; a large domain gets a subdirectory such as `research/`                       |
| `src/lib/<domain>/`       | Framework-independent domain logic and helpers       | Keep modules pure by default; name server-only modules clearly and never import them into client code |
| `src/services/api/`       | Browser API clients and client workflow coordination | Call API routes and return typed results; do not hide store mutations                                 |
| `src/app/api/**/route.ts` | Request parsing and response handling                | Delegate feature logic; keep provider-specific behavior in adapters                                   |

Domain-local types live beside their owners, such as
`src/lib/chat/types.ts` and `src/lib/plugin/types.ts`. Keep
`src/types.ts` as the compatibility export for existing imports; new code
should import from the owning domain when it is clear.

## Browser-only rendering and action boundaries

`markdown/extensionResources.ts` keeps browser checks directly beside all 12
extension imports: GFM, math parsing and rendering, HTML, highlighting,
Artifacts, diagrams, charts, files, citations, images, and read-only code.
Next resolves `typeof window` at build time for each target, removing these
extension implementations from SSR while retaining the browser resource cache
and retry behavior. Do not replace these checks with effect-only loading: an
import that never executes on the server can still enter its bundle.

CommonMark and visualization source fallbacks remain server-rendered, including
on shared conversation pages. Browser components still own enhanced rendering,
theme changes, full-screen controls, and image export. Verify both server
source maps and client chunks after changing this boundary; a passing component
test alone does not prove server bundle exclusion.

Browser direct-provider clients, attachment image compression, message image
export, workspace ZIP creation, and OPFS operations load their libraries behind
explicit browser guards. Keep OPFS path validation synchronous and independent
of browser APIs. Import failures must preserve the existing action error paths
and allow later attempts to retry.

Interactive workspace, attachment, Agent, Research, skill-parameter, and agent
question dialogs use `next/dynamic` with `ssr: false` in their client owners.
Keep their existing visibility and state-reset lifecycle; the chat shell,
message text, and public sharing pages retain SSR.

Server API provider SDKs and document ZIP parsing remain server dependencies.
GFM parsing also remains available to shared Research report and evidence
processing; isolating the renderer does not remove these domain parsers.
Shared persistence initialization retains its existing synchronous
interface: removing a browser library from SSR must not silently change store
hydration, migrations, or backup restore semantics.

## Deep Research layout

Deep Research spans the layers above. New code belongs in the narrowest matching
area:

| Area                              | Responsibility                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/research/`               | Pure plans, prompts, templates, evidence, claims, search policy, and orchestration. It does not read stores or dispatch providers. Its `index.ts` barrel exposes pure modules only.                                            |
| `src/lib/research/runtime/`       | Store-aware execution. `prepareExecution.ts` builds the execution context; `stages/` owns exploration, verification, synthesis, and failure; `wave/` owns prepare → stream → archive → integrate.                              |
| `src/services/research/`          | Task persistence, Artifact IO, extension records, locks, and lifecycle. `taskRepository/` owns the core schema; `extensionRepository.ts` owns the IndexedDB v1 sidecar `neo-chat-research-extensions`.                         |
| `src/lib/plugin/researchSources/` | Fixed-endpoint source catalog, bounded server adapters, throttling, parsers, and client normalization. Built-in source dispatch goes through `src/app/api/plugins/execute/route.ts` and the existing Plugin security boundary. |
| `src/hooks/research/`             | React actions over the runtime. `ResearchRuntimeProvider.tsx` composes hooks rather than owning domain logic.                                                                                                                  |
| `src/components/research/`        | Presentation. `ui/`, `workbench/`, and `topology/` expose rendering barrels; `viewModel/` builds canonical plan, run, evidence, claim, trust, and version-diff views.                                                          |

Within the pure layer, `templates.ts` owns the serializable template contract,
`steering.ts` owns command and frontier projection, and
`evidenceConversations.ts` owns frozen-snapshot and citation rules. These
modules do not open storage or dispatch providers.

The research extension sidecar stores templates, task snapshots, source
contracts, steering queues, evidence snapshots, and Q&A threads without
changing the core Research schema. Lifecycle code clones ID-bearing extension
records during session copies and prunes them on task deletion and cleanup.
Task leases are explicit: lifecycle actions reload durable state under the
lease and pass it into execution without reacquiring it. Hydration never
recovers another tab's active task. Global OPFS orphan sweeping remains
suspended until it can share a maintenance lock with publishers; explicit task
deletion still checks Artifact references.

`runtime/steering.ts` consumes durable commands only at a safe wave boundary
under the task Web Lock. `runtime/evidenceConversation.ts` owns
one-request-per-topic streaming, cancellation, retry, and exact report-version
routing. Import
`ResearchRuntimeProvider.tsx` and `ConnectedResearchViews.tsx` by path when a
component needs them so a research card does not pull in the runtime.

## Client, server, and source boundaries

Client components and hooks must not import server-only modules. API routes may
inject external dependencies such as `fetch` and secret decryption into
executors so tests can keep those boundaries explicit. Server adapters
normalize provider behavior while preserving route schemas and response
contracts.

Research source adapters accept only their fixed official HTTPS hosts and
expose `local_read`/`network_read` operations. Search results are discovery
data; the client creates formal evidence only from a committed read. Provider
credentials and coordination state stay in server-side or encrypted local
secret seams and never enter pure Research types.

## Naming and change hygiene

- React components use `PascalCase.tsx`.
- Hooks use `useX.ts`.
- Helpers, server modules, and domain utilities use `camelCase.ts`.
- Next route convention files keep their framework names.
- Rename a file only when it is already being moved or split.

Keep visual components presentational, expose explicit typed interfaces, and
avoid adding a store subscription when a feature hook can own the workflow.
When a contract must change, document the migration and compatibility reader in
the same change.

## Verification

Each independently mergeable phase should pass the focused checks appropriate
to its boundary, at minimum:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

Also run `corepack pnpm check:imports` and `corepack pnpm format:check` when moving modules or
changing documentation and imports. Keep browser/E2E, deployment, and Cloud
validation separate from local static and unit-test evidence.
