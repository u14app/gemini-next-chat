const CACHE_PREFIX = "neo-chat-pwa-";
const CACHE_VERSION =
  typeof self.__NEO_CHAT_DEPLOYMENT_ID__ === "string" &&
  self.__NEO_CHAT_DEPLOYMENT_ID__
    ? self.__NEO_CHAT_DEPLOYMENT_ID__
    : "unknown";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const OFFLINE_FALLBACK = "/offline.html";
const PRECACHE_URLS = [
  "/",
  OFFLINE_FALLBACK,
  "/manifest.webmanifest",
  "/logo.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/logo.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/icon-maskable-512.png"
  );
}

function mustUseNetwork(request, url) {
  const accept = request.headers.get("accept") || "";
  return (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/share/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/files/") ||
    url.pathname.startsWith("/media/") ||
    url.pathname.startsWith("/uploads/") ||
    accept.includes("text/event-stream")
  );
}

async function cacheOne(cache, url) {
  try {
    const response = await fetch(url, { cache: "reload" });
    if (response.ok && response.type === "basic") {
      await cache.put(url, response);
    }
  } catch {
    // A partial precache remains useful and is completed after app startup.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all(PRECACHE_URLS.map((url) => cacheOne(cache, url))),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(CACHE_PREFIX) &&
                name !== SHELL_CACHE &&
                name !== STATIC_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }

  if (event.data?.type !== "CACHE_SHELL_ASSETS") return;
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(
        urls.flatMap((candidate) => {
          try {
            const url = new URL(candidate, self.location.origin);
            return url.origin === self.location.origin && isStaticAsset(url)
              ? [cacheOne(cache, url.href)]
              : [];
          } catch {
            return [];
          }
        }),
      ),
    ),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      if (new URL(request.url).pathname === "/") {
        await cache.put("/", response.clone());
      }
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      (await cache.match(OFFLINE_FALLBACK)) ||
      Response.error()
    );
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (mustUseNetwork(event.request, url)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(event.request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request));
  }
});
