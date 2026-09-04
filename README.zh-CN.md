# Neo Chat

<p align="center">
  <img src="public/logo.png" width="96" alt="Neo Chat logo" />
</p>

<p align="center">
  <strong>本地优先的 AI 对话工作台，集成模型、助理、技能、插件、搜索、RAG、语音、记忆和产物。</strong>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/u14app/neo-chat/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/u14app/neo-chat/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/u14app/neo-chat/actions/workflows/docker.yml"><img alt="Docker" src="https://github.com/u14app/neo-chat/actions/workflows/docker.yml/badge.svg" /></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6" />
</p>

Neo Chat 是一个可自托管、本地优先的 AI 对话应用，基于 Next.js、React、TypeScript 和 Zustand 构建。它把多供应商模型、助理预设、纯文本技能、OpenAPI 风格插件工具、远程 MCP 与可选本地 stdio 桥接、联网与本地全局搜索、知识库 RAG、显式启用的加密跨设备同步、版本化备份恢复、本地记忆、离线 PWA、语音、生成媒体、富消息渲染、引用和可编辑产物整合到一个干净的工作台中。

它适合想使用现代 AI 工作台、同时保持本地数据所有权的用户。默认情况下，对话历史、工作区元数据、技能、插件配置、记忆、搜索索引和文件都保存在浏览器内；服务端路由作为受控代理，连接模型供应商、联网搜索、RAG、文档解析、语音、插件与 MCP 执行和部署健康检查。

## v2.4.0 亮点

- 新增显式启用的端到端加密个人保险库，通过 WebDAV 或 S3/MinIO 在多设备间
  收敛同步；恢复密钥、凭据、本地基线、搜索缓存和向量不会进入远端或 ZIP。
- 新增长对话虚拟列表、流式 checkpoint、首字前有限重试、部分输出续写、消息
  引用回复，以及重新生成兄弟分支时的显式模型选择。
- 新增会话级输入草稿、Token 与上下文用量摘要、生成期间的消息树变更保护，
  并明确离线状态下的交互边界。
- 新增仅浏览器前台运行的可信 Agent Runtime：持久化运行、按副作用授权、幂等
  执行账本、revision 工作区、不可变 Artifact、动态 Tool/Skill、分 Scope Memory
  与 MCP Resources/Prompts。
- 技能升级为参数化 schema，并支持最多四个普通技能组成的有序 bundle；参数在
  发送前校验，调用记录可复现。
- 新增集合级分块策略、Markdown 标题感知预览、显式重建索引、关键词与向量混合
  检索、关键词降级、稳定来源预览、文件筛选和串行批处理。
- 新增 HEIC/HEIF 转换、分阶段客户端图片压缩，以及 OpenAI、Google、Anthropic
  原生对话的文件化多模态上传。
- 远程 MCP 新增 legacy SSE 兼容、仅限连接阶段的安全降级和加密的安装时凭据，
  同时提供命令由部署配置固定的鉴权 Docker stdio 桥接。
- 新增严格不缓存 API 的本地部署离线 PWA、可访问的全局搜索模态框、本地化设置
  搜索、首次模型配置引导，以及只读的本地存储健康诊断。
- 自定义模型 metadata 和本地加密的 server-default 凭据改为按供应商隔离；无效、
  缺失或不匹配的默认配置会 fail closed。
- 本地存储 schema 升至 6，同时继续兼容版本 3 ZIP，并补齐中英日界面文案。

完整发布说明见 [CHANGELOG.md](CHANGELOG.md)。

## v2.2.0 亮点

- 通过官方 SDK 新增 Anthropic 原生 Messages API 支持。
- 新增从官方 MCP Registry 发现和安装远程 streamable HTTP MCP 服务器，
  支持插件市场管理、鉴权和服务端工具执行；本版本明确只支持远程 MCP
  服务器。
- 加强供应商请求、API 路由策略、上下文预算、出站 URL 安全、插件注册表
  和 Worker 部署校验。
- 将聊天壳层、输入框、消息渲染和聊天服务内部拆分为更小的模块，同时保持
  现有用户流程。
- 修复聊天历史、工具调用、供应商流式响应、媒体与导出、记忆/RAG/搜索/语音、
  设置和无障碍相关的已知问题。

## v2.1.0 亮点

