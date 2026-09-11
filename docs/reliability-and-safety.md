# Reliability and Safety Model

Neo Chat is local-first and self-hosting friendly. The runtime keeps failures
visible, treats retrieved content as untrusted, protects side effects behind
server policy, and preserves enough state for recovery. This page summarizes
the cross-cutting guarantees; see [Trusted Agent Runtime](agent-runtime.md) and
[Deep Research workflows](research-workflows.md) for their full contracts.

## Keep generation failures recoverable

Chat generation has explicit states: `idle`, `pending`, `attachments`, `rag`,
`searching`, `tool`, `model`, `done`, `error`, and `aborted`. Provider and
orchestration failures are stored on `Message.generationError`, not inserted
into assistant content as `Error: ...`. The UI renders a recoverable status
block so retry, regenerate, branch, and stop actions cannot be mistaken for
model output.

Search failures remain visible as sanitized search blocks. Successful search
updates merge sources and images without duplicating streamed entries.

## Keep capabilities explicit

Skills are text-only prompt modules. Built-in metadata comes from
`public/data/skills`; definitions load only after installation or selection.
Installed skills, custom edits, active IDs, and catalog/definition caches are
persisted in the browser. Only installed active Skills can be applied. Auto
selection lets the model choose from that set; manual mode injects the active
set directly. Normalization rejects script, external-tool, network, and file
system requirements.

Agent mode is opt-in and available only to models that advertise Tool Calling.
Its persisted `AgentRun`, tab lease, checkpoints, effect journal, approval
policy, and replay rules are described in [Trusted Agent Runtime](agent-runtime.md).
Deep Research uses the same low-level primitives but has a separate tool
surface and source snapshot.

## Gate tool effects

Tool descriptors classify effects (`local_read`, `local_write`,
`local_destructive`, `network_read`, `external_write`, and
`external_destructive`) together with idempotency, sensitivity, origin, target
scope, and a definition fingerprint. The policy may become stricter after
canonical arguments are known. Unknown or unverifiable MCP functions are
treated as external destructive effects.

Permissive mode can run reads, recoverable local changes, and trusted
non-destructive external writes automatically. Balanced and strict modes add
confirmation for progressively lower-risk writes. Permanent deletion, payment,
publication, permission changes, credential exposure, and unknown MCP tools
always require one-time confirmation. Destructive approval is never persisted.
Any session approval is bound to effect, target scope, provider/server, tool
name, and definition fingerprint; the server checks the same identity before
dispatch.

MCP servers are reached through `streamable-http` or legacy `sse` over HTTP(S).
The only transport fallback is connection setup after a 404 or 405, so a tool
call is never replayed across transports. User-configured MCP, provider,
search, RAG, and Plugin targets may be local or private; fixed registries and
built-in services remain HTTPS-only. Local/private targets increase the SSRF
surface, and HTTP can expose credentials or permit tampering. Installation and
execution retain server-side registration and response limits, and tool results
are bounded before entering later model context. The optional local stdio
bridge is documented in [MCP stdio bridge](mcp-stdio-bridge.md).

Built-in Plugin IDs are reserved. A custom entry cannot override one, and a
function-name collision is reported instead of resolved by guesswork.

## Recover local data

Knowledge records keep the original `sourcePath` separate from searchable or
editable `contentPath`. Parsed documents retain the binary source and extracted
text independently; local-storage and vector-index failures are recorded
separately.

| Action                               | Recovery behavior                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `cancelUpload(collectionId, fileId)` | Stops local and remote work, then removes only files with no durable reference            |
| `retryFile(collectionId, fileId)`    | Resumes the failed parse or index stage without discarding saved source/content files     |
| `reconcileCollection(collectionId)`  | Checks both paths, cleans orphans, and keeps extracted text when an old source is missing |
| `reparseFile`                        | Replaces extracted text only; edited extraction needs explicit confirmation               |

Document parse jobs carry an opaque job secret. Poll and cancel requests to
`/api/doc-parse/jobs/:id` must provide it. Hosted or multi-instance deployments
must use a shared `DOCUMENT_PARSE_JOB_STORE`; in-memory jobs are local-process
state. Mineru ZIP output is bounded before extraction by entry count,
decompressed size, compression ratio, and final Markdown size.

## Report catalog and search health

Plugin, MCP, Skill, and assistant catalogs distinguish fresh data, valid or
stale cache, explicit fallback, and request errors. A failed request without a
cache is never shown as an empty catalog. Search settings, the composer,
request preflight, and deployment health share the effective-capability
resolver. Deployment credentials are exposed to the browser only as the
`Default Search` capability; selecting a provider uses its client credential or
an explicitly valid `http`/`https` self-hosted URL.

Global search builds a cancellable in-memory index and rebuilds only changed
conversation, workspace, knowledge, and Memory sources. It indexes each
conversation's active branch and excludes reasoning, tool arguments/results,
binary data, settings, market content, and credentials. Document limits keep
metadata and show a partial-index notice when body text is omitted.

RAG reindexing removes stale vector IDs when a newer version has fewer chunks.
Collection attachments search the whole collection; indexed-file attachments
are restricted to selected file IDs. Normalized source metadata preserves
citations, images, collection IDs, and file IDs for rendering.

## Bound context and render untrusted content

Context planning is centralized in `src/lib/chat/contextBudget.ts`. Model
metadata supplies the input ceiling through `limit.context` and reserves
`limit.output` for the response; a stable character estimate is used when
metadata is unavailable. History, attachments, search, RAG, and tools should
all use this planner instead of adding independent truncation rules.

Markdown rendering sanitizes inline HTML, Mermaid, mind maps, image previews,
citations, and Artifacts. Scripts, event handlers, iframes, unsafe URLs, full
HTML documents, and unsafe style constructs are blocked.

Model text and image output is stored as ordered `MessageOutputBlock` entries;
renderers and exports use `outputBlocks` rather than only
`message.content`. Local user and model images keep OPFS references and are
resolved to revocable runtime Blob URLs. Image requests use bounded multipart
files or provider file IDs/URIs, not Base64 payloads. HEIC/HEIF is converted to
JPEG first; files over 20 MiB are rejected, files from 10–20 MiB are always
compressed, and the compressed result must be at most 5 MiB. A local image is
not attached when its required OPFS write fails.

Remote image sources pass client and server URL policies. The server never
fetches private-network edit sources on the user's behalf. Unsupported provider
options surface as generation errors instead of silently switching models.

Browser JavaScript artifacts run in a terminable worker inside the sandbox
iframe. The sandbox blocks network primitives, caps output, and times out long
running code. Fullscreen Mermaid, mind-map, and reader dialogs trap focus,
close with Escape, restore focus, respect safe-area insets, and honor reduced
motion.

## Accessibility baseline

Use the shared primitives for new controls:

- `Dialog` traps and restores focus and closes with Escape.
- `Menu` supports ArrowUp, ArrowDown, Home, End, and Escape focus return.
- `Toast` announces through `role="status"` or `role="alert"` with `aria-live`.
- `SafeImage` defaults to lazy loading, async decoding, and `no-referrer`.
