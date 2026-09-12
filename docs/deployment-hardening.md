# Deployment guide

Run Neo Chat with the official Docker image, build it from source, or deploy to
Vercel or Cloudflare Workers. Model providers can be configured in the app;
server defaults are optional.

- [Official Docker image](#official-docker-image): start without building locally.
- [Production configuration](#production-configuration): persistent keys, access,
  and shared stores.
- [Build from source](#build-from-source), [Vercel](#vercel), or
  [Cloudflare Workers](#cloudflare-workers): alternative deployment paths.
- [Verify and troubleshoot](#verify-and-troubleshoot): check readiness after setup.

## Official Docker image

The [Docker workflow](../.github/workflows/docker.yml) publishes
`ghcr.io/u14app/neo-chat` and `ghcr.io/u14app/neo-chat-mcp-bridge` to GitHub
Container Registry. It builds `linux/amd64` images; ARM hosts need amd64
emulation or a local source build.

| Image reference                            | Use                                                        |
| ------------------------------------------ | ---------------------------------------------------------- |
| `ghcr.io/u14app/neo-chat:latest`           | Tracks the default branch; not a stable-release channel.   |
| `ghcr.io/u14app/neo-chat:<tag>`            | Pin a published Git tag, including its `v` prefix.         |
| `ghcr.io/u14app/neo-chat@sha256:<digest>`  | Pin an exact published image for reproducible deployments. |
| `ghcr.io/u14app/neo-chat-mcp-bridge:<tag>` | Optional local MCP bridge image with matching tags.        |

Choose an available tag or digest from the
[package page](https://github.com/u14app/neo-chat/pkgs/container/neo-chat).

### Try locally

```bash
docker pull ghcr.io/u14app/neo-chat:latest
docker run --rm --name neo-chat-demo \
  -p 127.0.0.1:3000:3000 \
  -e DEPLOYMENT_MODE=local \
  -e ACCESS_PASSWORD='replace-with-a-strong-password' \
  -e BYOK_ALLOW_EPHEMERAL_KEY=true \
  ghcr.io/u14app/neo-chat:latest
```

Open [localhost:3000](http://localhost:3000), enter the password, and add a model
provider in Settings. Stop the container with `Ctrl+C`.

This example uses temporary BYOK keys. After a restart, the browser refreshes
the server public key and re-encrypts the locally saved credential once. Use
stable keys for a long-lived or replicated instance.

### Run with Docker Compose

Create a deployment directory with these two files. This setup pulls the official
image and does not require a source checkout or local build.

`compose.yaml`:

```yaml
services:
  neo-chat:
    image: ghcr.io/u14app/neo-chat:latest
    ports:
      - "127.0.0.1:3000:3000"
    env_file:
      - .env
    restart: unless-stopped
```

`.env` (replace the password, private key, and key ID before starting):

```dotenv
DEPLOYMENT_MODE=local
ACCESS_PASSWORD=replace-with-a-strong-password
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
BYOK_KEY_ID=replace-with-your-key-id
ALLOW_INSECURE_LOCAL_PRODUCTION=false
TRUST_PROXY_HEADERS=false
RATE_LIMIT_STORE=memory
DOCUMENT_PARSE_JOB_STORE=memory
PLUGIN_REGISTRY_STORE=memory
```

Generate the BYOK pair with `corepack pnpm byok:generate` in a source checkout.
Without a checkout, save the standalone [key generator](../scripts/generate-byok-key.mjs)
as `generate-byok-key.mjs` and run `node generate-byok-key.mjs` with Node.js.
Copy its three output assignments into `.env`. Keep the private key on one line with literal `\n` separators;
Neo Chat converts them to PEM line breaks. Store the file securely and keep a
backup of the key and ID.

```bash
chmod 600 .env
docker compose pull
docker compose up -d
docker compose logs --tail=100 neo-chat
```

The port binds to the host's loopback interface. For internet access, put an
HTTPS reverse proxy in front and apply the hosted settings below. If the proxy
runs in another container, connect it to the app's Docker network and use
`neo-chat:3000` as its upstream.

Conversations and uploaded files are browser-local by default; a container
volume does not back them up. Use the app's backup/export or encrypted sync,
and keep the browser origin (scheme, host, and port) consistent when migrating.
See [privacy and local data](privacy-and-local-data.md).

### Update or roll back

Back up local data from the app and retain `.env`. Review the
[changelog](../CHANGELOG.md), then pull and recreate the service:

```bash
docker compose pull neo-chat
docker compose up -d neo-chat
docker compose logs --tail=100 neo-chat
```

For a pinned deployment, change `image` to the chosen published tag or digest
before running these commands. To roll back the server, restore the previous
image reference and run them again. An image rollback does not reverse browser
data migrations; retain a pre-upgrade backup. Keep the same BYOK key and ID
across container replacements and replicas.

## Production configuration

### Access and stable keys

Set `BYOK_PRIVATE_KEY_PEM`, `BYOK_KEY_ID`, and
`BYOK_ALLOW_EPHEMERAL_KEY=false` for a long-lived deployment. Set
`ACCESS_PASSWORD` when password protection is desired. Generate keys once, not
on every restart. Changing the private key invalidates cached server envelopes;
the browser refreshes the public key and re-encrypts locally saved credentials
once on the next proxied request.

Hosted mode can start without a stable key by generating a process-local BYOK
key and request-proof signing key. This availability fallback is intended for a
single instance: a restart invalidates the temporary material, and replicas do
not share it. The browser re-establishes request proof once after a key change,
and the BYOK client similarly refreshes a stale public key once.

`ACCESS_PASSWORD` is optional. A non-empty value enables the deployment password
gate; an empty or unset value disables it. It accepts comma-separated passwords,
trims whitespace, and ignores empty entries. Passwords cannot contain commas.
Changing the list invalidates existing access sessions. Production local mode
still rejects API requests without a password unless
`ALLOW_INSECURE_LOCAL_PRODUCTION=true` is explicitly set for a private
installation protected by another access boundary.

The password is a deployment gate, not an account system. A public multi-user
service needs authentication, tenant isolation, secret management, quotas,
auditing, abuse controls, and provider spending limits. Deployment defaults such
as `DEFAULT_PROVIDER_API_KEY` are shared by all users; leave them unset for BYOK.

### Private or hosted mode

Use `DEPLOYMENT_MODE=local` for a private single-instance installation. For an
internet-facing deployment, add or replace these runtime values:

```dotenv
DEPLOYMENT_MODE=hosted
ALLOW_LOCAL_NETWORK_PROXY=false
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
UPSTASH_REDIS_REST_URL=https://your-redis-rest-endpoint
UPSTASH_REDIS_REST_TOKEN=replace-with-your-token
```

In a single hosted process, basic API rate limiting falls back to process memory
when Upstash is missing or unreachable. The fallback resets on restart and is
not coordinated across replicas. Document parsing jobs and plugin registration
retain their shared-store requirements. Multi-instance private or hosted
deployments should use all three Upstash stores so rate limits, parsing jobs,
and plugin registration remain consistent across replicas. The same Redis pair
coordinates specialized Research sources. Sharing additionally requires
`SHARING_ENABLED=true`; see [conversation sharing](conversation-sharing.md).

Leave `TRUST_PROXY_HEADERS=false` unless your proxy strips client-supplied
forwarded headers. Protected hosted APIs then use their verified request-proof
session as a fallback rate-limit identity; public bootstrap routes still share
a deployment bucket.

User-configured provider, search, RAG, plugin, and MCP URLs can use HTTP and
private-network addresses in either mode. Restrict configuration to trusted
users: HTTP exposes credentials in transit, and private targets expand the
server's SSRF surface. Fixed registries and built-in service endpoints retain
their HTTPS and allowlist policies.

### Build-time values

`NEXT_PUBLIC_*` values must be available during the build; changing only the
runtime environment of a prebuilt image cannot replace values already bundled
into client code or static output. Build from source if you need custom
`NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_API_URL` values baked into the app.

`NEXT_DEPLOYMENT_ID` is also build-time configuration. Use the same release ID
for every replica in a rollout; the source Compose file passes it as a build
argument. See the [configuration reference](environment-variables.md).

## Build from source

From a source checkout, the repository's [docker-compose.yml](../docker-compose.yml)
builds a local image:

```bash
ACCESS_PASSWORD='replace-with-a-strong-password' docker compose up --build -d
```

For a private deployment without a password, explicitly opt in to open local
API access:

```bash
ALLOW_INSECURE_LOCAL_PRODUCTION=true docker compose up --build -d
```

This source Compose file loads the optional root `.env` into the `neo-chat`
container, defaults to ephemeral BYOK keys, and publishes port 3000 on all host
interfaces. Set stable keys for long-lived use and restrict network access as
appropriate. The `mcp-bridge` service intentionally keeps an explicit
environment allowlist so application credentials are not copied into it.
Copying `.env.local` alone does not configure container runtime values.

For a Node.js deployment, use Node 24 and Corepack-managed pnpm 10.30.3:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm start
```

Configure the production values above before starting the server. Local MCP
stdio tools require the separate [MCP bridge](mcp-stdio-bridge.md).

## Vercel

Import the repository with the **Next.js** preset and default output directory.
Use `corepack pnpm install --frozen-lockfile` to install and `pnpm build` to build.

Set access protection, stable BYOK keys, hosted mode, and Upstash values in the
project's environment settings. Select the relevant Production, Preview, or
Development scope. Set `NEXT_PUBLIC_SITE_URL` before building so metadata and
public URLs use your domain. Keep all credentials out of source control.

## Cloudflare Workers

Use Node 24 and pnpm 10.30.3. Build and deploy through the repository scripts:

```bash
corepack pnpm build:worker
corepack pnpm deploy:worker
```

For Workers Builds, set the build command to `pnpm build:worker` and the deploy
command to `pnpm exec opennextjs-cloudflare deploy -- --keep-vars`.
`--keep-vars` preserves dashboard-managed runtime variables.

| Configuration surface                         | Values                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Settings → Variables and Secrets**          | Hosted mode, store selectors, stable BYOK keys, access password, Redis credentials, and optional service defaults |
| **Settings → Builds → Variables and Secrets** | `NEXT_PUBLIC_*`, optional `NEXT_DEPLOYMENT_ID`, and other values required by the build                            |

Use secrets for passwords, BYOK key material, Redis credentials, and provider
keys. Keep only non-sensitive defaults in `wrangler.jsonc`. Build variables do
not automatically become runtime variables; configure both when needed.

OpenNext Cloudflare compatibility requires the Edge Middleware entry point at
`src/middleware.ts`. Do not rename it to `src/proxy.ts`: the current OpenNext
integration does not support its Node.js middleware. Keep `/api/access/verify`
and `/api/request-proof/session` available as bootstrap routes. Hosted and
Worker deployments must not run the local stdio bridge. See
[MCP bridge boundaries](mcp-stdio-bridge.md).

For Worker-specific verification, the existing `worker:dry-run` and
`worker:size` scripts inspect deployment output after `build:worker`.
`worker:size` checks Wrangler's reported gzip size against the existing 3 MiB
budget. It does not deploy the Worker. Production observability sampling is
configured in `wrangler.jsonc`; restore it after temporary debugging changes.

## Verify and troubleshoot

Open **Settings → deployment health** after deployment or configuration changes.
The `/api/health` route reports configuration readiness for keys, access, stores,
and service defaults. A password-protected deployment may return `401` before
authentication. Readiness does not prove that an upstream service is reachable.

| Symptom                                     | Check                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| API access denied                           | Access password and deployment mode; do not disable the gate to fix a public deployment. |
| Saved credentials fail after restart        | Stable BYOK private key and key ID are unchanged.                                        |
| Parsing jobs or tools fail across instances | All three shared-store selectors and both Redis values are configured.                   |
| Custom site URL does not appear             | Public URL values were set during the build.                                             |
| Local data appears missing after a move     | Browser profile and origin match the original installation.                              |

Provider direct calls bypass the server's password gate, request proofs, and
rate limits. The server-default provider cannot use direct calls, so its
server-held key remains behind those guards.

Use [reliability and recovery](reliability-and-safety.md) for generation, parsing,
and storage errors, and the [configuration reference](environment-variables.md)
for the full variable list. Source changes should follow the validation workflow
in [CONTRIBUTING.md](../CONTRIBUTING.md).