- 重构 System Settings，提供更清晰的分组控制、About 面板、部署健康可见性，以及本地数据导出/重置入口。
- 新增模型原生图片生成/编辑，支持按顺序渲染图文混合输出块，并使用 OPFS 做图片显示缓存。
- 扩展内置插件媒体工具：Agnes/Gemini 图片处理、独立的 OpenAI 兼容 Images API 与 OpenAI Responses 图片处理插件、插件级 Base URL/Model ID 配置、受支持接口的图片数量参数、压缩后的图片工具结果，以及 Agnes 图片/视频处理能力升级。
- 为支持 reasoning 的 Google/Gemini 和 OpenAI-compatible 模型新增 thinking intensity 控制。
- 新增日文支持，覆盖应用界面、SEO metadata、助理语言路由、语音语言处理和公共 Skills 目录。
- 加强 hosted 部署安全，加入 API request proof、共享存储检查、服务健康覆盖、更安全的 URL/密钥处理，以及 Cloudflare Worker 命令修复。
- 新增基于 `CHANGELOG.md` 的 GitHub Release 自动化，以及仅在 fork 仓库运行的 upstream 同步 workflow。

## 功能特性

- 支持 Google、Anthropic、OpenAI 和 OpenAI-compatible endpoint 的多供应商
  对话，并按供应商隔离自定义模型能力 metadata。
- 对 metadata 声明支持图片输出/输入的模型提供原生图片生成和图片编辑，图文混排会按模型输出顺序渲染，并使用 OPFS + Blob URL 做图片显示缓存。
- OpenAI、Google、Anthropic 原生对话使用文件化多模态图片输入，不再发送
  Base64；HEIC/HEIF 转换与分阶段客户端压缩执行 20 MiB 原图上限、10 MiB
  强制压缩阈值和 5 MiB 压缩结果上限。
- 本地优先的会话、分支、置顶对话、会话级输入草稿、回复导航、Token/上下文
  用量摘要、工作区、工作区文件和助理指令。
- 显式启用的 WebDAV 或 S3/MinIO 端到端加密同步，包含设备身份、恢复代码、
  可收敛 CRDT 文档和加密 OPFS 分块。
- 支持 LobeHub Agent Registry 助理预设，也支持本地自定义助理。
- 支持面向工具调用模型的会话级 Agent 模式，由浏览器编排研究、分 Scope Memory、
  revision 工作区与 Artifact、声明式 Skill、MCP Resources/Prompts、沙箱
  JavaScript、结构化提问和持久化运行/授权状态。
- 支持独立深度研究模式：先用模型已有知识拟定计划，仅在概念不明确时依次查询
  选定知识库和公开摘要；经结构化计划确认后按 breadth/depth 自适应推进研究轮次，显式审计主张与证据关系，并支持安全
  暂停、手动恢复、报告版本、本地引用和响应式研究工作台；同时提供可复用研究模板、
  只读的 arXiv/PubMed/EPO OPS/SEC EDGAR 来源适配器、研究轮次结束时的前沿节点调整，
  以及绑定到每个报告版本的多话题闭卷问答。论据不足的报告仍在聊天和工作台展示，
  导出保留限制说明；问答快照失败不阻碍报告交付。完整报告以不可变 Artifact 保存，
  聊天保留其引用。报告标准标题支持中英日文，附录放入补充材料标签页，Markdown/PDF
  共用下载菜单；研究搜索串行执行并至少间隔两秒，Tavily 研究请求最多等待 90 秒。
  点击文档标题或正文预览即可打开阅读。
- 支持参数化文本技能：本地化公共目录、安装/卸载、编辑内置技能、本地自定义
  技能、自动选择、工作区预设，以及最多四个普通技能组成的有序非嵌套 bundle。
- 支持 OpenAPI 风格插件工具，以及 remote Streamable HTTP 与 legacy SSE MCP
  服务器，包含加密的安装时凭据、实际 transport 持久化、插件鉴权、服务端执行、
  风险下限和可选的破坏性调用确认；本地 Docker 部署还可通过独立鉴权桥接使用
  allowlist 中的 stdio 服务器。
