# Security Policy

Neo Chat is designed for local-first and self-hosted use. It is not a turnkey
boundary for a public multi-user SaaS deployment.

## Supported versions

Security fixes are handled on the default branch. If release branches are
introduced, update this section with the supported-version policy.

## Report a vulnerability

Report vulnerabilities privately through [GitHub Security
Advisories](https://github.com/u14app/neo-chat/security/advisories/new). Do not
include secrets, private chat logs, or private user files in a public issue.

A useful report includes:

- The affected version or commit.
- The deployment target: local, Docker, Cloudflare Workers, or another host.
- `DEPLOYMENT_MODE` and relevant store settings with secrets removed.
- Reproduction steps and expected impact.
- Safe proof-of-concept details, where available.

## Security boundaries

- Browser storage is the primary durable store for chats, app settings,
  plugins, assistants, knowledge metadata, and files.
- BYOK envelopes keep user-entered secrets out of plain server-route request
  fields. Deployments must still protect server logs, upstream services, and
  environment variables.
- `DEPLOYMENT_MODE=hosted` tightens policy for fixed registries and
  deployment-gated proxy surfaces and requires shared stores for hosted or
  multi-instance deployments. User-configured provider, search, RAG, plugin,
  and MCP URLs may still use HTTP or private addresses, so restrict that
  configuration to trusted administrators.
- `ACCESS_PASSWORD` is a deployment gate, not account authentication or tenant
  isolation.

Before running Neo Chat as a public service, add account authentication, tenant
isolation, server-side secret storage, quotas, audit logs, abuse controls, and
provider spend limits.
