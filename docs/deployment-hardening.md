# Deployment Hardening

Neo Chat is local-first by default. A production self-hosted deployment should
decide whether it is running as a private local app or as a hosted internet app,
then configure secrets and shared state accordingly.

## Local or Private Self-hosted

Use `DEPLOYMENT_MODE=local` for Docker, LAN, or private deployments. User-
configured provider, search, RAG, plugin, and MCP endpoints may use HTTP(S) and
local/private addresses in either deployment mode.

Recommended settings:

```bash
DEPLOYMENT_MODE=local
ACCESS_PASSWORD=first-strong-password,second-strong-password
ALLOW_INSECURE_LOCAL_PRODUCTION=false
ALLOW_LOCAL_NETWORK_PROXY=
TRUST_PROXY_HEADERS=false
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID=prod-2026-07
```

Production `local` mode now fails closed for `/api/*` when `ACCESS_PASSWORD` is
empty. Set `ALLOW_INSECURE_LOCAL_PRODUCTION=true` only for a private deployment
that is not exposed to the internet and has another access boundary.

`ACCESS_PASSWORD` accepts one or more comma-separated passwords. Surrounding
whitespace and empty entries are ignored, commas cannot be part of a password,
and changing the list invalidates existing access sessions.

If the deployment has more than one instance, use Upstash for shared request
limits, document parse jobs, and server-registered plugins:

```bash
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

## Hosted Internet Deployment

Use `DEPLOYMENT_MODE=hosted` when the app is reachable from the public internet.
Hosted mode tightens CSP and requires shared short-lived state so rate limits,
document parse jobs, and server-registered plugins behave consistently across
instances. It does not reject HTTP, localhost, or private-network addresses for
user-configured provider, search, RAG, plugin, or MCP targets.

Required hosted settings:

```bash
DEPLOYMENT_MODE=hosted
ALLOW_LOCAL_NETWORK_PROXY=false
TRUST_PROXY_HEADERS=false
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID=prod-2026-07
```

Enable `TRUST_PROXY_HEADERS=true` only when the platform or reverse proxy strips
spoofed forwarded headers before requests reach Neo Chat. These headers affect
rate-limit identity and public request metadata; trusting user-supplied values
can weaken hosted protections.

Treat permission to configure outbound URLs as an administrative capability on
public deployments. Private-network targets expand the SSRF surface, and HTTP
can expose provider or plugin credentials and allow responses to be modified in
transit. Fixed registries and built-in service endpoints remain HTTPS-only, but
that does not protect a user-supplied target.

## Vercel Environment Variables

Vercel runs the standard Next.js build output, not the Cloudflare Workers
OpenNext output. Import the repository with the Next.js framework preset and use
the default output directory.

Recommended project settings:

```bash
Install Command: default, or corepack pnpm install --frozen-lockfile
Build Command: pnpm build
Output Directory: default
```

For public Vercel deployments, use hosted mode and shared stores:

```bash
DEPLOYMENT_MODE=hosted
ALLOW_LOCAL_NETWORK_PROXY=false
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID=prod-2026-07
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Set these values in the Vercel project under the Production, Preview, or
Development environments that need them. Vercel environment variables are
available to the build step and to Next.js function execution for that
deployment, so `NEXT_PUBLIC_SITE_URL` should be configured anywhere metadata,
Open Graph image URLs, or generated public links must use the deployed domain.

Keep deployment passwords, provider keys, BYOK key material, Upstash
credentials, and third-party service tokens out of source control. Configure
them as Vercel environment variables instead.

## Cloudflare Workers Environment Variables

OpenNext and Cloudflare Workers have separate build-time and runtime
configuration surfaces.

For Cloudflare Workers Builds, set:

```bash
Build command: pnpm build:worker
Deploy command: pnpm exec opennextjs-cloudflare deploy -- --keep-vars
```

OpenNext Cloudflare compatibility requires this repository to keep its Edge
Middleware entry point at `src/middleware.ts`.
Do not rename it to `src/proxy.ts`: the proxy entry point is emitted as Node.js
middleware by the current Next.js toolchain, which OpenNext Cloudflare does not
support. The middleware must also keep `/api/access/verify` and
`/api/request-proof/session` available as bootstrap routes.

Use Node 24 with Corepack-enabled `pnpm@10.30.3` for local, CI, Docker, and
Cloudflare build parity. Before deploying Worker changes, run:

```bash
pnpm build:worker
pnpm worker:size
```

`pnpm worker:size` runs `wrangler deploy --dry-run`, reads the gzip value from
Wrangler's `Total Upload` report, and checks it against the default 3 MiB
budget. The command fails if Wrangler fails, the report cannot be parsed, or
the gzip value exceeds the budget. Override with `WORKER_GZIP_BUDGET_BYTES`
only for an intentional budget change.

`--keep-vars` prevents deployments from replacing runtime variables configured
in the Cloudflare dashboard with only the values committed in `wrangler.jsonc`.
The default observability sampling in `wrangler.jsonc` is production-oriented;
temporarily raise sampling while debugging noisy incidents, then lower it again.