- 内置网页阅读、天气、Unsplash 搜索、Agnes/Google 图片处理、OpenAI 兼容图片处理、OpenAI Responses 图片处理、Agnes 视频生成工具。Agnes 图片处理支持图生图编辑，Agnes 视频生成支持公开图片 URL 生成视频和插件级模型 ID。图片处理插件和模型原生图片输出保持分离。
- 支持 Google 原生 Google Search、OpenAI Web Search，以及 Tavily、Firecrawl、Exa、Bocha、SearXNG 等外部搜索。
- 在可访问的模态框中本地全局搜索活跃对话分支、附件、工作区、知识库和记忆，
  提供来源/日期/角色筛选和结果直达；设置页也提供独立的本地化搜索。
- 知识库 RAG 支持保留原文件、编辑提取内容、可配置的 Markdown 感知分块、
  关键词/向量混合检索、Mineru/LlamaParse 文档解析、文件名/状态筛选、串行批量
  操作，以及解析或索引失败后的恢复控制。
- 支持本地元数据和已引用 OPFS 文件的版本化 ZIP 备份与事务式恢复，不包含凭据
  和外部服务数据，并提供只读的配额与 OPFS 引用健康诊断。
- 本地部署可安装离线 PWA，离线时以只读方式保留历史记录、本地搜索、知识库访问和备份导出；托管部署会主动注销。
- 支持本地记忆、可选记忆搜索、后台记忆提取和记忆整合。
- 支持浏览器语音 API、ElevenLabs、Mimo 或兼容配置的语音输入输出。
- 支持 Markdown、安全内联 HTML 视觉块、GFM 表格、数学公式、代码高亮、Mermaid 图、思维导图、引用、推理、工具调用、图片、音频和产物渲染。
- 用户输入的模型、插件、MCP、搜索、RAG、语音密钥会以本地 BYOK envelope
  加密，server-default 供应商配置会 fail closed 校验。
- 支持部署健康检查，覆盖 BYOK、访问密码、共享存储、默认模型、搜索、RAG 和语音配置状态。
- 支持 Docker 和 Cloudflare Workers 部署。

部署方式与安全边界详见 [端到端加密同步](docs/encrypted-sync.md)、
[MCP stdio 桥接](docs/mcp-stdio-bridge.md) 与
[离线 PWA](docs/offline-pwa.md)，以及[深度研究工作流](docs/research-workflows.md)。

## 截图

![Neo Chat 桌面端](public/desktop.png)

![Neo Chat 移动端](public/mobile.png)

## 快速开始

### 环境要求

- Node.js 22
- pnpm 10.30.3

### 本地运行

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`，然后在设置里配置至少一个模型供应商。

如需部署级默认配置，可以复制环境变量模板：

```bash
cp .env.example .env.local
```

大多数设置都可以在浏览器中管理。服务端环境变量适用于共享默认模型供应商、托管部署安全、访问密码保护、共享运行时存储，或统一管理搜索、RAG、文档解析、语音、记忆和 HTML 视觉渲染等默认能力。

## 部署

### Docker Compose

```bash
docker compose up --build
```

Compose 会在 `http://localhost:3000` 暴露 Neo Chat，并使用本地/自托管安全默认值。生产 Docker 部署应设置稳定的 BYOK 值，托管或多实例部署应使用共享存储，并且只有在代理会剥离伪造转发头时才启用 `TRUST_PROXY_HEADERS`。

### Docker 镜像

```bash
docker build -t neo-chat:local .
docker run --rm -p 3000:3000 -e BYOK_ALLOW_EPHEMERAL_KEY=true neo-chat:local
```

Docker workflow 会为 pull request 构建镜像，并将 `main` / `v*` 标签发布到 GitHub Container Registry：

```text
ghcr.io/u14app/neo-chat:latest
```

### Vercel

把仓库导入为 Next.js 项目。Vercel 可以根据 `pnpm-lock.yaml` 和
`packageManager` 字段识别 pnpm，并使用 Next.js framework preset，因此
不需要自定义输出目录。

推荐项目设置：

```text
Framework Preset: Next.js
Install Command: default，或 corepack pnpm install --frozen-lockfile
Build Command: pnpm build
Output Directory: default
```

公开 Vercel 部署应在项目设置中配置生产环境变量：

