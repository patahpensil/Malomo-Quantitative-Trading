/* MALOMO QT — service worker (§CD-7, §19).
 *
 * Aturan:
 *  - CACHE_NAME WAJIB dinaikkan bila BERKAS APA PUN di src/ berubah.
 *    Diperiksa otomatis oleh scripts/check-cache-bump.js di CI. Tanpa ini,
 *    satu modul bisa terbarui sementara modul lain masih dari cache lama →
 *    kombinasi versi yang tak pernah diuji (kegagalan klasik multi-modul).
 *  - Semua aset aplikasi (same-origin) dilayani NETWORK-FIRST: saat online,
 *    versi terbaru selalu menang (push = live, seperti Patah Pensill); cache
 *    hanya cadangan offline.
 *  - Permintaan ke Binance (fapi/fstream) TIDAK PERNAH disentuh SW — data pasar
 *    harus selalu langsung dari jaringan, tidak boleh basi dari cache.
 */

const CACHE_NAME = 'malomo-qt-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/ui/styles.css',
  // core
  './src/core/types.js',
  './src/core/config.js',
  // indicators
  './src/indicators/indicators.js',
  './src/indicators/structure.js',
  // scoring
  './src/scoring/criterion.js',
  './src/scoring/engine.js',
  './src/scoring/families.js',
  './src/scoring/markov.js',
  './src/scoring/calibration.js',
  './src/scoring/pipeline.js',
  // net
  './src/net/gateway.js',
  './src/net/binance.js',
  './src/net/wsmanager.js',
  './src/net/orderflow.js',
  // store
  './src/store/db.js',
  './src/store/barrier.js',
  // ui
  './src/ui/render.js',
  './src/ui/market.js',
  './src/ui/news.js',
  './src/ui/evidence.js',
  './src/ui/app.js',
  // workers
  './src/workers/compute.worker.js',
  './src/workers/computeClient.js',
  // ikon
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll gagal-total bila satu URL 404; pakai per-item agar tahan.
      Promise.all(SHELL.map((u) => cache.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Jangan pernah tangani permintaan lintas-origin (Binance & lainnya).
  if (url.origin !== self.location.origin) return;

  // Data pasar tak pernah lewat SW walau kebetulan same-origin (jaga-jaga).
  if (url.hostname.includes('binance')) return;

  // NETWORK-FIRST untuk aset aplikasi.
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Simpan salinan segar untuk cadangan offline.
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
