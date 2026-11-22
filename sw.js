const CACHE = "mesa-de-roteiro-local-v30-js-separado";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles/app.css",
  "./js/armazenamento-local.js",
  "./js/config-nuvem.js",
  "./js/editor-desenho.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icon-192-192-1.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.cache === "no-store" || event.request.headers.has("Authorization")) return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const network = fetch(event.request).then((response) => {
    let copy = null;
    // A página pode consumir o corpo assim que receber a resposta. Clone antes
    // de devolvê-la, sem aguardar a abertura assíncrona do cache.
    try { if (response && response.ok) copy = response.clone(); } catch (_) {}
    return { response, copy };
  });

  // A falha de uma cópia opcional não invalida uma resposta válida da rede.
  // waitUntil é registrado durante o evento e observa também falhas de quota.
  event.waitUntil(
    network.then(({ copy }) => {
      if (copy) return caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }).catch(() => {})
  );
  event.respondWith(
    network.then(({ response }) => response).catch(async () => {
      try {
        const cached = await caches.match(event.request);
        if (cached) return cached;
      } catch (_) {}
      if (event.request.mode === "navigate") {
        try {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        } catch (_) {}
      }
      return Response.error();
    })
  );
});