```bash
DEPLOYMENT_MODE=hosted
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
BYOK_ALLOW_EPHEMERAL_KEY=false
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

部署密码、供应商 key、BYOK 材料和共享存储凭据应按 Production、Preview
或 Development 作用域配置为 Vercel environment variables，不要提交到仓库。
当 `NEXT_PUBLIC_*` 会影响 metadata 或公开链接生成时，需要在会构建这些部署的
环境中配置它。

### Cloudflare Workers

```bash
pnpm build:worker
pnpm worker:size
pnpm worker:dry-run
pnpm preview:worker
pnpm deploy:worker
```

Workers 应运行在 hosted 模式，并使用公开 HTTPS 上游。使用 Cloudflare
Workers Builds 时，建议把构建和部署命令分开，确保部署前已经生成
OpenNext 产物：

```bash
# Build command
pnpm build:worker

# Deploy command
pnpm exec opennextjs-cloudflare deploy -- --keep-vars
```

`--keep-vars` 会保留 Cloudflare dashboard 中配置的运行时变量和密钥，
避免部署时只使用仓库里 `wrangler.jsonc` 的值覆盖它们。

生产 Workers 应在 Cloudflare dashboard 的 **Settings -> Variables and
Secrets** 中配置运行时变量。非敏感部署默认值使用普通变量：

```bash
DEPLOYMENT_MODE=hosted
RATE_LIMIT_STORE=upstash
DOCUMENT_PARSE_JOB_STORE=upstash
PLUGIN_REGISTRY_STORE=upstash
BYOK_ALLOW_EPHEMERAL_KEY=false
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

部署密码、供应商 key、BYOK 材料和共享存储凭据应使用 secrets：

```bash
wrangler secret put BYOK_PRIVATE_KEY_PEM
wrangler secret put BYOK_KEY_ID
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put ACCESS_PASSWORD
```

使用 Cloudflare Workers Builds 时，如果某个变量需要在 `next build`
期间可用，尤其是 `NEXT_PUBLIC_*`，还需要在 **Settings -> Builds ->
Variables and Secrets** 中配置。运行时变量不会自动出现在构建步骤中。

不要把个人 API key 或部署密钥提交到 `wrangler.jsonc`。例如
`DEFAULT_PROVIDER_API_KEY` 是部署级默认 key，会被该 Worker 实例的所有
用户共享；如果希望用户在浏览器里使用自己的 key，就保持为空。

生产配置建议见 [Deployment Hardening](docs/deployment-hardening.md)。

## 配置

Neo Chat 默认本地优先：

- 核心设置、供应商记录、已选模型、会话级输入草稿和本地加密的供应商凭据
  envelope 存在浏览器 `localStorage`。
- 对话元数据、消息、应用设置、已安装插件、已安装/自定义技能、技能目录缓存、
  助理、知识库元数据、本地记忆、加密同步配置和 CRDT 基线通过 `localforage`
  存在 IndexedDB。
- 上传的对话与工作区文件、知识库原文件与提取文本，以及图片显示缓存保存在浏览器 OPFS。运行期 `blob:` URL 不会持久化；版本 3 ZIP 备份会打包已引用的应用自有 OPFS 文件，但不包含凭据和远程服务数据。
- 用户输入的密钥会先在浏览器中加密成 BYOK envelope，再发送给 API 路由。

重要服务端配置：

```bash
# 访问门禁（多个可用密码使用英文逗号分隔）
ACCESS_PASSWORD="first-password,second-password"

# 生产环境稳定 BYOK server key
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID="prod-2026-07"
BYOK_ALLOW_EPHEMERAL_KEY="false"

# 部署安全
DEPLOYMENT_MODE="local" # 或 hosted
ALLOW_LOCAL_NETWORK_PROXY=""

# 托管或多实例部署所需的共享短期状态
RATE_LIMIT_STORE="upstash"
DOCUMENT_PARSE_JOB_STORE="upstash"
PLUGIN_REGISTRY_STORE="upstash"
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."
```

默认模型供应商：

```bash
DEFAULT_PROVIDER_TYPE="Google"
DEFAULT_PROVIDER_NAME="Google"
DEFAULT_PROVIDER_BASE_URL=""
DEFAULT_PROVIDER_API_KEY="provider-key"
DEFAULT_PROVIDER_MODELS="model-a,model-b"
```

