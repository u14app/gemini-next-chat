# Environment Variables

Most personal settings belong in the app. Environment variables configure
access protection, shared infrastructure, and deployment-wide service defaults.
Start from [.env.example](../.env.example); deployment steps are in the
[deployment guide](deployment-hardening.md).

## Where to set values

| Environment        | Configuration                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Local development  | `.env.local` in the project root                                                                                                 |
| Docker             | Container environment or a Compose `env_file`; the source Compose file forwards only its declared variables                      |
| Vercel             | Project environment settings for each deployment scope                                                                           |
| Cloudflare Workers | Runtime values in **Settings → Variables and Secrets**; build values separately in **Settings → Builds → Variables and Secrets** |

Keep credentials out of source control. `DEFAULT_*` service credentials are
shared by users of the deployment; leave them unset when users should supply
their own keys in browser settings. Restart or redeploy after runtime changes.

`NEXT_PUBLIC_*` values must be present during the build. `NEXT_DEPLOYMENT_ID` is
also build-time: use one release ID across replicas, or omit it for an automatic
ID. It controls Next.js version-skew protection and PWA cache rotation. The
source Docker Compose file passes it as a build argument. Runtime changes cannot
replace values already baked into a prebuilt image.

## Access control

| Variable          | Purpose                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_PASSWORD` | Deployment password gate; required in production local mode unless explicitly bypassed. Accepts comma-separated passwords, not user accounts. |

Commas are separators and cannot be part of an access password. Changing the
configured list invalidates existing access sessions. Whitespace and empty entries
are ignored. See the deployment guide for private and hosted access boundaries.

## BYOK server key

| Variable                   | Purpose                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BYOK_PRIVATE_KEY_PEM`     | Stable private key used by server routes to decrypt BYOK envelopes. Required for production unless ephemeral keys are explicitly allowed. |
| `BYOK_KEY_ID`              | Identifier for the active BYOK key. Use a stable value that changes when the key changes.                                                 |
| `BYOK_ALLOW_EPHEMERAL_KEY` | Allows temporary BYOK keys for local smoke tests. Keep `false` for production.                                                            |

Generate copyable BYOK values with:

```bash
corepack pnpm byok:generate
```

## Deployment safety

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

## Shared stores

| Variable                   | Purpose                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_STORE`         | Store for rate-limit state. Use `upstash` for hosted or multi-instance deployments.                             |
| `DOCUMENT_PARSE_JOB_STORE` | Store for document parsing jobs. Use `upstash` for hosted or multi-instance deployments.                        |
| `PLUGIN_REGISTRY_STORE`    | Store for server-registered plugin manifests. Use `upstash` for hosted or multi-instance deployments.           |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST endpoint used by shared stores.                                                              |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token used by shared stores.                                                                 |
| `SHARING_ENABLED`          | Enables conversation sharing only when set to `true` and both Redis values are configured. Defaults to `false`. |

Use `memory` only for a single local process. Hosted and multi-instance
deployments should use `upstash` for all three stores. The same Redis pair
coordinates specialized Research source requests; hosted source calls fail
closed when coordination is unavailable.

`SHARING_ENABLED=true` requires both Redis values and has no memory fallback.
Disabling it blocks publication and public reads without deleting existing
snapshots; authenticated revocation remains available with Redis configured.
Share links are readable without the deployment password. See
[conversation sharing](conversation-sharing.md) for limits and lifecycle.

Specialized Research source credentials belong in the Plugin Market, not in
environment variables. Their fixed official endpoints cannot be overridden with
`DEFAULT_*_BASE_URL`. See [Research sources](research-workflows.md).

## Upload limits

| Variable                    | Purpose                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_ATTACHMENT_FILE_BYTES` | Maximum prepared chat attachment size in bytes. Defaults to `10485760` and is clamped internally. Image sources may be up to 20 MiB only for client preprocessing; sources over 10 MiB are force-compressed and must finish at 5 MiB or less. |

## Public URLs

| Variable               | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | Public site URL used by app metadata and generated public links.                |
| `NEXT_PUBLIC_API_URL`  | Optional public API base URL override. Leave empty for same-origin deployments. |

## Default model provider

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

## Default task models

| Variable                            | Purpose                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `DEFAULT_MODEL_TITLE_GENERATION`    | Model used for automatic chat title generation.           |
| `DEFAULT_MODEL_RELATED_QUESTIONS`   | Model used for related-question generation.               |
| `DEFAULT_MODEL_CONTEXT_COMPRESSION` | Model used for history/context compression.               |
| `DEFAULT_MODEL_PROMPT_OPTIMIZATION` | Model used for prompt optimization.                       |
| `DEFAULT_MODEL_RAG_QUERY`           | Model used for RAG query generation.                      |
| `DEFAULT_MODEL_MEMORY`              | Model used for memory extraction and dream consolidation. |

## Search defaults

| Variable                  | Purpose                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `DEFAULT_SEARCH_PROVIDER` | Default external search provider: `tavily`, `firecrawl`, `exa`, `bocha`, or `searxng`. |
| `DEFAULT_SEARCH_API_KEY`  | Deployment-level search API key when required by the selected provider.                |
| `DEFAULT_SEARCH_BASE_URL` | Base URL for configurable search providers such as SearXNG.                            |

Firecrawl's public search works without an API key; a key only raises the
request rate. An explicit non-default Firecrawl Base URL selects a self-hosted
service.

## RAG and document processing

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

## Voice defaults

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

## Default system behavior

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
