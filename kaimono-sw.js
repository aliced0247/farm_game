/* かいものリスト service worker — オフラインでも開けるように */
const V = "kaimono-v1";
const ASSETS = ["kaimono.html", "kaimono.webmanifest", "icons/kaimono-192.png", "icons/kaimono-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("kaimono-") && k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;               // FirebaseなどはSWを通さない
  const name = url.pathname.split("/").pop();
  if (!ASSETS.some(a => a.endsWith(name))) return;          // ゲームなど他ページには触らない

  if (name === "kaimono.html") {
    // ネット優先（更新をすぐ反映）、だめならキャッシュ
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