只有部署提供相关 `DEFAULT_PROVIDER_*` 或 `DEFAULT_MODEL_*` 配置时，应用才会暴露
server-default 供应商。部署 API key 可以留空，让每个浏览器保存自己的本地加密
凭据；该凭据只会在供应商类型与当前服务端默认配置一致时复用。服务端默认配置
缺失或类型不匹配时会 fail closed。自定义 Base URL 会在保存前校验，同时继续支持
受信任的自托管 HTTP/私网目标。

`DEFAULT_PROVIDER_MODELS` 支持多种格式:

```bash
# Comma-separated model IDs
DEFAULT_PROVIDER_MODELS="gpt-5.5,gpt-5.4-mini"

# JSON string array
DEFAULT_PROVIDER_MODELS='["gpt-5.5","gpt-5.4-mini"]'

# JSON object array with optional display names, capability aliases, and modalities
DEFAULT_PROVIDER_MODELS='[{"id":"gpt-image-2","name":"GPT Image 2","capabilities":["image_generation"]},{"id":"gemini-3.1-flash-image","modalities":{"input":["text","image"],"output":["text","image"]}},"gpt-5.4-mini"]'
```

JSON 对象条目中的 `name` 可选，缺省时会使用 `id` 作为显示名。
`capabilities` 支持 `vision`、`attachment`、`reasoning`、`tool_call`、
`image_generation`、`image_output`、`image_editing` 等 aliases。显式
`modalities.input` / `modalities.output` 存在时优先生效。

默认任务模型：

```bash
DEFAULT_MODEL_TITLE_GENERATION="model-a"
DEFAULT_MODEL_RELATED_QUESTIONS="model-a"
DEFAULT_MODEL_CONTEXT_COMPRESSION="model-a"
DEFAULT_MODEL_PROMPT_OPTIMIZATION="model-a"
DEFAULT_MODEL_RAG_QUERY="model-a"
DEFAULT_MODEL_MEMORY="model-a"
```

搜索、RAG、文档解析和语音默认值：

```bash
DEFAULT_SEARCH_PROVIDER="firecrawl"
# Firecrawl search works without an API key; set one for higher rate limits.
DEFAULT_SEARCH_API_KEY=""
DEFAULT_SEARCH_BASE_URL="https://search.example"

DEFAULT_RAG_BASE_URL="https://rag.example"
DEFAULT_RAG_TOKEN="rag-token"
DEFAULT_RAG_TOP_K="10"
DEFAULT_RAG_CHUNK_SIZE="512"
DEFAULT_RAG_NAMESPACE="default"
DEFAULT_DOCUMENT_PARSE_PROVIDER="mineru"
DEFAULT_MINERU_API_TOKEN=""
DEFAULT_LLAMA_PARSE_API_KEY="llama-parse-key"

DEFAULT_VOICE_PROVIDER="elevenlabs"
DEFAULT_ELEVENLABS_API_KEY="elevenlabs-key"
DEFAULT_ELEVENLABS_STT_MODEL="scribe_v2"
DEFAULT_ELEVENLABS_TTS_MODEL="eleven_flash_v2_5"
DEFAULT_ELEVENLABS_TTS_VOICE_ID="bIHbv24MWmeRgasZH58o"

DEFAULT_MIMO_API_KEY="mimo-key"
DEFAULT_MIMO_STT_MODEL="mimo-v2.5-asr"
DEFAULT_MIMO_TTS_MODEL="mimo-v2.5-tts"
DEFAULT_MIMO_TTS_VOICE_ID="mimo_default"
```

默认系统行为：

```bash
DEFAULT_SYSTEM_PROMPT=""
DEFAULT_ENABLE_AUTO_TITLE="true"
DEFAULT_ENABLE_RELATED_QUESTIONS="true"
DEFAULT_ENABLE_AUTO_COMPRESSION="true"
DEFAULT_ENABLE_CODE_COLLAPSE="true"
DEFAULT_ENABLE_HTML_VISUAL_PROMPT="true"
```

公开站点地址：

```bash
NEXT_PUBLIC_SITE_URL="https://your-domain.com"
```

完整模板见 [.env.example](.env.example)。

## 架构

