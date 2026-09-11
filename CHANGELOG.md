# Changelog

All notable changes to Neo Chat should be documented here.

This project does not yet follow a formal release cadence. Maintainers should
group changes under a level-2 heading that matches the release tag, such as
`## v2.0.0`; the release workflow uses that section as the GitHub release notes
when the matching tag is pushed.

## Unreleased

- Isolated local E2E deployment settings and Next.js development output so smoke
  tests can run alongside the normal dev server; fixed missing-translation errors
  for custom skill categories.
- Excluded Markdown extensions (including ECharts, Mermaid, mind maps, math,
  and highlighting), browser-only action libraries, and interactive dialogs
  from SSR bundles while preserving readable server fallbacks and browser
  rendering, storage, export, and dialog behavior.
- Fixed tool argument and MCP output-schema validation in strict CSP and
  Cloudflare environments by using an interpreter without dynamic JavaScript
  compilation; removed the application's direct Ajv dependency.
- Fixed streaming auto-scroll with TanStack Virtual's end-anchor correction,
  preserving the viewport when users scroll up to read earlier messages.
- Updated E2E fixtures for explicit conversation selection, model setup, and
  current Agent/search controls; wait for initialized layouts before testing
  keyboard focus and shortcuts.
- Simplified the project documentation and added a documentation hub, official
  Docker image deployment instructions, and upgrade/rollback guidance.

## v2.5.0

- **Agent runtime:** Expanded Agent mode with dynamic Tool and Skill discovery,
  task plans, structured user questions, scoped Memory, workspace and Artifact
  operations, MCP resources/prompts, persistent execution records, resumable
  runs, and effect-aware confirmation. Tools loaded by the host are explicitly
  authorized for later model rounds.
- **Chat generation reliability:** Stopping before a conversation switch now
  captures and persists the originating stream before navigation. Continuing an
  interrupted response retains existing document, search, image, plan, and Tool
  blocks while recording new structured output and Tool state.
- **Deep Research:** Added model-knowledge-first planning, bounded knowledge and
  public lookup, reviewable plans, adaptive research rounds, durable checkpoints,
  claim-to-evidence auditing, local citations, partial reports, manual resume,
  report versions, and the responsive Research workbench. Planning keeps the
  originally selected model through recovery, and approved workspace failures
  pause visibly instead of silently removing sources.
- **Deep Research templates:** Added four built-in research templates for
  competitive analysis, literature review, due diligence, and technical
  evaluation, plus local custom template management, revisioned Profile
  snapshots, explicit inheritance or no-template states, and immutable
  per-task template snapshots.
- **Specialized read-only sources:** Added arXiv, PubMed, EPO OPS, and SEC EDGAR
  search/read adapters with fixed official endpoints, source-scope and
  definition-fingerprint checks, encrypted local credentials, bounded parsing,
  provider-aware throttling, and discovery results that become evidence only
  after a source read is committed.
- **Frontier steering:** Added durable safe-wave commands to promote, demote,
  restore, or add a research node. Task Web Locks serialize execution; queued
  changes are applied after a completed wave and checkpoint, while late or
  already scheduled changes receive an explicit rejection.
- **Evidence conversations:** Added report-version-bound evidence snapshots and
  multiple local Q&A topics per report. Answers stream with cancellation and
  retry, use only the frozen report/evidence/claim ledger, and validate every
  citation against that snapshot without tools, network, Memory, or Research
  execution.
- **Research extension storage:** Added the local IndexedDB
  `neo-chat-research-extensions` v1 sidecar for templates, source contracts,
  steering records, evidence snapshots, and threads. The core Research store
  and existing ZIP format remain unchanged; task deletion, session copies, and
  orphan cleanup maintain the sidecar lifecycle. These extension records remain
  browser-local and are not yet included in ZIP backup or encrypted sync.
