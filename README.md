# Neo Chat

<p align="center">
  <img src="public/logo.png" width="96" alt="Neo Chat logo" />
</p>

<p align="center">
  <strong>A local-first AI chat workspace for models, agents, skills, plugins, search, RAG, voice, memory, and artifacts.</strong>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/u14app/neo-chat/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/u14app/neo-chat/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/u14app/neo-chat/actions/workflows/docker.yml"><img alt="Docker" src="https://github.com/u14app/neo-chat/actions/workflows/docker.yml/badge.svg" /></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6" />
</p>

Neo Chat is a self-hostable, local-first AI chat application built with Next.js, React, TypeScript, and Zustand. It brings multi-provider chat, assistant presets, text-only Skills, OpenAPI-style plugin tools, remote MCP servers and an optional local stdio bridge, web and local global search, knowledge-base RAG, opt-in encrypted cross-device sync, versioned backup and restore, local memory, an offline PWA, voice, generated media, rich message rendering, citations, and editable artifacts into one clean workspace.

It is designed for people who want the power of modern AI workspaces without giving up local data ownership. Chat history, workspace metadata, skills, plugin configuration, memories, search indexes, and files stay in the browser by default; server routes act as controlled proxies for model providers, web search, RAG, document parsing, voice, plugin and MCP execution, and deployment health.

## v2.5.0 Highlights

- Expanded Deep Research with reviewable adaptive plans, durable research
  rounds, evidence audits, partial and versioned reports, built-in and custom
  templates, specialized scholarly/regulatory sources, frontier steering, and
  report-version-bound evidence Q&A.
- Added an opt-in encrypted WebDAV or S3/MinIO personal vault, including
  per-domain Automerge documents, encrypted OPFS chunks, conflict handling, and
  protection against overwriting edits made during synchronization.
- Expanded the foreground Agent runtime with dynamic Tool and Skill discovery,
  task plans, structured questions, scoped Memory, revisioned workspaces,
  immutable Artifacts, resumable runs, and effect-aware confirmation.
- Added customizable keyboard shortcuts, temporary text chats, unified
  sidebar/titlebar conversation actions, Redis-backed read-only sharing, and
  safer stop, switch, and continue-generation behavior.
- Added progressive CommonMark rendering, persistent document blocks,
  HEIC/HEIF conversion, staged image compression, and file-backed multimodal
  requests for native OpenAI, Google, and Anthropic providers.
- Hardened hosted and self-hosted release paths with per-request CSP nonces,
  explicit Docker access-password setup, Node 24 alignment, tag/version
  validation, and release-time source, Next.js, Worker, and dependency checks.
- Kept Research extension records such as custom templates, steering, and report
  Q&A browser-local; they are not yet included in ZIP backup or encrypted sync.

See [CHANGELOG.md](CHANGELOG.md) for the complete release notes.

## v2.2.0 Highlights

- Added native Anthropic Messages API support through the official SDK.
- Added remote streamable HTTP MCP server discovery and installation from the
  official MCP Registry, with plugin-market management, authentication, and
  server-side tool execution. This release intentionally supports remote MCP
  servers only.
- Strengthened provider requests, API route policy, context budgeting,
  outbound URL safety, plugin registration, and Worker deployment validation.
- Reconstructed the chat shell, composer, message rendering, and chat service
  internals into smaller modules while preserving existing workflows.
- Fixed known issues across chat history, tool calls, provider streams, media
  and exports, memory/RAG/search/voice flows, settings, and accessibility.

## v2.1.0 Highlights

- Rebuilt System Settings with clearer grouped controls, an About panel, deployment health visibility, and local data export/reset actions.
- Added native model image generation/editing with ordered mixed text/image output blocks and OPFS-backed image display caching.
- Expanded built-in plugin media tools with Agnes/Gemini image processing, separate OpenAI-compatible Images API and OpenAI Responses image processing plugins, plugin-level Base URL/Model ID controls, image count parameters where supported, compact image tool results, and Agnes image/video processing upgrades.
- Added thinking intensity controls for reasoning-capable Google/Gemini and OpenAI-compatible models.
- Added Japanese localization for the app shell, SEO metadata, assistant locale routing, voice language handling, and the public Skills catalog.
- Hardened hosted deployments with API request proof, shared-store checks, service health coverage, safer URL/secret handling, and Cloudflare Worker command fixes.
- Added changelog-driven GitHub Release automation and a fork-only upstream sync workflow.

