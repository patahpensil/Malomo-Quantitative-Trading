# MALOMO QT

**Platform Keputusan & Riset Trading Kuantitatif** — PWA statis, crypto-first
(Binance USDT-M perpetual). Pemakaian pribadi, satu pengguna. Pengganti Patah
Pensill: mempertahankan yang benar darinya (Markov rezim, PWA push-langsung-live),
memperbaiki yang rusak (skor sirkular, repainting, bug tipe Bias↔Side).

> Ini alat bantu keputusan, **bukan** nasihat keuangan dan **bukan** robot yang
> menjanjikan profit. Seluruh desainnya justru dibuat untuk menolak klaim akurasi
> tinggi dan memaksa kejujuran statistik.

---

## Menjalankan tanpa langkah build

Tidak ada bundler, tidak ada transpile, tidak ada `npm run build`. Browser
menjalankan modul ES (`<script type="module">`) apa adanya. **Push ke GitHub =
langsung live**, persis alur Patah Pensill.

TypeScript dipakai **hanya sebagai pemeriksa** (`tsc --noEmit`), tak pernah
menghasilkan berkas yang dikirim ke browser (§CD-2).

## Deploy ke GitHub Pages (5 menit)

1. Buat repo baru di GitHub, mis. `malomo-qt`. **Harus publik** agar GitHub Pages
   gratis (Pages untuk repo privat perlu langganan berbayar).
2. Unggah seluruh isi folder ini ke root repo (bukan di dalam subfolder).
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
   `main`, folder `/ (root)` → Save.
4. Tunggu ±1 menit. Aplikasi hidup di `https://<username>.github.io/malomo-qt/`.
5. Buka di HP, lalu **Add to Home Screen** (wajib di iOS — lihat di bawah).

Berkas `.nojekyll` sudah disertakan supaya Pages menyajikan folder `src/` apa
adanya tanpa diproses Jekyll.

### Berita otomatis (opsional tapi disarankan)

`.github/workflows/news-fetch.yml` mengambil RSS kripto dua kali sejam dan
commit `data/news.json`. Agar bisa menulis balik ke repo:
Settings → Actions → General → **Workflow permissions** → pilih **Read and write
permissions** → Save. Tanpa ini, tab Berita tetap kosong tapi aplikasi jalan
normal (§N-R1).

## iOS: pemasangan itu wajib, bukan opsional

Safari menghapus IndexedDB situs yang tak dipasang setelah **7 hari tanpa dibuka**.
Kalau kamu memakai iPhone: buka di Safari → Share → **Add to Home Screen**, lalu
selalu buka dari ikon itu. Aplikasi akan mengingatkanmu. Ini alasan jurnal &
statistikmu tak hilang (§19).

> Domain Binance kadang diblokir ISP di Indonesia. Bila daftar pair kosong padahal
> koneksi ada, coba VPN. Pesan galat di aplikasi sudah menyebut ini.

## Verifikasi lokal (opsional, butuh Node ≥ 20)

```bash
node scripts/check.js             # invarian arsitektur (§CD-5, §NET-4, §ST-R1)
node scripts/check-cache-bump.js  # penjaga cache service worker (§CD-7)
node --test                       # 35 uji unit (skor, indikator, barrier, anti-lookahead)
node scripts/selftest.js          # smoke test pipeline ujung-ke-ujung
npx tsc -p tsconfig.json          # type-check JSDoc (butuh: npm i -D typescript)
```

CI (`.github/workflows/checks.yml`) menjalankan semuanya pada tiap push/PR.

## Peta struktur

```
index.html            shell aplikasi + bootstrap modul
sw.js                 service worker (network-first; TAK pernah cache Binance)
manifest.json         manifest PWA
src/
  core/               types.js (Bias vs Side, jembatan biasToSide), config.js (semua ambang)
  indicators/         indikator murni & kausal, struktur pasar (SMC ringkas, AVWAP)
  scoring/            mesin skor: criterion → engine → families → pipeline; markov; calibration
  net/                gateway (satu-satunya pintu ke Binance), binance, wsmanager, orderflow
  store/              IndexedDB (db.js), triple barrier & ekspektasi (barrier.js)
  ui/                 render, market, news, evidence, app (controller 6 tab)
  workers/            worker komputasi + client fallback (§CD-8)
data/                 calibration.json (prior), calendar.json, news.json
scripts/              check, check-cache-bump, selftest, fetch-news
tests/                uji node:test
research/             backtest.js (Bidang Riset — impor scoring/ yang SAMA)
```

## Dua bidang (§2)

- **Bidang Live** — PWA statis di HP. Membaca `data/calibration.json`, tak pernah
  menghitung bobotnya sendiri.
- **Bidang Riset** — `research/backtest.js` di PC. Menghasilkan artefak satu arah.
  Mengimpor `src/scoring/**` & `src/indicators/**` **yang sama persis** dengan
  live, sehingga tak ada celah backtest-vs-live. Lihat `research/README.md`.

Penjaga `scripts/check.js` menegakkan `scoring/` & `indicators/` tak menyentuh UI
atau jaringan — itulah yang membuat keduanya bisa dijalankan identik di dua tempat.

## Apa yang diperbaiki dari Patah Pensill

| Cacat lama | Perbaikan |
|---|---|
| Skor sirkular (kekuatan = kekompakan) | Tiga angka **terpisah**: arah / kekuatan / kekompakan (§17.3) |
| Bug tipe: `bias('bullish') === side('long')` selalu `false`, kategori MTF berbobot 15 selalu 0 | `Bias` & `Side` kosakata berbeda; konversi hanya lewat `biasToSide()`, ditegakkan pemeriksa (§21.1) |
| Bollinger membagi dengan `period`, bukan jumlah data nyata | `null` bila data < period; deviasi std memakai period penuh (§21.1 #3) |
| Repainting (indikator di atas bar berjalan) | `slice(0,-1)` untuk data tertutup; uji prefix-stability (§21.3) |
| Akurasi 24-jam yang menyesatkan | Triple barrier + ekspektasi setelah biaya + **baseline acak** + gate kewajaran (§6, §20) |
| Klaim "akurasi ~100%" | Angka setinggi itu memicu **gate peringatan wajib**, bukan perayaan (§O-R9) |

## Keputusan produk yang masih terbuka (PRD §13)

Aplikasi berjalan dengan nilai prior berikut; ubah bila kamu memutuskan lain:

1. **Repo publik** untuk Pages gratis? (prior: ya)
2. Nasib repo MALOMO v5.0.1 yang lama.
3. Bidang Riset ditulis ulang atau pakai ulang komponen lama.
4. **Ukuran Tier A** (prior: 30) — lihat `src/core/config.js` → `UNIVERSE.tierASize`.
5. **Bobot prior keluarga** (prior: semua sama) — lihat `PRIOR_WEIGHTS`.
6. Nama repo final.

## Catatan bobot & jujur soal status

Sampai Bidang Riset mengukur information coefficient tiap keluarga, semua bobot
= 1 dan aplikasi **menandainya sebagai prior** di setiap kartu ("belum
tervalidasi"). Tab **Bukti** menolak menampilkan persentase sebelum 30 sinyal
terevaluasi, dan menyandingkan hasil dengan baseline acak. Ini disengaja.

---

Lisensi: pemakaian pribadi. Silakan pakai untuk dirimu sendiri.