- **Research reliability and presentation:** Research searches share a serial
  queue with two-second spacing, preserve partial batches, respect cooldowns,
  and allow 90 seconds for Tavily Research and planning summaries. Evidence
  recovery preserves committed excerpts and stable source identity; report
  headings, dates, numbers, appendices, quality details, and downloads follow the
  selected English, Chinese, or Japanese locale. Search images retain provenance
  without becoming verified evidence merely by discovery.
- **Research rollback compatibility:** New reconnaissance records can contain
  `timeoutMs: 90000`; older readers capped at 30000 need the validator update
  before opening these records. Existing reports are not rewritten.
- **Encrypted synchronization:** Added opt-in WebDAV and S3/MinIO synchronization
  using per-domain Automerge documents, browser-side HKDF/AES-GCM encryption,
  opaque remote names, recovery codes, conflict visibility, transactional local
  apply, and encrypted OPFS chunks. A local edit made during remote blob download
  now forces a bounded remerge instead of being overwritten by a stale result.
- **Conversation controls:** Added customizable page-scoped keyboard shortcuts,
  shared sidebar/titlebar actions, and icon-only temporary text chats that stay
  out of saved history. Empty conversations hide titlebar actions, and shared
  dialogs retain keyboard focus and expose consistent close behavior.
- **Read-only sharing:** Redis snapshots include the selected branch, images, and
  Research reports with configurable expiry, explicit updates, and revocation
  before local deletion. Sharing defaults off behind `SHARING_ENABLED`; disabling
  publication preserves authenticated revocation while preventing public reads.
- **Rendering and documents:** CommonMark renders immediately while syntax
  extensions load independently, preserving streaming fences and source
  placeholders. Long model output can become persistent document blocks with
  preview, editing, and export controls.
- **Charts and visual export:** Added ECharts-backed `chart` Markdown fences
  with a strict JSON `version: 1` / `renderer: "echarts"` envelope,
  inline-only datasets, theme-aware defaults, and the `markdown-chart`
  compatibility alias. Charts provide a chart-only view, fullscreen rendering,
  localized loading/error/retry states, Markdown table copying, and PNG saving.
  Chart-aware image and PDF exports wait for rendering, and Mermaid diagrams
  and mind maps can also be saved as PNG images.
- **Conversation startup:** Reloads now open the welcome view while preserving
  durable conversations, and sync rehydration keeps an explicitly selected
  in-memory conversation and its loaded messages instead of replacing them
  with stale persisted selection state.
- **Mermaid mindmap presentation:** Scoped the article palette to Mermaid
  sources detected as `mindmap`, with opaque borderless circular nodes, SVG text
  labels, and curved links while preserving explicit shapes, rich labels,
  copied source, and the existing appearance of other diagram renderers.
- **Mermaid diagram palettes:** Corrected abnormal dark-color collapse in Git
  graphs, timelines, kanban boards, radar charts, and treemaps with derived
  light/dark palettes, readable text and labels, and stronger boundary and
  stroke contrast. The overrides are scoped to those diagram types, embedded
  in rendered SVG for fullscreen and exports, and preserve source and layout.
- **Providers and media:** Added direct browser requests for configured custom
  model providers, multi-password deployment access, HEIC/HEIF conversion, and
  staged image compression with file-backed native OpenAI, Google, and Anthropic
  multimodal uploads. Loading and shared UI presentation use consistent states.
- **Web reading reliability:** Jina failures can fall back once to a bounded
  direct public-page read. Challenge pages and application errors are rejected
  before evidence creation, and asynchronous plugin failures use route-level
  error handling.
- **Deployment and release safety:** Standardized local, CI, Docker, and Worker
  builds on Node 24. Docker quick starts require an access password and verify API
  availability. Hosted HTML receives per-request CSP nonces and bounded
  WebAssembly permission. Compatible framework, provider, sanitizer, validator,
  and MCP dependency updates clear the production audit; tag releases validate
  the package version and pass source, Next.js, Worker, and dependency checks
  before publication.
