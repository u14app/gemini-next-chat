<div align="center">
<h1>Gemini Next Chat</h1>

![GitHub deployments](https://img.shields.io/github/deployments/u14app/gemini-next-chat/Production)
![GitHub Release](https://img.shields.io/github/v/release/u14app/gemini-next-chat)
![Docker Image Size (tag)](https://img.shields.io/docker/image-size/xiangfa/talk-with-gemini/latest)
![Docker Pulls](https://img.shields.io/docker/pulls/xiangfa/talk-with-gemini)
![GitHub License](https://img.shields.io/github/license/u14app/gemini-next-chat)

一键免费部署您的私人 Gemini 应用, 支持 Gemini 1.5 Pro、Gemini 1.5 Flash、Gemini Pro 和 Gemini Pro Vision 模型。

[English](./README.md) · **简体中文**

[![Vercel](https://img.shields.io/badge/Vercel-111111?style=flat&logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat&project-name=gemini-next-chat&env=GEMINI_API_KEY&env=ACCESS_PASSWORD&repository-name=gemini-next-chat)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F69652?style=flat&logo=cloudflare&logoColor=white)](#部署到-cloudflare)

[![Gemini](https://img.shields.io/badge/Gemini-8E75B2?style=flat&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Next](https://img.shields.io/badge/Next.js-111111?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![shadcn/ui](https://img.shields.io/badge/shadcn/ui-111111?style=flat&logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)

[![Web][Web-image]][web-url]
[![MacOS][MacOS-image]][download-url]
[![Windows][Windows-image]][download-url]
[![Linux][Linux-image]][download-url]

[网页版][web-url] / [客户端][download-url] / [反馈](https://github.com/u14app/gemini-next-chat/issues)

[web-url]: https://gemini.u14.app/
[download-url]: https://github.com/u14app/gemini-next-chat/releases
[Web-image]: https://img.shields.io/badge/Web-PWA-orange?logo=microsoftedge
[Windows-image]: https://img.shields.io/badge/-Windows-blue?logo=windows
[MacOS-image]: https://img.shields.io/badge/-MacOS-black?logo=apple
[Linux-image]: https://img.shields.io/badge/-Linux-333?logo=ubuntu

**分享 GeminiNextChat 仓库**

[![][share-x-shield]][share-x-link]
[![][share-telegram-shield]][share-telegram-link]
[![][share-whatsapp-shield]][share-whatsapp-link]
[![][share-reddit-shield]][share-reddit-link]
[![][share-weibo-shield]][share-weibo-link]
[![][share-mastodon-shield]][share-mastodon-link]

[share-mastodon-link]: https://mastodon.social/share?text=Check%20this%20GitHub%20repository%20out%20GeminiNextChat%20-%20An%20open-source%2C%20extensible%20(Function%20Calling)%2C%20high-performance%20gemini%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20Gemini%20web%20application.%20https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat%20%23chatbot%20%23gemini
[share-mastodon-shield]: https://img.shields.io/badge/-share%20on%20mastodon-black?labelColor=black&logo=mastodon&logoColor=white&style=flat-square
[share-reddit-link]: https://www.reddit.com/submit?title=Check%20this%20GitHub%20repository%20out%20GeminiNextChat%20-%20An%20open-source%2C%20extensible%20(Function%20Calling)%2C%20high-performance%20gemini%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20Gemini%20web%20application.%20https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat
[share-reddit-shield]: https://img.shields.io/badge/-share%20on%20reddit-black?labelColor=black&logo=reddit&logoColor=white&style=flat-square
[share-telegram-link]: https://t.me/share/url"?text=Check%20this%20GitHub%20repository%20out%20GeminiNextChat%20-%20An%20open-source%2C%20extensible%20(Function%20Calling)%2C%20high-performance%20gemini%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20Gemini%20web%20application.%20https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat
[share-telegram-shield]: https://img.shields.io/badge/-share%20on%20telegram-black?labelColor=black&logo=telegram&logoColor=white&style=flat-square
[share-weibo-link]: http://service.weibo.com/share/share.php?sharesource=weibo&title=Check%20this%20GitHub%20repository%20out%20GeminiNextChat%20-%20An%20open-source%2C%20extensible%20(Function%20Calling)%2C%20high-performance%20gemini%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20Gemini%20web%20application.%20https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat
[share-weibo-shield]: https://img.shields.io/badge/-share%20on%20weibo-black?labelColor=black&logo=sinaweibo&logoColor=white&style=flat-square
[share-whatsapp-link]: https://api.whatsapp.com/send?text=Check%20this%20GitHub%20repository%20out%20GeminiNextChat%20-%20An%20open-source%2C%20extensible%20(Function%20Calling)%2C%20high-performance%20gemini%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20Gemini%20web%20application.%20https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat%20%23chatbot%20%23gemini
[share-whatsapp-shield]: https://img.shields.io/badge/-share%20on%20whatsapp-black?labelColor=black&logo=whatsapp&logoColor=white&style=flat-square
[share-x-link]: https://x.com/intent/tweet?hashtags=chatbot%2CchatGPT%2CopenAI&text=Check%20this%20GitHub%20repository%20out%20GeminiNextChat%20-%20An%20open-source%2C%20extensible%20(Function%20Calling)%2C%20high-performance%20gemini%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20Gemini%20web%20application.%20https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat
[share-x-shield]: https://img.shields.io/badge/-share%20on%20x-black?labelColor=black&logo=x&logoColor=white&style=flat-square

![cover](./public/screenshots/screenshots.png)

简洁的界面，支持图片识别和语音对话

![Gemini](./public/screenshots/pc-screenshot-1.png)

支持 Gemini 1.5 和 Gemini 2.0 多模态模型

![Support plugins](./public/screenshots/pc-screenshot-3.jpg)

支持插件功能，内置网络搜索、网页解读、论文搜索、实时天气等多种实用插件

![Multimodal Live](./docs/images/multimodal-live.jpg)

支持 Multimodal Live API，流畅的语音、视频体验

![Tray app](./docs/images/trayapp.png)

跨平台的应用客户端，支持常驻菜单栏，让您的工作效率翻倍

</div>

> 注意：如果您项目使用过程中遇到问题，可以查看[常见问题](#常见问题)的已知问题及解决方案。

## 目录

- [主要功能](#主要功能)
- [开发计划](#️开发计划)
- [开始使用](#开始使用)
  - [更新代码](#更新代码)
- [环境变量](#环境变量)
  - [访问密码](#访问密码)
  - [自定义模型列表](#️自定义模型列表)
- [开发](#开发)
  - [最低要求](#️最低要求)
- [部署](#部署)
  - [容器部署（推荐）](#容器部署推荐)
  - [静态部署](#静态部署)
- [常见问题](#常见问题)
- [开源协议](#开源协议)
- [收藏历史](#收藏历史)

## 主要功能

- 在 1 分钟内使用 Vercel **免费一键部署**
- 提供体积极小（~4MB）的跨平台客户端（Windows/MacOS/Linux），可以常驻菜单栏，提升办公效率
- 支持多模态模型，可以理解图片、视频、音频和部分文本文档
- 语音模式：让您直接与 Gemini 对话，支持 Multimodal Live API
- 视觉识别，让 Gemini 可以看懂图片内容
- 助理市场，拥有数百精选的系统指令
- 插件系统，内置网络搜索、网页解读、论文搜索、实时天气等多种实用插件
- 会话列表，让您可以保持重要的会话内容或与 Gemini 讨论不同的话题
- 支持 Artifact，让您可以更加优雅地修改对话内容
- 完整的 Markdown 支持：KaTex 公式、代码高亮, Mermaid 图表等
- 自动压缩上下文聊天记录，在节省 Token 的同时支持超长对话
- 隐私安全，所有数据保存在用户浏览器本地
- 支持 PWA，可以以应用形式运行
- 精心设计的 UI，响应式设计，支持深色模式
- 极快的首屏加载速度，支持流式响应
- 静态部署，支持部署在任何支持静态页面的网站服务，比如 Github Page、Cloudflare、Vercel 等
- 多国语言支持：English、简体中文、繁体中文、日本語、한국어、Español、Deutsch、Français、Português、Русский 以及 العربية

## 开发计划

- [x] 重构话题广场，引入 Prompt 列表
- [x] 使用 tauri 打包桌面应用
- [x] 实现基于 functionCall 插件
- [x] 支持会话列表
- [x] 支持对话导出功能
- [x] 启用 Multimodal Live API
- [ ] 支持联网 Deep Research 模式
- [ ] 支持本地知识库

## 开始使用

1. 获取 [Gemini API Key](https://aistudio.google.com/app/apikey)
2. 一键部署项目，可以选择部署到 Vercel

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fu14app%2Fgemini-next-chat&project-name=gemini-next-chat&env=GEMINI_API_KEY&env=ACCESS_PASSWORD&repository-name=gemini-next-chat)

3. 开始使用

### 部署到 Cloudflare

目前项目支持部署到 Cloudflare，但您需要按照 [如何部署到 Cloudflare Page](./docs/How-to-deploy-to-Cloudflare-Page.zh-CN.md) 进行操作。

### 更新代码

如果你想立即更新，可以查看[GitHub文档](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)以了解如何将分叉项目与上游代码同步。

您可以关注该项目或关注作者以及时获取发布通知。

## 环境变量

#### `GEMINI_API_KEY`（可选）

您的 Gemini api 密钥。 如果您需要“启用”服务器 api，这是必需的。**该变量不会影响前端页面上的 Gemini 密钥的值。**
支持多个 key，每个 key 之间使用 `,` 分隔，即 `key1,key2,key3`

#### `GEMINI_API_BASE_URL`（可选）

> 默认值：`https://generativelanguage.googleapis.com`

> 示例：`http://your-gemini-proxy.com`

覆盖 Gemini api 请求基本 url。**为了避免服务端代理 url 泄漏，不会覆盖和影响前端页面中的值。**

#### `NEXT_PUBLIC_GEMINI_MODEL_LIST`（可选）

自定义模型列表，默认为: all。

#### `NEXT_PUBLIC_UPLOAD_LIMIT`（可选）

文件上传大小限制。默认不限制文件大小。

#### `ACCESS_PASSWORD`（可选）

访问密码。

#### `HEAD_SCRIPTS` （可选）

用于注入的脚本代码可用于统计或错误跟踪。

#### `EXPORT_BASE_PATH` （可选）

仅用于[静态部署](#静态部署)模式下设置页面基础路径。

### 访问密码

项目提供访问控制。请在 `.env` 文件或环境变量页面添加名为 `ACCESS_PASSWORD` 的环境变量。

添加或修改此环境变量后，请重新部署项目以使更改生效。

### 自定义模型列表

本项目支持自定义模型列表。请在 `.env` 文件或环境变量页面添加名为 `NEXT_PUBLIC_GEMINI_MODEL_LIST` 的环境变量。

默认模型列表使用 `all` 表示，多个模型之间使用 `,` 分隔。

如果需要增加新的模型请直接写入模型名称 `all,new-model-name`，或使用 `+` 符号加上模型名称表示增加，即 `all,+new-model-name`。

如果要移除模型列表中的某个模型，请使用 `-` 符号加上模型名称表示移除，即 `all,-existing-model-name`。如果要移除默认模型列表，可以用 `-all` 表示。

如果要设定默认模型，可以使用 `@` 符号加上模型名称表示默认模型，即 `all,@default-model-name`。

## 开发

如果您没安装过 pnpm

```shell
npm install -g pnpm
```

```shell
# 1. 先安装nodejs和yarn
# 2. 配置本地变量，请将 `.env.example` 改为 `.env` 或 `.env.local`
# 3. 运行
pnpm install
pnpm dev
```

### 最低要求

NodeJS >= 18，Docker >= 20

## 部署

### 容器部署（推荐）

> Docker 版本需要在 20 及其以上，否则会提示找不到镜像。

> ⚠️ 注意：docker 版本在大多数时间都会落后最新的版本 1 到 2 天，所以部署后会持续出现“存在更新”的提示，属于正常现象。

```shell
docker pull xiangfa/talk-with-gemini:latest

docker run -d --name talk-with-gemini -p 5481:3000 xiangfa/talk-with-gemini
```

您也可以指定额外的环境变量：

```shell
docker run -d --name talk-with-gemini \
   -p 5481:3000 \
   -e GEMINI_API_KEY=AIzaSy... \
   -e ACCESS_PASSWORD=your-password \
   xiangfa/talk-with-gemini
```

如果您需要指定其他环境变量，请自行在上述命令中增加 `-e 环境变量=环境变量值` 来指定。

使用 `docker-compose.yml` 部署：

```shell
version: '3.9'
services:
   talk-with-gemini:
      image: xiangfa/talk-with-gemini
      container_name: talk-with-gemini
      environment:
         - GEMINI_API_KEY=AIzaSy...
         - ACCESS_PASSWORD=your-password
      ports:
         - 5481:3000
```

### 静态部署

您也可以直接构建静态页面版本，然后将 `out` 目录下的所有文件上传到任何支持静态页面的网站服务，比如 Github Page、Cloudflare、Vercel 等。

```shell
pnpm build:export
```

如果您将项目部署在子目录下，在访问时会遇到资源加载失败的情况，请在 `.env` 文件或者变量设置页面增加 `EXPORT_BASE_PATH=/路径/项目名称`。

## 常见问题

#### “User location is not supported for the API use” 的解决方案

1、使用 Cloudflare AI Gateway 转发 api。目前 Cloudflare AI Gateway 已经支持 Google Vertex AI 相关 api。如何使用请参考 [如何使用 Cloudflare AI Gateway](./docs/Use-Cloudflare-AI-Gateway.zh-CN.md) 。该方案速度快、稳定性好，**推荐使用**。

2、使用 Cloudflare Worker 进行 api 代理转发，详细设置请参考 [如何使用 Cloudflare Worker 代理 api](./docs/How-to-deploy-the-Cloudflare-Worker-api-proxy.zh-CN.md)。注意，该方案在某些情况下可能无法正常工作。

#### 为什么我用 vercel 一键部署后的网站无法在中国正常访问

vercel 部署后生成的域名在几年前就已经被国内网络屏蔽，但并没有屏蔽服务器的 ip 地址。可以自定义域名，就可以在国内正常访问了。由于 vercel 在国内并没有服务器，所以有时候会出现些许的网络波动，属于正常现象。如何设置域名，可以参考我从网上找到的解决文章[Vercel绑定自定义域名](https://docs.tangly1024.com/article/vercel-domain)。

#### 为什么我无法使用 Multimodal Live

目前 Multimodal Live API 只有 Gemini 2.0 Flash 模型支持，因此需要使用 Gemini 2.0 Flash 模型才可以使用。由于在国内无法访问 Gemini Multimodal Live API，因此您可能需要使用 Cloudflare Worker 部署一个代理转发的 API。如何使用请参考 [使用 Cloudflare Worker 代理 Multimodal Live API](./docs/Proxying-the-Multimodal-Live-API-with-Cloudflare-Worker.zh-CN.md)。
_目前 Multimodal Live API 尚不支持中文语音输出。_

## 致谢

### 技术栈

- [Next.js](https://nextjs.org/)
- [Shadcn UI](https://ui.shadcn.com/)
- [Tailwindcss](https://tailwindcss.com/)
- [Zustand](https://zustand-demo.pmnd.rs/)

### 灵感来源

- [Lobe Chat](https://github.com/lobehub/lobe-chat)
- [Next Web](https://github.com/ChatGPTNextWeb/NextChat)
- [Open Canvas](https://github.com/langchain-ai/open-canvas)

## 贡献

欢迎为该项目做出贡献！如果您愿意做出贡献，请按照以下步骤操作：

1. 在 GitHub 上 Fork 存储库。
2. 将您 Fork 的项目克隆到本地工作区。
3. 为您的更改创建一个新分支。
4. 进行更改并将其提交到您的分支。
5. 将您的更改推送到 GitHub 上的分叉。
6. 从您的分支向主存储库提交拉取请求。

在提交拉取请求之前，请确保您的代码遵循项目的编码风格并且所有测试都通过。
如果您发现任何错误或有改进建议，请随时在 GitHub 上创建新的 issue。

## 开源协议

本项目遵循 [MIT](https://www.apache.org/licenses/LICENSE-2.0) 许可证。请参阅 LICENSE 文件以获取完整的许可证文本。

## 收藏历史

[![Star History Chart](https://api.star-history.com/svg?repos=u14app/gemini-next-chat&type=Date)](https://star-history.com/#u14app/gemini-next-chat&Date)
