const CACHE_VERSION = "paperdeck-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const PRECACHE_URLS = ["/offline.html"];

const STATIC_PATTERNS = [
  /\.(?:js|css|woff2?|ttf|eot|otf)$/,
  /\/_next\/static\//,
  /\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/,
  /\/icon-/,
  /\/apple-touch-icon/,
  /\/favicon/,
  /\/manifest\.json$/,
  /\/splash-/,
];

function isStaticAsset(url) {
  return STATIC_PATTERNS.some((pattern) => pattern.test(url));
}

function isNavigation(request) {
  return request.mode === "navigate";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("paperdeck-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              event.waitUntil(
                caches
                  .open(STATIC_CACHE)
                  .then((cache) => cache.put(request, clone)),
              );
            }
            return response;
          })
          .catch(() => cached || new Response("", { status: 504 }));
        return cached || fetchPromise;
      }),
    );
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match("/offline.html")) ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
    return;
  }

  // Leave dynamic Next.js/RSC/data requests network-only and browser-managed.
});
