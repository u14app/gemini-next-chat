<p align="center">
  <img src="public/logo.png" width="80" alt="Neo Chat logo" />
</p>

<h1 align="center">Neo Chat</h1>

<p align="center">
  <strong>Your models. Your knowledge. Your workspace.</strong>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/u14app/neo-chat/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/u14app/neo-chat/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

Neo Chat brings multi-model chat, agents, and deep research into a self-hostable workspace. Connect your own model providers, work with your files, and keep your conversation history in your browser by default.

![Neo Chat desktop interface](public/desktop.png)

<details>
<summary>Mobile preview</summary>

![Neo Chat mobile interface](public/mobile.png)

</details>

## Why Neo Chat?

- **Your choice of models.** Google, OpenAI, Anthropic, and OpenAI-compatible endpoints, with image input and generation where supported.
- **Chat, act, research.** Everyday conversations, an Agent mode for multi-step tool workflows, and Deep Research with reviewable plans, cited reports, and manual resume.
- **A workspace for your knowledge.** File attachments, knowledge-base retrieval, local search, memory, and reusable assistant presets.
- **Extend it your way.** Text Skills, OpenAPI plugins, remote MCP servers, and an optional Docker bridge for local MCP tools.
- **More than text.** Voice, editable artifacts, Markdown, math, diagrams, and interactive charts with export controls.
- **Local-first data.** Browser storage by default, ZIP backup and restore, and optional end-to-end encrypted sync through WebDAV or S3/MinIO.

The interface supports English, Simplified Chinese, and Japanese, with responsive desktop and mobile layouts.

See the [changelog](CHANGELOG.md) for release notes and the [roadmap](ROADMAP.md) for planned work.

## Quick start

### Run locally

Requires **Node.js 24** and **pnpm 10.30.3** (via Corepack).

```bash
git clone https://github.com/u14app/neo-chat.git
cd neo-chat
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open [localhost:3000](http://localhost:3000), add a model provider and API key in **Settings**, then start a conversation.

Most options are available in the app. To configure deployment-wide defaults, copy [.env.example](.env.example) to `.env.local` and follow the [environment variable reference](docs/environment-variables.md).

### Try with Docker

Run the official image without a source checkout:

```bash
docker run --rm -p 127.0.0.1:3000:3000 \
  -e ACCESS_PASSWORD='replace-with-a-strong-password' \
  -e BYOK_ALLOW_EPHEMERAL_KEY=true \
  ghcr.io/u14app/neo-chat:latest
```

Open [localhost:3000](http://localhost:3000) and enter your access password. This local example uses ephemeral credential-encryption keys; configure stable BYOK keys before production use to avoid key rollover across restarts and replicas.

## Deploy

| Platform               | Getting started                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker**             | Use the official image; see the [Compose setup](docs/deployment-hardening.md#run-with-docker-compose).                                    |
| **Vercel**             | Import the repository with the Next.js preset and the default output directory.                                                           |
| **Cloudflare Workers** | Run `corepack pnpm build:worker`, then `corepack pnpm deploy:worker`. The deploy script preserves dashboard variables with `--keep-vars`. |

Before production deployment, follow the [deployment guide](docs/deployment-hardening.md) to configure stable BYOK keys, access protection, and shared runtime stores. A single hosted process has temporary-key and in-memory rate-limit fallbacks; public multi-instance deployments should use stable keys and shared stores.

## Your data

Conversations and workspace files stay in browser storage by default. Requests send the necessary content to the model providers and services you use, usually through the app's API routes. Local-first storage does not mean inference runs offline.

Encrypted sync is optional. Backups exclude credentials and external service data; Research extensions such as custom templates, steering, and report Q&A are currently browser-local and excluded from both ZIP backups and encrypted sync.

Agent and Research runs are orchestrated in the foreground. Closing the page interrupts execution; saved runs require explicit resume. The deployment password is an access gate, not a multi-user account system.

Read more about [privacy and local data](docs/privacy-and-local-data.md), [encrypted sync](docs/encrypted-sync.md), and [security](SECURITY.md).

## Documentation

Browse the [documentation hub](docs/README.md), or jump to a guide below.

| Guide                                                    | What you'll find                                         |
| -------------------------------------------------------- | -------------------------------------------------------- |
| [Configuration](docs/environment-variables.md)           | Model providers, search, RAG, voice, and server defaults |
| [Deployment](docs/deployment-hardening.md)               | Docker, Vercel, Cloudflare Workers, and production setup |
| [Agent runtime](docs/agent-runtime.md)                   | Tools, permissions, workspaces, and execution recovery   |
| [Deep Research](docs/research-workflows.md)              | Templates, sources, steering, and report Q&A             |
| [Plugin development](docs/plugin-development.md)         | Build and integrate tools                                |
| [Local MCP bridge](docs/mcp-stdio-bridge.md)             | Connect allowlisted stdio servers through Docker         |
| [Conversation sharing](docs/conversation-sharing.md)     | Publish, update, expire, and revoke read-only snapshots  |
| [Offline mode](docs/offline-pwa.md)                      | PWA installation and available offline features          |
| [Reliability and safety](docs/reliability-and-safety.md) | Runtime boundaries, failure handling, and recovery       |

## Contributing

Contributions, bug reports, and focused improvements are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and pull request guidance. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report vulnerabilities through the [Security Policy](SECURITY.md).

Built with Next.js, React, TypeScript, and Zustand. Common development commands:

```bash
corepack pnpm dev        # Start the development server
corepack pnpm lint       # Run ESLint
corepack pnpm typecheck  # Check TypeScript
corepack pnpm test       # Run Vitest
corepack pnpm build      # Create a production build
```

## Community

Join the conversation on [LinuxDo](https://linux.do/), or open an [issue](https://github.com/u14app/neo-chat/issues) for a bug report or feature request.

Looking for the original Gemini-only project? It is archived on the [`gemini-next-chat` branch](https://github.com/u14app/neo-chat/tree/gemini-next-chat).

## License

[MIT](LICENSE)
