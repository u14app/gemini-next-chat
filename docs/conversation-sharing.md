# Conversation sharing and temporary chats

## Read-only snapshots

Open **Share** from a conversation's sidebar or titlebar menu. This action is
disabled by default and available only when the deployment sets
`SHARING_ENABLED=true` and configures both `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`.
The titlebar conversation menu appears after the conversation has messages.
The first snapshot expires after one day by default; choose 1, 7, 30 days or
never using the expiry buttons. Existing shares also offer **Keep current expiry**.
Anyone holding its link can read it without the site's access password.

Turning `SHARING_ENABLED` off hides the entry and blocks publication, updates,
public links and share images. It does not delete existing Redis snapshots;
unexpired, uncancelled links become readable again if sharing is re-enabled.
Authenticated cancellation remains available while Redis is configured,
including when deleting the original conversation. See
[environment variables](environment-variables.md#shared-stores) for setup.

Publishing freezes the current visible branch. It includes message text,
images, public source links and the currently published research report.
Original documents, audio, video and other attachments show their names without
downloads. System instructions, private configuration, Memory, raw tool payloads,
authentication values and hidden branches are not included.

Continue chatting normally; new messages remain private until **Update snapshot**
is selected. Updating content keeps the existing expiration unless a new period
is explicitly selected. **Cancel sharing** invalidates the link. Expired or
cancelled shares receive a new link when published again.

Deleting the original conversation first cancels its share. If cancellation
fails, the app keeps the conversation and its local association so the operation
can be retried. Application cleanup or restore operations that remove associated
conversations follow the same order. Management information is automatically
kept in the publishing browser and excluded from ordinary export and sync.
Clearing website data outside the app cannot run this revocation step; no account
or cross-device share-management feature is provided.

## Images, capacity and availability

Images are copied into the snapshot. The reader does not need access to the
publisher's local files or a remote image's expiring URL. Copies may be resized
while original files remain intact. Unsupported formats, missing images and
capacity errors prevent publication rather than silently dropping content.

Runtime limits are 4 MiB per publication request, 768 KiB of text and metadata,
32 unique images, 512 KiB per image and 2 MiB of image bytes in total. Failed
updates preserve the previous snapshot. These are upload/storage limits, not
build-size gates.

The page and its resources require a network connection and are excluded from
PWA offline caching. Redis failure does not fall back to process-local copies.
Revocation prevents subsequent reads; it cannot retract content a reader has
already copied. Permanent shares have no automatic expiry, but still depend on
the deployment and its Redis data remaining available.

## Temporary conversations

Choose the **Temporary chat** icon in the welcome screen's upper right corner. It
supports text chat and search. It does not use Agent, Research, attachments,
plugins, Skills, image generation or persistent Memory.

Temporary conversations are hidden from the conversation list. The welcome
screen shows a note directly below the composer explaining that the conversation will
not appear in history. While temporary chat is active, the entry icon becomes
**Exit temporary chat**; choosing it returns to a new ordinary conversation.

The app retains the conversation and its draft in memory only. Switching chats,
returning home, opening another main panel, refreshing or closing the page
ends it and discards its contents. Settings remain accessible without ending
the chat. You can explicitly copy or export text before leaving.

Search and model requests still use the selected provider. Temporary mode
controls this application's local conversation storage; it does not change a
provider's processing or retention policy.

## 中文说明

在侧栏或标题栏会话菜单中选择“分享”，可公开当前可见分支的正文、图片和研究报告。
空会话不显示右上角的会话操作菜单。
分享默认关闭；部署设置 `SHARING_ENABLED=true` 且配置完整的 Redis REST 地址和令牌后
才显示入口，持链接即可阅读。有效期通过并排按钮选择，默认 1 天，
可选 7 天、30 天或永久；已有分享还可选择保持当前有效期。
后续消息仅在手动更新快照后公开；仅更新内容时保持原到期时间，也可明确选择新的有效期。
取消分享或到期后旧链接失效，再次分享会创建新链接。

关闭开关会隐藏入口，并停止发布、更新和公开读取分享正文及图片；已有 Redis 快照不会
自动删除，重新启用后未到期、未撤销的链接可恢复访问。只要 Redis 配置仍在，携带管理
凭据的撤销操作继续可用，以便删除原会话时取消分享。

分享与原会话绑定，删除会话前先取消分享，失败则保留会话供重试。管理信息仅由发布时的
浏览器自动保存，不进入普通导出或同步。直接清除浏览器网站数据无法触发应用内撤销。
分享图片使用独立副本；缺图、不支持的格式或容量超限会明确失败，不静默截断内容。

欢迎页右上角的“临时会话”图标仅支持文字聊天与搜索，不保存会话、草稿或记忆。
临时会话不会出现在会话列表中，欢迎页说明紧邻输入框底部；启用后入口替换为
“退出临时会话”图标，点击后返回新的普通会话。
切换会话、返回首页、进入其他主面板、刷新或关闭页面时销毁；打开设置不会销毁。
离开前可主动复制或导出文字。该模式不改变模型供应商自身的数据处理政策。
