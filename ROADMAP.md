# Roadmap

This roadmap records likely directions for Neo Chat. It is not a delivery
commitment; priorities may change as contributors find bugs, deployment issues,
or simpler implementation paths.

## Near term

- Keep local-first chat, workspace, Skill, plugin, assistant, memory, and
  knowledge flows stable across refreshes and storage migrations.
- Keep documentation current as deployment, Skill, plugin execution, privacy,
  and configuration behavior changes.
- Keep CI gates aligned across import hygiene, formatting, linting, type checks,
  unit and E2E tests, builds, and dependency audits.
- Keep release notes, versioned Docker image guidance, and upgrade notes
  current as releases evolve.

## Mid term

- Improve hosted deployment readiness with operational checks, shared-store
  diagnostics, and safer defaults.
- Expand plugin and Skill workflow examples for OpenAPI-compatible tools and
  text-only reusable instructions.
- Harden knowledge-base recovery and indexing diagnostics across refreshes,
  storage migrations, and upstream parser failures.
- Add screenshots and workflow examples for common model, search, RAG, voice,
  Skill, plugin, and deployment-health setups.

## Later

- Evaluate account authentication, tenant isolation, server-side secret
  storage, quotas, audit logs, and provider spend controls for public
  multi-user deployments.

## Known limitations

- `ACCESS_PASSWORD` is a deployment gate, not a user account system.
- Public multi-user SaaS deployments need additional security and operational
  controls before production use.
- Agent approval profiles default to permissive: destructive effects, credential
  exposure, unknown MCP tools, and similar high-risk work require one-time
  approval. Balanced also gates external writes, and strict gates local writes;
  reads remain automatic. Enable only plugins you trust.
- Skills provide text-only prompt context. They do not execute scripts, call
  networks, or access local files.
- Agent mode is a foreground, per-chat runtime. Closing the page interrupts an
  active run; persisted runs require explicit resume. The selected Agent
  Profile bounds tool access, approvals, and budgets, including revisioned
  workspace writes. Skills stay text-only, and sandboxed JavaScript has no DOM
  or network access.