## Features

- Multi-provider chat with Google, Anthropic, OpenAI, and OpenAI-compatible
  endpoints, including provider-scoped custom model capabilities.
- Native image generation and image editing for models whose metadata exposes image output/input, with ordered mixed text/image message blocks and OPFS-backed Blob URL display caching.
- File-backed multimodal image input without Base64 for native OpenAI, Google,
  and Anthropic chat; HEIC/HEIF conversion and staged client-side compression
  enforce the 20 MiB source, 10 MiB force-compression, and 5 MiB result limits.
- Local-first sessions, branches, pinned chats, per-chat composer drafts, reply
  navigation, token/context usage summaries, workspaces, workspace files, and
  assistant instructions.
- Opt-in, end-to-end encrypted WebDAV or S3/MinIO synchronization with local
  device identity, recovery code, convergent CRDT documents, and encrypted OPFS
  chunks.
- Assistant presets from the LobeHub agent registry plus local custom assistants.
- Per-chat Agent mode for tool-call-capable models, with scoped Memory,
  revisioned workspace and Artifact operations, declarative Skills, MCP
  resources/prompts, sandboxed JavaScript, structured user input, and
  persistent run/approval state.
- Independent Deep Research mode with model-knowledge-first planning, conditional
  selected-knowledge and public-summary lookup, structured plan approval,
  adaptive breadth/depth research rounds, explicit
  claim-to-evidence auditing, safe foreground pause and manual resume,
  versioned reports, local citations, and a responsive Research workbench. It
  also includes reusable research templates, read-only arXiv/PubMed/EPO OPS/
  SEC EDGAR source adapters, safe-wave frontier steering, and threaded
  closed-book questions against each report version. Reports with evidence gaps
  remain visible in chat and the workbench, with limitations included in exports.
  Failed question snapshots do not block reports. Full reports remain immutable
  Artifacts referenced by chat. Report headings support English, Chinese, and
  Japanese; appendices have their own tab and a shared Markdown/PDF download menu.
  Research searches run serially with two-second spacing, and Tavily Research
  requests allow up to 90 seconds. Search images and their sources can illustrate
  reports without being counted as verified evidence. Document previews open
  directly when clicked. Research extension records such as custom templates,
  steering and report Q&A remain browser-local and are not yet included in ZIP
  backup or encrypted sync.
- Parameterized text Skills with localized public catalogs, install/uninstall
  flows, local edits, custom skills, auto-selection, workspace presets, and
  ordered non-nested bundles of up to four Skills.
- OpenAPI-based plugin tools plus remote Streamable HTTP and legacy SSE MCP
  servers, with encrypted install-time credentials, persisted transport
  selection, per-plugin authentication, server-side execution,
  transport-derived risk floors, optional confirmation for destructive calls,
  and an authenticated Docker bridge for allowlisted local stdio servers.
- Built-in tools for web reading, weather, Unsplash search, Agnes/Google image processing, OpenAI-compatible image processing, OpenAI Responses image processing, and Agnes video generation. Agnes image processing supports image-to-image edits, and Agnes video generation supports public image URL to video plus plugin-level model IDs. Image processing plugins remain separate from native model image output.
- Web search through Google native Google Search, OpenAI Web Search, or external providers such as Tavily, Firecrawl, Exa, Bocha, and SearXNG.
- Local global search in an accessible modal across active chat branches,
  attachments, workspaces, knowledge, and memories, with source/date/role
  filters and direct result navigation; Settings has its own localized search.
- Customizable, page-scoped keyboard shortcuts for search, chat creation,
  composer focus, chat mode switching, sidebar visibility, shortcut settings,
  and stopping generation.
- Knowledge-base RAG with preserved original files, editable extracted content,
  configurable Markdown-aware chunking, hybrid lexical/vector retrieval,
  Mineru/LlamaParse document parsing, filename/status filters, serial batch
  actions, and recovery controls for failed parsing or indexing.
