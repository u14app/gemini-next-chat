# Encrypted sync

Encrypted sync is optional. It merges a personal Neo Chat vault through your
own WebDAV server or S3-compatible storage, including MinIO. Neo Chat does not
create an account for the vault and the backend receives encrypted objects,
not a plaintext content index.

## Set up a vault

1. Open **Settings → Sync** and configure a WebDAV or S3/MinIO backend.
2. Save the connection details and select **Test connection**.
3. Choose **Create encrypted vault**, then save the recovery code and its QR
   code before activating the vault.
4. On another device, configure that device's backend access and import the same
   recovery code.

The recovery code contains the 256-bit vault key and a checksum. It is the only
way to decrypt the vault on another device; Neo Chat cannot recover it. Anyone
who obtains it can decrypt the vault.

## What is synchronized

Sync merges chat metadata and message trees, settings, workspaces, knowledge
metadata and files, memories, and installed Skill data. Research task records
and extension data such as custom templates, source contracts, steering,
evidence snapshots, and report Q&A threads remain in the browser and are
excluded from sync. Research tasks and referenced report artifacts are handled
by ZIP backups as the supported transfer path.

The following remain outside the synchronized vault:

- provider, search, RAG, document-parsing, voice, plugin, MCP, and backend
  credentials (backend credentials are wrapped for a single proxy request);
- the recovery key, device identity, local CRDT baselines, and share-management
  credentials;
- global-search and generated caches, external vector indexes, and in-flight
  processing jobs.

## Encryption and merge behavior

The browser encrypts each document and file before upload. AES-256-GCM keys are
derived from the recovery key for separate metadata, file, and object-name
purposes. Remote object names are HMAC-derived and do not reveal local paths or
entity names. Files are encrypted in chunks and verified by hash before they
are committed locally.

Sync uses Automerge documents split by domain. Each device writes its own
encrypted snapshot; a run downloads device snapshots, merges them, applies the
result transactionally, and uploads the current device snapshot. Message
additions remain reachable as branches. Scalar settings changed concurrently
are shown under **Settings → Sync** so you can choose the value to keep.

## Backend access

The browser sends encrypted content to `POST /api/sync/remote`. Backend
credentials are encrypted on this device, wrapped for one proxy request,
decrypted only for that request, and never logged or persisted by the route.
The proxy exposes only connection test, list, metadata, read, and write
operations (`test`, `list`, `head`, `get`, and `put`).

Use HTTPS for internet-hosted WebDAV and S3. HTTP and private-network
endpoints are intended for explicit self-hosted deployments.

## Scheduling and retention

When enabled and online, Neo Chat attempts sync on startup, reconnect, window
focus, five seconds after local changes settle, and every five minutes while
the tab is visible. **Sync now** is always available. The Service Worker does
not run background sync.

While offline, sync setup, backend changes, vault creation or import, key
rotation, and conflict decisions are unavailable. Disabling sync keeps both
local data and encrypted remote objects.

Remote objects are append-safe. Neo Chat does not automatically delete orphaned
chunks because another device may reconnect later. To rotate a lost device or
recovery code, create a new vault, migrate every remaining device, and then
remove the old vault manually from WebDAV or S3.
