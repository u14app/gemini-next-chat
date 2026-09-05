# Privacy And Local Data

Neo Chat is local-first. Durable user data stays in browser storage whenever
possible, while server routes act as controlled proxies for providers, search,
RAG, document parsing, voice, and plugin execution.

## Browser Storage

Neo Chat uses several browser storage layers:

| Storage                         | Data                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localStorage`                  | Core settings, keyboard shortcut preferences, provider records, selected models, and provider API key envelopes.                                                            |
| IndexedDB through `localforage` | Chat metadata, messages, app settings, installed plugins, installed/custom skills, skill catalog and definition caches, assistants, knowledge metadata, and local memories. |
| Research IndexedDB              | Core Research tasks and reports, plus a separate `neo-chat-research-extensions` sidecar for templates, source contracts, steering, evidence snapshots, and Q&A threads.     |
| OPFS                            | Uploaded chat/workspace files, knowledge originals and extracted text, and file-backed user-sent or model-generated images.                                                 |

Deep Research tasks use a separate versioned IndexedDB database. Their
checkpoints live under the owning chat workspace, while published reports use a
global content-addressed `chat/research-artifacts` OPFS namespace. On the first
v2 initialization, only v1 Research task records, orphaned Research
checkpoints, and unreferenced Research report Artifacts are removed. Chats,
settings, knowledge, ordinary Agent data, and user workspace files are not part
of that reset. Old chat output blocks remain visible as removable “legacy
record cleared” placeholders.

Core Research tasks and referenced report Artifacts are included in versioned
ZIP backups. The `neo-chat-research-extensions` sidecar is currently excluded
from ZIP backup and encrypted cross-device sync, so custom templates, source
contracts, pending steering, evidence snapshots, and report Q&A threads remain
only in the browser where they were created.

Clearing browser data can remove local chats, settings, plugin configuration,
assistant records, memories, and uploaded files.

Generated images from native image models are stored as OPFS-backed message
output references in IndexedDB with the rest of the chat message. When users
export app data, those image output blocks and referenced OPFS files are
included in the exported conversation payload. PNG/PDF
message exports render the visible output blocks, while full app export
preserves every stored session message tree, including trees not referenced by
the current chat metadata. If any message tree cannot be read, the export fails
instead of returning partial data. The current full-app backup is export version
3 and records storage schema version 6. It creates a ZIP with `manifest.json`,
`data.json`, and every referenced app-owned OPFS blob that can be read. The
manifest records file size, MIME type, and SHA-256; missing files are listed
explicitly. Runtime `blob:` URLs, remote caches, external RAG vectors, plaintext
credentials, browser-local encrypted credential envelopes, and local master
keys are not included.

Keyboard shortcut bindings are ordinary core preference data, not secrets. They
are included in versioned app backups and in the encrypted `core-settings`
document when cross-device sync is enabled. They apply only while the Neo Chat
page has focus; Neo Chat does not register operating-system global hotkeys.

Restore validates ZIP paths, duplicate entries, extraction limits, sizes, and
SHA-256 before replacing data. Files are written to new OPFS paths first, and a
small restore journal plus IndexedDB snapshot protects the replacement through
the next application boot. The restored data remains pending while the five
persisted stores hydrate, the current session is loaded, and every stored
message tree is structurally validated. Only then are the rollback snapshot and
superseded OPFS files removed. A hydration error, validation error, or page
interruption during that verification boot restores the previous data on the
next startup. Restore never merges profiles: it replaces local app data, clears
RAG index references, and requires credentials to be entered again. After a
successful restore, System Settings keeps a credential checklist for providers,
search, RAG/document parsing, voice, and plugin/MCP auth until the user
acknowledges it. Legacy v2 JSON exports can restore metadata, but their
referenced OPFS files are marked unavailable because those exports did not
contain file blobs. Backup inspection also counts v1 Deep Research payloads;
restore skips those incompatible Research records with an explicit warning
while still restoring all other compatible data.

ZIP import uses a bounded synchronous decompression step in the browser. To
keep peak memory predictable, backups are limited to 128 MiB compressed, 256
MiB uncompressed, 64 MiB per file, and 32 MiB per JSON entry. Reading is
streamed into a preallocated buffer and can be cancelled; cancellation is also
checked before and after decompression and hashing. The decompression call
itself cannot be interrupted once it starts, which is why the import limits are
deliberately conservative. Restore becomes intentionally non-cancellable only
after the validated data replacement phase begins.

Global search is also local-only. Its index exists in memory for the current app
lifetime and contains only each chat's active branch, workspace metadata,
knowledge text, and the existing memory fields. It is not uploaded, persisted,
or used for telemetry, and it excludes reasoning, tool payloads, and secrets.

New local image attachments keep an OPFS file reference as their canonical
message data. Legacy inline images are moved into multipart file fields when
used in a model request and can be promoted to OPFS-backed storage during image
preparation. Renderers resolve OPFS files to runtime `blob:` URLs with
`URL.createObjectURL(...)`; Blob URLs are never persisted.

For native OpenAI, Google, and Anthropic multimodal requests, the browser sends
local images to the server as bounded multipart files. The server uploads them
through the selected provider's file API and sends only the resulting
request-scoped file ID or URI to the model call. OpenAI and Anthropic temporary
files are deleted on a best-effort basis after the stream finishes; Google file
retention follows the provider-managed file lifecycle. Provider file references
are not persisted in chat history. OpenAI-compatible endpoints have no uniform
file-reference protocol, so local image files are rejected explicitly instead
of being converted to Base64; validated remote HTTPS image URLs remain
available where the provider supports them.

Memory is local-first, but it is not invisible to model providers. When the
memory search tool is used, matching memory snippets are included in the
current model request as context. Background memory extraction and dream
consolidation also send the latest exchange or memory set to the configured
memory task model.

Skills are also local-first prompt context. Built-in skill metadata and
definitions are fetched from `public/data/skills`; installed copies, local
edits, custom skills, and active skill selections are stored in browser
storage. When a skill is applied to a message, its instructions are included in
the model request as context. Skills do not execute code, access local files, or
call networks.

## BYOK Envelopes

User-entered secrets are encrypted in the browser before they are sent to API
routes. These include model provider keys, plugin auth values, search keys, RAG
tokens, document parsing keys, and voice provider keys.

Production deployments should configure a stable BYOK private key:

```bash
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID=prod-2026-07
```

If the server private key changes, existing local envelopes cannot be decrypted
until users re-enter the affected secrets.

## Direct Browser Calls

Each user-configured provider has a **direct call** toggle. When it is on, the
browser sends model requests straight to the provider endpoint and the server
never sees the prompt, the message context, the attachments, or the API key.
The key is used directly by the browser instead of being wrapped in a BYOK
envelope. It is sent to the configured provider, but never to the Neo Chat
server.

This is the most private transport, but it has hard limits:

- The provider endpoint must return CORS headers for this origin. Many
  self-hosted and gateway endpoints do not, and a browser preflight failure is
  opaque. Verify with **Fetch models** in provider settings before relying on
  it; there is no automatic fallback to the proxy.
- Direct `http://` calls are limited to `localhost`, loopback addresses, and
  literal private LAN IPs. Hostnames and public IPs must use HTTPS. An
  HTTPS-served app may still block an allowed local HTTP endpoint as mixed
  content.