```mermaid
flowchart LR
  Browser["浏览器应用\nReact + Zustand"] --> LocalStorage["localStorage\n供应商 + 加密密钥 + 草稿"]
  Browser --> IndexedDB["IndexedDB\n会话 + 插件 + 技能 + 知识库 + 记忆 + 同步"]
  Browser --> OPFS["OPFS\n上传 + 原文件 + 图片缓存"]
  Browser --> ApiRoutes["Next.js API routes"]
  ApiRoutes --> Providers["模型供应商\nGoogle / Anthropic / OpenAI / compatible"]
  ApiRoutes --> Search["搜索供应商"]
  ApiRoutes --> Rag["RAG + 文档服务"]
  ApiRoutes --> Plugins["插件 + MCP endpoint"]
  ApiRoutes --> Sync["WebDAV / S3"]
  ApiRoutes --> Voice["语音供应商"]
  ApiRoutes --> Health["部署健康"]
  Browser -. "加密 BYOK envelopes" .-> ApiRoutes
  Browser -. "加密同步对象" .-> ApiRoutes
```

应用尽量把持久用户数据保存在浏览器存储中。API 路由负责：

- 统一供应商请求和流式输出；
- 在服务端解密 BYOK；
- 为代理上游提供 URL 安全门；
- 通过已注册插件 ID 和函数名执行插件与 MCP；
- 代理已加密的 WebDAV/S3 同步对象，不在服务端持久化密钥；
- 通过 `/api/health` 输出部署健康状态；
- 在 hosted 模式检查共享存储和固定服务的网络边界。

## 技能、插件、搜索、RAG 与语音

技能是纯文本的提示词上下文模块。应用会从 `public/data/skills` 加载本地化元数据目录，只在需要时获取完整技能定义，并把已安装、已编辑和自定义技能保存在本地。活跃技能可以手动选择，也可以来自工作区预设，或在发送消息时自动选择。

Agent 模式是按会话显式启用、仅在浏览器前台编排的运行模式。它会持久化
`AgentRun`、执行记录、用量、结构化停止原因和事件 checkpoint，但页面关闭后
不承诺继续执行。初始 Tool 集保持紧凑，通过 `search_tools` / `load_tools` 与
`search_skills` / `inspect_skill` 按需发现已启用能力，避免把全部 schema 注入每轮
请求。JavaScript 仍只能在有边界的同步沙箱内运行，不能访问网络或 DOM；Skill
仍是声明式文本，不执行脚本。

Tool 策略由副作用、幂等性、敏感度、来源、目标与定义指纹共同决定。本地/网络
读取自动执行；可恢复本地写入与可信非破坏性外部写入遵循宽松、均衡或严格
Profile。永久删除、支付、发布、权限修改、凭据外发及未知 MCP Tool 始终只允许
单次确认。已发布 Artifact 是内容寻址的不可变快照；可变工作区文件使用 revision
校验和可恢复回收站。详见[可信 Agent Runtime](docs/agent-runtime.md)。

插件是可执行工具，可以来自 OpenAPI manifest、内置定义，或从官方 MCP Registry
发现的远程 MCP 服务器。启用的函数会以 tool 形式暴露给兼容模型，再由服务端插件
路由执行。远程 MCP 支持 Streamable HTTP 和 legacy SSE：优先尝试 Streamable HTTP，
仅当连接建立阶段返回 404 或 405 时才降级到 SSE；鉴权及其他错误不会跨 transport
重试。协商出的实际 transport 会保存并用于后续工具调用。需要 header 凭据的
Registry 条目会在发现工具前提示输入，并以本地加密密钥保存。本地 Docker 用户可
通过独立鉴权的 [MCP stdio 桥接](docs/mcp-stdio-bridge.md) 暴露预配置 stdio
服务器。用户配置的 MCP URL 可使用 HTTP 或 HTTPS，并可在任一部署模式下指向
localhost 或私网；官方 Registry 本身仍保持 HTTPS-only。

内置图片处理插件结果保留在工具详情和压缩后的对话历史中，由模型决定是否以及
如何在后续回复中引用生成或编辑后的图片。OpenAI 兼容 Images API 和 OpenAI
Responses 图片处理是两个独立插件，便于分别管理密钥和启用状态。受支持的内置
媒体插件提供插件级 API Base URL 与 Model ID 字段、可选图片数量参数、Agnes
图生图编辑，以及基于公开 HTTPS 图片 URL 的 Agnes 图生视频；Agnes 视频仍保持
显式 `create_video` / `get_video_result` 两步流程。工具调用编排使用较高但有边界
的循环上限，既允许多步任务，也避免递归工具调用失控。

