# Privacy and local data

Neo Chat is local-first. Conversations, settings, and workspace data are kept
in this browser by default. A request still sends the content needed for the
selected model or service; local storage does not make inference run offline.

## Where data lives

| Location       | Data                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `localStorage` | Core settings, shortcuts, provider records, selected models, and encrypted provider-key envelopes                            |
| IndexedDB      | Conversations and message trees, app settings, plugins, Skills, assistants, knowledge metadata, memories, and Research tasks |
| OPFS           | Chat and workspace files, knowledge originals and extracted text, user and generated images, and Research report artifacts   |

Research extension data (custom templates, source contracts, steering, evidence
snapshots, and report Q&A threads) is stored in the browser sidecar
`neo-chat-research-extensions`. It is currently excluded from ZIP backups and
encrypted sync. Research tasks and referenced report artifacts are included in
ZIP backups; see [encrypted sync](encrypted-sync.md) for its narrower data
scope.

The local global-search index is built in memory for the current app lifetime.
It is not uploaded, persisted, or used for telemetry. Browser site-data
clearing can remove local conversations, settings, plugins, memories,
knowledge data, and uploaded files.

## Back up or restore

Use the backup controls in **Settings → System**. A backup includes app data
and referenced app-owned files, including message branches, workspace files,
knowledge files, generated images, and Research data. Missing local file
references are recorded explicitly. If a stored message tree cannot be read,
the export fails instead of returning a partial conversation.

Backups exclude:

- provider, search, RAG, document-parsing, voice, plugin, and MCP credentials;
- browser-local encrypted secret envelopes, local master keys, and deployment
  secrets;
- external vector indexes, in-flight jobs, remote catalogs, regenerated caches,
  and runtime `blob:` URLs.

The current ZIP backup is bounded to 128 MiB compressed, 256 MiB uncompressed,
64 MiB per entry, and 32 MiB per JSON entry. The importer validates ZIP paths,
duplicates, extraction limits, sizes, and SHA-256 hashes before changing local
data. Restore replaces the local profile; it does not merge profiles. Files are
staged before the replacement, and a failed hydration or validation pass rolls
back the previous data on the next boot. Credentials must be entered again
after restore, and external RAG index references must be reconnected or
reindexed locally.

Older JSON exports can restore compatible metadata, but their referenced files
are unavailable because that format did not contain file blobs. Incompatible
legacy Research records are skipped with an explicit warning while other
compatible data is restored.

## What leaves the browser

Through the normal server proxy, a deployment can receive prompts, message
context, applied Skill instructions, tool arguments, search queries, document
parsing jobs, attachments, audio, plugin requests, and encrypted secret
envelopes. Treat application, hosting, and observability logs as sensitive.

Depending on the features you use, content may also go to model providers,
search providers, RAG/vector services, document parsers, voice providers,
plugin APIs, and remote MCP servers. Each service has its own logging and
retention policy. When memory search is used, matching memory snippets become
model context. Applied Skills likewise become model prompt context. Deep
Research may perform a small pre-approval query against its configured search
provider; that reconnaissance is recorded with the plan but is not report
evidence.

Review the privacy and retention policy of every provider or service before
sending sensitive content.

## Direct provider calls

Enable **Direct call** for a user-configured provider when the browser should
call that provider itself. The Neo Chat server then does not receive the
prompt, context, attachments, or provider key; the provider still receives
them. The server default provider always stays on the proxy because its key is
deployment-held.

Direct calls require CORS support from the provider and have no automatic proxy
fallback. Browser HTTP is limited to localhost, loopback, and literal private
LAN IP addresses; hostnames and public addresses require HTTPS. Server-side URL
checks, response limits, and logging do not apply to this path.

## Provider keys (BYOK)

For proxied requests, user-entered provider, search, RAG, parsing, voice,
plugin, and sync credentials are encrypted in the browser before they are sent
to an API route. Production deployments should keep one stable BYOK private key
and key ID across restarts and replicas:

```dotenv
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID=replace-with-a-stable-key-id
```

Changing the private key makes existing local envelopes unreadable until the
affected credentials are entered again. See the [environment variable
reference](environment-variables.md) and [deployment guide](deployment-hardening.md)
for configuration details. Direct calls use the browser-held provider key and
do not use this proxy envelope.

## Hosted deployments

`DEPLOYMENT_MODE=hosted` selects the shared-store and deployment safeguards,
but the deployment password is still only an access gate. A public multi-user
service also needs authentication, tenant isolation, server-side secret
management, quotas, audit logs, abuse controls, and provider spend limits. See
the [deployment guide](deployment-hardening.md).

## For contributors

- Never commit real credentials, private conversations, uploads, or production
  logs.
- Use synthetic fixtures and redact keys, passwords, BYOK material, and private
  paths from issues and screenshots.
- Update this document when storage, backup, proxy, BYOK, or third-party data
  flow changes.
