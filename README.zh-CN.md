<p align="center">
  <img src="public/logo.png" width="80" alt="Neo Chat logo" />
</p>

<h1 align="center">Neo Chat</h1>

<p align="center">
  <strong>连接模型，汇聚知识，构建你的 AI 工作空间。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="https://github.com/u14app/neo-chat/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/u14app/neo-chat/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

Neo Chat 将多模型对话、Agent 和深度研究整合到一个可自托管的工作空间。连接自己的模型供应商，围绕文件开展工作，对话记录默认保存在浏览器中。

![Neo Chat 桌面界面](public/desktop.png)

<details>
<summary>查看移动端界面</summary>

![Neo Chat 移动端界面](public/mobile.png)

</details>

## 为什么选择 Neo Chat？

- **自由选择模型。** 支持 Google、OpenAI、Anthropic 和 OpenAI 兼容接口，可使用模型支持的图片理解与生成能力。
- **从对话到行动与研究。** 日常聊天、执行多步工具任务的 Agent，以及支持计划审核、引用报告和手动恢复的 Deep Research。
- **围绕你的知识工作。** 文件附件、知识库检索、本地搜索、记忆和可复用的助理预设。
- **按需扩展能力。** 文本技能、OpenAPI 插件、远程 MCP 服务器，以及连接本地 MCP 工具的可选 Docker 桥接。
- **不止于文字。** 语音、可编辑的内容产物、Markdown、公式、图表与交互式图表，并提供导出功能。
- **本地优先的数据管理。** 默认使用浏览器存储，支持 ZIP 备份与恢复，以及通过 WebDAV 或 S3/MinIO 进行可选的端到端加密同步。

界面支持简体中文、英语和日语，适配桌面与移动端。

版本变化见[更新日志](CHANGELOG.md)，后续计划见[路线图](ROADMAP.md)。

## 快速开始

### 本地运行

需要 **Node.js 24** 和 **pnpm 10.30.3**（通过 Corepack 使用）。

```bash
git clone https://github.com/u14app/neo-chat.git
cd neo-chat
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

打开 [localhost:3000](http://localhost:3000)，在**设置**中添加模型供应商和 API key，即可开始对话。

大多数选项都可以在应用内配置。如需设置部署级默认值，将 [.env.example](.env.example) 复制为 `.env.local`，并参考[环境变量文档](docs/environment-variables.md)。

### 使用 Docker 体验

直接运行官方镜像，无需克隆仓库：

```bash
docker run --rm -p 127.0.0.1:3000:3000 \
  -e ACCESS_PASSWORD='replace-with-a-strong-password' \
  -e BYOK_ALLOW_EPHEMERAL_KEY=true \
  ghcr.io/u14app/neo-chat:latest
```

打开 [localhost:3000](http://localhost:3000)，输入你设置的访问密码。此本地示例使用临时凭据加密密钥；用于生产环境前，请配置稳定的 BYOK 密钥，避免重启或多实例之间发生密钥轮换。

## 部署

| 平台                   | 开始方式                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Docker**             | 使用官方镜像，长期运行可参考 [Compose 配置](docs/deployment-hardening.md#run-with-docker-compose)。                         |
| **Vercel**             | 导入仓库，选择 Next.js 预设，保留默认输出目录。                                                                             |
| **Cloudflare Workers** | 运行 `corepack pnpm build:worker`，然后执行 `corepack pnpm deploy:worker`。部署脚本通过 `--keep-vars` 保留 dashboard 变量。 |

生产部署前，请按照[部署指南](docs/deployment-hardening.md) 配置稳定的 BYOK 密钥、访问保护和共享运行时存储。单实例 hosted 可临时使用进程密钥和内存限流；公开的多实例部署仍应使用稳定密钥与共享存储。

## 你的数据

对话和工作区文件默认保存在浏览器存储中。请求会将必要内容发送给你使用的模型供应商及服务，通常经过应用的 API 路由。本地优先存储不代表模型在离线运行。

加密同步需要主动开启。备份不包含凭据和外部服务数据；自定义模板、研究方向调整、报告问答等 Research 扩展数据目前仅保存在当前浏览器，不包含在 ZIP 备份或加密同步中。

Agent 和 Research 在浏览器前台编排运行。关闭页面会中断执行，已保存的任务需要显式恢复。部署访问密码是访问门禁，不是多用户账号系统。

了解更多：[隐私与本地数据](docs/privacy-and-local-data.md)、[加密同步](docs/encrypted-sync.md)、[安全政策](SECURITY.md)。

## 文档

浏览[文档中心](docs/README.md)，或直接选择下方指南。

| 指南                                           | 内容                                          |
| ---------------------------------------------- | --------------------------------------------- |
| [配置参考](docs/environment-variables.md)      | 模型供应商、搜索、RAG、语音与服务端默认值     |
| [部署指南](docs/deployment-hardening.md)       | Docker、Vercel、Cloudflare Workers 与生产配置 |
| [Agent 运行时](docs/agent-runtime.md)          | 工具、权限、工作区与执行恢复                  |
| [深度研究](docs/research-workflows.md)         | 模板、来源、研究方向调整与报告问答            |
| [插件开发](docs/plugin-development.md)         | 开发和集成工具                                |
| [本地 MCP 桥接](docs/mcp-stdio-bridge.md)      | 通过 Docker 连接允许列表中的 stdio 服务器     |
| [对话分享](docs/conversation-sharing.md)       | 发布、更新、设置有效期与撤销只读快照          |
| [离线模式](docs/offline-pwa.md)                | PWA 安装与可用的离线功能                      |
| [可靠性与安全](docs/reliability-and-safety.md) | 运行边界、异常处理与恢复                      |

## 参与贡献

欢迎贡献代码、报告问题或提出具体改进建议。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，了解开发环境、检查流程和 PR 要求。参与讨论请遵守[行为准则](CODE_OF_CONDUCT.md)，漏洞报告请遵循[安全政策](SECURITY.md)。

项目基于 Next.js、React、TypeScript 和 Zustand 构建。常用开发命令：

```bash
corepack pnpm dev        # 启动开发服务器
corepack pnpm lint       # 运行 ESLint
corepack pnpm typecheck  # 检查 TypeScript
corepack pnpm test       # 运行 Vitest
corepack pnpm build      # 创建生产构建
```

## 社区

欢迎在 [LinuxDo](https://linux.do/) 参与讨论，或通过 [Issue](https://github.com/u14app/neo-chat/issues) 报告问题、提出功能需求。

寻找早期仅支持 Gemini 的版本？代码已归档至 [`gemini-next-chat` 分支](https://github.com/u14app/neo-chat/tree/gemini-next-chat)。

## 许可证

[MIT](LICENSE)