搜索可以使用 Google 模型的原生 Google Search、OpenAI Web Search，也可以对
包括 Anthropic 在内的其他模型族使用外部搜索供应商。Agent 模式启用时，需要
选择外部供应商才能暴露 `web_search`；原生搜索不会与 Agent 函数调用组合。
Firecrawl 公共服务无需 API key 即可使用，会遵循所选时间范围，配置 key 只会
提高请求速率。独立的全局搜索模态框会在浏览器内存中索引活跃对话分支、附件、
工作区、知识库和记忆，并排除推理、工具 payload 和凭据。设置页还提供独立、
可通过键盘导航的本地化搜索。

知识库 RAG 会分别保留上传原文件和可编辑、可索引的提取文本，支持 Markdown
感知或递归分块及关键词/向量混合检索，可选使用 Mineru 或 LlamaParse 解析文档，
并可把 chunks 索引到外部向量服务。文件可按名称或状态筛选，也可串行批量重试、
重建索引、下载或确认删除，并逐文件报告结果。失败操作仍可重新解析、取消或对账，
不会丢弃仍可使用的原文件。

语音流程支持浏览器语音 API 和外部供应商。将 `DEFAULT_VOICE_PROVIDER` 设为 `elevenlabs` 或 `mimo` 可启用服务端默认语音供应商；留空则默认使用浏览器原生语音。默认模型值为空会禁用对应的 STT 或 TTS 能力，用户级密钥也可以由 UI 本地保存。

部署健康状态可从设置页和 `/api/health` 查看。它只返回非敏感状态，用于判断 BYOK、访问密码、hosted 模式、共享存储、默认模型、搜索、RAG 和语音配置是否可用。

## 安全模型

Neo Chat 适合自托管，但不是开箱即用的公共 SaaS 安全边界。

- 用户配置的 Provider、搜索、RAG、插件和 MCP 目标在任一部署模式下都可使用 HTTP 和私网地址。
- 固定 Registry 与内置服务继续使用 HTTPS 和域名白名单；媒体代理的 HTTP 开关仍由 `ALLOW_LOCAL_NETWORK_PROXY` 控制。
- 同步对象在浏览器内加密，并使用不透明的远端对象名；恢复材料、凭据、本地基线
  和设备身份不会进入远端对象或 ZIP 导出。
- BYOK envelope 防止用户输入的明文密钥出现在请求体中。
- server-default 供应商凭据会在本地加密并绑定供应商类型；部署默认配置不可用
  或类型发生变化时，请求会被拒绝。
- API schema 会拒绝未知高风险字段和过大的 payload。
- 插件执行仍然通过服务端代理和校验。工具调用默认自动执行；可在系统设置中选择仅让破坏性调用暂停，等待单次允许或拒绝。破坏性授权不会在本会话持久化。
- `ACCESS_PASSWORD` 支持使用英文逗号分隔多个密码（会忽略首尾空白与空项），
  但它仍然只是部署门禁，不是账号系统。密码本身不能包含英文逗号；修改密码列表
  会使现有访问会话失效。

如果要把 Neo Chat 作为公共多用户服务提供，请先补齐账号认证、租户隔离、服务端密钥存储、配额、审计日志、滥用控制和供应商费用控制。

运行时行为和恢复说明见 [Reliability and Safety Model](docs/reliability-and-safety.md)。

## 开发

质量检查：

```bash
pnpm check:imports
pnpm format:check
pnpm hygiene:artifacts
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm audit --audit-level low
```

常用脚本：

```bash
pnpm dev              # 启动 Next.js 开发服务器
pnpm build            # 生产构建
pnpm start            # 启动生产服务
pnpm format           # 使用 Prettier 格式化仓库
pnpm format:check     # 检查仓库格式
pnpm check:imports    # 拒绝不允许的长相对导入路径
pnpm hygiene:artifacts # 检查生成产物卫生
pnpm test:e2e         # 在 3100 端口运行隔离的 Playwright 冒烟测试
pnpm build:worker     # 构建 Cloudflare Workers
pnpm worker:size      # 检查 Worker gzip 体积预算
pnpm worker:dry-run   # 校验 Worker 部署但不发布
pnpm preview:worker   # 预览 Worker 构建
pnpm deploy:worker    # 部署 Worker 构建并保留 dashboard 变量
pnpm byok:generate    # 生成可复制的 BYOK key
```

