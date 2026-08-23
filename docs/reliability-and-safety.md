# Reliability and Safety Model

Neo Chat remains local-first and self-hosting friendly. Runtime safeguards focus
on keeping user data recoverable, routing external side effects through
controlled server boundaries, and staying within model context limits.

## Generation Errors

Chat generation uses explicit states: `idle`, `pending`, `attachments`, `rag`,
`searching`, `tool`, `model`, `done`, `error`, and `aborted`.

Provider and orchestration failures are stored on `Message.generationError`
instead of being written into assistant content as `Error: ...`. The UI renders
these errors as recoverable status blocks so retry, regenerate, branch, and
stop flows do not confuse model output with application errors.

Search failures are also rendered as search blocks instead of disappearing from
the conversation. The block keeps the failed search visible with sanitized
error text, while successful search updates merge sources and images without
duplicating previously streamed entries.

## Skills Runtime

Skills are text-only prompt-context modules, not executable tools. Built-in
skill metadata is loaded from locale-specific catalogs under
`public/data/skills`, and full definitions are fetched only after installation
or selection. Installed skills, local edits to built-in skills, custom skills,
active skill ids, catalog caches, and definition caches are persisted in the
browser.

Only installed active skills can be applied to a message. When auto-selection is
enabled, the model can choose from that active installed set; when disabled, all
active skills are injected directly. Skills must stay text-only and are
normalized to reject script, external-tool, network, or file-system
requirements.

## Trusted Agent Runtime

Agent mode is opt-in per chat, foreground-only, and available only to models
whose metadata declares Tool-call support. A persisted `AgentRun` is the source
of truth for status, activities, aggregate usage, budgets, stop reason, and Tool
execution records. Event checkpoints occur around model and side-effect
boundaries. A tab owner lease prevents two tabs from executing the same run.
Interrupted uncertain external effects become `effect_unknown` and are never
replayed automatically.

The runtime starts with application-owned Tools for structured input, planning,
research, scoped Memory, declarative Skills, document extraction, sandboxed
JavaScript, revisioned workspace operations, immutable Artifact publishing, and
MCP resources/prompts. Plugin and MCP function schemas remain discoverable via
`search_tools` and are loaded only when selected, forced by an explicit composer
reference, or explicitly allowlisted by the Agent Profile. The capability panel
uses the same catalog contract as runtime registration.

`run_javascript` accepts synchronous computation only and has no DOM or network
access. Skills remain text-only and may narrow an already-authorized Tool set;
they cannot grant Tools, run scripts, or receive plaintext secrets. Web,
attachment, Plugin, and MCP content is marked `external_untrusted` and cannot
become a system instruction or widen permission. See
[Trusted Agent Runtime](agent-runtime.md) for the complete model.

## Plugin Tool Safety

Tool descriptors classify one or more effects (`local_read`, `local_write`,
`local_destructive`, `network_read`, `external_write`, or
`external_destructive`) together with idempotency, sensitivity, origin, target,
and a stable definition fingerprint. The invocation policy can become stricter
after canonical arguments are known. MCP annotations are display hints only;
unknown or unverifiable MCP functions fail closed as external destructive.

Permissive mode automatically runs reads, recoverable local changes, and trusted
non-destructive external writes. Permanent deletion, payment, publication,
permission changes, credential exfiltration, and unknown MCP functions always
pause for allow-once or deny. Destructive approval is never persisted. Any
session approval is bound to effect, target scope, provider/server, Tool name,
and definition fingerprint. The server validates arguments and the expected
fingerprint again before dispatch.

MCP-backed functions add a side-effect boundary: the MCP server owns the tool
implementation and may perform external actions. The application transport is
`streamable-http` or legacy `sse` over HTTP or HTTPS; local Docker deployments
can translate an explicit stdio allowlist through the separate bridge.
Fallback from Streamable HTTP to SSE is limited to connection setup after a 404
or 405, so a tool call is never retried across transports. User-configured MCP,
provider, search, RAG, and plugin targets may resolve to localhost or private
networks in either deployment mode; fixed registries and built-in services
remain HTTPS-only. HTTP may expose credentials or permit response tampering,
and private targets expand the server's SSRF surface. MCP installation and
execution retain server-side registration and response limits, and results are
bounded before entering tool details or later model context.

Built-in plugin IDs are reserved. Custom or manifest-installed plugins cannot
override them, and built-ins take precedence if a stale mutable registry entry
uses the same ID. If multiple active plugins expose the same function name, tool
resolution reports the collision instead of guessing which plugin should run.

## Knowledge Base Recovery

Knowledge records distinguish the original `sourcePath` from the searchable and
editable `contentPath`. Text files can share one path; parsed documents retain
the binary original and a separate extracted text file. Local storage failures
and vector-index failures are recorded independently.

Store recovery actions:

- `cancelUpload(collectionId, fileId)` aborts local work and remote parsing, then
  removes only files no longer referenced by a durable record.
- `retryFile(collectionId, fileId)` resumes the failed parsing or indexing stage
  without discarding already saved source/content files.
