// sw.js — ARIA Service Worker
// Caches the app shell so it loads instantly and works offline as a PWA.
//
// Bump CACHE_VERSION when you ship breaking front-end changes — old caches
// get auto-purged on activate.

const CACHE_VERSION = "v3-2026-05";
const CACHE_NAME = `aria-${CACHE_VERSION}`;

// Core shell to precache. Stylesheet paths must match what index.html links.
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/style/base.css",
  "/style/layout.css",
  "/style/chat.css",
  "/style/lock-boot.css",
  "/style/homepage.css",
  "/style/settings.css",
  "/style/overlays.css",
  "/style/theme.css",
  "/style/components.css",
  "/style/panels.css",
  "/style/hometools.css",
  "/style/features.css",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── Install: precache shell ──
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Use individual adds so one missing file doesn't kill the whole install
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Precache miss: ${url}`, err.message);
          }),
        ),
      ),
    ),
  );
});

// ── Activate: clean old caches ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch: network-first for API, stale-while-revalidate for assets ──
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls, server-sent events, or external resources
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname !== self.location.hostname ||
    event.request.headers.get("accept")?.includes("text/event-stream")
  ) {
    return;
  }

  // Only handle GETs — never cache POST/PUT/DELETE
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          // Cache successful responses for next time (stale-while-revalidate)
          if (response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Network failed
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
          return new Response("Offline and not in cache", { status: 503 });
        });
      // Return cached version immediately if we have one, otherwise wait for network
      return cached || network;
    }),
  );
});

// ── Allow client to force a SW update ──
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