- Versioned ZIP backup and transactional restore for local metadata and
  referenced OPFS files, excluding credentials and external service data, plus
  read-only quota and OPFS reference diagnostics.
- Installable offline PWA for local deployments, with read-only history, local search, knowledge access, and backup export; hosted deployments unregister it.
- Local memory with optional memory search, background extraction, and dream consolidation.
- Voice input and output through browser APIs, ElevenLabs, Mimo, or compatible configured providers.
- Rich message rendering for Markdown, safe inline HTML visual blocks, GFM tables, math, code highlighting, Mermaid diagrams, mind maps, citations, reasoning, tool calls, images, audio, and artifacts.
  CommonMark appears immediately; extension syntax loads as it is discovered,
  with original-text placeholders and independent block updates. HTML visual
  instructions apply only to narrative prose, leaving code, math and diagram
  syntax intact.
  Default chat instructions use standalone Markdown images when a relevant,
  real image URL is available; Research uses its saved illustration catalog
  without a separate gallery or export appendix.
- Shared conversation actions in both the sidebar and titlebar, including
  Redis-backed read-only snapshots with images and research reports. Links expire
  after 1, 7 or 30 days, or never, selected with expiry buttons; deleting the
  conversation cancels its share. Sharing is off by default; enable it with
  `SHARING_ENABLED=true` and both Redis REST configuration values.
- Temporary chat and search from the welcome screen, without saved conversation
  history or a conversation-list entry. Its icon toggles to an exit action and
  the welcome composer explains the history behavior. Leaving the chat discards it;
  Agent, Research, attachments, tools,
  image generation and Memory are unavailable in temporary chats.

- Local BYOK encryption for user-entered provider, plugin, MCP, search, RAG, and
  voice secrets, with fail-closed server-default provider validation.
- Deployment health checks for BYOK, access password, shared stores, default model, search, RAG, and voice readiness.
- Docker and Cloudflare Workers deployment paths.

See [End-to-end encrypted sync](docs/encrypted-sync.md),
[MCP stdio bridge](docs/mcp-stdio-bridge.md), and
[Offline PWA](docs/offline-pwa.md), [Conversation sharing and temporary chats](docs/conversation-sharing.md), and [Deep Research workflows](docs/research-workflows.md)
for deployment and trust-boundary details.

## Screenshots

![Neo Chat Desktop](public/desktop.png)

![Neo Chat Mobile](public/mobile.png)

## Quick Start

### Requirements

- Node.js 24
- pnpm 10.30.3

### Run Locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, then configure at least one model provider in Settings.

For deployment-wide defaults, copy the environment template:

```bash
cp .env.example .env.local
```

Most settings can be managed in the browser. Server environment variables are useful when you want a shared default provider, hosted deployment safety, access password protection, shared runtime stores, or managed defaults for search, RAG, document parsing, voice, memory, and HTML visual rendering.

## Keyboard Shortcuts

Keyboard shortcuts work while the Neo Chat page has focus and can be changed or
cleared under **Settings > Shortcuts**. `Mod` means `Command` on macOS and
`Ctrl` on other platforms.

| Action                 | Default shortcut |
| ---------------------- | ---------------- |
| Global search          | `Mod+K`          |
| New chat               | `Mod+Alt+N`      |
| Focus the composer     | `Mod+/`          |
| Switch chat mode       | `Mod+M`          |
| Toggle the sidebar     | `Mod+\`          |
| Open shortcut settings | `Mod+Alt+S`      |
| Stop generation        | `Mod+Alt+.`      |

Shortcut preferences are stored with core settings. They are included in
versioned app backups and, when enabled, in the end-to-end encrypted sync
document for core settings.

## Deployment

### Docker Compose

```bash
ACCESS_PASSWORD='replace-with-a-strong-password' docker compose up --build
```

The compose file requires an access password, publishes Neo Chat on
`http://localhost:3000`, and uses local/self-hosted safety defaults. For
production Docker deployments, set stable BYOK values, use shared stores for
hosted or multi-instance deployments, and enable `TRUST_PROXY_HEADERS` only
behind a proxy that strips spoofed forwarded headers.

### Docker Image