- The server-side URL safety gates, response size limits, and error logging do
  not apply on this path.

The server default provider is always proxied. Its key is server environment
material and is never exposed to the browser.

## Server Proxy Boundaries

Server routes can receive prompts, message context, applied skill instructions,
generated tool calls, search queries, document parsing jobs, multipart image
files, audio payloads, plugin requests, and BYOK envelopes. Local memory tool
results may also be present in model request context. Deployments should treat
server logs, observability tools, and hosting provider logs as sensitive.

Remote MCP calls send model-generated tool arguments, including any context the
tool arguments contain, to the configured MCP server. MCP tool results return
through the plugin execution route and may be included in a subsequent model
request. Treat every MCP server as a third-party service with its own logging,
retention, and external side-effect behavior.

Neo Chat validates request payloads, applies URL safety gates, limits response
sizes, and uses hosted-mode restrictions, but upstream providers still receive
the content required to complete user-requested actions.

## Third-Party Services

Depending on configuration, user content may be sent to:

- Model providers such as Google, Anthropic, OpenAI, or OpenAI-compatible endpoints.
- Search providers such as Tavily, Firecrawl, Exa, Bocha, or SearXNG.
- RAG/vector services and document parsers such as Mineru or LlamaParse.
- Voice providers such as ElevenLabs or Mimo.
- Plugin APIs enabled by the user.
- Remote MCP servers installed from the Registry or configured through a custom
  endpoint, and local stdio MCP servers explicitly enabled through the Docker
  bridge.

When Deep Research is selected, the composer discloses that the research
question may be sent to the configured public search provider before plan
approval. This pre-approval reconnaissance is limited to two summary-only
queries with five results each and a 30-second deadline. The query, result
domains, timing, and failure state are stored with the plan audit record, but
the summaries do not enter the formal evidence ledger and cannot be cited in a
report.

Text-only skills themselves are local prompt instructions, but applied skill
content can be sent to the selected model provider as part of the prompt.

Review each third-party service's privacy, retention, and logging policy before
using it with sensitive data.

## Hosted Deployment Risks

`DEPLOYMENT_MODE=hosted` tightens URL policy and shared-state requirements, but
it does not turn Neo Chat into a full public SaaS security boundary.

Before offering Neo Chat as a public multi-user service, add:

- Account authentication.
- Tenant isolation.
- Server-side secret storage.
- Quotas and provider spend controls.
- Audit logs and abuse controls.
- Operational monitoring and incident response.

## Data Handling Guidelines For Contributors

- Do not commit real secrets, private chats, user uploads, or production logs.
- Redact provider keys, access passwords, BYOK material, and private file names
  from issues and screenshots.
- Keep tests deterministic and use synthetic fixtures.
- Update this document when storage, proxy, BYOK, or third-party data flow
  behavior changes.
