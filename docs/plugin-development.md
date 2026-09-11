# Plugin Development

Plugins expose network-capable tools to compatible model providers. A plugin
can come from an OpenAPI manifest, a built-in definition, or a remote HTTP MCP
server. Enabled functions are sent to the model as tools, and runtime calls go
through server routes.

Plugins and MCP servers can call networks and external services. Skills are
different: they are text-only prompt context stored locally and do not execute
tools.

## Plugin shape

Plugins use the `Plugin` and `PluginFunction` interfaces from
`src/lib/plugin/types.ts`.

Required fields:

| Field         | Purpose                                                     |
| ------------- | ----------------------------------------------------------- |
| `id`          | Stable id used by settings, registry lookup, and execution. |
| `title`       | User-facing plugin name.                                    |
| `description` | User-facing summary.                                        |
| `logoUrl`     | Logo shown in the plugin market.                            |
| `manifestUrl` | URL for the source manifest or OpenAPI document.            |
| `functions`   | Tool functions exposed by the plugin.                       |

Optional fields include `externalDocsUrl`, `baseUrl`, `source`, `mcp`,
`category`, `categories`, `added`, `builtIn`, and `auth`. The `source` values
are `builtin`, `openapi`, and `mcp`; existing OpenAPI plugins may omit it.

Plugin IDs must be stable. Built-in IDs are reserved, so custom plugins and
manifest imports cannot replace built-in definitions.

### Deep Research is not a plugin

Deep Research is a first-class chat mode with a browser-owned emitter bridge.
Its start and planning tools are internal: they do not reserve a plugin
definition or appear in `installedPlugins`. During approved execution, enabled
plugin functions are exposed only when their verified policy is read-only;
registration and invocation reject effects outside `local_read` and
`network_read`.

Plugin manifests must not imitate the host context or claim access to
ResearchTask internals. The `deep-research` Skill remains a normal text Skill
and is never loaded by Research mode.

## Function shape

Each function should define:

| Field         | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `name`        | Stable, model-friendly tool name.                                                       |
| `description` | Short description sent to the model.                                                    |
| `parameters`  | JSON-schema-like parameter object.                                                      |
| `path`        | Relative REST/OpenAPI request path. Absolute and protocol-relative paths are rejected.  |
| `method`      | HTTP method for REST/OpenAPI tools, usually `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`. |
| `mcpToolName` | Original remote MCP tool name. MCP functions omit `path` and `method`.                  |
| `risk`        | Optional risk level: `read`, `write`, `destructive`, or `external`.                     |

The HTTP method is a minimum risk floor even when a manifest supplies `risk`:

- `GET` is at least `read`.
- `DELETE` is always `destructive`.
- Other mutating methods are at least `write`.
- MCP tools without an HTTP method are at least `external`, because the remote
  server owns their side effects.

A manifest may raise the risk level, never lower it.

## MCP servers

MCP is part of the plugin system. Installed servers live in
`installedPlugins`, enabled servers in `activePlugins`, and credentials in
`pluginConfigs` through the same local BYOK secret path as OpenAPI plugins.
There is no separate `activeMcpServers` store.

The app supports `streamable-http` and legacy `sse` servers discovered from the
official MCP Registry or configured by the user. It prefers Streamable HTTP and
retries legacy SSE only when connection setup returns 404 or 405.

Local deployments may run the separate authenticated
[stdio bridge](mcp-stdio-bridge.md). It translates a startup allowlist of stdio
processes to Streamable HTTP. The local-only custom MCP dialog discovers its
authenticated `/servers` list through a request-proof-protected BYOK proxy and
imports each descriptor with `plugin.mcp.source = "bridge"`. Commands,
arguments, working directories, and environment configuration never enter the
browser, and the browser never launches a process. User-configured MCP URLs
may use HTTP or HTTPS and may target localhost or a private network in local or
hosted deployments. The official Registry remains HTTPS-only.

During installation, the server route opens a short-lived MCP SDK client,
calls `listTools`, converts the result into `PluginFunction` entries, registers
the plugin in the server registry, and returns it for local installation.
Registry servers that require a header credential prompt for it before
discovery; the browser sends a BYOK-encrypted envelope and stores the
credential in its local encrypted-secret store. If authentication is required
before `listTools`, installation returns a clear auth-required error until a
pre-install credential flow is available.