```bash
docker build -t neo-chat:local .
docker run --rm -p 3000:3000 \
  -e ACCESS_PASSWORD='replace-with-a-strong-password' \
  -e BYOK_ALLOW_EPHEMERAL_KEY=true \
  neo-chat:local
```

The Docker workflow builds pull requests and publishes `main` / `v*` tags to GitHub Container Registry:

```text
ghcr.io/u14app/neo-chat:latest
```

### Vercel

Import the repository as a Next.js project. Vercel can use the framework preset
and package manager detection from `pnpm-lock.yaml` and the `packageManager`
field, so the project does not need a custom output directory.

Recommended project settings:

```text
Framework Preset: Next.js
Install Command: default, or corepack pnpm install --frozen-lockfile
Build Command: pnpm build
Output Directory: default
```

For public Vercel deployments, configure production environment variables in
the Vercel project settings:

```bash
DEPLOYMENT_MODE=hosted
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
BYOK_ALLOW_EPHEMERAL_KEY=false
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Store deployment passwords, provider keys, BYOK material, and shared store
credentials as Vercel environment variables with the appropriate Production,
Preview, or Development scope. Do not commit these values to the repository.
When a `NEXT_PUBLIC_*` value affects metadata or generated public links, set it
for the environments that build those deployments.

### Cloudflare Workers

```bash
pnpm build:worker
pnpm worker:size
pnpm worker:dry-run
pnpm preview:worker
pnpm deploy:worker
```

Workers should run in hosted mode and use public HTTPS upstreams. When using
Cloudflare Workers Builds, use separate build and deploy commands so the
OpenNext build output exists before deployment:

```bash
# Build command
pnpm build:worker

# Deploy command
pnpm exec opennextjs-cloudflare deploy -- --keep-vars
```

`--keep-vars` preserves runtime variables and secrets configured in the
Cloudflare dashboard instead of replacing them with only the values committed in
`wrangler.jsonc`.

Production Workers should configure runtime variables in the Cloudflare
dashboard under **Settings -> Variables and Secrets**. Use plain variables for
non-sensitive deployment defaults:

```bash
DEPLOYMENT_MODE=hosted
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
BYOK_ALLOW_EPHEMERAL_KEY=false
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Use secrets for deployment passwords, provider keys, BYOK material, and shared
store credentials:

```bash
wrangler secret put BYOK_PRIVATE_KEY_PEM
wrangler secret put BYOK_KEY_ID
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put ACCESS_PASSWORD
```

For Cloudflare Workers Builds, also add build-time variables under
**Settings -> Builds -> Variables and Secrets** when a value must be available
during `next build`, especially `NEXT_PUBLIC_*` values. Runtime variables are
not available to the build step unless they are also configured there.

Do not commit personal API keys or deployment secrets to `wrangler.jsonc`.
Deployment-level provider keys such as `DEFAULT_PROVIDER_API_KEY` are shared by
everyone using that Worker instance; leave them unset if users should provide
their own keys in the browser.

See [Deployment Hardening](docs/deployment-hardening.md) for production configuration guidance.

## Configuration

Neo Chat is local-first by default:

- Core settings, provider records, selected models, keyboard shortcut bindings,
  per-chat composer drafts, and locally encrypted provider credential envelopes
  are stored in browser `localStorage`.
- Chat metadata, messages, app settings, installed plugins, installed/custom
  skills, skill catalog caches, assistants, knowledge metadata, local memories,
  encrypted sync configuration, and CRDT baselines are stored in IndexedDB
  through `localforage`.
- Uploaded chat and workspace files, knowledge originals and extracted text, and image display-cache copies are stored in browser OPFS. Runtime `blob:` URLs remain temporary; version 3 ZIP backups bundle referenced app-owned OPFS files while excluding credentials and remote service data.
- User-entered secrets are encrypted in the browser as BYOK envelopes before being sent to API routes.

Important server-side settings:

```bash
# Access gate (separate multiple accepted passwords with commas)
ACCESS_PASSWORD="first-password,second-password"

# Stable BYOK server key for production
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID="prod-2026-07"
BYOK_ALLOW_EPHEMERAL_KEY="false"

# Deployment safety
DEPLOYMENT_MODE="local" # or hosted
ALLOW_LOCAL_NETWORK_PROXY=""

# Shared short-lived state for hosted or multi-instance deployments
RATE_LIMIT_STORE="upstash"
DOCUMENT_PARSE_JOB_STORE="upstash"
PLUGIN_REGISTRY_STORE="upstash"
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."
```

Default model provider:

```bash
DEFAULT_PROVIDER_TYPE="Google"
DEFAULT_PROVIDER_NAME="Google"
DEFAULT_PROVIDER_BASE_URL=""
DEFAULT_PROVIDER_API_KEY="provider-key"
DEFAULT_PROVIDER_MODELS="model-a,model-b"
```

A server-default provider is exposed only when the deployment supplies related
`DEFAULT_PROVIDER_*` or `DEFAULT_MODEL_*` configuration. The deployment API key
may remain empty so each browser can save its own encrypted credential; that
credential is reused only while its provider type matches the active server
default. Missing or mismatched server defaults fail closed. Custom Base URLs are
validated before they are saved while trusted self-hosted HTTP/private targets
remain supported.

`DEFAULT_PROVIDER_MODELS` supports multiple formats:

```bash
# Comma-separated model IDs
DEFAULT_PROVIDER_MODELS="gpt-5.5,gpt-5.4-mini"

# JSON string array
DEFAULT_PROVIDER_MODELS='["gpt-5.5","gpt-5.4-mini"]'

# JSON object array with optional display names, capability aliases, and modalities
DEFAULT_PROVIDER_MODELS='[{"id":"gpt-image-2","name":"GPT Image 2","capabilities":["image_generation"]},{"id":"gemini-3.1-flash-image","modalities":{"input":["text","image"],"output":["text","image"]}},"gpt-5.4-mini"]'
```

For JSON object entries, `name` is optional and falls back to `id`.
`capabilities` accepts aliases such as `vision`, `attachment`, `reasoning`,
`tool_call`, `image_generation`, `image_output`, and `image_editing`.
Explicit `modalities.input` / `modalities.output` are preferred when present.

Default task models:

```bash
DEFAULT_MODEL_TITLE_GENERATION="model-a"
DEFAULT_MODEL_RELATED_QUESTIONS="model-a"
DEFAULT_MODEL_CONTEXT_COMPRESSION="model-a"
DEFAULT_MODEL_PROMPT_OPTIMIZATION="model-a"
DEFAULT_MODEL_RAG_QUERY="model-a"
DEFAULT_MODEL_MEMORY="model-a"
```

Search, RAG, document parsing, and voice defaults:

```bash
DEFAULT_SEARCH_PROVIDER="firecrawl"
# Firecrawl search works without an API key; set one for higher rate limits.
DEFAULT_SEARCH_API_KEY=""
DEFAULT_SEARCH_BASE_URL="https://search.example"

DEFAULT_RAG_BASE_URL="https://rag.example"
DEFAULT_RAG_TOKEN="rag-token"
DEFAULT_RAG_TOP_K="10"
DEFAULT_RAG_CHUNK_SIZE="512"
DEFAULT_RAG_NAMESPACE="default"
DEFAULT_DOCUMENT_PARSE_PROVIDER="mineru"
DEFAULT_MINERU_API_TOKEN=""
DEFAULT_LLAMA_PARSE_API_KEY="llama-parse-key"

DEFAULT_VOICE_PROVIDER="elevenlabs"
DEFAULT_ELEVENLABS_API_KEY="elevenlabs-key"
DEFAULT_ELEVENLABS_STT_MODEL="scribe_v2"
DEFAULT_ELEVENLABS_TTS_MODEL="eleven_flash_v2_5"
DEFAULT_ELEVENLABS_TTS_VOICE_ID="bIHbv24MWmeRgasZH58o"

DEFAULT_MIMO_API_KEY="mimo-key"
DEFAULT_MIMO_STT_MODEL="mimo-v2.5-asr"
DEFAULT_MIMO_TTS_MODEL="mimo-v2.5-tts"
DEFAULT_MIMO_TTS_VOICE_ID="mimo_default"
```

Default system behavior:

