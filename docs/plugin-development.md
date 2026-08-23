# Plugin Development

Neo Chat plugins expose executable tools to compatible model providers. A
plugin can come from an OpenAPI manifest, a built-in definition, or a remote
HTTP-based MCP server. Enabled plugin functions are sent to the model as tools,
and runtime tool calls execute through server routes. Plugins are
different from Skills: Skills are text-only prompt-context instructions stored
locally, while plugins and MCP servers are network-capable tools executed by
the server-side plugin route.

## Plugin Shape

Plugins use the `Plugin` and `PluginFunction` interfaces from
`src/lib/plugin/types.ts`.

Required plugin fields:

| Field         | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `id`          | Stable plugin id used by settings, registry lookup, and tool execution. |
| `title`       | User-facing plugin name.                                                |
| `description` | User-facing summary.                                                    |
| `logoUrl`     | Logo URL shown in the plugin market.                                    |
| `manifestUrl` | URL for the source manifest or OpenAPI document.                        |
| `functions`   | Tool functions exposed by the plugin.                                   |

Optional fields include `externalDocsUrl`, `baseUrl`, `source`, `mcp`,
`category`, `categories`, `added`, `builtIn`, and `auth`. Existing OpenAPI
plugins may omit `source`; built-ins use `builtin`, imported OpenAPI plugins
use `openapi`, and MCP-backed plugins use `mcp`.

Plugin IDs must be stable. Built-in plugin IDs are reserved; a custom plugin or
manifest import cannot replace a built-in tool definition.

## Function Shape

Each function should define:

| Field         | Purpose                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `name`        | Tool name. Keep it stable and model-friendly.                                                         |
| `description` | Short description sent to the model.                                                                  |
| `parameters`  | JSON-schema-like parameter object.                                                                    |
| `path`        | Relative request path for REST/OpenAPI tools. Absolute URLs and protocol-relative paths are rejected. |
| `method`      | HTTP method for REST/OpenAPI tools, usually `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.               |
| `mcpToolName` | Original remote MCP tool name. MCP functions omit `path` and `method`.                                |
| `risk`        | Optional risk level: `read`, `write`, `destructive`, or `external`.                                   |

The method is a minimum risk floor even when a manifest supplies `risk`: `GET`
maps to at least `read`, `DELETE` is always `destructive`, and other mutating
methods map to at least `write`. MCP tools without an HTTP method are at least
`external` because the side effects are owned by the remote server. A manifest
may raise this level but cannot lower it.

## MCP Servers

MCP support is intentionally folded into the existing plugin system. Installed
MCP servers live in `installedPlugins`, enabled MCP servers live in
`activePlugins`, and credentials live in `pluginConfigs` using the same BYOK
local-secret path as OpenAPI plugins. There is no separate `activeMcpServers`
store.

The application supports `streamable-http` and legacy `sse` MCP servers
discovered from the official MCP Registry or configured by the user. It
prefers Streamable HTTP when both are advertised and safely retries legacy SSE
only when Streamable HTTP connection setup returns 404 or 405. Local
deployments may run the separate authenticated
[stdio bridge](mcp-stdio-bridge.md), which translates a startup allowlist of
stdio processes to a Streamable HTTP interface. The local-only custom MCP
dialog can discover its authenticated `/servers` list through a
request-proof-protected BYOK proxy and imports each descriptor with
`plugin.mcp.source = "bridge"`. The web application never receives or launches
commands, arguments, or environment configuration. User-configured MCP server
URLs may use HTTP or HTTPS and may target localhost or a private network in
local or hosted deployments. The official Registry fetch remains HTTPS-only.

During installation, the server route opens a short-lived MCP SDK client,
calls `listTools`, converts the tools into `PluginFunction` entries, registers
the resulting plugin in the server registry, and returns it to the browser for
local installation. Registry servers that require a header credential prompt
for it before discovery; the browser sends a BYOK-encrypted envelope and stores
the credential in its local encrypted-secret store. Local tool names use a
deterministic format:

```text
mcp_<server_slug>__<sanitized_tool_name>
```

Names are capped at the chat tool-schema limit and get a short hash suffix
when truncation or same-plugin collisions occur. The model sees only the local
tool name. Execution maps it back through `plugin.mcp.toolNameMap` or
`function.mcpToolName`, then calls MCP `callTool({ name, arguments })`.

MCP results are returned through the same `/api/plugins/execute` response
shape as REST plugin results and are compacted before storage if they exceed
plugin execution limits.

Registry metadata can provide static remote headers, which are stored in
`plugin.mcp.headers` and sent with MCP `listTools` and `callTool` requests.
Registry secret or required header metadata is mapped to the existing plugin
auth UI. If a server requires auth before `listTools`, installation returns a
clear auth-required error until a pre-install credential flow is added.

## Authentication

Plugin auth supports:

- `none`
- `bearer`
- `apiKey`
- `basic`
- `oauth2`

For API keys, set `name` and `in` (`header` or `query`) when the upstream API
requires a specific key location. User-entered plugin secrets are stored as
local BYOK envelopes before server routes use them.

## OpenAPI Import Constraints

OpenAPI conversion supports a bounded subset:

- The spec must be a JSON object with a `paths` object.
- A server URL or OpenAPI `host` must be present.
- Supported methods are `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.
- Plugin paths must start with `/`, must not start with `//`, and are truncated
  to the configured path limit.