- **Dependency security:** Updated vulnerable root and MCP Bridge dependency
  resolutions for Sharp, JS-YAML, Vitest, baseline-browser-mapping,
  brace-expansion, Hono, qs, fast-uri, ip-address, and the Hono Node adapter.

## v2.4.0

- **Private cross-device vault:** Added opt-in WebDAV and S3/MinIO sync with
  per-domain Automerge documents, client-side HKDF/AES-GCM encryption,
  opaque remote object names, encrypted OPFS chunks, device state, recovery
  codes, deterministic conflict handling, transactional local application, and
  no server-side credential or plaintext persistence. ZIP export remains
  version 3 and deliberately excludes sync keys, credentials, baselines, and
  device identity.
- **Remote MCP compatibility:** Added legacy SSE support alongside Streamable
  HTTP, preferring Streamable HTTP and falling back only when initial connection
  setup returns 404 or 405. The negotiated transport is persisted for later
  tool calls, authentication failures remain visible, and Registry servers that
  require header credentials now collect them before discovery and keep them in
  local encrypted-secret storage.
- **Local MCP bridge:** Added an optional hardened Docker profile that exposes
  deployment-admin allowlisted stdio MCP servers through authenticated
  Streamable HTTP. Commands and environment variables come only from a
  read-only configuration file; the bridge runs unprivileged with bounded
  output, timeouts, restart backoff, and redacted logs.
- **Long-chat reliability:** Virtualized message timelines with dynamic row
  measurement, stable end anchoring, screen-proximity rendering for expensive
  diagrams, durable streaming checkpoints, bounded pre-output retries, partial
  output preservation, and guarded continuation after interruptions.
- **Message and session workflows:** Added reply snapshots and jump navigation,
  explicit interrupted-generation ownership, model-selectable sibling-branch
  regeneration, per-chat composer drafts, and a token/context usage summary
  with a clearly marked estimate when providers omit usage. Message edits,
  deletion, retraction, and branch switches are guarded during generation while
  the existing context-compression pipeline remains intact.
- **Agent mode:** Added a per-chat, tool-capability-gated client orchestration
  mode with localized web search, knowledge search, text-only skill loading,
  bounded sandboxed JavaScript, and task-plan tools. The five read-only
  built-ins are auto-approved, and Agent web search requires an external search
  provider rather than native Google Search or OpenAI Web Search.
- **Parameterized Skills:** Upgraded custom Skills to a compatible schema with
  validated text, textarea, and select parameters; reproducible invocation
  metadata; and ordered bundles of up to four non-nested Skills with fixed or
  mapped inputs.
- **Knowledge productivity and retrieval:** Added collection-level
  Markdown-aware or recursive chunking, preview and explicit reindex controls,
  chunk-level lexical search, vector-plus-keyword reciprocal-rank fusion,
  lexical fallback, and stable source previews with retrieval-method labels.
  Knowledge files can now be filtered by name or status and processed through
  serial batch retry, reindex, download, and confirmed-delete workflows with
  per-file failure reporting.
- **Automatic image compression:** Added configurable client-side compression
  for supported conversation, workspace, generated, and plugin images before
  storage or model use. The pipeline is cancellable, skips the dimension limit
  for extreme-aspect images, preserves the source format and name, and falls
  back to the original whenever compression fails or does not reduce the
  payload.
- **Local offline PWA:** Added a local-deployment-only application shell for
  offline history, branch navigation, local search, knowledge reading, and
  backup export. API routes, streams, model traffic, sync, MCP, user files, and
  external requests are never cached; hosted deployments unregister workers and
  remove application caches.
- **Navigation, settings, and onboarding:** Promoted global search to an
  accessible, focus-managed modal, added localized settings search and a
  first-run path to Provider settings when no model is available, and improved
  mobile panel navigation, default-title localization, collapsed-sidebar
  semantics, and offline draft guidance.
