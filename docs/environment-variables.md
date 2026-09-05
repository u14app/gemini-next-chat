# Environment Variables

Neo Chat is local-first by default. Most user settings can be configured in the
browser, while environment variables provide deployment-level defaults,
security boundaries, and shared infrastructure configuration.

Use `.env.example` as the source template.

## Cloudflare Workers

For local development, use `.env.local` or `.dev.vars` as appropriate. Do not
commit production `.env` files.

For production Cloudflare Workers deployments, configure runtime values in the
Cloudflare dashboard under **Settings -> Variables and Secrets**. Configure
build-time values separately under **Settings -> Builds -> Variables and
Secrets** when Workers Builds must read them during `next build`. Build
variables are not available at runtime.

Use this Workers Builds setup:

```bash
Build command: pnpm build:worker
Deploy command: pnpm exec opennextjs-cloudflare deploy -- --keep-vars
```

Use Node 22 and Corepack-managed `pnpm@10.30.3` for local builds, CI, Docker,
and Workers Builds. Worker PRs should also pass `pnpm worker:size` and
`pnpm worker:dry-run` after `pnpm build:worker`.

`NEXT_DEPLOYMENT_ID` is an optional non-secret build-time release identifier.
Use a commit SHA or release ID, and use the same value for every replica in one
rollout. Neo Chat generates a unique fallback when it is omitted. The value is
baked into Next.js version-skew protection and the PWA cache namespace, so
setting it only as a runtime variable is too late. For Workers Builds, configure
it under **Settings -> Builds -> Variables and Secrets**. Docker Compose passes
the value as a build argument.

`--keep-vars` preserves dashboard-managed runtime variables and secrets across
deployments. Without it, deployments can replace dashboard variables with only
the values present in `wrangler.jsonc`.

Only non-sensitive deployment defaults should live in `wrangler.jsonc`. Each
deployment should set its own secrets in Cloudflare. Provider keys configured as
`DEFAULT_*_API_KEY` values are deployment-wide defaults shared by all users of
that Worker instance; leave them empty when users should bring their own keys in
the browser.

## Access Control

| Variable          | Purpose                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_PASSWORD` | Optional deployment-level password gate. Separate multiple accepted passwords with commas; surrounding whitespace and empty entries are ignored. This is not an account or tenant system. |

Commas are separators and cannot be part of an access password. Changing the
configured list invalidates existing access sessions.

## BYOK Server Key

| Variable                   | Purpose                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BYOK_PRIVATE_KEY_PEM`     | Stable private key used by server routes to decrypt BYOK envelopes. Required for production unless ephemeral keys are explicitly allowed. |
| `BYOK_KEY_ID`              | Identifier for the active BYOK key. Use a stable value that changes when the key changes.                                                 |
| `BYOK_ALLOW_EPHEMERAL_KEY` | Allows temporary BYOK keys for local smoke tests. Keep `false` for production.                                                            |

Generate copyable BYOK values with:

```bash
pnpm byok:generate
```

## Deployment Safety

| Variable                          | Purpose                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_MODE`                 | Selects local or hosted deployment safeguards and shared-store expectations. It does not block user-configured HTTP or private-network targets.                                             |
| `NEXT_DEPLOYMENT_ID`              | Optional build-time release ID shared by every replica in one rollout; drives Next.js version-skew protection and PWA cache rotation.                                                       |
| `ALLOW_INSECURE_LOCAL_PRODUCTION` | Explicitly allows production `local` mode without `ACCESS_PASSWORD`. Use only for private deployments that are not exposed to the internet.                                                 |
| `ALLOW_LOCAL_NETWORK_PROXY`       | Allows HTTP on deployment-gated media/image proxy surfaces. Private addresses themselves are no longer blocked; provider, search, RAG, plugin, and MCP policies do not depend on this flag. |
| `TRUST_PROXY_HEADERS`             | Trust forwarded proxy headers only when the hosting platform strips spoofed values.                                                                                                         |

`TRUST_PROXY_HEADERS` affects request identity used by deployment diagnostics
and rate limiting. Leave it `false` unless Neo Chat is behind a trusted proxy
that removes client-supplied forwarded headers.

User-configured provider, search, RAG, plugin manifest/execution, and MCP URLs
may use HTTP and may resolve to localhost or private-network addresses in both
deployment modes. Fixed registries and built-in service endpoints remain
HTTPS-only. On a public deployment, accept these user-configured URLs only from
trusted administrators because they expand the server's SSRF surface and HTTP
does not protect credentials or responses in transit.

## Shared Stores

| Variable                   | Purpose                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_STORE`         | Store for rate-limit state. Use `upstash` for hosted or multi-instance deployments.                             |
| `DOCUMENT_PARSE_JOB_STORE` | Store for document parsing jobs. Use `upstash` for hosted or multi-instance deployments.                        |
| `PLUGIN_REGISTRY_STORE`    | Store for server-registered plugin manifests. Use `upstash` for hosted or multi-instance deployments.           |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST endpoint used by shared stores.                                                              |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token used by shared stores.                                                                 |
| `SHARING_ENABLED`          | Enables conversation sharing only when set to `true` and both Redis values are configured. Defaults to `false`. |

