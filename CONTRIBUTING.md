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
dedicated development server on port 3100 by default; set
`NEO_CHAT_E2E_REUSE_EXISTING_SERVER=1` only when intentionally reusing a known
Neo Chat server.

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