- **Provider and model safety:** Scoped custom model metadata to each provider
  so same-named models can retain independent capabilities. Hardened locally
  encrypted credentials for server-default providers, bound their reuse to a
  matching provider type, rejected missing or mismatched deployment defaults,
  validated provider Base URLs, and handled empty default-model lists without
  synthesizing unavailable choices.
- **Search and presentation fixes:** Applied the selected time range to
  Firecrawl instead of forcing a one-week filter, removed duplicate Agent web
  search tool details while retaining the dedicated source presentation, and
  simplified the model picker by removing capability preflight copy while
  preserving the underlying capability gates.
- **Compatibility and engineering:** Advanced local storage schema to version
  6 while retaining ZIP export version 3, added read-only quota and OPFS
  reference health diagnostics, expanded English, Chinese, and Japanese copy,
  and broadened security, migration, convergence, performance, offline,
  accessibility, provider, MCP, and container regression coverage.

## v2.3.0

- **Local search and navigation:** Added a local global search center, available
  from the sidebar or `Ctrl`/`Cmd` + `K`, across active conversation branches,
  attachments, workspaces, knowledge content, and memories. Search supports
  source, workspace, role, date, and sort controls, cancellable incremental
  indexing, partial-index notices, highlighted results, and direct navigation
  without persisting or uploading its index.
- **Portable backup and restore:** Replaced metadata-only app export with the
  version 3 ZIP format, bundling `manifest.json`, `data.json`, and referenced
  app-owned OPFS files. Added path, size, digest, and extraction validation;
  bounded and cancellable inspection; missing-file reporting; legacy version 2
  JSON import; staged replacement; hydration validation; rollback journaling;
  credential exclusion; and a post-restore credential checklist.
- **Knowledge-base lifecycle:** Separated preserved source files from editable
  or indexable extracted content, with independent storage and index states.
  Added migration, editing, retry, reparse, reindex, cancellation,
  reconciliation, orphan cleanup, and per-file operation serialization while
  retaining originals through parser or vector-service failures.
- **Plugin and MCP safety:** Enforced transport-derived risk floors, added an
  optional destructive-tool confirmation flow with allow-once and deny
  decisions, redacted sensitive arguments, and limited chat-scoped approvals to
  non-destructive `write` and `external` risks. Approvals are bound to stable
  function fingerprints; browser and server checks prevent stale-definition
  execution, and confirmed calls fail closed instead of falling back to legacy
  full-manifest payloads.
- **Markets, search, and deployment health:** Distinguished fresh, cached,
  stale, fallback, and failed marketplace loads so errors are not presented as
  empty catalogs. Unified effective search capability across settings, request
  preflight, and deployment health, preserved the search-enabled setting, and
  kept public Firecrawl search available without an API key while treating an
  explicit non-default Base URL as self-hosted configuration.
- **Self-hosted endpoint compatibility:** Allowed user-configured provider,
  search, RAG, plugin, and remote MCP targets to use HTTP or private-network
  addresses in local or hosted mode. Fixed registries and built-in service
  endpoints retain their HTTPS and host allowlists, and the documentation now
  calls out the administrative trust, SSRF, credential, and transport risks.
- **Chat, media, and export fixes:** Corrected OpenAI Responses multi-turn
  assistant-history serialization, added a bounded server image proxy for
  cross-origin image display and export, improved image proxy policy and DNS
  checks, restored model-message download progress, and fixed startup behavior
  that unexpectedly reset search availability.
- **Data integrity:** Coordinated session writes, snapshots, app restore, and
  selective data clearing through shared/exclusive gates so queued writes cannot
  deadlock restore or recreate cleared data. Restore now drains admitted writes
  before replacement, validates hydrated stores and message trees, and rolls
  back interrupted or invalid replacements.
- **Engineering and dependencies:** Added import-alias enforcement, Testing
  Library coverage, isolated Playwright smoke tests on port 3100, and Chromium
  E2E execution in CI. Refreshed provider SDKs and development dependencies,
  excluded E2E artifacts from Vitest and Git, and expanded regression coverage
  for search, backup/restore, knowledge operations, plugins, networking, and UI
  state.