Conversation sharing is disabled by default. Set `SHARING_ENABLED=true` and
configure both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to enable
it; sharing has no memory fallback. This is a server runtime variable: set it
in `.env.local` for local development, the environment passed to Docker Compose,
or Cloudflare **Settings -> Variables and Secrets**, then restart or redeploy
as appropriate. Only `true` enables it (case and surrounding whitespace are
ignored); unset, empty or other values keep it disabled.

When disabled, the menu entry is hidden and publication, updates, public reads
and share image requests return `SHARING_UNAVAILABLE`. Existing Redis snapshots
are not deleted. Authenticated revocation remains available while Redis is
configured, so deleting the original conversation can still cancel its share.
When enabled, anyone holding a share link can read it, including on
password-protected deployments; publishing and revocation keep the normal write
guards. See [conversation sharing](conversation-sharing.md) for lifetime, image
limits and deletion behavior.

All three stores may use in-memory state for one local process. Hosted,
Cloudflare Workers, and multi-instance Docker deployments should use `upstash`
for all three so rate limits, document parse jobs, and plugin execution
registry lookups survive across instances. The same Upstash pair coordinates
the provider leases used by the Deep Research arXiv, PubMed, EPO OPS, and SEC
EDGAR adapters. Hosted specialized-source calls fail closed with a coordination
error when the pair is absent or unreachable; a local single process can use
in-memory coordination.

Specialized source credentials are configured in the Plugin Market and stored
through the existing local encrypted-secret path. They are not environment
variables and are never copied into Research plans, templates, prompts,
evidence, or extension snapshots. arXiv needs no credential, PubMed accepts an
optional NCBI API key, EPO OPS requires a client ID and client secret, and SEC
EDGAR requires a contact-bearing User-Agent such as `Neo Chat research
team <research@example.com>`. These adapters use fixed official HTTPS
endpoints; their endpoint cannot be replaced with `DEFAULT_*_BASE_URL`.

## Upload Limits

| Variable                    | Purpose                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_ATTACHMENT_FILE_BYTES` | Maximum prepared chat attachment size in bytes. Defaults to `10485760` and is clamped internally. Image sources may be up to 20 MiB only for client preprocessing; sources over 10 MiB are force-compressed and must finish at 5 MiB or less. |

## Public URLs

| Variable               | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | Public site URL used by app metadata and generated public links.                |
| `NEXT_PUBLIC_API_URL`  | Optional public API base URL override. Leave empty for same-origin deployments. |

## Default Model Provider

| Variable                    | Purpose                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_PROVIDER_TYPE`     | Default provider type: `Google`, `Anthropic`, `OpenAI`, or `OpenAI Compatible`. Legacy `Gemini` is still accepted and normalized to `Google`.                              |
| `DEFAULT_PROVIDER_NAME`     | Display name for the default provider.                                                                                                                                     |
| `DEFAULT_PROVIDER_BASE_URL` | Base URL for the default provider. Google defaults to `/v1beta`, while OpenAI-compatible and Anthropic default to `/v1` unless a version segment such as `/v2` is present. |
| `DEFAULT_PROVIDER_API_KEY`  | Deployment-level API key for the default provider.                                                                                                                         |
| `DEFAULT_PROVIDER_MODELS`   | Model IDs exposed by the default provider. Supports comma-separated IDs, JSON string arrays, and JSON object arrays with optional metadata.                                |

`DEFAULT_PROVIDER_MODELS` JSON object entries may include display metadata,
capability aliases, and explicit modalities:

```bash
DEFAULT_PROVIDER_MODELS='[
  {
    "id": "gpt-image-2",
    "name": "GPT Image 2",
    "capabilities": ["image_generation"]
  },
  {
    "id": "gemini-3.1-flash-image",
    "modalities": {
      "input": ["text", "image"],
      "output": ["text", "image"]
    }
  }
]'
```

Supported capability aliases include `vision`, `attachment`, `audio`,
`reasoning`, `tool_call`, `image_generation`, `image_output`, and
`image_editing`. `image_generation` / `image_output` add `image` to
`modalities.output`; `image_editing` adds `image` to both input and output.
When explicit `modalities.input` or `modalities.output` are present, they are
treated as authoritative for that direction.

Image generation request counts are not configured here. `imageCount` is an
optional per-request API field planned by the app when the selected model
supports image output; it is omitted when the user did not clearly ask for
multiple separate images.

## Default Task Models