项目结构：

```text
src/app/              Next.js routes 和 API routes
src/components/       对话 UI、设置、插件市场、知识库
src/lib/              服务端/客户端领域逻辑与安全门
src/services/         模型、搜索、语音、RAG、插件 service clients
src/store/            Zustand stores 和持久化迁移
src/__tests__/        Vitest 工具、路由和工作流测试
e2e/                  Playwright 浏览器冒烟测试
docs/                 部署和可靠性说明
```

项目文档：

- [环境变量](docs/environment-variables.md)
- [插件开发](docs/plugin-development.md)
- [隐私和本地数据](docs/privacy-and-local-data.md)
- [部署加固](docs/deployment-hardening.md)
- [可靠性与安全模型](docs/reliability-and-safety.md)
- [路线图](ROADMAP.md)
- [变更日志](CHANGELOG.md)

### Fork 同步

fork 维护者可以启用 `Sync upstream` workflow，把自己的 fork 从上游 `u14app/neo-chat` 的 `main` 分支快进同步。

1. 在 fork 仓库打开 **Settings > Actions > General**，允许 GitHub Actions 运行。
2. 在 **Workflow permissions** 中选择 **Read and write permissions**，让 `GITHUB_TOKEN` 可以推送到 fork。
3. 打开 **Actions > Sync upstream > Run workflow**，手动触发第一次同步。
4. 如果希望每天自动同步，请保持 scheduled workflow 启用。

该 workflow 会在上游仓库中跳过，只会在 GitHub 标记为 fork 的仓库里运行。它使用 fast-forward-only merge；当 fork 分支已经和上游分叉，或分支保护规则阻止推送时，会安全失败，不会自动合并冲突或强推。

可选 repository variables 可以覆盖默认值：

```text
UPSTREAM_REPOSITORY=u14app/neo-chat
UPSTREAM_BRANCH=main
TARGET_BRANCH=<fork default branch>
```

## FAQ

### Neo Chat 会把我的数据存在服务器上吗？

默认情况下，持久对话和配置数据保存在浏览器存储中。API 路由会代理外部服务；生产部署仍应按照自身隐私要求处理服务端日志、上游服务和配置的共享存储。

### 可以使用 OpenAI-compatible 供应商吗？

可以。在设置中添加 OpenAI-compatible 供应商，或通过 `DEFAULT_PROVIDER_TYPE="OpenAI Compatible"` 和兼容 `/v1` base URL 配置部署默认值。

### 可以使用 Anthropic 原生 Messages API 吗？

可以。在设置中添加 Anthropic 供应商，或配置 `DEFAULT_PROVIDER_TYPE="Anthropic"`。官方 Base URL 是 `https://api.anthropic.com`；应用会通过官方 TypeScript SDK 调用原生 `/v1/messages` API。

### 为什么生产环境需要稳定的 BYOK private key？

浏览器密钥会加密到服务端 public key。如果服务端 private key 改变，已有本地 envelope 将无法解密，直到用户重新输入密钥。

### 可以直接部署成公共 SaaS 吗？

不建议。Hosted 模式会加强 URL 策略和共享状态要求，但公共 SaaS 仍需要账号、租户、配额、审计和服务端密钥管理。

### 为什么工具调用很多次后会停止？

Neo Chat 保持较高但有边界的工具调用上限。模型可以运行多步工具工作流，但递归工具循环会在配置的轮次上限处停止。

### 我如何获取之前的版本

之前的项目版本是仅基于 Gemini 生态进行开发的项目，如果您需要之前的版本可以从 `gemini-next-chat` 分支获取，**该分支代码已存档**。

## 贡献

欢迎贡献。请保持改动聚焦，保留本地优先行为，并在提交 pull request 前运行质量检查。涉及安全边界的改动应同时覆盖 local 和 hosted 部署模式。

较大改动前请阅读 [Contributing](CONTRIBUTING.md)、[Security Policy](SECURITY.md)
和 [Code of Conduct](CODE_OF_CONDUCT.md)。

## 社区支持

[LinuxDo](https://linux.do/)

## 许可证

Neo Chat 使用 [MIT License](LICENSE) 发布。