Set runtime variables in the Worker dashboard under **Settings -> Variables and
Secrets**. Use plain variables only for non-sensitive deployment defaults:

```bash
DEPLOYMENT_MODE=hosted
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
BYOK_ALLOW_EPHEMERAL_KEY=false
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Use secrets for sensitive values:

```bash
BYOK_PRIVATE_KEY_PEM
BYOK_KEY_ID
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ACCESS_PASSWORD
DEFAULT_PROVIDER_API_KEY
DEFAULT_SEARCH_API_KEY
DEFAULT_RAG_TOKEN
DEFAULT_LLAMA_PARSE_API_KEY
DEFAULT_ELEVENLABS_API_KEY
DEFAULT_MIMO_API_KEY
```

Workers Builds also has **Settings -> Builds -> Variables and Secrets**. Values
there are available only during the build step. Add `NEXT_PUBLIC_*` values and
any non-public values required by static generation there as well as in runtime
variables when the app also needs them after deployment.

Keep personal API keys and deployment secrets out of source control.
Deployment-level defaults such as `DEFAULT_PROVIDER_API_KEY` are shared by every
user of that Worker instance. Leave them unset when users should provide their
own provider keys in local browser settings.

Hosted mode also disables legacy plugin execution payloads where the browser
submits a complete plugin manifest and function definition to the server. Plugin
calls must resolve through server-registered plugin ids and function names.
Tool calls follow the selected effect-aware approval Profile. Irreversible
operations, credential exfiltration, permission changes, and unknown MCP Tools
always pause for a one-time allow or deny decision; destructive approval is
never persisted for the chat. See
[Reliability and Safety Model](reliability-and-safety.md) for tool execution
boundaries, context budgeting, and recovery behavior.

Remote MCP servers use the same server-registered plugin path and outbound URL
policy. Neo Chat supports `streamable-http` and legacy `sse` MCP over HTTP or
HTTPS, including localhost and private-network targets. Streamable HTTP is
preferred when both are available. Local Docker deployments may opt into the
isolated [stdio bridge](mcp-stdio-bridge.md); hosted and Worker deployments must
not run it. The official Registry remains HTTPS-only. Hosted or
multi-instance deployments should configure
`PLUGIN_REGISTRY_STORE=upstash` so installed MCP tools resolve consistently
across instances.

The stdio bridge's child environment allowlist prevents accidental variable
inheritance, but it is not an adversarial process boundary: bridge and children
usually share one container UID and same-UID `/proc` visibility. Run only
fully trusted and audited commands, and never inject unrelated secrets into the
bridge container. Strong isolation requires per-server containers, distinct
UIDs, `/proc` isolation, and a separate secret broker. The bridge container is
memory/PID bounded, and its transport rejects oversized or unterminated raw
stdio frames before JSON parsing as well as enforcing the parsed-result limit.

## Deployment Health

Settings includes a deployment health panel backed by `/api/health`. The route
returns non-secret status for BYOK, access password, hosted mode, shared stores,
default model, search, RAG/document processing, and voice readiness. Use it
after changing environment variables or moving from single-instance local mode
to hosted or multi-instance deployments.

`/api/health` intentionally reports availability and policy state only. It must
not expose access passwords, BYOK key material, provider keys, Upstash tokens,
or internal Redis URLs. It is a configuration readiness check, not a live canary
or external uptime monitor.

## Runtime Recovery

Knowledge-base OPFS files and vector records should be treated as durable user
data. Use the built-in reconciliation flow after storage errors, interrupted
uploads, or manual OPFS changes. It detects missing local files, cleans orphan
files, and leaves recoverable metadata instead of silently dropping entries.

Search, RAG, attachment, and tool context should share the central context
budget helper so hosted and local deployments behave consistently across model
providers with different context limits.

Document parsing uses asynchronous jobs for providers such as Mineru and
LlamaParse. In hosted or multi-instance deployments, keep
`DOCUMENT_PARSE_JOB_STORE=upstash`; in-memory job state is only suitable for a
single local process. Polling and cancellation require the job secret returned
when the job is created.

## Access Password Boundary

`ACCESS_PASSWORD` accepts multiple credentials, but it remains one deployment
gate for a single private deployment. It does not identify users and is not a
user account system. Before offering Neo Chat as a public multi-user SaaS, add
account authentication, tenant isolation, server-side secret storage, quotas,
audit logs, abuse controls, and provider spend limits.

The per-provider **direct call** toggle bypasses this gate entirely: those
requests go from the browser to the provider without touching the server, so
`ACCESS_PASSWORD`, request-proof signing, and rate limiting do not apply to
them. For BYOK providers the user is spending their own key, but do not assume
"gate the app" equals "gate the models". The server default provider is never
eligible for direct calls, so server-held keys stay behind the gate.

## Dependency Gate

Production changes should pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level low
```
