// Service worker Zylora — caching app-shell agar installable + bisa offline.
// Zero-dependency (tanpa Workbox). Naikkan VERSION tiap rilis agar cache lama dibuang.
const VERSION = "zylora-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/offline.html", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Panggilan API (origin backend berbeda) — JANGAN di-cache; biarkan jaringan.
  if (url.origin !== self.location.origin) return;

  // Navigasi halaman: network-first → fallback cache → offline.html.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("/offline.html"))),
    );
    return;
  }

  // Aset statis same-origin: cache-first, isi cache saat pertama diambil.
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return resp;
      }).catch(() => caches.match("/offline.html")),
    ),
  );
});