```bash
DEFAULT_SYSTEM_PROMPT=""
DEFAULT_ENABLE_AUTO_TITLE="true"
DEFAULT_ENABLE_RELATED_QUESTIONS="true"
DEFAULT_ENABLE_AUTO_COMPRESSION="true"
DEFAULT_ENABLE_CODE_COLLAPSE="true"
DEFAULT_ENABLE_HTML_VISUAL_PROMPT="true"
```

Public site URL:

```bash
NEXT_PUBLIC_SITE_URL="https://your-domain.com"
```

For the full template, see [.env.example](.env.example).

## Architecture

```mermaid
flowchart LR
  Browser["Browser app\nReact + Zustand"] --> LocalStorage["localStorage\nproviders + encrypted secrets + drafts"]
  Browser --> IndexedDB["IndexedDB\nsessions + plugins + skills + knowledge + memories + sync"]
  Browser --> OPFS["OPFS\nuploads + originals + image cache"]
  Browser --> ApiRoutes["Next.js API routes"]
  ApiRoutes --> Providers["Model providers\nGoogle / Anthropic / OpenAI / compatible"]
  ApiRoutes --> Search["Search providers"]
  ApiRoutes --> Rag["RAG + document services"]
  ApiRoutes --> Plugins["Plugin + MCP endpoints"]
  ApiRoutes --> Sync["WebDAV / S3"]
  ApiRoutes --> Voice["Voice providers"]
  ApiRoutes --> Health["Deployment health"]
  Browser -. encrypted BYOK envelopes .-> ApiRoutes
  Browser -. encrypted sync objects .-> ApiRoutes
```

The app keeps durable user data in browser storage whenever possible. API routes provide:

- provider request normalization and streaming;
- BYOK decryption on the server side;
- URL safety gates for proxied upstreams;
- plugin and MCP execution through registered plugin IDs and function names;
- encrypted WebDAV/S3 sync proxying without server-side key persistence;
- deployment health reporting through `/api/health`;
- hosted-mode checks for shared stores and fixed-service network boundaries.

## Skills, Plugins, Search, RAG, and Voice

Skills are text-only prompt-context modules. The app loads localized metadata catalogs from `public/data/skills`, fetches full skill definitions only when needed, and stores installed, edited, and custom skills locally. Active skills can be selected manually, inherited from workspace presets, or auto-selected for a message.

Agent mode is an opt-in, foreground-only browser orchestration mode for models
that support tool calls. It persists an `AgentRun`, execution records, usage,
structured stop reasons, and event checkpoints, but it does not promise work
after the page closes. The initial Tool set stays compact; `search_tools` /
`load_tools` and `search_skills` / `inspect_skill` discover additional enabled
capabilities without dumping every schema into every model request. JavaScript
remains synchronous in a bounded sandbox without network or DOM access, and
Skills remain declarative text rather than executable scripts.

Tool policy is based on effects, idempotency, sensitivity, origin, target, and
definition fingerprint. Local and network reads execute automatically;
recoverable local writes and trusted non-destructive external writes follow the
selected permissive, balanced, or strict Profile policy. Permanent deletion,
payments, publishing, permission changes, credential exfiltration, and unknown
MCP Tools always require one-time approval. Published Artifacts are immutable
content-addressed snapshots, while mutable workspace files use revision checks
and recoverable trash. See [Trusted Agent Runtime](docs/agent-runtime.md).

Plugins are executable tools installed from OpenAPI manifests, built-in
definitions, or remote MCP servers discovered from the official MCP Registry.
Enabled functions are exposed to compatible models as tools, then executed by
the server-side plugin route. Remote MCP supports Streamable HTTP and legacy
SSE, preferring Streamable HTTP and falling back to SSE only when connection
setup returns 404 or 405; authentication and other failures are not retried
across transports. The negotiated transport is saved for later tool calls.
Registry entries that require header credentials prompt before discovery and
store the value as a local encrypted secret. Local Docker users may expose
preconfigured stdio servers through the separate authenticated
[MCP stdio bridge](docs/mcp-stdio-bridge.md). User-configured MCP URLs may use
HTTP or HTTPS and may target localhost or private networks in either deployment
mode; the official Registry remains HTTPS-only.