- `reconcileCollection(collectionId)` checks both source and content references,
  cleans orphans, and preserves extracted content when an old source is missing.
- `reparseFile` replaces only extracted text; an edited extraction requires an
  explicit confirmation before it is overwritten.

## Market And Search Health States

Plugin, MCP, skill, and assistant catalogs distinguish fresh data, valid or
stale cache, explicit fallback, and request errors. A failed request without a
cache is never presented as an empty catalog. Search settings, the composer,
request preflight, and deployment health share the same effective-capability
resolver, including server defaults and self-hosted URL requirements.
Deployment credentials are exposed to the browser only as the `Default Search`
capability; selecting an individual provider uses its client credential or an
explicit valid `http`/`https` self-hosted URL.

Global search builds a cancellable browser-memory index when opened and keeps
per-source sub-indexes for the current application lifecycle. Only changed
conversation, workspace, knowledge, or memory sources are rebuilt. It indexes
only each conversation's active branch plus local workspace, knowledge, and
existing memory data. Reasoning, tool arguments/results, binary data, settings,
market content, and credentials are excluded. Limits retain metadata while
surfacing partial-index notices for omitted body text.

RAG update and reindex paths remove stale vector ids when a newer version has
fewer chunks, which prevents old chunks from continuing to appear in retrieval.

RAG search respects the selected scope. Collection attachments query the whole
collection, while indexed file attachments restrict returned sources to the
selected file IDs. Search source metadata is normalized and preserved so source
blocks can show citations, images, collection IDs, and file IDs consistently.

## Document Parse Jobs

Document parsing jobs include an opaque job secret. The client must provide
that secret when polling or cancelling `/api/doc-parse/jobs/:id`; requests
without the secret are rejected. Hosted deployments must use a shared
`DOCUMENT_PARSE_JOB_STORE` so jobs are not lost when another instance handles
the poll.

Mineru ZIP results are bounded before extraction. The parser limits entry
count, decompressed size, compression ratio, and final Markdown size before
using `full.md`, reducing risk from oversized or highly compressed archives.

## Context Budgeting

Context planning is centralized in `src/lib/chat/contextBudget.ts`.

The planner uses model metadata when available:

- `limit.context` sets the input token ceiling.
- `limit.output` is reserved for the model response.
- A stable character estimate is used when token metadata is unavailable.

Current allocation bands are history, attachments, search, RAG, and tools.
Search context injection already uses this planner before adding web results to
the model input. Other context producers should use the same helper instead of
adding independent truncation rules.

## Rendering And Sandbox Boundaries

Markdown rendering supports safe inline HTML visual blocks, Mermaid diagrams,
mind maps, image previews, citations, and artifacts. Inline HTML is sanitized;
scripts, event handlers, iframes, unsafe URLs, full HTML documents, and unsafe
style constructs are blocked before rendering.

Native model image output is stored as ordered `MessageOutputBlock` entries.
Mixed Gemini text/image responses and OpenAI image-generation events append
`text` and `image` blocks in the order received, so chat rendering, reading
mode, PNG export, and PDF print views use `outputBlocks` instead of only
`message.content`. New local user-sent images and prepared model-generated
images keep OPFS-backed file references; renderers resolve those files to
runtime Blob URLs and revoke the Blob URLs when the component unmounts or the
image source changes. Local image model requests use bounded multipart files
and native provider file IDs or URIs instead of Base64 payloads.

HEIC and HEIF uploads are converted to JPEG before compression. Images over 20
MiB are rejected before processing. Images over 10 MiB and at most 20 MiB are
always compressed even when automatic compression is disabled, and the result
must be at most 5 MiB. The composer remains locked during preparation and shows
separate conversion, compression, and document-parsing status text.

Remote image URLs still pass through the existing client and server URL safety
policies. The app does not fetch private-network image edit sources on behalf
of users; image edit requests use uploaded files or provider-side file URLs
that pass validation. If a provider or route does not support a
requested image option such as multiple images, the provider error is surfaced
as a generation failure instead of silently downgrading to another model.

Legacy inline and remote images retain their existing rendering fallbacks. A
new local image is not attached when its required OPFS write fails.

Mermaid and mind map fullscreen views normalize generated SVG root attributes
for stable sizing and export snapshots. Fullscreen dialogs and reader views trap
focus, close with Escape, restore focus on close, respect safe-area insets, and
avoid forced smooth motion for users who prefer reduced motion.

Browser JavaScript artifact execution runs in a terminable worker inside the
sandbox iframe. The sandbox blocks network primitives, caps output, and times
out long-running code instead of letting it hang the page.

## UI Accessibility Baseline

Shared primitives provide consistent focus and announcement behavior:

- `Dialog` traps focus, restores focus, and closes with Escape.
- `Menu` supports ArrowUp, ArrowDown, Home, End, and Escape focus return.
- `Toast` uses `role="status"` or `role="alert"` with `aria-live`.
- `SafeImage` defaults to lazy loading, async decoding, and `no-referrer`.

New menus, dialogs, form fields, and image displays should prefer these
primitives before adding local one-off behavior.