## v2.2.0

- **New capabilities:** Added native Anthropic Messages API support through the
  official SDK, including provider-specific streaming and tool-call handling.
- **MCP integration:** Added remote `streamable-http` MCP server discovery from
  the official MCP Registry, custom server installation, header authentication,
  tool registration, server-side execution, caching, pagination, and hosted URL
  safety controls. Local stdio, npm, Docker, and OAuth transports remain out of
  scope for this version.
- **Reliability and security:** Strengthened API route access policy, request
  body and response limits, terminal stream validation, context budgeting and
  compression, outbound URL/DNS checks, shared plugin registration, and Worker
  gzip-size and deployment dry-run validation.
- **Architecture and maintainability:** Split the chat shell, composer,
  message editor, Markdown diagram rendering, and chat-service orchestration
  into smaller components, hooks, and domain modules while preserving the
  existing user-facing workflows.
- **Fixes and experience:** Fixed known issues across branch-preserving chat
  history, tool-call completion, provider response handling, image/export
  fallback, memory/RAG/search/voice workflows, settings, loading/error states,
  and accessibility behavior.
- **Engineering and documentation:** Aligned local, CI, Docker, and Worker
  guidance around Node 22 and pnpm 10.30.3, added artifact-hygiene checks, and
  synchronized Anthropic, MCP, privacy, security, and deployment documentation.

## v2.1.0

- Rebuilt System Settings with clearer grouped controls, an About panel,
  deployment health visibility, local data export/reset actions, and refreshed
  localized settings copy.
- Added native image generation and image editing for models with image
  input/output metadata, including ordered mixed text/image output blocks,
  image edit attachments, and OPFS-backed display caching.
- Expanded built-in plugin media tools: Agnes and Gemini now present as image
  processing plugins, OpenAI-compatible Images API and OpenAI Responses image
  processing are separate built-ins, and image plugin results are compacted into
  tool details/history so follow-up model messages decide how to reference them.
- Added plugin-level API Base URL and Model ID controls for supported image
  plugins, image count parameters where the upstream API supports them, Agnes
  image-to-image editing, and Agnes video image-to-video support with custom
  video model IDs while preserving the two-step `create_video` /
  `get_video_result` workflow.
- Added thinking intensity controls and provider-specific reasoning mapping for
  Gemini and OpenAI-compatible model requests.
- Added Japanese localization across the app, SEO metadata, LobeHub assistant
  locale routing, voice language handling, and the public Skills catalog.
- Hardened hosted deployments with API request proof, stronger shared-store and
  rate-limit checks, service health coverage, safer URL/secret handling, and
  expanded test coverage.
- Fixed Cloudflare Workers preview/deploy commands and kept Worker deploys from
  dropping dashboard-managed variables.
- Refined code block rendering, syntax highlighting, sandboxed HTML preview,
  Mermaid/mind map/SVG rendering behavior, and release automation based on
  matching `CHANGELOG.md` sections.
- Added a fork-only upstream sync workflow and README guidance for keeping fork
  repositories current with `u14app/neo-chat`.

## v2.0.0

- Added open-source governance files, issue templates, pull request template,
  Dependabot configuration, and documentation for environment variables,
  plugin development, and privacy/data handling.
- Added required Prettier format checking to CI after a one-time repository
  formatting pass.
- Added text-only Skills with localized public catalogs, install/uninstall,
  local edits, custom skills, auto-selection, and workspace presets.
- Expanded message rendering with safe inline HTML visual blocks, Mermaid and
  mind map fullscreen rendering, richer source blocks, and visible search
  failure states.
- Hardened hosted and multi-instance deployment behavior with shared plugin
  registry storage, document parse job secrets, deployment health checks,
  trusted proxy guidance, and safer sandbox/document parsing limits.
- Added local memory documentation and Mimo voice defaults alongside existing
  search, RAG, document parsing, and BYOK configuration guidance.
