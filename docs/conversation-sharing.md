# Conversation sharing

Conversation sharing is an optional, read-only publishing feature. It is
disabled by default. Enable it only when the deployment sets
`SHARING_ENABLED=true` and provides both `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. See the [environment variable
reference](environment-variables.md#shared-stores).

## Publish a snapshot

Open **Share** from a conversation's sidebar or titlebar menu after the
conversation has messages. Choose an expiry and create the link:

- New shares expire after one day by default. You can choose 1, 7, or 30 days,
  or **Never expires**.
- The snapshot contains the current visible branch, message text, images, safe
  public source links, and the currently published Research report.
- Non-image attachments show their names only. Original documents, audio, and
  video are not downloadable from the snapshot.
- System instructions, private configuration, Memory, raw tool payloads,
  credentials, and hidden branches are omitted.

Anyone with the link can read the snapshot, including on a password-protected
deployment. The public page is read-only and does not use the publisher's
browser storage.

## Update or revoke

Publishing freezes the snapshot at that point. New messages stay private until
you choose **Update snapshot**. A content update keeps the existing expiry;
select a new period explicitly when you want to change it. **Cancel sharing**
invalidates the link, and publishing an expired or cancelled share creates a
new link.

Deleting the source conversation first cancels its share. If cancellation
fails, the app keeps the conversation and its local share association so you
can retry. The browser stores the management credential locally; it is excluded
from ordinary exports and encrypted sync. Clearing site data cannot perform the
revocation step, and there is no account or cross-device share-management
feature.

Turning off `SHARING_ENABLED` hides the menu and blocks publication, updates,
public reads, and share-image requests. Existing Redis snapshots are not
deleted; an unexpired, uncancelled link becomes readable again if sharing is
enabled later. Revocation remains available while the Redis credentials are
configured.

## Images, limits, and availability

Images are copied into the snapshot, so readers do not depend on the
publisher's local files or an expiring remote URL. Neo Chat may resize the
copy while keeping the original file intact. Missing or unsupported images and
capacity errors fail the publication instead of silently dropping content.

Each publication is limited to:

- 4 MiB per request;
- 768 KiB for snapshot text and metadata;
- 32 unique images;
- 512 KiB per image and 2 MiB for all images together.

The public page and its assets require a network connection and are excluded
from PWA offline caching. Redis failures do not fall back to process-local
copies. Revocation stops later reads but cannot retract content that a reader
has already copied. A permanent share has no automatic expiry, but still
depends on the deployment and its Redis data remaining available.

## Temporary chats

Choose **Temporary chat** from the welcome screen to start a conversation that
is never persisted to browser storage or shown in history. It supports text
chat and search, but not Agent, Research, RAG, attachments, plugins, Skills,
image generation, or persistent Memory.

The draft and conversation exist only in memory. Switching chats, returning
home, opening another main panel, refreshing, or closing the page ends the
temporary chat and discards its contents. Opening Settings keeps it alive.
Copy or export any text you need before leaving.

Temporary mode does not change how a selected model or search provider
processes requests or retains data.
