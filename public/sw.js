const CACHE = "mesa-de-roteiro-pwa-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192-192-1.png",
  "./icon-512.png"
];
const REMOTE_SHELL = [
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-compat.js"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then((cache) => Promise.all(REMOTE_SHELL.map((url) =>
        fetch(url, {mode:"cors"}).then((response) => {
          if (response && (response.ok || response.type === "opaque")) return cache.put(url, response);
        }).catch(() => null)
      )))
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
  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const isFirebaseSdk = REMOTE_SHELL.indexOf(event.request.url) !== -1;
  const isFont = FONT_HOSTS.indexOf(requestUrl.hostname) !== -1;
  if (!sameOrigin && !isFirebaseSdk && !isFont) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response && (response.ok || response.type === "opaque")) {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()));
      return cached || network;
    })
  );
});
