# Contributing

Neo Chat is local-first and self-hosting friendly. Contributions should
preserve user data ownership, browser storage behavior, and deployment safety.

## Set up

Requirements:

- Node.js 24
- pnpm 10.30.3 through Corepack

Install dependencies and start the development server:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:3000` and configure at least one model provider in
**Settings**.

## Verify changes

Run focused checks while iterating. Before opening a pull request, run the full
project check set:

```bash
corepack pnpm check:imports
corepack pnpm format:check
corepack pnpm hygiene:artifacts
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
corepack pnpm audit --audit-level low
```

Use `corepack pnpm format` to apply Prettier formatting. Playwright uses a
dedicated development server on port 3100 by default. Set `NEO_CHAT_E2E_PORT`
to use another port. Its `.next-e2e` output and `tsconfig.e2e.json` let it run
alongside the normal development server without sharing Next's development
lock or rewriting `tsconfig.json`.
Playwright sets the internal `NEO_CHAT_E2E=1` flag automatically for this server;
it is not a deployment setting.

The managed server uses local fixture settings, in-memory stores, and an
ephemeral BYOK key. Deployment settings declared in `.env.example` and local
`.env*` files are cleared in the child process before the fixture settings are
applied, so a local access password, hosted mode, provider key, or public API
URL cannot redirect smoke tests into a developer's deployment. The files and
the parent shell environment are unchanged.

Set `NEO_CHAT_E2E_REUSE_EXISTING_SERVER=1` only when intentionally reusing a
known Neo Chat server. Playwright cannot change an already-running server's
configuration; that server must already use compatible fixture settings.

## Pull requests

- Keep changes focused and explain the user-facing behavior they change.
- Add tests for bug fixes, data migrations, API routes, and security-sensitive
  behavior.
- Update documentation when changing configuration, deployment behavior,
  plugins, privacy boundaries, or user workflows.
- For localization changes, follow
  [`docs/localization-pr-guide.md`](docs/localization-pr-guide.md) and record
  any intentional English fallback.
- Never include real API keys, access passwords, provider secrets, private chat
  logs, or user files in issues, tests, screenshots, or fixtures.
- For hosted deployment changes, review `DEPLOYMENT_MODE=hosted`,
  user-configured outbound URL trust boundaries, fixed-service HTTPS/host
  allowlists, shared stores, rate limits, and server-side plugin registry
  requirements.

## Security issues

Do not open public issues for vulnerabilities. Use [GitHub Security
Advisories](https://github.com/u14app/neo-chat/security/advisories/new).
