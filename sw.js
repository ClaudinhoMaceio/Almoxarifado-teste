const CACHE_NAME = "sanegestao-pro-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./tailwind.css",
  "./sw.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(
        APP_SHELL.map(async (asset) => {
          await cache.add(asset);
        })
      );
      results.forEach((res, idx) => {
        if (res.status === "rejected") {
          console.warn("SW cache falhou para:", APP_SHELL[idx], res.reason);
        }
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const isNavigation = request.mode === "navigate";
  const isSameOrigin = url.origin === self.location.origin;
  const isAppsScriptApi = url.hostname.includes("script.google.com") && url.pathname.includes("/macros/s/");

  // API remota deve sempre vir da rede para evitar dados antigos.
  if (isAppsScriptApi) {
    event.respondWith(fetch(request));
    return;
  }

  // Páginas HTML: tenta rede primeiro e usa cache apenas como fallback.
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          const cloned = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          return networkRes;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Assets locais do app: cache-first com atualização em segundo plano.
  if (isSameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((networkRes) => {
            const cloned = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
            return networkRes;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Recursos externos (CDN, fontes, etc.): rede primeiro, fallback em cache.
  event.respondWith(
    fetch(request)
      .then((networkRes) => {
        const cloned = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        return networkRes;
      })
      .catch(() => caches.match(request))
  );
});