Built-in image processing plugin results stay in the tool details and compact
conversation history, so the model can decide whether and how to reference
generated or edited images in its follow-up message. OpenAI-compatible Images
API and OpenAI Responses image processing are separate plugins so their
credentials and activation can be managed independently. Supported built-in
media plugins expose plugin-level API Base URL and Model ID fields, optional
image count parameters, Agnes image-to-image editing, and Agnes video generation
from a public HTTPS image URL while keeping Agnes video as the explicit
`create_video` / `get_video_result` two-step flow. Tool-call orchestration uses a
high but bounded loop limit to avoid runaway recursive calls while still
allowing multi-step tasks.

Search can run through Google native Google Search, OpenAI Web Search, or
external providers for other model families including Anthropic. When Agent
mode is active, select an external provider to expose `web_search`; native
search configurations are not combined with Agent function calling.
Firecrawl's public service works without an API key, honors the selected time
range, and uses a key only to raise its request rate. The separate global search
modal indexes active chat branches, attachments, workspaces, knowledge, and
memories in browser memory while excluding reasoning, tool payloads, and
credentials. Settings provides its own localized keyboard-navigable search.

Knowledge-base RAG preserves uploaded originals separately from editable or
indexable extracted text, supports Markdown-aware or recursive chunking with
hybrid lexical/vector retrieval, optionally parses documents with Mineru or
LlamaParse, and can index chunks into an external vector service. Files can be
filtered by name or status and processed through serial retry, reindex,
download, or confirmed-delete batches with per-file results. Failed operations
can still be retried, reparsed, cancelled, or reconciled without discarding a
usable original.

Voice workflows support browser speech APIs and configured external providers. Set `DEFAULT_VOICE_PROVIDER` to `elevenlabs` or `mimo` to enable a server default; leaving it empty keeps browser-native speech as the default. Empty default model values disable the matching STT or TTS capability, and the UI can store user-specific secrets locally.

Deployment health is available from Settings and `/api/health`. It reports non-secret readiness for BYOK, access password, hosted mode, shared stores, default model, search, RAG, and voice configuration.

## Security Model

Neo Chat is self-hosting friendly, not a turnkey public SaaS security boundary.

- User-configured provider, search, RAG, plugin, and MCP targets may use HTTP and private-network addresses in either deployment mode.
- Fixed registries and built-in service targets retain their HTTPS and host allowlists; HTTP media proxying remains controlled by `ALLOW_LOCAL_NETWORK_PROXY`.
- Sync objects are encrypted in the browser with opaque remote names; recovery
  material, credentials, local baselines, and device identity are excluded from
  remote objects and ZIP exports.
- BYOK envelopes prevent plain user-entered secrets from being sent in request bodies.
- Server-default provider credentials are locally encrypted, provider-bound,
  and rejected when the deployment default is unavailable or has changed type.
- API schemas reject unknown high-risk fields and oversized payloads.
- Plugin execution remains server-proxied and schema-validated. Approval is
  effect-aware: irreversible operations, credential exfiltration, permission
  changes, and unknown MCP Tools always require one-time approval. Destructive
  approval is never persisted for the chat.
- `ACCESS_PASSWORD` accepts comma-separated passwords (surrounding whitespace
  and empty entries are ignored), but it remains a deployment gate rather than
  an account system. Commas cannot be part of a password, and changing the list
  invalidates existing access sessions.

Before exposing Neo Chat as a public multi-user service, add account authentication, tenant isolation, server-side secret storage, quotas, audit logs, abuse controls, and provider spend limits.

See [Reliability and Safety Model](docs/reliability-and-safety.md) for runtime behavior and recovery notes.

## Development

Quality checks:

```bash
pnpm check:imports
pnpm format:check
pnpm hygiene:artifacts
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm audit --audit-level low
```

Useful scripts:

```bash
pnpm dev              # Start Next.js dev server
pnpm build            # Production build
pnpm start            # Start production server
pnpm format           # Format the repository with Prettier
pnpm format:check     # Check repository formatting
pnpm check:imports    # Reject disallowed long relative imports
pnpm hygiene:artifacts # Check generated artifact hygiene
pnpm test:e2e         # Run isolated Playwright smoke tests on port 3100
pnpm build:worker     # Build for Cloudflare Workers
pnpm worker:size      # Check Worker gzip size budget
pnpm worker:dry-run   # Validate Worker deploy without publishing
pnpm preview:worker   # Preview Worker build
pnpm deploy:worker    # Deploy Worker build while preserving dashboard vars
pnpm byok:generate    # Generate copyable BYOK key values
```

Project layout:

```text
src/app/              Next.js routes and API routes
src/components/       Chat UI, settings, plugin market, knowledge base
src/lib/              Server/client domain helpers and safety gates
src/services/         Provider, search, voice, RAG, and plugin service clients
src/store/            Zustand stores and persistence migrations
src/__tests__/        Vitest coverage for utilities, routes, and workflows
e2e/                  Playwright browser smoke tests
docs/                 Deployment and reliability notes
```

Project documentation:

- [Environment Variables](docs/environment-variables.md)
- [Plugin Development](docs/plugin-development.md)
- [Privacy and Local Data](docs/privacy-and-local-data.md)
- [Deployment Hardening](docs/deployment-hardening.md)
- [Reliability and Safety Model](docs/reliability-and-safety.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

### Fork Synchronization

Fork maintainers can enable the `Sync upstream` workflow to fast-forward their fork from the upstream `u14app/neo-chat` `main` branch.

1. In the fork, open **Settings > Actions > General** and allow GitHub Actions to run.
2. In **Workflow permissions**, select **Read and write permissions** so `GITHUB_TOKEN` can push to the fork.
3. Open **Actions > Sync upstream > Run workflow** to trigger the first sync manually.
4. Keep the scheduled workflow enabled if you want the fork to sync daily.

The workflow is skipped in the upstream repository and only runs when GitHub marks the repository as a fork. It uses fast-forward-only merging, so it fails safely when the fork branch has diverged from upstream or a branch protection rule blocks the push.

Optional repository variables can override the defaults:

```text
UPSTREAM_REPOSITORY=u14app/neo-chat
UPSTREAM_BRANCH=main
TARGET_BRANCH=<fork default branch>
```

## FAQ

### Does Neo Chat store my data on a server?

By default, durable chat and configuration data live in browser storage. API routes proxy external services, and production deployments should still treat server logs, upstream services, and configured stores according to their own privacy requirements.

### Can I use OpenAI-compatible providers?

Yes. Add an OpenAI-compatible provider in Settings or configure deployment defaults with `DEFAULT_PROVIDER_TYPE="OpenAI Compatible"` and a compatible `/v1` base URL.

### Can I use Anthropic's native Messages API?

Yes. Add an Anthropic provider in Settings or configure `DEFAULT_PROVIDER_TYPE="Anthropic"`. The official base URL is `https://api.anthropic.com`; the app uses Anthropic's native `/v1/messages` API through the official TypeScript SDK.

### Why do I need a stable BYOK private key in production?

Browser secrets are encrypted to the server public key. If the server private key changes, existing local envelopes cannot be decrypted until users re-enter their secrets.

### Can I deploy this as a public SaaS?

Not as-is. Hosted mode tightens URL policy and shared-state requirements, but public SaaS still needs accounts, tenancy, quotas, auditing, and server-side secret management.

### Why did a tool stop after many calls?

Neo Chat keeps tool calls high but bounded. The model can run multi-step tool workflows, but recursive tool loops stop after the configured tool-round limit.

### How do I retrieve previous versions?

Previous versions of the project were developed solely based on the Gemini ecosystem. If you need previous versions, you can obtain them from the `gemini-next-chat` branch, **which has its code archived**.

## Contributing

Contributions are welcome. Keep changes focused, preserve local-first behavior, and run the quality checks before opening a pull request. For security-sensitive changes, include tests for both local and hosted deployment modes.

Read [Contributing](CONTRIBUTING.md), [Security Policy](SECURITY.md), and the
[Code of Conduct](CODE_OF_CONDUCT.md) before opening larger changes.

## Community Support

[LinuxDo](https://linux.do/)

## License

Neo Chat is released under the [MIT License](LICENSE).