Local tool names use this deterministic format:

```text
mcp_<server_slug>__<sanitized_tool_name>
```

Names are capped at the chat tool-schema limit. Truncated names and
same-plugin collisions receive a short hash suffix. The model sees only the
local name. Execution maps it back through `plugin.mcp.toolNameMap` or
`function.mcpToolName`, then calls `callTool({ name, arguments })`.

MCP results use the same `/api/plugins/execute` response shape as REST plugin
results and are compacted before storage when they exceed plugin execution
limits.

Registry metadata may provide static remote headers. They are stored in
`plugin.mcp.headers` and sent with `listTools` and `callTool`; registry secret
or required-header metadata is mapped to the existing plugin auth UI.

## Authentication

Plugin auth supports `none`, `bearer`, `apiKey`, `basic`, and `oauth2`.

For API keys, set `name` and `in` (`header` or `query`) to match the upstream
API. User-entered plugin secrets are stored as local BYOK envelopes before
server routes use them.

## OpenAPI import constraints

The importer accepts a bounded subset:

- The spec is a JSON object with a `paths` object.
- A server URL or OpenAPI `host` is present.
- Methods are `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.
- Paths start with `/`, do not start with `//`, and are truncated to the
  configured path limit.
- Query and path parameters become tool parameters.
- Operation names use `operationId` when available; unsafe characters become
  underscores.
- Path, parameter, and function counts are capped to prevent oversized
  manifests.

## Hosted deployment registry

Hosted mode blocks legacy payloads where the browser submits a complete plugin
definition for execution. Hosted execution resolves through server-registered
plugin IDs and function names.

Configure shared registry storage for hosted or multi-instance deployments:

```bash
DEPLOYMENT_MODE=hosted
PLUGIN_REGISTRY_STORE=upstash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

Built-in plugins are always resolvable by ID. Register custom plugins before
use and store them in the shared registry; otherwise another instance may not
resolve a call.

Built-in media plugin IDs are reserved and protocol-specific. Agnes and Gemini
image tools are image-processing plugins, `openai-image-generation` targets
the OpenAI-compatible Images API, and `openai-responses-image-processing`
targets the OpenAI Responses API. Supported built-ins may expose plugin-level
API Base URL and Model ID fields. Agnes video remains a two-step
`create_video` / `get_video_result` flow and accepts public HTTPS image URLs
for image-to-video.

Tool calls use effect-aware policy. Reads and recoverable writes may run
automatically according to the selected Agent approval Profile. Permanent
deletion, payment, publication, permission changes, credential exfiltration,
and unknown MCP functions always pause for allow-once or deny. Destructive
approval is never persisted.

Session approvals bind the provider/server, tool name, effect, target scope, and
stable definition fingerprint. Confirmation summaries redact credential-like
arguments. Interrupted confirmations fail closed, and the expected fingerprint
plus canonical arguments are rechecked before REST or MCP dispatch.

If two active plugins expose the same function name, execution returns a
collision error instead of choosing one silently. Keep names unique across
plugins that users are likely to enable together.

## Safety checklist

- Prefer trusted HTTPS plugin and OpenAPI origins. HTTP and private-network
  targets are supported but can expose credentials, permit response tampering,
  and expand the deployment's SSRF surface.
- Prefer `GET` for read-only tools and reserve mutating methods for actions that
  change external state.
- Mark destructive or external-side-effect functions with explicit risk
  metadata.
- Keep descriptions concise and specific so the model can choose tools
  correctly.
- Avoid collisions with built-in or commonly installed plugin names.
- Never log plugin secrets, provider keys, or raw private user data.

## Testing

Run the focused suites that cover the changed surface:

```bash
corepack pnpm test -- src/__tests__/pluginConfig.test.ts
corepack pnpm test -- src/__tests__/pluginManifest.test.ts
corepack pnpm test -- src/__tests__/pluginResolve.test.ts
corepack pnpm test -- src/__tests__/serverPluginRegistry.test.ts
corepack pnpm test -- src/__tests__/mcpRegistry.test.ts
corepack pnpm test -- src/__tests__/mcpInstallRoute.test.ts
corepack pnpm test -- src/__tests__/mcpExecuteRoute.test.ts
```

Before opening a pull request, also run:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```