| Variable                            | Purpose                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `DEFAULT_MODEL_TITLE_GENERATION`    | Model used for automatic chat title generation.           |
| `DEFAULT_MODEL_RELATED_QUESTIONS`   | Model used for related-question generation.               |
| `DEFAULT_MODEL_CONTEXT_COMPRESSION` | Model used for history/context compression.               |
| `DEFAULT_MODEL_PROMPT_OPTIMIZATION` | Model used for prompt optimization.                       |
| `DEFAULT_MODEL_RAG_QUERY`           | Model used for RAG query generation.                      |
| `DEFAULT_MODEL_MEMORY`              | Model used for memory extraction and dream consolidation. |

## Search Defaults

| Variable                  | Purpose                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `DEFAULT_SEARCH_PROVIDER` | Default external search provider: `tavily`, `firecrawl`, `exa`, `bocha`, or `searxng`. |
| `DEFAULT_SEARCH_API_KEY`  | Deployment-level search API key when required by the selected provider.                |
| `DEFAULT_SEARCH_BASE_URL` | Base URL for configurable search providers such as SearXNG.                            |

## RAG And Document Processing

| Variable                          | Purpose                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DEFAULT_RAG_BASE_URL`            | Default vector/RAG service base URL.                                                                   |
| `DEFAULT_RAG_TOKEN`               | Default vector/RAG service token.                                                                      |
| `DEFAULT_RAG_TOP_K`               | Default retrieval count for RAG queries.                                                               |
| `DEFAULT_RAG_CHUNK_SIZE`          | Default chunk size for knowledge indexing.                                                             |
| `DEFAULT_RAG_NAMESPACE`           | Default namespace for vector records.                                                                  |
| `DEFAULT_DOCUMENT_PARSE_PROVIDER` | Default document parser: `mineru` or `llamaParse`.                                                     |
| `DEFAULT_MINERU_API_TOKEN`        | Optional deployment-level Mineru token for precise parsing. Empty uses Mineru's no-token Agent parser. |
| `DEFAULT_LLAMA_PARSE_API_KEY`     | Deployment-level LlamaParse API key for document parsing.                                              |

## Voice Defaults

| Variable                          | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `DEFAULT_VOICE_PROVIDER`          | Default external voice provider. Empty means no default voice provider. |
| `DEFAULT_ELEVENLABS_API_KEY`      | Deployment-level ElevenLabs API key.                                    |
| `DEFAULT_ELEVENLABS_STT_MODEL`    | Default ElevenLabs speech-to-text model.                                |
| `DEFAULT_ELEVENLABS_TTS_MODEL`    | Default ElevenLabs text-to-speech model.                                |
| `DEFAULT_ELEVENLABS_TTS_VOICE_ID` | Default ElevenLabs text-to-speech voice ID.                             |
| `DEFAULT_MIMO_API_KEY`            | Deployment-level Mimo API key.                                          |
| `DEFAULT_MIMO_STT_MODEL`          | Default Mimo speech-to-text model.                                      |
| `DEFAULT_MIMO_TTS_MODEL`          | Default Mimo text-to-speech model.                                      |
| `DEFAULT_MIMO_TTS_VOICE_ID`       | Default Mimo text-to-speech voice ID.                                   |

When `DEFAULT_VOICE_PROVIDER` is set to `elevenlabs` or `mimo`, an empty default model disables that single STT or TTS capability. The browser UI falls back to native browser speech for disabled default capabilities.

`DEFAULT_MIMO_*` values configure the Mimo server default only when
`DEFAULT_VOICE_PROVIDER=mimo` and `DEFAULT_MIMO_API_KEY` is present. Otherwise
they remain available as documented defaults without exposing a shared provider.

## Default System Behavior

| Variable                            | Purpose                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_SYSTEM_PROMPT`             | Default system prompt used when the browser has no local override.                                                                        |
| `DEFAULT_ENABLE_AUTO_TITLE`         | Enables automatic title generation by default.                                                                                            |
| `DEFAULT_ENABLE_RELATED_QUESTIONS`  | Enables related-question suggestions by default.                                                                                          |
| `DEFAULT_ENABLE_AUTO_COMPRESSION`   | Enables automatic context compression by default.                                                                                         |
| `DEFAULT_COMPRESSION_THRESHOLD`     | Number of turns before automatic compression can run.                                                                                     |
| `DEFAULT_HISTORY_KEEP_COUNT`        | Number of recent history items retained after compression.                                                                                |
| `DEFAULT_ENABLE_CODE_COLLAPSE`      | Enables collapsible code blocks by default.                                                                                               |
| `DEFAULT_ENABLE_HTML_VISUAL_PROMPT` | Guides models to use safe inline HTML for visual structures. Defaults to enabled; set to `false` to disable for new self-hosted defaults. |

`DEFAULT_ENABLE_HTML_VISUAL_PROMPT` changes model instructions only. Message
rendering still sanitizes inline HTML and blocks scripts, event handlers,
iframes, unsafe URLs, and full HTML documents.
