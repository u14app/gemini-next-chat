# Offline mode

Neo Chat's offline PWA is enabled only for a production build with
`DEPLOYMENT_MODE=local`. Development and hosted deployments unregister the
Neo Chat Service Worker and remove its caches, so they do not retain an old
offline shell.

## Install and prepare

Open the local deployment once while online. The browser caches the navigation
shell, manifest, icons, and same-origin static assets used by that build. If
the browser offers **Install** or **Add to home screen**, use that action to
install the PWA. A partial first load may need one more online visit before it
can open offline.

Navigation uses the network first and falls back to the cached shell. Versioned
static assets use the cache first. The Service Worker never caches:

- `/api/` requests or event streams;
- external origins, share pages, or `/_next/image` responses;
- file, media, and upload routes;
- IndexedDB or OPFS content.

## What works offline

The app stays read-only for network-backed work. You can still navigate local
history, inspect message branches, use local global search, read knowledge
files, and export a backup. Chat drafts are saved locally and can be sent when
the device reconnects.

Sending messages, model generation, Agent and MCP actions, web search, external
RAG, voice providers, synchronization, knowledge uploads or edits, and
reindexing remain disabled until the browser is online.

The Service Worker does not perform background sync. Offline data comes from
the browser's existing IndexedDB and OPFS stores; the PWA cache contains only
the application shell and static assets.

## Updates

The app checks for a new Service Worker at startup, after reconnecting, when a
tab becomes visible, and every 30 minutes during a visible session. A ready
update is shown as an explicit reload action, so a running conversation is not
replaced without consent. Accepting the update activates the waiting worker and
reloads tabs controlled by the previous worker.

## Local data and device security

Clearing browser site data removes the offline shell and local app data. It does
not delete a remote encrypted-sync vault. The deployment access password is a
server gate, not a device lock; protect the browser profile and operating
system account when keeping sensitive history offline.