- Query and path parameters are converted into tool parameters.
- Operation names come from `operationId` when available, with unsafe
  characters converted to underscores.
- The importer caps the number of paths, parameters, and plugin functions to
  prevent oversized manifests.

## Hosted Deployment Registry

Hosted mode blocks legacy payloads where the browser submits a complete plugin
definition for execution. In hosted deployments, plugin execution must resolve
through server-registered plugin ids and function names.

Set shared registry storage for hosted or multi-instance deployments:

```bash
DEPLOYMENT_MODE=hosted
PLUGIN_REGISTRY_STORE=upstash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

Built-in plugins are always resolvable by ID. Custom plugins should be
registered before use and stored in the shared registry for hosted or
multi-instance deployments; otherwise another instance may be unable to resolve
the function call.

Built-in media plugin IDs are reserved and protocol-specific. Agnes and Gemini
image tools are image processing plugins, `openai-image-generation` targets the
OpenAI-compatible Images API, and `openai-responses-image-processing` targets
the OpenAI Responses API. Supported built-ins can expose plugin-level API Base
URL and Model ID fields; Agnes video remains a two-step `create_video` /
`get_video_result` flow and accepts public HTTPS image URLs for image-to-video.

Tool calls use effect-aware policy. Reads and recoverable writes may run
automatically according to the selected Agent approval Profile. Permanent
deletion, payment, publication, permission changes, credential exfiltration,
and unknown MCP functions always pause for allow-once or deny. Destructive
approval is never persisted. Session approvals bind the provider/server, Tool
name, effect, target scope, and stable definition fingerprint. Confirmation
summaries redact credential-like arguments, interrupted confirmations fail
closed, and the expected fingerprint plus canonical arguments are rechecked
before REST or MCP dispatch.

If two active plugins expose the same function name, execution returns a
collision error instead of choosing one silently. Keep function names unique
across plugins that users are likely to enable together.

## Safety Checklist

- Prefer trusted HTTPS plugin and OpenAPI origins. HTTP and private-network
  targets are supported but can expose credentials, permit response tampering,
  and expand the deployment's SSRF surface.
- Prefer `GET` for read-only tools and reserve mutating HTTP methods for
  actions that actually change external state.
- Mark destructive or external-side-effect functions with explicit risk
  metadata.
- Keep descriptions concise and specific so the model can choose tools
  correctly.
- Avoid function-name collisions with other built-in or commonly installed
  plugins.
- Do not log plugin secrets, provider keys, or raw private user data.

## Testing

Relevant checks:

```bash
pnpm test -- src/__tests__/pluginConfig.test.ts
pnpm test -- src/__tests__/pluginManifest.test.ts
pnpm test -- src/__tests__/pluginResolve.test.ts
pnpm test -- src/__tests__/serverPluginRegistry.test.ts
pnpm test -- src/__tests__/mcpRegistry.test.ts
pnpm test -- src/__tests__/mcpInstallRoute.test.ts
pnpm test -- src/__tests__/mcpExecuteRoute.test.ts
```

Run the full project checks before opening a pull request:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
